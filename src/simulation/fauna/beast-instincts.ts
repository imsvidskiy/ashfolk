import { ADULT_YOUTH, ANIMALS } from "../../content/animals.ts";
import { isWinter } from "../../content/seasons.ts";
import { clamp } from "../../shared/math.ts";
import type { RandomSource, RandomState } from "../../shared/random.ts";
import { faceTowards, moveAlong, setDestination, stopMoving } from "../agents/movement.ts";
import type { NavigationGrid, Waypoint } from "../agents/navigation.ts";
import type { WorldState } from "../world/world-state.ts";
import type { Animal, FaunaTick } from "./fauna.ts";
import { CALM_FEAR, startleAnimal } from "./fear.ts";

const SCENT_RADIUS = 300;
const PROWL_RADIUS = 3500;
const PROWL_HUNGER = 0.55;
const PROWL_STAND_OFF = 90;
const HUNT_CHECK_SECONDS = 3;
const HUNT_CHANCE = 0.9;
const MOST_HUNT_CHANCE = 0.9;
const STARTING_HUNGER = 0.5;
const HUNGER_PER_DAY = 0.7;
const LONGEST_HUNT_SECONDS = 60;
const REST_AFTER_FEAST_DAYS = 2;
const REST_AFTER_FAILURE_DAYS = 1;
const HURT_SHARE = 0.55;
const LONE_COMPANIONS = 1;
const GROUP_COMPANIONS = 3;
const BITE_REACH = 1.7;
const BITE_CHANCE = 0.62;
const BITE_DAMAGE: readonly [number, number] = [0.12, 0.19];
const BITE_SECONDS: readonly [number, number] = [0.9, 1.4];
const RETARGET_SECONDS = 0.5;
const FIRST_STRIKE_SECONDS: readonly [number, number] = [0.2, 0.8];
const CLOSING_DISTANCE = BITE_REACH * 0.6;
const FLINCH_SECONDS = 0.45;
const STALKING_SPEED_SHARE = 0.85;
const CHARGE_SECONDS = 7;
const CHARGE_GIVE_UP_DISTANCE = 50;
const CHARGE_SPEED_SHARE = 1.2;
const MAMMOTH_REACH = 3.4;
const STAG_REACH = 1.8;
const TRAMPLE_DAMAGE: readonly [number, number] = [0.38, 0.55];
const GORE_DAMAGE: readonly [number, number] = [0.14, 0.24];
const MAMMOTH_CHARGE_CHANCE = 0.5;
const BULL_CHARGE_CHANCE = 0.45;
const HERD_GUARD_RADIUS = 45;
const STAG_NOTICE_RADIUS = 5;
const STAG_CHANCE = 0.4;
const CORNERED_SECONDS = 0.3;
const CHASE_HUNGER = 0.3;
const CHASE_CHANCE = 0.7;
const CHASE_START_DISTANCE = 45;
const LONGEST_CHASE_SECONDS = 22;
const CHASE_SPEED_SHARE = 1.15;
const POUNCE_REACH = 1.6;
const PREY_LEAD_SECONDS = 0.6;
const POUNCE_CHANCE = 0.5;
const POUNCE_SECONDS: readonly [number, number] = [0.4, 0.8];
const SMALL_PREY_MEAL = 0.45;
const REST_AFTER_SMALL_PREY_DAYS = 0.2;
const REST_AFTER_ESCAPE_DAYS = 0.05;

export interface Quarry {
  readonly companions: number;
  readonly frailty: number;
  readonly id: number;
  readonly isSheltered: boolean;
  readonly x: number;
  readonly z: number;
}

type BlowKind = "bite" | "gore" | "trample";

export interface BeastBlow {
  readonly attacker: Animal;
  readonly damage: number;
  readonly isFirst: boolean;
  readonly kind: BlowKind;
}

export interface Assailant {
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

export interface PeopleSense {
  findQuarry: (x: number, z: number, radius: number) => Quarry | null;
  locate: (id: number) => Quarry | null;
  nearest: (x: number, z: number, radius: number) => Quarry | null;
  wound: (id: number, blow: BeastBlow) => void;
}

export interface Pack {
  goalX: number;
  goalZ: number;
  readonly id: number;
  readonly kind: Animal["kind"];
  readonly memberIds: readonly number[];
}

interface PackHunt {
  hasDrawnBlood: boolean;
  readonly preyId: number;
  seconds: number;
  readonly startingSize: number;
}

interface PreySense {
  find: (id: number) => Animal | null;
  kill: (animal: Animal) => void;
  nearest: (x: number, z: number, radius: number) => Animal | null;
}

interface InstinctSources {
  readonly chaseRandom: RandomSource;
  readonly navigation: NavigationGrid;
  readonly prey: PreySense;
  readonly random: RandomSource;
  readonly world: WorldState;
}

export interface InstinctsSnapshot {
  charges: Map<number, Charge>;
  chaseRandom: RandomState;
  flinches: Map<number, number>;
  moods: Map<number, PackMood>;
  random: RandomState;
  strikes: Map<number, Strike>;
}

interface PreyChase {
  hasCaught: boolean;
  readonly preyId: number;
  seconds: number;
}

interface PackMood {
  chase: PreyChase | null;
  checkSeconds: number;
  hunger: number;
  hunt: PackHunt | null;
  restDays: number;
}

interface Charge {
  readonly blow: BlowKind;
  hasStruck: boolean;
  seconds: number;
  readonly targetId: number;
}

interface Strike {
  cooldownSeconds: number;
  retargetSeconds: number;
}

function nightFactor(hours: number): number {
  if (hours >= 20 || hours < 5.5) {
    return 1;
  }

  if (hours >= 17.5 || hours < 7.5) {
    return 0.6;
  }

  return 0.25;
}

function between(random: RandomSource, range: readonly [number, number]): number {
  return random.between(range[0], range[1]);
}

function packBoldness(hunger: number, packSize: number, tick: FaunaTick): number {
  const winter = isWinter(tick.season) ? 2 : 1;
  const strength = clamp(packSize / 4, 0.4, 1.2);

  return tick.rules.nature.beastBoldness * nightFactor(tick.hours) * winter * hunger * strength;
}

function isTame(tick: FaunaTick): boolean {
  return tick.rules.nature.beastBoldness <= 0;
}

function refill<Value>(target: Map<number, Value>, source: ReadonlyMap<number, Value>): void {
  target.clear();

  for (const [key, value] of source) {
    target.set(key, value);
  }
}

export function isHurt(animal: Animal): boolean {
  return animal.health < ANIMALS[animal.kind].health * HURT_SHARE;
}

function prowl(pack: Pack, mood: PackMood, members: readonly Animal[], tick: FaunaTick): void {
  const [leader] = members;

  if (leader === undefined || mood.hunt !== null || mood.hunger < PROWL_HUNGER || isTame(tick)) {
    return;
  }

  const scent = tick.threats.people.nearest(leader.mover.x, leader.mover.z, PROWL_RADIUS);

  if (scent === null) {
    return;
  }

  const awayX = leader.mover.x - scent.x;
  const awayZ = leader.mover.z - scent.z;
  const distance = Math.max(1, Math.hypot(awayX, awayZ));

  pack.goalX = scent.x + (awayX / distance) * PROWL_STAND_OFF;
  pack.goalZ = scent.z + (awayZ / distance) * PROWL_STAND_OFF;
}

function herdBull(wounded: Animal, herdMates: readonly Animal[]): Animal | null {
  let bull: Animal | null = null;

  for (const mate of herdMates) {
    const isAdult = mate.isAlive && mate.youth <= ADULT_YOUTH && mate !== wounded;
    const isNear = Math.hypot(mate.mover.x - wounded.mover.x, mate.mover.z - wounded.mover.z) < HERD_GUARD_RADIUS;

    if (isAdult && isNear && (bull === null || mate.health > bull.health)) {
      bull = mate;
    }
  }

  return bull;
}

function holdStill(animal: Animal, pose: Animal["pose"]): void {
  animal.pose = pose;
  animal.speed = 0;
  stopMoving(animal.mover);
}

function scatter(animals: readonly Animal[], from: Waypoint): void {
  for (const animal of animals) {
    startleAnimal(animal, from.x, from.z, 1);
  }
}

export class BeastInstincts {
  readonly #chaseRandom: RandomSource;
  readonly #charges = new Map<number, Charge>();
  readonly #flinches = new Map<number, number>();
  readonly #moods = new Map<number, PackMood>();
  readonly #navigation: NavigationGrid;
  readonly #prey: PreySense;
  readonly #random: RandomSource;
  readonly #strikes = new Map<number, Strike>();
  readonly #world: WorldState;

  constructor(sources: InstinctSources) {
    this.#world = sources.world;
    this.#navigation = sources.navigation;
    this.#random = sources.random;
    this.#chaseRandom = sources.chaseRandom;
    this.#prey = sources.prey;
  }

  snapshot(): InstinctsSnapshot {
    return {
      charges: structuredClone(this.#charges),
      chaseRandom: this.#chaseRandom.state(),
      flinches: new Map(this.#flinches),
      moods: structuredClone(this.#moods),
      random: this.#random.state(),
      strikes: structuredClone(this.#strikes),
    };
  }

  restore(snapshot: InstinctsSnapshot): void {
    this.#chaseRandom.restore(snapshot.chaseRandom);
    this.#random.restore(snapshot.random);
    refill(this.#charges, snapshot.charges);
    refill(this.#flinches, snapshot.flinches);
    refill(this.#moods, snapshot.moods);
    refill(this.#strikes, snapshot.strikes);
  }

  huntOf(packId: number): PackHunt | null {
    const mood = this.#moods.get(packId);

    if (mood === undefined) {
      return null;
    }

    return mood.hunt;
  }

  isCharging(animal: Animal): boolean {
    return this.#charges.has(animal.id);
  }

  steerPacks(packs: readonly Pack[], tick: FaunaTick): void {
    for (const pack of packs) {
      if (pack.kind !== "wolf") {
        continue;
      }

      const members = pack.memberIds
        .map((id) => {
          return this.#prey.find(id);
        })
        .filter((animal) => {
          return animal !== null;
        });

      this.#steerPack(pack, members, tick);
    }

    this.#updateFlinches(tick.seconds);
  }

  watchCornered(animal: Animal, tick: FaunaTick): void {
    const isGrazer = animal.kind === "deer" || animal.kind === "ibex";

    if (!isGrazer || animal.youth > ADULT_YOUTH || animal.fear <= CALM_FEAR || this.#charges.has(animal.id)) {
      return;
    }

    if (animal.mover.stuckSeconds < CORNERED_SECONDS) {
      return;
    }

    const person = tick.threats.people.nearest(animal.mover.x, animal.mover.z, STAG_NOTICE_RADIUS);

    if (person === null) {
      return;
    }

    if (this.#random.chance(STAG_CHANCE * tick.rules.nature.beastBoldness)) {
      this.#startCharge(animal, person.id, "gore");
    }
  }

  isEngaged(animal: Animal, packHunt: PackHunt | null): boolean {
    return (
      this.#charges.has(animal.id) ||
      this.#flinches.has(animal.id) ||
      packHunt !== null ||
      this.#chaseOf(animal.herdId) !== null
    );
  }

  act(animal: Animal, packHunt: PackHunt | null, tick: FaunaTick): void {
    if (this.#flinches.has(animal.id)) {
      holdStill(animal, "flinch");

      return;
    }

    const charge = this.#charges.get(animal.id);

    if (charge !== undefined) {
      this.#charge(animal, charge, tick);

      return;
    }

    if (packHunt !== null) {
      this.#hunt(animal, packHunt, tick);

      return;
    }

    const chase = this.#chaseOf(animal.herdId);

    if (chase !== null) {
      this.#pursue(animal, chase, tick);
    }
  }

  provoke(animal: Animal, assailant: Assailant, herdMates: readonly Animal[], boldness: number): void {
    if (animal.kind !== "mammoth" || !animal.isAlive || this.#charges.has(animal.id)) {
      return;
    }

    if (this.#random.chance(MAMMOTH_CHARGE_CHANCE * boldness)) {
      this.#startCharge(animal, assailant.id, "trample");

      return;
    }

    const bull = herdBull(animal, herdMates);

    if (bull !== null && this.#random.chance(BULL_CHARGE_CHANCE * boldness)) {
      this.#startCharge(bull, assailant.id, "trample");
    }
  }

  flinch(animal: Animal): void {
    this.#flinches.set(animal.id, FLINCH_SECONDS);
  }

  forget(animal: Animal): void {
    this.#charges.delete(animal.id);
    this.#flinches.delete(animal.id);
    this.#strikes.delete(animal.id);
  }

  forgetPack(packId: number): void {
    this.#moods.delete(packId);
  }

  abandonHunt(packId: number, members: readonly Animal[], from: Waypoint): void {
    const mood = this.#moods.get(packId);

    if (mood === undefined || mood.hunt === null) {
      return;
    }

    this.#callOffHunt(mood, members, from);
  }

  #steerPack(pack: Pack, members: readonly Animal[], tick: FaunaTick): void {
    const mood = this.#moodOf(pack.id);

    mood.hunger = Math.min(1, mood.hunger + tick.days * HUNGER_PER_DAY);
    mood.restDays -= tick.days;

    if (mood.hunt !== null) {
      this.#followHunt(mood, mood.hunt, members, tick);

      return;
    }

    if (mood.chase !== null) {
      this.#followChase(mood, mood.chase, members, tick);

      return;
    }

    mood.checkSeconds -= tick.seconds;

    if (mood.checkSeconds > 0 || mood.restDays > 0) {
      return;
    }

    mood.checkSeconds = HUNT_CHECK_SECONDS;
    this.#considerHunt(mood, members, tick);

    if (this.#trackPrey(pack, mood, members, tick)) {
      return;
    }

    prowl(pack, mood, members, tick);
  }

  #followHunt(mood: PackMood, hunt: PackHunt, members: readonly Animal[], tick: FaunaTick): void {
    hunt.seconds += tick.seconds;

    const prey = tick.threats.people.locate(hunt.preyId);

    if (prey === null) {
      mood.hunt = null;
      mood.hunger = hunt.hasDrawnBlood ? 0 : mood.hunger;
      mood.restDays = hunt.hasDrawnBlood ? REST_AFTER_FEAST_DAYS : REST_AFTER_FAILURE_DAYS;
      this.#forgetStrikes(members);

      return;
    }

    const isBroken =
      members.length < hunt.startingSize ||
      members.some((member) => {
        return isHurt(member);
      });
    const isGuarded = prey.isSheltered || prey.companions >= GROUP_COMPANIONS;

    if (isGuarded || isBroken || hunt.seconds > LONGEST_HUNT_SECONDS) {
      this.#callOffHunt(mood, members, prey);
    }
  }

  #callOffHunt(mood: PackMood, members: readonly Animal[], from: Waypoint): void {
    mood.hunt = null;
    mood.restDays = REST_AFTER_FAILURE_DAYS;
    this.#forgetStrikes(members);
    scatter(members, from);
  }

  #trackPrey(pack: Pack, mood: PackMood, members: readonly Animal[], tick: FaunaTick): boolean {
    const [leader] = members;

    if (leader === undefined || mood.hunt !== null || mood.hunger < CHASE_HUNGER || isTame(tick)) {
      return false;
    }

    const prey = this.#prey.nearest(leader.mover.x, leader.mover.z, SCENT_RADIUS);

    if (prey === null) {
      return false;
    }

    const distance = Math.hypot(prey.mover.x - leader.mover.x, prey.mover.z - leader.mover.z);

    if (distance > CHASE_START_DISTANCE) {
      pack.goalX = prey.mover.x;
      pack.goalZ = prey.mover.z;

      return true;
    }

    if (this.#chaseRandom.chance(CHASE_CHANCE)) {
      mood.chase = { hasCaught: false, preyId: prey.id, seconds: 0 };
    }

    return true;
  }

  #followChase(mood: PackMood, chase: PreyChase, members: readonly Animal[], tick: FaunaTick): void {
    chase.seconds += tick.seconds;

    const prey = this.#prey.find(chase.preyId);

    const isOver = prey === null || !prey.isAlive || chase.seconds > LONGEST_CHASE_SECONDS;

    if (!isOver) {
      return;
    }

    mood.chase = null;
    mood.hunger = chase.hasCaught ? Math.max(0, mood.hunger - SMALL_PREY_MEAL) : mood.hunger;
    mood.restDays = chase.hasCaught ? REST_AFTER_SMALL_PREY_DAYS : REST_AFTER_ESCAPE_DAYS;

    this.#forgetStrikes(members);

    for (const member of members) {
      if (member.pose === "charge" || member.pose === "attack") {
        member.pose = "walk";
      }
    }
  }

  #pursue(animal: Animal, chase: PreyChase, tick: FaunaTick): void {
    const prey = this.#prey.find(chase.preyId);

    if (prey === null || !prey.isAlive) {
      holdStill(animal, "walk");

      return;
    }

    const { x, z } = prey.mover;

    const distance = Math.hypot(x - animal.mover.x, z - animal.mover.z);
    const strike = this.#strikeOf(animal, this.#chaseRandom);

    strike.cooldownSeconds -= tick.seconds;

    if (distance > POUNCE_REACH || strike.cooldownSeconds > 0) {
      const lead = prey.speed * PREY_LEAD_SECONDS;
      const ahead = { x: x + Math.sin(prey.mover.heading) * lead, z: z + Math.cos(prey.mover.heading) * lead };

      this.#runAt(animal, ahead, strike, ANIMALS[animal.kind].runSpeed * CHASE_SPEED_SHARE, tick);

      return;
    }

    strike.cooldownSeconds = between(this.#chaseRandom, POUNCE_SECONDS);
    holdStill(animal, "attack");
    faceTowards(animal.mover, x, z);

    if (this.#chaseRandom.chance(POUNCE_CHANCE)) {
      chase.hasCaught = true;
      this.#prey.kill(prey);
    }
  }

  #chaseOf(packId: number): PreyChase | null {
    const mood = this.#moods.get(packId);

    if (mood === undefined) {
      return null;
    }

    return mood.chase;
  }

  #considerHunt(mood: PackMood, members: readonly Animal[], tick: FaunaTick): void {
    const [leader] = members;

    if (
      leader === undefined ||
      members.some((member) => {
        return isHurt(member);
      })
    ) {
      return;
    }

    const quarry = tick.threats.people.findQuarry(leader.mover.x, leader.mover.z, SCENT_RADIUS);

    if (quarry === null || quarry.isSheltered || quarry.companions > LONE_COMPANIONS) {
      return;
    }

    const boldness = packBoldness(mood.hunger, members.length, tick);

    if (!this.#random.chance(clamp(boldness * quarry.frailty * HUNT_CHANCE, 0, MOST_HUNT_CHANCE))) {
      return;
    }

    mood.hunt = { hasDrawnBlood: false, preyId: quarry.id, seconds: 0, startingSize: members.length };
  }

  #hunt(animal: Animal, hunt: PackHunt, tick: FaunaTick): void {
    const prey = tick.threats.people.locate(hunt.preyId);

    if (prey === null) {
      return;
    }

    const distance = Math.hypot(prey.x - animal.mover.x, prey.z - animal.mover.z);
    const strike = this.#strikeOf(animal);

    if (distance > BITE_REACH) {
      this.#runAt(animal, prey, strike, ANIMALS.wolf.runSpeed * STALKING_SPEED_SHARE, tick);

      return;
    }

    holdStill(animal, "attack");
    faceTowards(animal.mover, prey.x, prey.z);
    strike.cooldownSeconds -= tick.seconds;

    if (strike.cooldownSeconds > 0) {
      return;
    }

    strike.cooldownSeconds = between(this.#random, BITE_SECONDS);

    if (!this.#random.chance(BITE_CHANCE)) {
      return;
    }

    const isFirst = !hunt.hasDrawnBlood;

    hunt.hasDrawnBlood = true;
    tick.threats.people.wound(prey.id, {
      attacker: animal,
      damage: between(this.#random, BITE_DAMAGE),
      isFirst,
      kind: "bite",
    });
  }

  #charge(animal: Animal, charge: Charge, tick: FaunaTick): void {
    charge.seconds += tick.seconds;

    const target = tick.threats.people.locate(charge.targetId);

    if (target === null || charge.hasStruck || charge.seconds > CHARGE_SECONDS) {
      this.#endCharge(animal, target);

      return;
    }

    const distance = Math.hypot(target.x - animal.mover.x, target.z - animal.mover.z);
    const reach = animal.kind === "mammoth" ? MAMMOTH_REACH : STAG_REACH;

    if (distance > CHARGE_GIVE_UP_DISTANCE) {
      this.#endCharge(animal, target);

      return;
    }

    if (distance > reach) {
      this.#runAt(animal, target, this.#strikeOf(animal), ANIMALS[animal.kind].runSpeed * CHARGE_SPEED_SHARE, tick);

      return;
    }

    charge.hasStruck = true;
    holdStill(animal, "attack");
    faceTowards(animal.mover, target.x, target.z);
    tick.threats.people.wound(target.id, {
      attacker: animal,
      damage: between(this.#random, charge.blow === "trample" ? TRAMPLE_DAMAGE : GORE_DAMAGE),
      isFirst: true,
      kind: charge.blow,
    });
  }

  #endCharge(animal: Animal, from: Waypoint | null): void {
    this.#charges.delete(animal.id);
    this.#strikes.delete(animal.id);

    if (from !== null) {
      startleAnimal(animal, from.x, from.z, 1);
    }
  }

  #startCharge(animal: Animal, targetId: number, blow: BlowKind): void {
    this.#charges.set(animal.id, { blow, hasStruck: false, seconds: 0, targetId });
  }

  #forgetStrikes(members: readonly Animal[]): void {
    for (const member of members) {
      this.#strikes.delete(member.id);
    }
  }

  #runAt(animal: Animal, target: Waypoint, strike: Strike, speed: number, tick: FaunaTick): void {
    strike.retargetSeconds -= tick.seconds;

    if (strike.retargetSeconds <= 0) {
      strike.retargetSeconds = RETARGET_SECONDS;
      setDestination(animal.mover, target, this.#navigation, { arrivalDistance: CLOSING_DISTANCE });
    }

    animal.pose = "charge";
    animal.speed = speed;
    moveAlong(animal.mover, tick.seconds, speed, this.#world, this.#navigation);
  }

  #strikeOf(animal: Animal, random: RandomSource = this.#random): Strike {
    const existing = this.#strikes.get(animal.id);

    if (existing !== undefined) {
      return existing;
    }

    const strike: Strike = { cooldownSeconds: between(random, FIRST_STRIKE_SECONDS), retargetSeconds: 0 };

    this.#strikes.set(animal.id, strike);

    return strike;
  }

  #moodOf(packId: number): PackMood {
    const existing = this.#moods.get(packId);

    if (existing !== undefined) {
      return existing;
    }

    const mood: PackMood = {
      chase: null,
      checkSeconds: this.#random.next() * HUNT_CHECK_SECONDS,
      hunger: STARTING_HUNGER,
      hunt: null,
      restDays: 0,
    };

    this.#moods.set(packId, mood);

    return mood;
  }

  #updateFlinches(seconds: number): void {
    for (const [id, remaining] of this.#flinches) {
      if (remaining - seconds <= 0) {
        this.#flinches.delete(id);
      } else {
        this.#flinches.set(id, remaining - seconds);
      }
    }
  }
}
