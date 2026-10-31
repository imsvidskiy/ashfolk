import { ADULT_YOUTH, ANIMALS, type AnimalKind } from "../../content/animals.ts";
import type { WorldRules } from "../../content/world-rules.ts";
import { clamp, distanceSquared, FULL_TURN } from "../../shared/math.ts";
import { between, createRandom, type RandomSource, type RandomState } from "../../shared/random.ts";
import type { AnimalPose } from "../../world/agent-poses.ts";
import type { Hop } from "../agents/hops.ts";
import {
  createMover,
  hasArrived,
  isStranded,
  type Mover,
  moveAlong,
  placeMover,
  savedMover,
  setDestination,
  stopMoving,
} from "../agents/movement.ts";
import type { NavigationGrid, Waypoint } from "../agents/navigation.ts";
import type { IdentifierSource } from "../identifiers.ts";
import type { WorldState } from "../world/world-state.ts";
import {
  type Assailant,
  BeastInstincts,
  type InstinctsSnapshot,
  isHurt,
  type Pack,
  type PeopleSense,
} from "./beast-instincts.ts";
import { CALM_FEAR, startleAnimal } from "./fear.ts";
import { canStand, escapeRoute, findNewHome, findPasture, herdKindAt, smallGameAt } from "./habitat.ts";

const HERD_SPREAD = 30;
const HERD_START_SCATTER = 15;
const HERD_RETARGET_SECONDS: readonly [number, number] = [25, 65];
const GRAZE_SECONDS: readonly [number, number] = [4, 12];
const LINGER_SECONDS: readonly [number, number] = [3, 9];
const FIRST_GRAZE_SECONDS = 5;
const GAIT_PHASE_SPREAD = 10;
const MAMMOTH_GAIT_RATE = 0.55;
const CALF_OFFSET = 2;
const SCATTER_ATTEMPTS_PER_HERD = 60;
const SCATTER_REACH = 0.9;
const BURNING_GROUND = 0.25;
const FIRE_DAMAGE_PER_SECOND = 0.5;
const FEAR_DECAY_PER_SECOND = 0.12;
const FLEE_REPLAN_SECONDS = 2.5;
const FIRE_AWARENESS = 60;
const FIRE_STARTLE_DISTANCE = 5;
const WANDER_DISTANCE_TO_FOLLOW = 35;
const CORPSE_SECONDS = 30;
const FALL_SECONDS = 1.3;
const EDGE_MARGIN = 4;
const YOUTH_DECAY_PER_DAY = 0.5;
const MENACE_SEARCH_PADDING = 1;
const ALERT_SECONDS: readonly [number, number] = [0.6, 1.2];
const SKITTISH_ALERT_SECONDS: readonly [number, number] = [0.3, 0.6];
const SKITTISH_REPLAN_SECONDS = 1.2;
const HUNTER_FEAR = 0.8;
const PREDATOR_FEAR = 0.9;
const LIVED_SHARE: readonly [number, number] = [0.05, 0.85];
const MOST_SMALL_GAME_GROUPS_PER_SQUARE_KILOMETER = 1.3;
const DISPERSAL_PER_DAY = 0.8;
const DISPERSING_MEMBERS = 2;

type AnimalDeathCause = "age" | "blast" | "fire" | "hunt" | "lightning" | "prey" | "tornado";

export interface Animal {
  appearanceSeed: number;
  causeOfDeath: AnimalDeathCause | null;
  deathSeconds: number;
  fear: number;
  fleeFromX: number;
  fleeFromZ: number;
  health: number;
  herdId: number;
  id: number;
  isAlive: boolean;
  kind: AnimalKind;
  lifeDays: number;
  mover: Mover;
  offsetX: number;
  offsetZ: number;
  phase: number;
  pose: AnimalPose;
  poseSeconds: number;
  speed: number;
  threatCheckSeconds: number;
  youth: number;
}

interface Herd extends Pack {
  memberIds: number[];
  retargetSeconds: number;
}

export interface FaunaSnapshot {
  animals: Animal[];
  herds: Herd[];
  instincts: InstinctsSnapshot;
  smallGameRandom: RandomState;
}

export interface FaunaThreats {
  dangerNear: (x: number, z: number, radius: number) => Waypoint | null;
  hunterNear: (x: number, z: number, radius: number) => Waypoint | null;
  people: PeopleSense;
}

export interface FaunaTick {
  days: number;
  hours: number;
  random: RandomSource;
  rules: WorldRules;
  season: number;
  seconds: number;
  threats: FaunaThreats;
}

function settleFall(animal: Animal): void {
  if (animal.pose === "fall" && animal.deathSeconds > FALL_SECONDS) {
    animal.pose = "dead";
  }
}

function litterSize(range: readonly [number, number], random: RandomSource): number {
  const [smallest, largest] = range;

  if (smallest === largest) {
    return smallest;
  }

  return random.integer(smallest, largest + 1);
}

function phaseRate(kind: AnimalKind): number {
  if (kind === "mammoth") {
    return MAMMOTH_GAIT_RATE;
  }

  return 1;
}

function hopSpeedOf(kind: AnimalKind): number {
  const { runSpeed, walkSpeed } = ANIMALS[kind];

  return kind === "mammoth" ? walkSpeed : runSpeed;
}

export class FaunaSystem {
  readonly #animalsById = new Map<number, Animal>();
  readonly #herdsById = new Map<number, Herd>();
  readonly #identifiers: IdentifierSource;
  readonly #instincts: BeastInstincts;
  readonly #navigation: NavigationGrid;
  readonly #smallGameRandom: RandomSource;
  readonly #world: WorldState;
  #animals: Animal[] = [];
  #heldId: number | null = null;
  #herds: Herd[] = [];
  #predators: Animal[] = [];

  constructor(world: WorldState, navigation: NavigationGrid, identifiers: IdentifierSource) {
    this.#world = world;
    this.#navigation = navigation;
    this.#identifiers = identifiers;
    this.#smallGameRandom = createRandom(world.seed * 43 + 11);
    this.#instincts = new BeastInstincts({
      chaseRandom: createRandom(world.seed * 59 + 23),
      navigation,
      prey: {
        find: (id) => {
          return id === this.#heldId ? null : this.findAnimal(id);
        },
        kill: (animal) => {
          this.kill(animal, "prey");
        },
        nearest: (x, z, radius) => {
          return this.nearestAnimal(x, z, radius, (animal) => {
            return ANIMALS[animal.kind].isSmallGame;
          });
        },
      },
      random: createRandom(world.seed * 31 + 7),
      world,
    });
  }

  get animals(): readonly Animal[] {
    return this.#animals;
  }

  get herds(): readonly Herd[] {
    return this.#herds;
  }

  snapshot(): FaunaSnapshot {
    return {
      animals: this.#animals.map((animal) => {
        return structuredClone({ ...animal, mover: savedMover(animal.mover, true) });
      }),
      herds: structuredClone(this.#herds),
      instincts: this.#instincts.snapshot(),
      smallGameRandom: this.#smallGameRandom.state(),
    };
  }

  restore(snapshot: FaunaSnapshot): void {
    this.#animals = snapshot.animals;
    this.#herds = snapshot.herds;
    this.#predators = [];
    this.#heldId = null;
    this.#animalsById.clear();
    this.#herdsById.clear();

    for (const animal of this.#animals) {
      this.#animalsById.set(animal.id, animal);
    }

    for (const herd of this.#herds) {
      this.#herdsById.set(herd.id, herd);
    }

    this.#smallGameRandom.restore(snapshot.smallGameRandom);
    this.#instincts.restore(snapshot.instincts);
  }

  findAnimal(id: number): Animal | null {
    const animal = this.#animalsById.get(id);

    if (animal === undefined) {
      return null;
    }

    return animal;
  }

  spawnHerd(kind: AnimalKind, x: number, z: number, size: number, random: RandomSource): Herd | null {
    if (!this.canStand(kind, x, z)) {
      return null;
    }

    const herd: Herd = { goalX: x, goalZ: z, id: this.#identifiers.next(), kind, memberIds: [], retargetSeconds: 0 };

    for (let member = 0; member < size; member += 1) {
      this.#addAnimal(herd, x + random.signed() * HERD_START_SCATTER, z + random.signed() * HERD_START_SCATTER, random);
    }

    this.#addHerd(herd);

    return herd;
  }

  populate(herdCount: number, random: RandomSource): number {
    return this.#scatterHerds(herdCount, random, (x, z) => {
      return herdKindAt(this.#world, x, z, random);
    });
  }

  populateSmallGame(groupCount: number): number {
    return this.#scatterHerds(groupCount, this.#smallGameRandom, (x, z) => {
      return smallGameAt(this.#world, x, z);
    });
  }

  nearestAnimal(x: number, z: number, maximumDistance: number, accepts: (animal: Animal) => boolean): Animal | null {
    let nearest: Animal | null = null;
    let nearestDistance = maximumDistance * maximumDistance;

    for (const animal of this.#animals) {
      const squaredDistance = distanceSquared(animal.mover.x, animal.mover.z, x, z);

      if (animal.isAlive && !this.isHeld(animal) && squaredDistance < nearestDistance && accepts(animal)) {
        nearest = animal;
        nearestDistance = squaredDistance;
      }
    }

    return nearest;
  }

  livingWithin(x: number, z: number, radius: number): Animal[] {
    return this.#animals.filter((animal) => {
      return animal.isAlive && Math.hypot(animal.mover.x - x, animal.mover.z - z) < radius && !this.isHeld(animal);
    });
  }

  scare(x: number, z: number, radius: number): void {
    for (const animal of this.livingWithin(x, z, radius)) {
      startleAnimal(animal, x, z, 1);
    }
  }

  damageArea(x: number, z: number, radius: number, damage: number, cause: AnimalDeathCause): void {
    for (const animal of this.livingWithin(x, z, radius)) {
      const distance = Math.hypot(animal.mover.x - x, animal.mover.z - z);

      animal.health -= damage * (1 - distance / radius);

      if (animal.health <= 0) {
        this.kill(animal, cause);
      }
    }
  }

  wound(animal: Animal, damage: number, assailant: Assailant, rules: WorldRules): boolean {
    if (!animal.isAlive) {
      return false;
    }

    animal.health -= damage;

    if (animal.health <= 0) {
      this.kill(animal, "hunt");

      return true;
    }

    this.#instincts.flinch(animal);
    this.provoke(animal, assailant, rules);

    if (isHurt(animal) && !this.#instincts.isCharging(animal)) {
      this.#instincts.abandonHunt(animal.herdId, this.#packOf(animal), assailant);
      startleAnimal(animal, assailant.x, assailant.z, 1);
    }

    return false;
  }

  provoke(animal: Animal, assailant: Assailant, rules: WorldRules): void {
    this.#instincts.provoke(animal, assailant, this.#packOf(animal), rules.nature.beastBoldness);
  }

  menaceNear(x: number, z: number, radius: number): Animal | null {
    return this.nearestAnimal(x, z, radius + MENACE_SEARCH_PADDING, (animal) => {
      return this.isMenacing(animal);
    });
  }

  isMenacing(animal: Animal): boolean {
    return this.#instincts.isCharging(animal) || this.#instincts.huntOf(animal.herdId) !== null;
  }

  canStand(kind: AnimalKind, x: number, z: number): boolean {
    return canStand(this.#world, kind, x, z);
  }

  hold(animal: Animal): void {
    this.#heldId = animal.id;
    this.#instincts.forget(animal);
    animal.pose = "graze";
    animal.speed = 0;
    placeMover(animal.mover, animal.mover.x, animal.mover.z);
  }

  setDown(animal: Animal, x: number, z: number): void {
    this.#heldId = null;
    placeMover(animal.mover, x, z);
  }

  isHeld(animal: Animal): boolean {
    return this.#heldId === animal.id;
  }

  kill(animal: Animal, cause: AnimalDeathCause): void {
    if (!animal.isAlive) {
      return;
    }

    animal.isAlive = false;
    animal.causeOfDeath = cause;
    animal.pose = cause === "blast" || cause === "age" ? "dead" : "fall";
    this.#instincts.forget(animal);
    animal.speed = 0;
    stopMoving(animal.mover);

    const herd = this.#herdsById.get(animal.herdId);

    if (herd !== undefined) {
      herd.memberIds = herd.memberIds.filter((memberId) => {
        return memberId !== animal.id;
      });
    }
  }

  update(tick: FaunaTick): void {
    this.#predators = this.#animals.filter((animal) => {
      return animal.isAlive && animal.kind === "wolf";
    });

    for (const herd of this.#herds) {
      this.#steerHerd(herd, tick);
    }

    this.#instincts.steerPacks(this.#herds, tick);

    for (const animal of this.#animals) {
      this.#updateAnimal(animal, tick);
    }

    this.#breed(tick);
    this.#removeRemains();
  }

  #addAnimal(herd: Herd, x: number, z: number, random: RandomSource): Animal {
    const { bodyRadius, health, lifespanDays } = ANIMALS[herd.kind];

    const start = this.#spawnPoint(herd, x, z);

    const animal: Animal = {
      appearanceSeed: random.next(),
      causeOfDeath: null,
      deathSeconds: 0,
      fear: 0,
      fleeFromX: 0,
      fleeFromZ: 0,
      health,
      herdId: herd.id,
      id: this.#identifiers.next(),
      isAlive: true,
      kind: herd.kind,
      lifeDays: lifespanDays === null ? Number.POSITIVE_INFINITY : between(random, lifespanDays),
      mover: {
        ...createMover(start.x, start.z, random.next() * FULL_TURN, bodyRadius),
        hopSpeed: hopSpeedOf(herd.kind),
      },
      offsetX: random.signed() * HERD_SPREAD * 0.5,
      offsetZ: random.signed() * HERD_SPREAD * 0.5,
      phase: random.next() * GAIT_PHASE_SPREAD,
      pose: "graze",
      poseSeconds: random.next() * FIRST_GRAZE_SECONDS,
      speed: 0,
      threatCheckSeconds: random.next(),
      youth: 0,
    };

    herd.memberIds.push(animal.id);
    this.#animals.push(animal);
    this.#animalsById.set(animal.id, animal);

    return animal;
  }

  #addHerd(herd: Herd): void {
    this.#herds.push(herd);
    this.#herdsById.set(herd.id, herd);
  }

  #firstMember(herd: Herd): Animal | null {
    const [firstId] = herd.memberIds;

    return this.findAnimal(firstId);
  }

  #spawnPoint(herd: Herd, x: number, z: number): Waypoint {
    if (this.canStand(herd.kind, x, z)) {
      return { x, z };
    }

    return { x: herd.goalX, z: herd.goalZ };
  }

  #scatterHerds(herdCount: number, random: RandomSource, kindAt: (x: number, z: number) => AnimalKind | null): number {
    const { halfSize } = this.#world.grid;

    let created = 0;

    for (let attempt = 0; attempt < herdCount * SCATTER_ATTEMPTS_PER_HERD && created < herdCount; attempt += 1) {
      const x = random.signed() * halfSize * SCATTER_REACH;
      const z = random.signed() * halfSize * SCATTER_REACH;

      const kind = kindAt(x, z);

      if (kind === null) {
        continue;
      }

      const [smallest, largest] = ANIMALS[kind].herdSizeRange;

      const herd = this.spawnHerd(kind, x, z, random.integer(smallest, largest + 1), random);

      if (herd === null) {
        continue;
      }

      if (ANIMALS[kind].isSmallGame) {
        this.#ageFounders(herd, random);
      }

      created += 1;
    }

    return created;
  }

  #ageFounders(herd: Herd, random: RandomSource): void {
    for (const founder of this.#membersOf(herd)) {
      founder.lifeDays *= 1 - between(random, LIVED_SHARE);
    }
  }

  #randomFor(kind: AnimalKind, tick: FaunaTick): RandomSource {
    return ANIMALS[kind].isSmallGame ? this.#smallGameRandom : tick.random;
  }

  #steerHerd(herd: Herd, tick: FaunaTick): void {
    herd.retargetSeconds -= tick.seconds;

    const leader = this.#firstMember(herd);

    if (herd.retargetSeconds > 0 || leader === null) {
      return;
    }

    const random = this.#randomFor(herd.kind, tick);

    herd.retargetSeconds = between(random, HERD_RETARGET_SECONDS);

    const pasture = findPasture(this.#world, herd.kind, leader.mover, random);

    if (pasture !== null) {
      herd.goalX = pasture.x;
      herd.goalZ = pasture.z;
    }
  }

  #packOf(animal: Animal): Animal[] {
    const herd = this.#herdsById.get(animal.herdId);

    if (herd === undefined) {
      return [];
    }

    return this.#membersOf(herd);
  }

  #membersOf(herd: Herd): Animal[] {
    return herd.memberIds
      .map((id) => {
        return this.findAnimal(id);
      })
      .filter((member) => {
        return member !== null;
      });
  }

  #updateAnimal(animal: Animal, tick: FaunaTick): void {
    if (this.isHeld(animal)) {
      return;
    }

    if (!animal.isAlive) {
      animal.deathSeconds += tick.seconds;
      settleFall(animal);

      return;
    }

    animal.youth = Math.max(0, animal.youth - tick.days * YOUTH_DECAY_PER_DAY);
    animal.lifeDays -= tick.days;

    if (animal.lifeDays <= 0) {
      this.kill(animal, "age");

      return;
    }

    this.#sufferFire(animal, tick);

    if (!animal.isAlive) {
      return;
    }

    const packHunt = this.#instincts.huntOf(animal.herdId);

    this.#lookForThreats(animal, this.#instincts.isEngaged(animal, packHunt), tick);
    this.#instincts.watchCornered(animal, tick);

    const { hop } = animal.mover;

    if (hop !== null) {
      this.#keepHopping(animal, tick, hop);
    } else if (isStranded(animal.mover, this.#world)) {
      this.#swimAshore(animal, tick);
    } else if (this.#instincts.isEngaged(animal, packHunt)) {
      this.#instincts.act(animal, packHunt, tick);
    } else if (animal.fear > CALM_FEAR) {
      this.#flee(animal, tick);
    } else {
      this.#graze(animal, tick);
    }

    animal.phase += tick.seconds * animal.speed * phaseRate(animal.kind);
    this.#keepOnIsland(animal);
  }

  #keepHopping(animal: Animal, tick: FaunaTick, hop: Hop): void {
    animal.pose = animal.kind === "mammoth" ? "walk" : "run";
    animal.speed = hop.speed;
    moveAlong(animal.mover, tick.seconds, animal.speed, this.#world, this.#navigation);
  }

  #sufferFire(animal: Animal, tick: FaunaTick): void {
    const cell = this.#world.grid.cellAt(animal.mover.x, animal.mover.z);

    if (cell < 0 || this.#world.fields.fire[cell] <= BURNING_GROUND) {
      return;
    }

    animal.health -= FIRE_DAMAGE_PER_SECOND * tick.seconds;
    startleAnimal(
      animal,
      animal.mover.x - Math.sin(animal.mover.heading) * FIRE_STARTLE_DISTANCE,
      animal.mover.z - Math.cos(animal.mover.heading) * FIRE_STARTLE_DISTANCE,
      1
    );

    if (animal.health <= 0) {
      this.kill(animal, "fire");
    }
  }

  #lookForThreats(animal: Animal, isEngaged: boolean, tick: FaunaTick): void {
    animal.threatCheckSeconds -= tick.seconds;

    if (animal.threatCheckSeconds > 0) {
      return;
    }

    const { fleeDistance, isSmallGame } = ANIMALS[animal.kind];
    const { x, z } = animal.mover;

    const alertSeconds = isSmallGame ? SKITTISH_ALERT_SECONDS : ALERT_SECONDS;

    animal.threatCheckSeconds = between(this.#randomFor(animal.kind, tick), alertSeconds);

    const fire = tick.threats.dangerNear(x, z, FIRE_AWARENESS);
    const hunter = tick.threats.hunterNear(x, z, fleeDistance);

    if (fire !== null) {
      startleAnimal(animal, fire.x, fire.z, 1);
    }

    if (hunter !== null && !isEngaged) {
      startleAnimal(animal, hunter.x, hunter.z, HUNTER_FEAR);
    }

    const predator = isSmallGame ? this.#nearestPredator(x, z, fleeDistance) : null;

    if (predator !== null) {
      startleAnimal(animal, predator.mover.x, predator.mover.z, PREDATOR_FEAR);
    }
  }

  #nearestPredator(x: number, z: number, radius: number): Animal | null {
    let nearest: Animal | null = null;
    let nearestDistance = radius * radius;

    for (const predator of this.#predators) {
      const squaredDistance = distanceSquared(predator.mover.x, predator.mover.z, x, z);

      if (squaredDistance < nearestDistance) {
        nearest = predator;
        nearestDistance = squaredDistance;
      }
    }

    return nearest;
  }

  #swimAshore(animal: Animal, tick: FaunaTick): void {
    const { runSpeed, walkSpeed } = ANIMALS[animal.kind];

    const isAfraid = animal.fear > CALM_FEAR;

    animal.pose = isAfraid ? "run" : "walk";
    animal.speed = isAfraid ? runSpeed : walkSpeed;
    moveAlong(animal.mover, tick.seconds, animal.speed, this.#world, this.#navigation);
  }

  #flee(animal: Animal, tick: FaunaTick): void {
    const { mover } = animal;

    animal.fear -= tick.seconds * FEAR_DECAY_PER_SECOND;
    animal.poseSeconds -= tick.seconds;

    if (animal.pose !== "run" || animal.poseSeconds <= 0) {
      const random = this.#randomFor(animal.kind, tick);

      setDestination(mover, escapeRoute(this.#world, animal, random), this.#navigation, { canPlanRoute: false });
      animal.pose = "run";
      animal.poseSeconds = ANIMALS[animal.kind].isSmallGame ? SKITTISH_REPLAN_SECONDS : FLEE_REPLAN_SECONDS;
    }

    animal.speed = ANIMALS[animal.kind].runSpeed;

    if (moveAlong(mover, tick.seconds, animal.speed, this.#world, this.#navigation)) {
      animal.poseSeconds = 0;
    }
  }

  #graze(animal: Animal, tick: FaunaTick): void {
    const herd = this.#herdsById.get(animal.herdId);

    animal.poseSeconds -= tick.seconds;

    if (animal.pose === "run") {
      animal.pose = "graze";
    }

    if (herd === undefined || animal.pose === "graze") {
      this.#keepGrazing(animal, herd, tick);

      return;
    }

    animal.speed = ANIMALS[animal.kind].walkSpeed;

    if (moveAlong(animal.mover, tick.seconds, animal.speed, this.#world, this.#navigation)) {
      animal.pose = "graze";
      animal.poseSeconds = between(this.#randomFor(animal.kind, tick), GRAZE_SECONDS);
    }
  }

  #keepGrazing(animal: Animal, herd: Herd | undefined, tick: FaunaTick): void {
    animal.speed = 0;
    stopMoving(animal.mover);

    if (herd === undefined || animal.poseSeconds > 0) {
      return;
    }

    const targetX = herd.goalX + animal.offsetX;
    const targetZ = herd.goalZ + animal.offsetZ;

    if (Math.hypot(targetX - animal.mover.x, targetZ - animal.mover.z) <= WANDER_DISTANCE_TO_FOLLOW) {
      animal.poseSeconds = between(this.#randomFor(animal.kind, tick), LINGER_SECONDS);

      return;
    }

    setDestination(animal.mover, { x: targetX, z: targetZ }, this.#navigation);
    animal.pose = hasArrived(animal.mover) ? "graze" : "walk";
  }

  #keepOnIsland(animal: Animal): void {
    const limit = this.#world.grid.halfSize - EDGE_MARGIN;

    animal.mover.x = clamp(animal.mover.x, -limit, limit);
    animal.mover.z = clamp(animal.mover.z, -limit, limit);
  }

  #breed(tick: FaunaTick): void {
    for (const herd of this.#herds) {
      const { breeding } = ANIMALS[herd.kind];

      if (tick.season < breeding.season[0] || tick.season >= breeding.season[1]) {
        continue;
      }

      const chance = tick.days * breeding.perDay * tick.rules.nature.animalBirthRate;

      this.#tryCalving(herd, chance, this.#randomFor(herd.kind, tick));
    }

    this.#disperse(tick.days);
  }

  #tryCalving(herd: Herd, chance: number, random: RandomSource): void {
    const { breeding, maximumHerdSize } = ANIMALS[herd.kind];

    const mother = this.#firstMember(herd);

    if (mother === null || herd.memberIds.length >= maximumHerdSize) {
      return;
    }

    if (!random.chance(chance)) {
      return;
    }

    const litter = litterSize(breeding.litterSize, random);

    for (let young = 0; young < litter && herd.memberIds.length < maximumHerdSize; young += 1) {
      const calf = this.#addAnimal(herd, mother.mover.x + CALF_OFFSET, mother.mover.z + CALF_OFFSET, random);

      calf.youth = 1;
    }
  }

  #disperse(days: number): void {
    const random = this.#smallGameRandom;
    const groups = this.#herds.filter((herd) => {
      return ANIMALS[herd.kind].isSmallGame;
    });
    const limit = Math.round(MOST_SMALL_GAME_GROUPS_PER_SQUARE_KILOMETER * this.#world.grid.squareKilometers);

    let groupCount = groups.length;

    for (const herd of groups) {
      if (groupCount >= limit) {
        return;
      }

      const isFull = herd.memberIds.length >= ANIMALS[herd.kind].maximumHerdSize;

      if (isFull && random.chance(days * DISPERSAL_PER_DAY) && this.#foundGroup(herd, random)) {
        groupCount += 1;
      }
    }
  }

  #foundGroup(herd: Herd, random: RandomSource): boolean {
    const leader = this.#firstMember(herd);

    if (leader === null) {
      return false;
    }

    const grown = this.#membersOf(herd)
      .filter((member) => {
        return member !== leader && member.youth <= ADULT_YOUTH;
      })
      .slice(-DISPERSING_MEMBERS);

    if (grown.length < DISPERSING_MEMBERS) {
      return false;
    }

    const home = findNewHome(this.#world, herd.kind, leader.mover, random);

    if (home === null) {
      return false;
    }

    const group: Herd = {
      goalX: home.x,
      goalZ: home.z,
      id: this.#identifiers.next(),
      kind: herd.kind,
      memberIds: grown.map((member) => {
        return member.id;
      }),
      retargetSeconds: between(random, HERD_RETARGET_SECONDS),
    };

    herd.memberIds = herd.memberIds.filter((id) => {
      return !group.memberIds.includes(id);
    });

    for (const member of grown) {
      member.herdId = group.id;
      member.pose = "walk";
      setDestination(member.mover, { x: home.x + member.offsetX, z: home.z + member.offsetZ }, this.#navigation);
    }

    this.#addHerd(group);

    return true;
  }

  #removeRemains(): void {
    const hasExpired = this.#animals.some((animal) => {
      return !animal.isAlive && animal.deathSeconds > CORPSE_SECONDS;
    });

    if (!hasExpired) {
      return;
    }

    for (const animal of this.#animals) {
      if (!animal.isAlive && animal.deathSeconds > CORPSE_SECONDS) {
        this.#animalsById.delete(animal.id);
      }
    }

    for (const herd of this.#herds) {
      if (herd.memberIds.length === 0) {
        this.#herdsById.delete(herd.id);
        this.#instincts.forgetPack(herd.id);
      }
    }

    this.#animals = this.#animals.filter((animal) => {
      return animal.isAlive || animal.deathSeconds <= CORPSE_SECONDS;
    });
    this.#herds = this.#herds.filter((herd) => {
      return herd.memberIds.length > 0;
    });
  }
}
