import { clamp } from "../../../shared/math.ts";
import type { Tribe } from "../tribe.ts";

const LOWEST_STANDING = -100;
const HIGHEST_STANDING = 100;
const KIN_STANDING = 60;
const STRANGER_STANDING = 0;
const KIN_REST = 25;
const STRANGER_REST = -5;
const TRUCE_REST = 20;
const RECOVERY_PER_DAY = 0.06;
const GRIEVANCE_DECAY_PER_DAY = 0.12;
const WEARINESS_DECAY_PER_DAY = 0.06;
const BECOMES_HOSTILE = -50;
const STAYS_HOSTILE = -35;
const BECOMES_WARY = -15;
const STAYS_WARY = -8;
const BECOMES_FRIENDLY = 30;
const STAYS_FRIENDLY = 22;

export type Stance = "friendly" | "hostile" | "neutral" | "wary";

export type Grudge = "blood" | "burning" | "hunting" | "land" | "plunder" | "trespass";

interface RelationSide {
  deaths: number;
  grievance: number;
  readonly tribeId: number;
  weariness: number;
}

export interface Relation {
  envoyId: number | null;
  feudStartDay: number | null;
  readonly first: RelationSide;
  readonly isKin: boolean;
  lastGrudge: Grudge;
  readonly second: RelationSide;
  stance: Stance;
  standing: number;
  truceUntilDay: number;
}

function pairKey(firstId: number, secondId: number): string {
  return `${Math.min(firstId, secondId)}:${Math.max(firstId, secondId)}`;
}

function createSide(tribeId: number): RelationSide {
  return { deaths: 0, grievance: 0, tribeId, weariness: 0 };
}

export function areKin(first: Tribe, second: Tribe): boolean {
  const isParent = first.originId === second.id || second.originId === first.id;
  const isSibling = first.originId !== null && first.originId === second.originId;

  return isParent || isSibling;
}

export function stanceFor(standing: number, current: Stance): Stance {
  if (standing <= BECOMES_HOSTILE || (current === "hostile" && standing < STAYS_HOSTILE)) {
    return "hostile";
  }

  if (standing <= BECOMES_WARY || (current === "wary" && standing < STAYS_WARY)) {
    return "wary";
  }

  if (standing >= BECOMES_FRIENDLY || (current === "friendly" && standing > STAYS_FRIENDLY)) {
    return "friendly";
  }

  return "neutral";
}

export function sideOf(relation: Relation, tribeId: number): RelationSide {
  return relation.first.tribeId === tribeId ? relation.first : relation.second;
}

export function otherSideOf(relation: Relation, tribeId: number): RelationSide {
  return relation.first.tribeId === tribeId ? relation.second : relation.first;
}

export function isTruce(relation: Relation, day: number): boolean {
  return day < relation.truceUntilDay;
}

function shiftStanding(relation: Relation, amount: number): void {
  relation.standing = clamp(relation.standing + amount, LOWEST_STANDING, HIGHEST_STANDING);
}

export function aggrieve(relation: Relation, tribeId: number, amount: number, grudge: Grudge): void {
  sideOf(relation, tribeId).grievance += amount;
  shiftStanding(relation, -amount);
  relation.lastGrudge = grudge;
}

export function restingStanding(relation: Relation, day: number): number {
  if (isTruce(relation, day)) {
    return TRUCE_REST;
  }

  return relation.isKin ? KIN_REST : STRANGER_REST;
}

export function settle(relation: Relation, days: number, day: number): void {
  const recovery = 1 - Math.exp(-RECOVERY_PER_DAY * days);
  const grievanceDecay = Math.exp(-GRIEVANCE_DECAY_PER_DAY * days);
  const wearinessDecay = Math.exp(-WEARINESS_DECAY_PER_DAY * days);

  relation.standing += (restingStanding(relation, day) - relation.standing) * recovery;

  for (const side of [relation.first, relation.second]) {
    side.grievance *= grievanceDecay;
    side.weariness *= wearinessDecay;
  }
}

export class RelationBook {
  readonly #relations = new Map<string, Relation>();

  get all(): readonly Relation[] {
    return [...this.#relations.values()];
  }

  snapshot(): Map<string, Relation> {
    return structuredClone(this.#relations);
  }

  restore(relations: ReadonlyMap<string, Relation>): void {
    this.#relations.clear();

    for (const [key, relation] of relations) {
      this.#relations.set(key, relation);
    }
  }

  find(firstId: number, secondId: number): Relation | null {
    const relation = this.#relations.get(pairKey(firstId, secondId));

    if (relation === undefined) {
      return null;
    }

    return relation;
  }

  meet(firstId: number, secondId: number, isKin: boolean): Relation {
    const existing = this.find(firstId, secondId);

    if (existing !== null) {
      return existing;
    }

    const standing = isKin ? KIN_STANDING : STRANGER_STANDING;

    const relation: Relation = {
      envoyId: null,
      feudStartDay: null,
      first: createSide(Math.min(firstId, secondId)),
      isKin,
      lastGrudge: "land",
      second: createSide(Math.max(firstId, secondId)),
      stance: stanceFor(standing, "neutral"),
      standing,
      truceUntilDay: Number.NEGATIVE_INFINITY,
    };

    this.#relations.set(pairKey(firstId, secondId), relation);

    return relation;
  }

  forgetTribe(tribeId: number): void {
    for (const [key, relation] of this.#relations) {
      if (relation.first.tribeId === tribeId || relation.second.tribeId === tribeId) {
        this.#relations.delete(key);
      }
    }
  }
}
