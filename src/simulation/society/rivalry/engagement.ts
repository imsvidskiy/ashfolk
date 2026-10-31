import { hashToUnit } from "../../../shared/math.ts";
import type { PersonPose } from "../../../world/agent-poses.ts";
import { faceTowards, setDestination } from "../../agents/movement.ts";
import { nearestWalkableSpot } from "../../agents/walkable-ground.ts";
import { standStill, walk } from "../jobs/job.ts";
import { runSpeed, walkSpeed } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { type CarriedWeapon, canShoot } from "../weapons.ts";
import { BARE_HANDS, WEAPON_STATS } from "./combat-stats.ts";
import { distanceTo, type Foe, foeGirth, foeMover } from "./foes.ts";
import { strike } from "./strikes.ts";

const RETARGET_SECONDS = 0.4;
const CLOSING_SHARE = 0.75;
const BOW_CLOSEST = 7;
const BOW_PREFERRED = 18;
const BACK_OFF_DISTANCE = 10;
const BACK_OFF_PACE = 1.3;
const STRIKE_SPREAD = 0.15;
const FLANK_SALT = 17.3;
const FLANK_SPREAD = 1.5;
const SPOT_SEARCH_RADIUS = 20;
const ELBOW_ROOM = 0.9;
const LONGEST_SHUFFLE_SECONDS = 2;
const ARRIVAL_DISTANCE = 0.4;
const MELEE_POSES: Readonly<Record<"none" | "spear", PersonPose>> = { none: "brawl", spear: "thrust" };

function isCrowded(tick: PersonTick): boolean {
  const { person } = tick;

  return tick.context.people.livingWithin(person.mover.x, person.mover.z, ELBOW_ROOM).some((neighbor) => {
    return neighbor.id < person.id;
  });
}

function faceFoe(tick: PersonTick, foe: Foe): void {
  const target = foeMover(foe);

  faceTowards(tick.person.mover, target.x, target.z);
}

export function runningPose(weapon: CarriedWeapon): PersonPose {
  return weapon.kind === "spear" ? "charge" : "run";
}

export class Engagement {
  readonly #weapon: CarriedWeapon;
  #cooldownSeconds: number;
  #retargetSeconds = 0;
  #shufflingSeconds = 0;

  constructor(weapon: CarriedWeapon, firstDelay: number) {
    this.#weapon = weapon;
    this.#cooldownSeconds = firstDelay * WEAPON_STATS[weapon.kind].strikeSeconds;
  }

  update(tick: PersonTick, foe: Foe): void {
    const { person } = tick;

    if (tick.context.rivalry.ledger.isStaggered(person.id)) {
      standStill(person, "flinch");

      return;
    }

    const distance = distanceTo(person.mover, foe);

    if (this.#weapon.kind !== "bow") {
      this.#fight(tick, foe, distance, this.#weapon);

      return;
    }

    if (!canShoot(tick.tribe)) {
      this.#fight(tick, foe, distance, BARE_HANDS);

      return;
    }

    this.#shoot(tick, foe, distance);
  }

  #fight(tick: PersonTick, foe: Foe, distance: number, weapon: CarriedWeapon): void {
    const { person } = tick;
    const { kind } = weapon;

    const reach = WEAPON_STATS[kind].reach + foeGirth(foe);

    if (distance > reach || this.#makesRoom(tick)) {
      this.#close(tick, foe, WEAPON_STATS[kind].reach * CLOSING_SHARE + foeGirth(foe));

      return;
    }

    const isGuarding = tick.context.rivalry.ledger.isGuarding(person.id);

    standStill(person, isGuarding || kind === "bow" ? "block" : MELEE_POSES[kind]);
    faceFoe(tick, foe);
    this.#cooldownSeconds -= tick.seconds;

    if (this.#cooldownSeconds > 0 || isGuarding) {
      return;
    }

    this.#cooldownSeconds = this.#nextCooldown(tick);
    strike(person, weapon, foe, tick.context);
  }

  #shoot(tick: PersonTick, foe: Foe, distance: number): void {
    const { person } = tick;

    if (distance > WEAPON_STATS.bow.reach) {
      this.#close(tick, foe, BOW_PREFERRED + foeGirth(foe));

      return;
    }

    if (distance < BOW_CLOSEST) {
      this.#backOff(tick, foe);

      return;
    }

    if (this.#makesRoom(tick)) {
      this.#close(tick, foe, distance);

      return;
    }

    standStill(person, "shoot");
    faceFoe(tick, foe);
    this.#cooldownSeconds -= tick.seconds;

    if (this.#cooldownSeconds > 0) {
      return;
    }

    this.#cooldownSeconds = this.#nextCooldown(tick);
    tick.tribe.stock.arrows -= 1;
    tick.context.rivalry.loose(person, this.#weapon, foe);
  }

  #makesRoom(tick: PersonTick): boolean {
    if (!isCrowded(tick) || this.#shufflingSeconds > LONGEST_SHUFFLE_SECONDS) {
      this.#shufflingSeconds = 0;

      return false;
    }

    this.#shufflingSeconds += tick.seconds;

    return true;
  }

  #close(tick: PersonTick, foe: Foe, standOff: number): void {
    const { person } = tick;

    const target = foeMover(foe);

    this.#retargetSeconds -= tick.seconds;

    if (this.#retargetSeconds <= 0) {
      const flank = (hashToUnit(person.id, FLANK_SALT) - 0.5) * 2 * FLANK_SPREAD;
      const angle = Math.atan2(person.mover.x - target.x, person.mover.z - target.z) + flank;
      const spot = { x: target.x + Math.sin(angle) * standOff, z: target.z + Math.cos(angle) * standOff };

      this.#retargetSeconds = RETARGET_SECONDS;
      setDestination(
        person.mover,
        nearestWalkableSpot(tick.context.world, spot, SPOT_SEARCH_RADIUS),
        tick.context.navigation,
        {
          arrivalDistance: ARRIVAL_DISTANCE,
        }
      );
    }

    walk(tick, runSpeed(person));
    person.pose = runningPose(this.#weapon);
  }

  #backOff(tick: PersonTick, foe: Foe): void {
    const { person } = tick;

    const target = foeMover(foe);

    this.#retargetSeconds -= tick.seconds;

    if (this.#retargetSeconds <= 0) {
      const awayX = person.mover.x - target.x;
      const awayZ = person.mover.z - target.z;
      const length = Math.max(0.01, Math.hypot(awayX, awayZ));

      const retreat = {
        x: person.mover.x + (awayX / length) * BACK_OFF_DISTANCE,
        z: person.mover.z + (awayZ / length) * BACK_OFF_DISTANCE,
      };

      this.#retargetSeconds = RETARGET_SECONDS;
      setDestination(
        person.mover,
        nearestWalkableSpot(tick.context.world, retreat, SPOT_SEARCH_RADIUS),
        tick.context.navigation
      );
    }

    walk(tick, walkSpeed(person) * BACK_OFF_PACE);
  }

  #nextCooldown(tick: PersonTick): number {
    const { strikeSeconds } = WEAPON_STATS[this.#weapon.kind];

    return strikeSeconds * (1 + tick.context.rivalry.random.signed() * STRIKE_SPREAD);
  }
}
