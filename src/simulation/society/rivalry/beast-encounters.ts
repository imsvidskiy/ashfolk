import type { BeastBlow, PeopleSense, Quarry } from "../../fauna/beast-instincts.ts";
import { takeUpJob } from "../decisions.ts";
import type { JobKind } from "../jobs/job.ts";
import { isChild, isElder, type Person } from "../person.ts";
import type { SocietyContext } from "../society-context.ts";
import type { Tribe } from "../tribe.ts";
import { litCampfireOf } from "../tribe-places.ts";
import { carriedWeapon } from "../weapons.ts";
import { FightJob, ShelterJob } from "./defense-jobs.ts";
import { animalFoe } from "./foes.ts";
import { describePlace } from "./places.ts";
import { canFight } from "./raids.ts";
import { capitalized, theTribe } from "./stories.ts";

const FIRESIDE_RADIUS = 60;
const CAMP_SHELTER_RADIUS = 50;
const COMPANION_RADIUS = 15;
const KIN_RALLY_RADIUS = 85;
const CHILD_FRAILTY = 1;
const ELDER_FRAILTY = 0.8;
const WOUNDED_FRAILTY = 0.85;
const UNARMED_FRAILTY = 0.6;
const ARMED_FRAILTY = 0.4;
const PAIRED_FRAILTY = 0.4;
const WOUNDED_HEALTH = 0.5;
const STEADFAST_JOBS: ReadonlySet<JobKind> = new Set(["defend", "fight", "flee", "hide", "raid"]);

interface Deed {
  readonly ending: string;
  readonly verb: string;
}

const KILLING_DEEDS: Readonly<Record<BeastBlow["kind"], Deed>> = {
  bite: { ending: "", verb: "killed" },
  gore: { ending: " to death", verb: "gored" },
  trample: { ending: "", verb: "trampled" },
};

const ATTACK: Deed = { ending: "", verb: "attacked" };

function isSteadfast(person: Person): boolean {
  const kind = person.job?.kind;

  return kind !== undefined && STEADFAST_JOBS.has(kind);
}

function isSheltered(person: Person, tribe: Tribe, context: SocietyContext): boolean {
  const { x, z } = person.mover;

  if (Math.hypot(tribe.campX - x, tribe.campZ - z) < CAMP_SHELTER_RADIUS) {
    return true;
  }

  const campfire = litCampfireOf(tribe, context.buildings);

  return campfire !== null && Math.hypot(campfire.x - x, campfire.z - z) < FIRESIDE_RADIUS;
}

function frailtyOf(person: Person): number {
  if (isChild(person)) {
    return CHILD_FRAILTY;
  }

  if (isElder(person)) {
    return ELDER_FRAILTY;
  }

  if (person.health < WOUNDED_HEALTH) {
    return WOUNDED_FRAILTY;
  }

  return carriedWeapon(person).kind === "none" ? UNARMED_FRAILTY : ARMED_FRAILTY;
}

function beastName(blow: BeastBlow): string {
  if (blow.attacker.kind === "wolf") {
    return "wolves";
  }

  if (blow.attacker.kind === "mammoth") {
    return "a mammoth";
  }

  return blow.attacker.kind === "ibex" ? "an ibex" : "a stag";
}

export class BeastEncounters implements PeopleSense {
  readonly #context: SocietyContext;

  constructor(context: SocietyContext) {
    this.#context = context;
  }

  findQuarry(x: number, z: number, radius: number): Quarry | null {
    let best: Quarry | null = null;
    let bestScore = 0;

    const context = this.#context;

    for (const person of context.people.livingWithin(x, z, radius)) {
      const tribe = context.people.findTribe(person.tribeId);

      if (tribe === null || isSheltered(person, tribe, context)) {
        continue;
      }

      const nearness = 1 + Math.hypot(person.mover.x - x, person.mover.z - z) / radius;

      if (frailtyOf(person) / nearness <= bestScore) {
        continue;
      }

      const quarry = this.#describe(person, false);
      const score = quarry.frailty / nearness;

      if (score > bestScore) {
        best = quarry;
        bestScore = score;
      }
    }

    return best;
  }

  locate(id: number): Quarry | null {
    const person = this.#context.people.findPerson(id);

    if (person === null || !person.isAlive) {
      return null;
    }

    return this.#quarryOf(person);
  }

  nearest(x: number, z: number, radius: number): Quarry | null {
    const { people } = this.#context;

    const person = people.nearestPerson(x, z, radius, (candidate) => {
      return people.findTribe(candidate.tribeId) !== null;
    });

    if (person === null) {
      return null;
    }

    return this.#quarryOf(person);
  }

  wound(id: number, blow: BeastBlow): void {
    const context = this.#context;

    const person = context.people.findPerson(id);
    const tribe = person === null ? null : context.people.findTribe(person.tribeId);

    if (person === null || tribe === null || !person.isAlive) {
      return;
    }

    person.health -= blow.damage;
    context.rivalry.ledger.stagger(person.id, blow.attacker.id);

    if (person.health <= 0) {
      this.#mourn(person, tribe, blow);

      return;
    }

    if (blow.isFirst && blow.kind === "bite") {
      context.chronicle.record({
        category: "beast",
        text: this.#tell(blow, ATTACK, person, tribe),
        tribeId: tribe.id,
        x: person.mover.x,
        z: person.mover.z,
      });
    }

    this.#fightBack(person, tribe, blow);
    this.#rallyKin(person, tribe, blow);
  }

  #tell(blow: BeastBlow, deed: Deed, person: Person, tribe: Tribe): string {
    const place = describePlace(this.#context.world, person.mover.x, person.mover.z, tribe);

    return capitalized(
      `${beastName(blow)} ${deed.verb} ${person.name} of ${theTribe(tribe.name)}${deed.ending} ${place}`
    );
  }

  #mourn(person: Person, tribe: Tribe, blow: BeastBlow): void {
    const text = this.#tell(blow, KILLING_DEEDS[blow.kind], person, tribe);

    this.#context.people.kill(person, blow.kind === "trample" ? "mammoth" : "beast", { category: "beast", text });
  }

  #quarryOf(person: Person): Quarry | null {
    const context = this.#context;

    const tribe = context.people.findTribe(person.tribeId);

    if (tribe === null) {
      return null;
    }

    return this.#describe(person, isSheltered(person, tribe, context));
  }

  #describe(person: Person, isPersonSheltered: boolean): Quarry {
    const { x, z } = person.mover;

    const companions = this.#context.people.countNear(x, z, COMPANION_RADIUS, (other) => {
      return other !== person;
    });
    const pairing = companions >= 1 ? PAIRED_FRAILTY : 1;

    return {
      companions,
      frailty: frailtyOf(person) * pairing,
      id: person.id,
      isSheltered: isPersonSheltered,
      x,
      z,
    };
  }

  #fightBack(person: Person, tribe: Tribe, blow: BeastBlow): void {
    if (isSteadfast(person)) {
      return;
    }

    if (canFight(person)) {
      takeUpJob(person, tribe, this.#context, (tick) => {
        return new FightJob(tick, animalFoe(blow.attacker), carriedWeapon(person));
      });

      return;
    }

    takeUpJob(person, tribe, this.#context, (tick) => {
      return new ShelterJob(tick, null);
    });
  }

  #rallyKin(person: Person, tribe: Tribe, blow: BeastBlow): void {
    const { x, z } = person.mover;

    for (const kin of this.#context.people.livingWithin(x, z, KIN_RALLY_RADIUS)) {
      if (kin === person || kin.tribeId !== tribe.id || isSteadfast(kin) || !canFight(kin)) {
        continue;
      }

      takeUpJob(kin, tribe, this.#context, (tick) => {
        return new FightJob(tick, animalFoe(blow.attacker), carriedWeapon(kin));
      });
    }
  }
}
