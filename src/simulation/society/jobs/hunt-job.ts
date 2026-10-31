import { ANIMALS, animalWithArticle } from "../../../content/animals.ts";
import { faceTowards } from "../../agents/movement.ts";
import type { Animal } from "../../fauna/fauna.ts";
import { startleAnimal } from "../../fauna/fear.ts";
import { pickUp, type Weapon, walkSpeed } from "../person.ts";
import { ARROW_SPEED } from "../rivalry/arrows.ts";
import type { PersonTick } from "../society-context.ts";
import { learn, markScarce } from "../tribe.ts";
import { armForHunt, canShoot, weaponHitBonus } from "../weapons.ts";
import { DeliverJob } from "./deliver-job.ts";
import { headTo, type Job, standStill, walk } from "./job.ts";

const HUNT_SECONDS = 50;
const HUNTING_RANGE = 800;
const THROWING_RANGE = 28;
const SHOOTING_RANGE = 46;
const LOST_RANGE_MARGIN = 6;
const RETARGET_SECONDS = 2;
const FIRST_THROW_DELAY = 0.5;
const THROW_COOLDOWN = 2.2;
const SHOT_COOLDOWN = 1.8;
const MAXIMUM_CARRIED_MEAT = 8;
const HELPER_RANGE = 40;
const MAMMOTH_REACH = 12;
const MAMMOTH_COUNTERATTACK = 0.15;
const MAMMOTH_WOUND = 0.35;
const HELPER_HIT_BONUS = 0.05;
const SMALL_GAME_RANGE = 360;
const SMALL_GAME_PREFERENCE = 0.35;

type HuntPhase = "stalk" | "strike";

function strikingRange(weapon: Weapon): number {
  return weapon.kind === "bow" ? SHOOTING_RANGE : THROWING_RANGE;
}

export function findGame(tick: PersonTick): HuntJob | null {
  const { tribe } = tick;

  const weapon = armForHunt(tick.person, tribe);

  if (weapon === null) {
    return null;
  }

  const animal = chooseGame(tick);

  if (animal === null) {
    markScarce(tribe, "game", tick.context.environment.day);

    return null;
  }

  return new HuntJob(tick, animal, weapon);
}

function chooseGame(tick: PersonTick): Animal | null {
  const { campX, campZ, memberCount } = tick.tribe;
  const { fauna } = tick.context;

  function isHuntable(candidate: Animal, isSmallGame: boolean): boolean {
    const { huntingPartySize } = ANIMALS[candidate.kind];

    return (
      ANIMALS[candidate.kind].isSmallGame === isSmallGame &&
      huntingPartySize !== null &&
      memberCount >= huntingPartySize
    );
  }

  const game = fauna.nearestAnimal(campX, campZ, HUNTING_RANGE, (candidate) => {
    return isHuntable(candidate, false);
  });
  const smallGame = fauna.nearestAnimal(campX, campZ, SMALL_GAME_RANGE, (candidate) => {
    return isHuntable(candidate, true);
  });

  if (game === null || smallGame === null) {
    return game === null ? smallGame : game;
  }

  const gameDistance = Math.hypot(game.mover.x - campX, game.mover.z - campZ);
  const smallGameDistance = Math.hypot(smallGame.mover.x - campX, smallGame.mover.z - campZ);

  return smallGameDistance < gameDistance * SMALL_GAME_PREFERENCE ? smallGame : game;
}

function loose(tick: PersonTick, animal: Animal, isHit: boolean): void {
  const { mover } = tick.person;
  const { random } = tick.context;

  const missX = isHit ? 0 : random.signed() * 4;
  const missZ = isHit ? 0 : random.signed() * 4;

  const toX = animal.mover.x + missX;
  const toZ = animal.mover.z + missZ;

  tick.tribe.stock.arrows -= 1;
  tick.context.effects.add({
    durationSeconds: Math.hypot(toX - mover.x, toZ - mover.z) / ARROW_SPEED,
    fromX: mover.x,
    fromZ: mover.z,
    isHit,
    kind: "arrow",
    toX,
    toZ,
  });
}

function provokeAnimal(tick: PersonTick, animal: Animal): void {
  const { mover } = tick.person;

  tick.context.fauna.provoke(animal, { id: tick.person.id, x: mover.x, z: mover.z }, tick.context.rules);
}

function hitChance(tick: PersonTick, animal: Animal, weapon: Weapon): number {
  const definition = ANIMALS[animal.kind];

  const chance = definition.hitChance + weaponHitBonus(weapon);

  if (definition.huntingPartySize === null || definition.huntingPartySize <= 1) {
    return chance;
  }

  const helpers = tick.context.people.countNear(animal.mover.x, animal.mover.z, HELPER_RANGE, (person) => {
    return person.tribeId === tick.tribe.id && person.job?.kind === "hunt";
  });

  return chance + HELPER_HIT_BONUS * helpers;
}

function sufferCounterattack(tick: PersonTick, animal: Animal, distance: number): void {
  if (animal.kind !== "mammoth" || distance >= MAMMOTH_REACH) {
    return;
  }

  if (!tick.context.random.chance(MAMMOTH_COUNTERATTACK)) {
    return;
  }

  tick.person.health -= MAMMOTH_WOUND;

  if (tick.person.health <= 0) {
    tick.context.people.kill(tick.person, "mammoth");

    return;
  }

  tick.context.chronicle.record({
    category: "warning",
    text: `${tick.person.name} was hurt by a mammoth`,
    tribeId: tick.tribe.id,
    x: tick.person.mover.x,
    z: tick.person.mover.z,
  });
}

function bringDown(tick: PersonTick, animal: Animal): Job {
  const { food, isSmallGame } = ANIMALS[animal.kind];

  const carried = Math.min(MAXIMUM_CARRIED_MEAT, food);

  tick.context.fauna.kill(animal, "hunt");
  pickUp(tick.person, "meat", carried, "meat");
  tick.tribe.stock.meat += food - carried;
  learn(tick.tribe, 3, tick.context.rules);

  if (!isSmallGame) {
    tick.context.chronicle.record({
      category: "hunt",
      text: `${tick.tribe.name} hunters brought down ${animalWithArticle(animal.kind)}`,
      tribeId: tick.tribe.id,
      x: animal.mover.x,
      z: animal.mover.z,
    });
  }

  return new DeliverJob(tick);
}

export class HuntJob implements Job {
  readonly kind = "hunt";
  readonly #animalId: number;
  readonly #weapon: Weapon;
  #phase: HuntPhase = "stalk";
  #remainingSeconds = HUNT_SECONDS;
  #retargetSeconds = 0;
  #throwCooldown = 0;

  constructor(tick: PersonTick, animal: Animal, weapon: Weapon) {
    this.#animalId = animal.id;
    this.#weapon = weapon;
    headTo(tick.person, animal.mover, tick.context);
  }

  update(tick: PersonTick): Job | null {
    this.#remainingSeconds -= tick.seconds;

    const animal = tick.context.fauna.findAnimal(this.#animalId);

    if (animal === null || !animal.isAlive || tick.context.fauna.isHeld(animal) || this.#remainingSeconds <= 0) {
      return null;
    }

    const distance = Math.hypot(animal.mover.x - tick.person.mover.x, animal.mover.z - tick.person.mover.z);

    if (this.#phase === "stalk") {
      this.#stalk(tick, animal, distance);

      return this;
    }

    return this.#strike(tick, animal, distance);
  }

  #stalk(tick: PersonTick, animal: Animal, distance: number): void {
    this.#retargetSeconds -= tick.seconds;

    if (this.#retargetSeconds <= 0) {
      this.#retargetSeconds = RETARGET_SECONDS;
      headTo(tick.person, animal.mover, tick.context);
    }

    walk(tick, walkSpeed(tick.person) * (distance > 60 ? 1.1 : 0.75));

    if (distance < strikingRange(this.#weapon)) {
      this.#phase = "strike";
      this.#throwCooldown = FIRST_THROW_DELAY;
    }
  }

  #strike(tick: PersonTick, animal: Animal, distance: number): Job | null {
    const isBow = this.#weapon.kind === "bow";

    standStill(tick.person, isBow ? "shoot" : "throw");
    faceTowards(tick.person.mover, animal.mover.x, animal.mover.z);

    if (distance > strikingRange(this.#weapon) + LOST_RANGE_MARGIN) {
      this.#phase = "stalk";

      return this;
    }

    this.#throwCooldown -= tick.seconds;

    if (this.#throwCooldown > 0) {
      return this;
    }

    if (isBow && !canShoot(tick.tribe)) {
      return null;
    }

    this.#throwCooldown = isBow ? SHOT_COOLDOWN : THROW_COOLDOWN;
    sufferCounterattack(tick, animal, distance);

    if (!tick.person.isAlive) {
      return null;
    }

    const isHit = tick.context.random.chance(hitChance(tick, animal, this.#weapon));

    if (isBow) {
      loose(tick, animal, isHit);
    }

    if (!isHit) {
      startleAnimal(animal, tick.person.mover.x, tick.person.mover.z, 0.8);
      this.#phase = "stalk";

      return this;
    }

    animal.health -= 1;

    if (animal.health > 0) {
      startleAnimal(animal, tick.person.mover.x, tick.person.mover.z, 1);
      provokeAnimal(tick, animal);

      return this;
    }

    return bringDown(tick, animal);
  }
}
