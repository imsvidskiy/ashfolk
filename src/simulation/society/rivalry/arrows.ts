import type { RandomSource } from "../../../shared/random.ts";
import type { EffectLog } from "../../effects.ts";
import type { Person } from "../person.ts";
import type { SocietyContext } from "../society-context.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { WEAPON_STATS } from "./combat-stats.ts";
import { distanceTo, type Foe, foeGirth, foeMover, isFoeAlive } from "./foes.ts";
import { hurtAnimal, hurtPerson, rolledDamage } from "./strikes.ts";

export const ARROW_SPEED = 38;
const SHORTEST_FLIGHT = 0.15;
const LONG_SHOT_PENALTY = 0.45;
const MOVING_TARGET = 3;
const MOVING_TARGET_PENALTY = 0.7;
const MISS_ANGLE_SPREAD = 0.5;
const SHORTEST_MISS = 1.5;
const LONGEST_MISS = 5;
const LANDING_TOLERANCE = 3;

interface ArrowFlight {
  readonly damage: number;
  readonly foe: Foe;
  readonly isHit: boolean;
  readonly landX: number;
  readonly landZ: number;
  remainingSeconds: number;
  readonly shooter: Person;
}

function hitChance(weapon: CarriedWeapon, foe: Foe, distance: number): number {
  const mover = foeMover(foe);
  const { accuracy, reach } = WEAPON_STATS[weapon.kind];

  const speed = Math.hypot(mover.velocityX, mover.velocityZ);
  const range = 1 - LONG_SHOT_PENALTY * Math.min(1, distance / reach);

  return accuracy * range * (speed > MOVING_TARGET ? MOVING_TARGET_PENALTY : 1);
}

function land(flight: ArrowFlight, context: SocietyContext): void {
  const { foe } = flight;

  const target = foeMover(foe);

  const isStillThere = Math.hypot(target.x - flight.landX, target.z - flight.landZ) < LANDING_TOLERANCE + foeGirth(foe);

  if (!(flight.isHit && isFoeAlive(foe) && isStillThere)) {
    return;
  }

  if (foe.kind === "animal") {
    hurtAnimal(foe.animal, flight.damage, flight.shooter, context);

    return;
  }

  hurtPerson(foe.person, flight.damage, flight.shooter, context);
}

export class ArrowFlights {
  readonly #effects: EffectLog;
  #flights: ArrowFlight[] = [];

  constructor(effects: EffectLog) {
    this.#effects = effects;
  }

  loose(shooter: Person, weapon: CarriedWeapon, foe: Foe, random: RandomSource): void {
    const target = foeMover(foe);

    const distance = distanceTo(shooter.mover, foe);
    const isHit = random.chance(hitChance(weapon, foe, distance));
    const durationSeconds = Math.max(SHORTEST_FLIGHT, distance / ARROW_SPEED);

    const aimX = target.x + target.velocityX * durationSeconds;
    const aimZ = target.z + target.velocityZ * durationSeconds;
    const missAngle = Math.atan2(aimX - shooter.mover.x, aimZ - shooter.mover.z) + random.signed() * MISS_ANGLE_SPREAD;
    const miss = isHit ? 0 : random.between(SHORTEST_MISS, LONGEST_MISS) + foeGirth(foe);

    const landX = aimX + Math.sin(missAngle) * miss;
    const landZ = aimZ + Math.cos(missAngle) * miss;

    this.#flights.push({
      damage: rolledDamage(weapon, random),
      foe,
      isHit,
      landX,
      landZ,
      remainingSeconds: durationSeconds,
      shooter,
    });
    this.#effects.add({
      durationSeconds,
      fromX: shooter.mover.x,
      fromZ: shooter.mover.z,
      isHit,
      kind: "arrow",
      toX: landX,
      toZ: landZ,
    });
  }

  clear(): void {
    this.#flights = [];
  }

  update(seconds: number, context: SocietyContext): void {
    if (this.#flights.length === 0) {
      return;
    }

    for (const flight of this.#flights) {
      flight.remainingSeconds -= seconds;
    }

    const landed = this.#flights.filter((flight) => {
      return flight.remainingSeconds <= 0;
    });

    this.#flights = this.#flights.filter((flight) => {
      return flight.remainingSeconds > 0;
    });

    for (const flight of landed) {
      land(flight, context);
    }
  }
}
