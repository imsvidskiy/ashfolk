import { clamp } from "../../../shared/math.ts";
import { createRandom, type RandomSource, type RandomState } from "../../../shared/random.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import type { Chronicle } from "../../chronicle.ts";
import type { EffectLog } from "../../effects.ts";
import type { PeopleSense } from "../../fauna/beast-instincts.ts";
import { isComplete } from "../buildings.ts";
import { takeUpJob } from "../decisions.ts";
import type { Person } from "../person.ts";
import type { SocietyContext } from "../society-context.ts";
import { emptyStock, type Stock, takeFood, totalFood } from "../stock.ts";
import { knows, type Tribe } from "../tribe.ts";
import { litCampfireOf } from "../tribe-places.ts";
import { armForHunt, type CarriedWeapon, carriedWeapon } from "../weapons.ts";
import { ArrowFlights } from "./arrows.ts";
import { BeastEncounters } from "./beast-encounters.ts";
import { CombatLedger, type FighterRecord } from "./combat-ledger.ts";
import { MournJob } from "./defense-jobs.ts";
import type { Foe } from "./foes.ts";
import { chafeAtBorders, watchTrespass } from "./land-friction.ts";
import { agreeTruce, isEnvoyOnTheWay, peacePressure, sendEnvoy } from "./peace.ts";
import { FOOD_RESERVE, totalGoods, unpack } from "./provisions.ts";
import { RaidJob } from "./raid-job.ts";
import { advancePhase, enterPhase, RALLY_DISTANCE } from "./raid-phases.ts";
import {
  burnableBuilding,
  chooseAim,
  chooseWarriors,
  livingRaiders,
  type Raid,
  type RaidAim,
  type RaidPhase,
  rationsFor,
} from "./raids.ts";
import {
  aggrieve,
  isTruce,
  otherSideOf,
  type Relation,
  RelationBook,
  type Stance,
  settle,
  sideOf,
  stanceFor,
} from "./relations.ts";
import { isBusy } from "./responses.ts";
import { envoyText, fallText, mourningText, raidLaunchText, raidSummary, stanceNews, truceText } from "./stories.ts";
import type { Battleground } from "./strikes.ts";
import { type Claim, claimOf } from "./territory.ts";

const SURVEY_SECONDS = 2;
const FEUD_WEARINESS_PER_DAY = 5;
const BLOOD_GRIEVANCE = 30;
const DEATH_WEARINESS = 16;
const BURNING_GRIEVANCE = 12;
const BURNING_WEARINESS = 8;
const PLUNDER_GRIEVANCE = 0.6;
const REVENGE_RELIEF = 0.45;
const RAID_GRIEVANCE = 18;
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
const PEACE_PER_DAY = 1.1;
const PROVISIONED_SHARE = 0.5;

interface RivalryDependencies {
  readonly chronicle: Chronicle;
  readonly effects: EffectLog;
  readonly seed: number;
}

export interface RelationView {
  readonly feudDays: number | null;
  readonly firstDeaths: number;
  readonly firstId: number;
  readonly isKin: boolean;
  readonly isTruce: boolean;
  readonly secondDeaths: number;
  readonly secondId: number;
  readonly stance: Stance;
  readonly standing: number;
}

export interface RaidView {
  readonly aim: RaidAim;
  readonly attackerId: number;
  readonly defenderId: number;
  readonly fallenDefenders: number;
  readonly fallenRaiders: number;
  readonly id: number;
  readonly phase: RaidPhase;
  readonly raiders: number;
}

export interface RivalrySnapshot {
  claims: Map<number, Claim>;
  ledger: Map<number, FighterRecord>;
  mourningUntil: Map<number, number>;
  nextRaidId: number;
  raids: Raid[];
  random: RandomState;
  relations: Map<string, Relation>;
  restingUntil: Map<number, number>;
  surveyDays: number;
  surveySeconds: number;
}

export interface RivalryView {
  readonly raids: readonly RaidView[];
  readonly relations: readonly RelationView[];
}

function areKin(first: Tribe, second: Tribe): boolean {
  const isParent = first.originId === second.id || second.originId === first.id;
  const isSibling = first.originId !== null && first.originId === second.originId;

  return isParent || isSibling;
}

function hasJoinedRaid(person: Person, raid: Raid): boolean {
  return person.job instanceof RaidJob && person.job.raidId === raid.id;
}

function claimFor(tribe: Tribe, context: SocietyContext): Claim {
  const buildings = context.buildings.all.filter((building) => {
    return building.tribeId === tribe.id && isComplete(building);
  });

  return claimOf(tribe, tribe.memberCount, buildings);
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

function recordFall(victim: Person, raid: Raid | null): void {
  if (raid === null) {
    return;
  }

  if (raid.warriorIds.includes(victim.id)) {
    raid.fallenRaiders.push(victim.name);

    return;
  }

  raid.fallenDefenders.push(victim.name);
}

function untilDay(dates: ReadonlyMap<number, number>, tribeId: number): number {
  const day = dates.get(tribeId);

  if (day === undefined) {
    return Number.NEGATIVE_INFINITY;
  }

  return day;
}

function copyDates(target: Map<number, number>, source: ReadonlyMap<number, number>): void {
  target.clear();

  for (const [tribeId, day] of source) {
    target.set(tribeId, day);
  }
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

export class RivalrySystem implements Battleground {
  readonly ledger = new CombatLedger();
  readonly random: RandomSource;
  readonly relations = new RelationBook();
  readonly #arrows: ArrowFlights;
  readonly #chronicle: Chronicle;
  readonly #mourningUntil = new Map<number, number>();
  readonly #restingUntil = new Map<number, number>();
  #claims = new Map<number, Claim>();
  #encounters: BeastEncounters | null = null;
  #nextRaidId = 1;
  #raids: Raid[] = [];
  #surveyDays = 0;
  #surveySeconds = SURVEY_SECONDS;

  constructor(dependencies: RivalryDependencies) {
    this.#chronicle = dependencies.chronicle;
    this.#arrows = new ArrowFlights(dependencies.effects);
    this.random = createRandom(dependencies.seed * 13 + 101);
  }

  get raids(): readonly Raid[] {
    return this.#raids;
  }

  snapshot(): RivalrySnapshot {
    return {
      claims: structuredClone(this.#claims),
      ledger: this.ledger.snapshot(),
      mourningUntil: new Map(this.#mourningUntil),
      nextRaidId: this.#nextRaidId,
      raids: structuredClone(this.#raids),
      random: this.random.state(),
      relations: this.relations.snapshot(),
      restingUntil: new Map(this.#restingUntil),
      surveyDays: this.#surveyDays,
      surveySeconds: this.#surveySeconds,
    };
  }

  restore(snapshot: RivalrySnapshot): void {
    this.#arrows.clear();
    this.#claims = snapshot.claims;
    this.ledger.restore(snapshot.ledger);
    copyDates(this.#mourningUntil, snapshot.mourningUntil);
    this.#nextRaidId = snapshot.nextRaidId;
    this.#raids = snapshot.raids;
    this.random.restore(snapshot.random);
    this.relations.restore(snapshot.relations);
    copyDates(this.#restingUntil, snapshot.restingUntil);
    this.#surveyDays = snapshot.surveyDays;
    this.#surveySeconds = snapshot.surveySeconds;
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

  senses(context: SocietyContext): PeopleSense {
    if (this.#encounters === null) {
      this.#encounters = new BeastEncounters(context);
    }

    return this.#encounters;
  }

  loose(shooter: Person, weapon: CarriedWeapon, foe: Foe): void {
    this.#arrows.loose(shooter, weapon, foe, this);
  }

  slay(victim: Person, slayer: Person, context: SocietyContext): void {
    const { people } = context;

    const victimTribe = people.findTribe(victim.tribeId);
    const slayerTribe = people.findTribe(slayer.tribeId);
    const raid = this.#raidBetween(victim.tribeId, slayer.tribeId);

    if (victimTribe === null || slayerTribe === null) {
      people.kill(victim, "battle");

      return;
    }

    people.kill(victim, "battle", { category: "death", text: fallText(victim, victimTribe, slayerTribe, raid) });
    recordFall(victim, raid);

    const relation = this.relations.find(victimTribe.id, slayerTribe.id);

    if (relation === null) {
      return;
    }

    const side = sideOf(relation, victimTribe.id);

    aggrieve(relation, victimTribe.id, BLOOD_GRIEVANCE, "blood");
    side.deaths += 1;
    side.weariness += DEATH_WEARINESS;
  }

  receiveEnvoy(guest: Tribe, host: Tribe, gifts: Stock, context: SocietyContext): void {
    const relation = this.relations.find(guest.id, host.id);

    unpack(host.stock, gifts);

    if (relation === null) {
      return;
    }

    relation.envoyId = null;
    this.#makePeace(relation, context);
    this.#chronicle.record({
      category: "peace",
      text: envoyText(guest, host),
      tribeId: guest.id,
      x: host.campX,
      z: host.campZ,
    });
  }

  launchRaid(attacker: Tribe, defender: Tribe, context: SocietyContext): Raid | null {
    const relation = this.relations.meet(attacker.id, defender.id, areKin(attacker, defender));
    const warriors = chooseWarriors(context.people.membersOf(attacker));

    if (warriors.length === 0) {
      return null;
    }

    const distance = Math.hypot(attacker.campX - defender.campX, attacker.campZ - defender.campZ);
    const rations = rationsFor(distance, context.rules.life.hungerRate);

    const provisions = rations * warriors.length * PROVISIONED_SHARE;

    if (totalFood(attacker.stock) < provisions + attacker.memberCount * FOOD_RESERVE) {
      return null;
    }

    const campfire = litCampfireOf(attacker, context.buildings);
    const canBurn = knows(attacker, "fire") && burnableBuilding(context.buildings.all, defender) !== null;
    const aim = chooseAim(relation.lastGrudge === "blood", canBurn, -relation.standing / 100);
    const rally =
      campfire === null ? { x: attacker.campX, z: attacker.campZ } : towards(campfire, defender, RALLY_DISTANCE);

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
      target: { x: defender.campX, z: defender.campZ },
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

      takeUpJob(warrior, attacker, context, (tick) => {
        return new RaidJob(tick, raid, weapon, slot, rations);
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

  update(seconds: number, days: number, context: SocietyContext): void {
    this.ledger.update(seconds);
    this.#arrows.update(seconds, this, context);
    this.#advanceRaids(seconds, context);
    this.#surveySeconds -= seconds;
    this.#surveyDays += days;

    if (this.#surveySeconds > 0) {
      return;
    }

    const surveyDays = this.#surveyDays;

    this.#surveySeconds = SURVEY_SECONDS;
    this.#surveyDays = 0;
    this.#survey(surveyDays, context);
  }

  view(day: number): RivalryView {
    return {
      raids: this.#raids.map((raid) => {
        return {
          aim: raid.aim,
          attackerId: raid.attackerId,
          defenderId: raid.defenderId,
          fallenDefenders: raid.fallenDefenders.length,
          fallenRaiders: raid.fallenRaiders.length,
          id: raid.id,
          phase: raid.phase,
          raiders: raid.warriorIds.length - raid.fallenRaiders.length,
        };
      }),
      relations: this.relations.all.map((relation) => {
        return {
          feudDays: relation.feudStartDay === null ? null : day - relation.feudStartDay,
          firstDeaths: relation.first.deaths,
          firstId: relation.first.tribeId,
          isKin: relation.isKin,
          isTruce: isTruce(relation, day),
          secondDeaths: relation.second.deaths,
          secondId: relation.second.tribeId,
          stance: relation.stance,
          standing: relation.standing,
        };
      }),
    };
  }

  #survey(days: number, context: SocietyContext): void {
    const tribes = context.people.tribes();

    this.#forgetVanished(tribes);
    this.#claims = new Map(
      tribes.map((tribe) => {
        return [tribe.id, claimFor(tribe, context)];
      })
    );

    for (const [index, first] of tribes.entries()) {
      for (const second of tribes.slice(index + 1)) {
        chafeAtBorders(this.relations.meet(first.id, second.id, areKin(first, second)), this.#claims, days, context);
      }
    }

    watchTrespass(this.#claims, this.relations, days, context);

    for (const relation of this.relations.all) {
      this.#review(relation, days, context);
    }

    for (const relation of this.relations.all) {
      this.#considerRaid(relation, days, context);
      this.#considerPeace(relation, days, context);
    }
  }

  #review(relation: Relation, days: number, context: SocietyContext): void {
    const { day } = context.environment;

    settle(relation, days, day);

    if (relation.stance === "hostile") {
      relation.first.weariness += FEUD_WEARINESS_PER_DAY * days;
      relation.second.weariness += FEUD_WEARINESS_PER_DAY * days;
    }

    if (relation.envoyId !== null && !isEnvoyOnTheWay(relation.envoyId, context)) {
      relation.envoyId = null;
    }

    const stance = stanceFor(relation.standing, relation.stance);

    if (stance === relation.stance) {
      return;
    }

    const previous = relation.stance;

    relation.stance = stance;

    if (stance === "hostile") {
      relation.feudStartDay = day;
    } else if (previous === "hostile") {
      relation.feudStartDay = null;
    }

    this.#announceStance(relation, previous, context);
  }

  #announceStance(relation: Relation, previous: Stance, context: SocietyContext): void {
    const first = context.people.findTribe(relation.first.tribeId);
    const second = context.people.findTribe(relation.second.tribeId);

    if (first === null || second === null) {
      return;
    }

    const news = stanceNews(relation, previous, first, second);

    if (news !== null) {
      this.#chronicle.record(news);
    }
  }

  #considerRaid(relation: Relation, days: number, context: SocietyContext): void {
    if (relation.stance !== "hostile" || isTruce(relation, context.environment.day) || relation.envoyId !== null) {
      return;
    }

    const sides = [relation.first, relation.second].toSorted((one, other) => {
      return other.grievance - one.grievance;
    });

    for (const side of sides) {
      const attacker = context.people.findTribe(side.tribeId);
      const defender = context.people.findTribe(otherSideOf(relation, side.tribeId).tribeId);

      if (attacker === null || defender === null || !this.#mayRaid(attacker, defender, context)) {
        continue;
      }

      const anger = clamp((side.grievance - RAID_GRIEVANCE) / 40, 0, 1) + clamp((-relation.standing - 60) / 80, 0, 0.5);
      const urgency = anger * clamp(1 - side.weariness / WEARY_LIMIT, 0, 1);
      const chance = 1 - Math.exp(-RAIDS_PER_DAY * urgency * context.rules.life.rivalry * days);

      if (urgency > 0 && this.random.chance(chance)) {
        this.launchRaid(attacker, defender, context);

        return;
      }
    }
  }

  #mayRaid(attacker: Tribe, defender: Tribe, context: SocietyContext): boolean {
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
    const distance = Math.hypot(attacker.campX - defender.campX, attacker.campZ - defender.campZ);

    return !(isResting || isMourning) && distance < LONGEST_RAID_DISTANCE;
  }

  #advanceRaids(seconds: number, context: SocietyContext): void {
    for (const raid of this.#raids) {
      raid.phaseSeconds += seconds;
      this.#advanceRaid(raid, context);
    }
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

    const relation = this.relations.find(attacker.id, defender.id);
    const restDays = RAID_REST_DAYS + REST_PER_LOSS_DAYS * raid.fallenRaiders.length;

    this.#restingUntil.set(attacker.id, context.environment.day + restDays);
    this.#chronicle.record({
      category: "raid",
      text: raidSummary(raid, attacker.name, defender.name),
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

  #considerPeace(relation: Relation, days: number, context: SocietyContext): void {
    if (relation.stance !== "hostile" || relation.envoyId !== null || relation.feudStartDay === null) {
      return;
    }

    const pressure = peacePressure(relation, context.environment.day - relation.feudStartDay);

    if (pressure <= 0 || !this.random.chance(1 - Math.exp(-PEACE_PER_DAY * pressure * days))) {
      return;
    }

    const isFirstWearier = relation.first.weariness >= relation.second.weariness;
    const seeker = context.people.findTribe(isFirstWearier ? relation.first.tribeId : relation.second.tribeId);
    const host = context.people.findTribe(isFirstWearier ? relation.second.tribeId : relation.first.tribeId);

    if (seeker === null || host === null) {
      return;
    }

    if (!sendEnvoy(relation, seeker, host, context)) {
      this.#makePeace(relation, context);
      this.#chronicle.record({
        category: "peace",
        text: truceText(seeker, host),
        tribeId: seeker.id,
        x: (seeker.campX + host.campX) / 2,
        z: (seeker.campZ + host.campZ) / 2,
      });
    }
  }

  #makePeace(relation: Relation, context: SocietyContext): void {
    agreeTruce(relation, context.environment.day);

    for (const raid of this.#raids) {
      if (isRaidBetween(raid, relation.first.tribeId, relation.second.tribeId) && raid.phase !== "retreat") {
        enterPhase(raid, "retreat");
      }
    }
  }

  #raidBetween(firstId: number, secondId: number): Raid | null {
    const raid = this.#raids.find((candidate) => {
      return isRaidBetween(candidate, firstId, secondId);
    });

    if (raid === undefined) {
      return null;
    }

    return raid;
  }

  #forgetVanished(tribes: readonly Tribe[]): void {
    const living = new Set(
      tribes.map((tribe) => {
        return tribe.id;
      })
    );

    for (const relation of this.relations.all) {
      if (!living.has(relation.first.tribeId)) {
        this.relations.forgetTribe(relation.first.tribeId);
      }

      if (!living.has(relation.second.tribeId)) {
        this.relations.forgetTribe(relation.second.tribeId);
      }
    }

    forgetDates(this.#mourningUntil, living);
    forgetDates(this.#restingUntil, living);
  }
}
