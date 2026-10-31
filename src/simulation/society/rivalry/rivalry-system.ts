import { createRandom, type RandomSource, type RandomState } from "../../../shared/random.ts";
import type { Chronicle } from "../../chronicle.ts";
import type { EffectLog } from "../../effects.ts";
import type { PeopleSense } from "../../fauna/beast-instincts.ts";
import { isComplete } from "../buildings.ts";
import type { Person } from "../person.ts";
import type { SocietySystem } from "../society.ts";
import type { SocietyContext } from "../society-context.ts";
import type { Stock } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { ArrowFlights } from "./arrows.ts";
import { BeastEncounters } from "./beast-encounters.ts";
import { CombatLedger, type FighterRecord } from "./combat-ledger.ts";
import type { Foe } from "./foes.ts";
import { chafeAtBorders, watchTrespass } from "./land-friction.ts";
import { agreeTruce, isEnvoyOnTheWay, peacePressure, sendEnvoy } from "./peace.ts";
import { unpack } from "./provisions.ts";
import { RaidCampaigns, type RaidCampaignsSnapshot } from "./raid-campaigns.ts";
import type { Raid, RaidAim, RaidPhase } from "./raids.ts";
import {
  aggrieve,
  areKin,
  isTruce,
  type Relation,
  RelationBook,
  type Stance,
  settle,
  sideOf,
  stanceFor,
} from "./relations.ts";
import { envoyText, fallText, stanceNews, truceText } from "./stories.ts";
import { type Claim, claimOf } from "./territory.ts";

const SURVEY_SECONDS = 2;
const FEUD_WEARINESS_PER_DAY = 5;
const BLOOD_GRIEVANCE = 30;
const DEATH_WEARINESS = 16;
const PEACE_PER_DAY = 1.1;

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

export interface RivalrySnapshot extends RaidCampaignsSnapshot {
  claims: Map<number, Claim>;
  ledger: Map<number, FighterRecord>;
  random: RandomState;
  relations: Map<string, Relation>;
  surveyDays: number;
  surveySeconds: number;
}

export interface RivalryView {
  readonly raids: readonly RaidView[];
  readonly relations: readonly RelationView[];
}

function claimFor(tribe: Tribe, context: SocietyContext): Claim {
  const buildings = context.buildings.all.filter((building) => {
    return building.tribeId === tribe.id && isComplete(building);
  });

  return claimOf(tribe, tribe.memberCount, buildings);
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

export class RivalrySystem {
  readonly campaigns: RaidCampaigns;
  readonly ledger = new CombatLedger();
  readonly random: RandomSource;
  readonly relations = new RelationBook();
  readonly #arrows: ArrowFlights;
  readonly #chronicle: Chronicle;
  #claims = new Map<number, Claim>();
  #encounters: BeastEncounters | null = null;
  #surveyDays = 0;
  #surveySeconds = SURVEY_SECONDS;

  constructor(dependencies: RivalryDependencies) {
    this.#chronicle = dependencies.chronicle;
    this.#arrows = new ArrowFlights(dependencies.effects);
    this.random = createRandom(dependencies.seed * 13 + 101);
    this.campaigns = new RaidCampaigns({
      chronicle: dependencies.chronicle,
      random: this.random,
      relations: this.relations,
    });
  }

  snapshot(people: readonly Person[]): RivalrySnapshot {
    return {
      ...this.campaigns.snapshot(people),
      claims: structuredClone(this.#claims),
      ledger: this.ledger.snapshot(),
      random: this.random.state(),
      relations: this.relations.snapshot(),
      surveyDays: this.#surveyDays,
      surveySeconds: this.#surveySeconds,
    };
  }

  restore(snapshot: RivalrySnapshot, people: SocietySystem): void {
    this.#arrows.clear();
    this.#claims = snapshot.claims;
    this.ledger.restore(snapshot.ledger);
    this.random.restore(snapshot.random);
    this.relations.restore(snapshot.relations);
    this.#surveyDays = snapshot.surveyDays;
    this.#surveySeconds = snapshot.surveySeconds;
    this.campaigns.restore(snapshot, people);
  }

  senses(context: SocietyContext): PeopleSense {
    if (this.#encounters === null) {
      this.#encounters = new BeastEncounters(context);
    }

    return this.#encounters;
  }

  loose(shooter: Person, weapon: CarriedWeapon, foe: Foe): void {
    this.#arrows.loose(shooter, weapon, foe, this.random);
  }

  slay(victim: Person, slayer: Person, context: SocietyContext): void {
    const { people } = context;

    const victimTribe = people.findTribe(victim.tribeId);
    const slayerTribe = people.findTribe(slayer.tribeId);
    const raid = this.campaigns.raidBetween(victim.tribeId, slayer.tribeId);

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

  update(seconds: number, days: number, context: SocietyContext): void {
    this.ledger.update(seconds);
    this.#arrows.update(seconds, context);
    this.campaigns.advance(seconds, context);
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
      raids: this.campaigns.raids.map((raid) => {
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
      this.campaigns.consider(relation, days, context);
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
    this.campaigns.retreatBetween(relation.first.tribeId, relation.second.tribeId);
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

    this.campaigns.forgetVanished(living);
  }
}
