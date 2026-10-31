import type { RandomSource } from "../../../shared/random.ts";
import type { Mover } from "../../agents/movement.ts";
import type { Animal } from "../../fauna/fauna.ts";
import type { JobKind } from "../jobs/job.ts";
import { isChild, type Person } from "../person.ts";
import type { SocietyContext } from "../society-context.ts";
import { type CarriedWeapon, carriedWeapon } from "../weapons.ts";
import type { CombatLedger } from "./combat-ledger.ts";
import { WEAPON_STATS, weaponDamage } from "./combat-stats.ts";
import type { Foe } from "./foes.ts";
import { wallCover } from "./walls.ts";

const GUARD_CHANCE: Readonly<Record<CarriedWeapon["kind"], number>> = { bow: 0.1, none: 0.2, spear: 0.34 };
const FLAT_FOOTED_GUARD = 0.04;
const FACING_THRESHOLD = 0.25;
const DAMAGE_SPREAD = 0.25;
const CHILD_FRAILTY = 1.3;
const SPARED_SHARE = 0.65;
const SPARED_HEALTH = 0.1;
const BEAST_DAMAGE_SCALE = 3;
const FIGHTING_JOBS: ReadonlySet<JobKind> = new Set(["defend", "fight", "raid"]);

type StrikeOutcome = "blocked" | "hit" | "killed" | "missed";

function isFighting(person: Person): boolean {
  const { job } = person;

  return job !== null && FIGHTING_JOBS.has(job.kind);
}

function facing(mover: Mover, toward: Mover): number {
  const awayX = toward.x - mover.x;
  const awayZ = toward.z - mover.z;

  const distance = Math.hypot(awayX, awayZ);

  if (distance < 0.01) {
    return 1;
  }

  return (Math.sin(mover.heading) * awayX + Math.cos(mover.heading) * awayZ) / distance;
}

function guardChance(defender: Person, attacker: Person, ledger: CombatLedger): number {
  if (!isFighting(defender) || ledger.isStaggered(defender.id) || isChild(defender)) {
    return FLAT_FOOTED_GUARD;
  }

  if (facing(defender.mover, attacker.mover) < FACING_THRESHOLD) {
    return FLAT_FOOTED_GUARD;
  }

  return GUARD_CHANCE[carriedWeapon(defender).kind];
}

export function rolledDamage(weapon: CarriedWeapon, random: RandomSource): number {
  return weaponDamage(weapon) * (1 + random.signed() * DAMAGE_SPREAD);
}

export function hurtPerson(victim: Person, damage: number, slayer: Person, context: SocietyContext): StrikeOutcome {
  const { rivalry } = context;

  const frailty = isChild(victim) ? CHILD_FRAILTY : 1;
  const cover = wallCover(victim, slayer, context.buildings.all);

  victim.health -= damage * frailty * (1 - cover);
  rivalry.ledger.stagger(victim.id, slayer.id);

  if (victim.health > 0) {
    return "hit";
  }

  if (rivalry.random.chance(SPARED_SHARE)) {
    victim.health = SPARED_HEALTH;

    return "hit";
  }

  rivalry.slay(victim, slayer, context);

  return "killed";
}

export function hurtAnimal(animal: Animal, damage: number, slayer: Person, context: SocietyContext): StrikeOutcome {
  const assailant = { id: slayer.id, x: slayer.mover.x, z: slayer.mover.z };

  if (context.fauna.wound(animal, damage * BEAST_DAMAGE_SCALE, assailant, context.rules)) {
    return "killed";
  }

  return "hit";
}

export function strike(attacker: Person, weapon: CarriedWeapon, foe: Foe, context: SocietyContext): StrikeOutcome {
  const { ledger, random } = context.rivalry;

  if (!random.chance(WEAPON_STATS[weapon.kind].accuracy)) {
    return "missed";
  }

  const damage = rolledDamage(weapon, random);

  if (foe.kind === "animal") {
    return hurtAnimal(foe.animal, damage, attacker, context);
  }

  if (random.chance(guardChance(foe.person, attacker, ledger))) {
    ledger.guard(foe.person.id, attacker.id);

    return "blocked";
  }

  return hurtPerson(foe.person, damage, attacker, context);
}
