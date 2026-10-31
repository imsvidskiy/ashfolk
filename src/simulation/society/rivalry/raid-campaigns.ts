import { clamp, hashToUnit } from "../../../shared/math.ts";
import type { RandomSource } from "../../../shared/random.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import type { Chronicle } from "../../chronicle.ts";
import { takeUpJob } from "../decisions.ts";
import type { Person } from "../person.ts";
import type { SocietySystem } from "../society.ts";
import type { SocietyContext } from "../society-context.ts";
import { emptyStock, takeFood, totalFood } from "../stock.ts";
import { knows, type Tribe } from "../tribe.ts";
import { campDistance, campPoint, litCampfireOf } from "../tribe-places.ts";
import { armForHunt, carriedWeapon } from "../weapons.ts";
import { MournJob } from "./defense-jobs.ts";
import { FOOD_RESERVE, totalGoods } from "./provisions.ts";
import { type RaiderState, RaidJob } from "./raid-job.ts";
import { advancePhase, enterPhase, RALLY_DISTANCE } from "./raid-phases.ts";
import { burnableBuilding, chooseAim, chooseWarriors, livingRaiders, type Raid, rationsFor } from "./raids.ts";
import {
  aggrieve,
  areKin,
  isTruce,
  otherSideOf,
  type Relation,
  type RelationBook,
  type RelationSide,
  sideOf,
} from "./relations.ts";
import { isBusy } from "./responses.ts";
import { mourningText, raidLaunchText, raidSummary } from "./stories.ts";

const BURNING_GRIEVANCE = 12;
const BURNING_WEARINESS = 8;
const PLUNDER_GRIEVANCE = 0.6;
const REVENGE_RELIEF = 0.45;
const RAID_GRIEVANCE = 18;
const GRIEVANCE_PER_ANGER = 40;
const BITTER_STANDING = -60;
const STANDING_PER_BITTERNESS = 80;
const LARGEST_BITTERNESS = 0.5;
const RAIDS_PER_DAY = 2.2;
const RAID_REST_DAYS = 3;
const REST_PER_LOSS_DAYS = 1.5;
const RAIDING_SEASON_END = 2.5;
const WEARY_LIMIT = 70;
const SMALLEST_RAIDING_TRIBE = 9;
const LONGEST_RAID_DISTANCE = 1600;
const SMALLEST_VICTIM_TRIBE = 8;
const MOURNING_DAYS = 0.45;
const MOURNERS = 4;
const MOURNER_RADIUS = 200;
const PROVISIONED_SHARE = 0.5;

interface CampaignDependencies {
  readonly chronicle: Chronicle;
  readonly random: RandomSource;
  readonly relations: RelationBook;
}

export interface RaidCampaignsSnapshot {
  mourningUntil: Map<number, number>;
  nextRaidId: number;
  raiders?: RaiderState[];
  raids: Raid[];
  restingUntil: Map<number, number>;
}

function hasJoinedRaid(person: Person, raid: Raid): boolean {
  return person.job instanceof RaidJob && person.job.raidId === raid.id;
}

function isRaidBetween(raid: Raid, firstId: number, secondId: number): boolean {
  return (
    (raid.attackerId === firstId && raid.defenderId === secondId) ||
    (raid.attackerId === secondId && raid.defenderId === firstId)
  );
}

function weighRaid(raid: Raid, relation: Relation): void {
  const plunder = totalGoods(raid.loot);
  const victims = sideOf(relation, raid.defenderId);
  const raiders = sideOf(relation, raid.attackerId);

  if (plunder > 0) {
    aggrieve(relation, raid.defenderId, plunder * PLUNDER_GRIEVANCE, "plunder");
  }

  if (raid.burned.length > 0) {
    aggrieve(relation, raid.defenderId, raid.burned.length * BURNING_GRIEVANCE, "burning");
    victims.weariness += raid.burned.length * BURNING_WEARINESS;
  }

  if (raid.fallenDefenders.length > 0 || plunder > 0 || raid.burned.length > 0) {
    raiders.grievance *= REVENGE_RELIEF;
  }
}

function raidUrgency(side: RelationSide, standing: number): number {
  const anger =
    clamp((side.grievance - RAID_GRIEVANCE) / GRIEVANCE_PER_ANGER, 0, 1) +
    clamp((BITTER_STANDING - standing) / STANDING_PER_BITTERNESS, 0, LARGEST_BITTERNESS);

  return anger * clamp(1 - side.weariness / WEARY_LIMIT, 0, 1);
}

function untilDay(dates: ReadonlyMap<number, number>, tribeId: number): number {
  const day = dates.get(tribeId);

  if (day === undefined) {
    return Number.NEGATIVE_INFINITY;
  }

  return day;
}

function forgetDates(dates: Map<number, number>, living: ReadonlySet<number>): void {
  for (const tribeId of dates.keys()) {
    if (!living.has(tribeId)) {
      dates.delete(tribeId);
    }
  }
}

function towards(from: Waypoint, to: Tribe, distance: number): Waypoint {
  const awayX = to.campX - from.x;
  const awayZ = to.campZ - from.z;
  const length = Math.max(1, Math.hypot(awayX, awayZ));

  return { x: from.x + (awayX / length) * distance, z: from.z + (awayZ / length) * distance };
}

function rejoinRaids(people: SocietySystem, raiders: readonly RaiderState[]): void {
  for (const state of raiders) {
    const person = people.findPerson(state.personId);

    if (person?.isAlive === true) {
      person.job = new RaidJob(state, carriedWeapon(person), hashToUnit(state.personId, state.raidId));
    }
  }
}

export class RaidCampaigns {
  readonly #chronicle: Chronicle;
  readonly #random: RandomSource;
  readonly #relations: RelationBook;
  #mourningUntil = new Map<number, number>();
  #nextRaidId = 1;
  #raids: Raid[] = [];
  #restingUntil = new Map<number, number>();

  constructor(dependencies: CampaignDependencies) {
    this.#chronicle = dependencies.chronicle;
    this.#random = dependencies.random;
    this.#relations = dependencies.relations;
  }

  get raids(): readonly Raid[] {
    return this.#raids;
  }

  snapshot(people: readonly Person[]): RaidCampaignsSnapshot {
    return {
      mourningUntil: new Map(this.#mourningUntil),
      nextRaidId: this.#nextRaidId,
      raiders: people.flatMap((person) => {
        return person.job instanceof RaidJob ? [person.job.saved()] : [];
      }),
      raids: structuredClone(this.#raids),
      restingUntil: new Map(this.#restingUntil),
    };
  }

  restore(snapshot: RaidCampaignsSnapshot, people: SocietySystem): void {
    this.#mourningUntil = new Map(snapshot.mourningUntil);
    this.#nextRaidId = snapshot.nextRaidId;
    this.#raids = snapshot.raids;
    this.#restingUntil = new Map(snapshot.restingUntil);
    rejoinRaids(people, snapshot.raiders === undefined ? [] : snapshot.raiders);
  }

  raidOf(id: number): Raid | null {
    const raid = this.#raids.find((candidate) => {
      return candidate.id === id;
    });

    if (raid === undefined) {
      return null;
    }

    return raid;
  }

  raidAgainst(tribeId: number): Raid | null {
    const raid = this.#raids.find((candidate) => {
      return candidate.defenderId === tribeId && candidate.isAlarmRaised;
    });

    if (raid === undefined) {
      return null;
    }

    return raid;
  }

  raidBetween(firstId: number, secondId: number): Raid | null {
    const raid = this.#raids.find((candidate) => {
      return isRaidBetween(candidate, firstId, secondId);
    });

    if (raid === undefined) {
      return null;
    }

    return raid;
  }

  launch(attacker: Tribe, defender: Tribe, context: SocietyContext): Raid | null {
    const relation = this.#relations.meet(attacker.id, defender.id, areKin(attacker, defender));
    const warriors = chooseWarriors(context.people.membersOf(attacker));

    if (warriors.length === 0) {
      return null;
    }

    const rations = rationsFor(campDistance(attacker, defender), context.rules.life.hungerRate);
    const provisions = rations * warriors.length * PROVISIONED_SHARE;

    if (totalFood(attacker.stock) < provisions + attacker.memberCount * FOOD_RESERVE) {
      return null;
    }

    const campfire = litCampfireOf(attacker, context.buildings);
    const canBurn = knows(attacker, "fire") && burnableBuilding(context.buildings.all, defender) !== null;
    const aim = chooseAim(relation, canBurn);
    const rally = campfire === null ? campPoint(attacker) : towards(campfire, defender, RALLY_DISTANCE);

    const raid: Raid = {
      aim,
      attackerId: attacker.id,
      burned: [],
      defenderId: defender.id,
      fallenDefenders: [],
      fallenRaiders: [],
      id: this.#nextRaidId,
      isAlarmRaised: false,
      loot: emptyStock(),
      phase: "muster",
      phaseSeconds: 0,
      rally,
      routedIds: new Set(),
      struckIds: new Set(),
      target: campPoint(defender),
      warriorIds: warriors.map((warrior) => {
        return warrior.id;
      }),
    };

    takeFood(attacker.stock, provisions);
    this.#nextRaidId += 1;
    this.#raids.push(raid);
    this.#restingUntil.set(attacker.id, context.environment.day + RAID_REST_DAYS);

    for (const [slot, warrior] of warriors.entries()) {
      armForHunt(warrior, attacker);

      const weapon = carriedWeapon(warrior);

      takeUpJob(warrior, attacker, context, () => {
        const state: RaiderState = {
          leg: "outward",
          loot: emptyStock(),
          personId: warrior.id,
          raidId: raid.id,
          rations,
          slot,
        };

        return new RaidJob(state, weapon, this.#random.next());
      });
    }

    this.#chronicle.record({
      category: "raid",
      text: raidLaunchText(attacker, defender, warriors.length),
      tribeId: attacker.id,
      x: attacker.campX,
      z: attacker.campZ,
    });

    return raid;
  }

  consider(relation: Relation, days: number, context: SocietyContext): void {
    if (relation.stance !== "hostile" || isTruce(relation, context.environment.day) || relation.envoyId !== null) {
      return;
    }

    const sides = [relation.first, relation.second].toSorted((one, other) => {
      return other.grievance - one.grievance;
    });

    for (const side of sides) {
      const attacker = context.people.findTribe(side.tribeId);
      const defender = context.people.findTribe(otherSideOf(relation, side.tribeId).tribeId);

      if (attacker === null || defender === null || !this.#canRaid(attacker, defender, context)) {
        continue;
      }

      const urgency = raidUrgency(side, relation.standing);
      const chance = 1 - Math.exp(-RAIDS_PER_DAY * urgency * context.rules.life.rivalry * days);

      if (urgency > 0 && this.#random.chance(chance)) {
        this.launch(attacker, defender, context);

        return;
      }
    }
  }

  advance(seconds: number, context: SocietyContext): void {
    for (const raid of this.#raids) {
      raid.phaseSeconds += seconds;
      this.#advanceRaid(raid, context);
    }
  }

  retreatBetween(firstId: number, secondId: number): void {
    for (const raid of this.#raids) {
      if (isRaidBetween(raid, firstId, secondId) && raid.phase !== "retreat") {
        enterPhase(raid, "retreat");
      }
    }
  }

  forgetVanished(living: ReadonlySet<number>): void {
    forgetDates(this.#mourningUntil, living);
    forgetDates(this.#restingUntil, living);
  }

  #canRaid(attacker: Tribe, defender: Tribe, context: SocietyContext): boolean {
    const { day } = context.environment;

    if (attacker.isMigrating || defender.isMigrating || defender.memberCount < SMALLEST_VICTIM_TRIBE) {
      return false;
    }

    if (totalFood(defender.stock) < defender.memberCount * FOOD_RESERVE) {
      return false;
    }

    if (attacker.memberCount < SMALLEST_RAIDING_TRIBE || context.environment.season >= RAIDING_SEASON_END) {
      return false;
    }

    if (
      this.#raids.some((raid) => {
        return raid.attackerId === attacker.id || raid.defenderId === attacker.id;
      })
    ) {
      return false;
    }

    const isResting = day < untilDay(this.#restingUntil, attacker.id);
    const isMourning = day < untilDay(this.#mourningUntil, attacker.id);

    return !(isResting || isMourning) && campDistance(attacker, defender) < LONGEST_RAID_DISTANCE;
  }

  #advanceRaid(raid: Raid, context: SocietyContext): void {
    const raiders = livingRaiders(context.people, raid).filter((raider) => {
      return hasJoinedRaid(raider, raid);
    });
    const attacker = context.people.findTribe(raid.attackerId);
    const defender = context.people.findTribe(raid.defenderId);

    if (raiders.length === 0 || attacker === null || defender === null) {
      this.#endRaid(raid, context);

      return;
    }

    if ((attacker.isMigrating || defender.isMigrating) && raid.phase !== "retreat") {
      enterPhase(raid, "retreat");

      return;
    }

    if (advancePhase(raid, raiders)) {
      this.#endRaid(raid, context);
    }
  }

  #endRaid(raid: Raid, context: SocietyContext): void {
    this.#raids = this.#raids.filter((candidate) => {
      return candidate !== raid;
    });

    const attacker = context.people.findTribe(raid.attackerId);
    const defender = context.people.findTribe(raid.defenderId);

    if (attacker === null || defender === null) {
      return;
    }

    const relation = this.#relations.find(attacker.id, defender.id);
    const restDays = RAID_REST_DAYS + REST_PER_LOSS_DAYS * raid.fallenRaiders.length;

    this.#restingUntil.set(attacker.id, context.environment.day + restDays);
    this.#chronicle.record({
      category: "raid",
      text: raidSummary(raid, attacker, defender),
      tribeId: attacker.id,
      x: defender.campX,
      z: defender.campZ,
    });

    if (relation !== null) {
      weighRaid(raid, relation);
    }

    this.#grieve(defender, raid.fallenDefenders, context);
    this.#grieve(attacker, raid.fallenRaiders, context);
  }

  #grieve(tribe: Tribe, fallen: readonly string[], context: SocietyContext): void {
    if (fallen.length === 0) {
      return;
    }

    const { day } = context.environment;

    this.#mourningUntil.set(tribe.id, day + MOURNING_DAYS);
    this.#chronicle.record({
      category: "death",
      text: mourningText(tribe, fallen),
      tribeId: tribe.id,
      x: tribe.campX,
      z: tribe.campZ,
    });

    const mourners = context.people
      .membersOf(tribe)
      .filter((person) => {
        return (
          !isBusy(person) && Math.hypot(person.mover.x - tribe.campX, person.mover.z - tribe.campZ) < MOURNER_RADIUS
        );
      })
      .slice(0, MOURNERS);

    for (const mourner of mourners) {
      takeUpJob(mourner, tribe, context, (tick) => {
        return new MournJob(tick);
      });
    }
  }
}
