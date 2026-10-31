import type { TribeSummary } from "../../simulation/frame.ts";
import type { Stance } from "../../simulation/society/rivalry/relations.ts";
import type { RaidView, RelationView, RivalryView } from "../../simulation/society/rivalry/rivalry-system.ts";

const STANCE_ORDER: readonly Stance[] = ["hostile", "wary", "neutral", "friendly"];

export function tribeWithId(tribes: readonly TribeSummary[], tribeId: number): TribeSummary | undefined {
  return tribes.find((tribe) => {
    return tribe.id === tribeId;
  });
}

export function isRelationOf(relation: RelationView, tribeId: number): boolean {
  return relation.firstId === tribeId || relation.secondId === tribeId;
}

export function otherTribeOf(relation: RelationView, tribeId: number): number {
  return relation.firstId === tribeId ? relation.secondId : relation.firstId;
}

export function byStance(first: RelationView, second: RelationView): number {
  const order = STANCE_ORDER.indexOf(first.stance) - STANCE_ORDER.indexOf(second.stance);

  if (order !== 0) {
    return order;
  }

  return first.standing - second.standing;
}

export function raidOf(rivalry: RivalryView, tribeId: number): RaidView | null {
  const raid = rivalry.raids.find((candidate) => {
    return candidate.attackerId === tribeId || candidate.defenderId === tribeId;
  });

  if (raid === undefined) {
    return null;
  }

  return raid;
}

export function isFeuding(rivalry: RivalryView, tribeId: number): boolean {
  return rivalry.relations.some((relation) => {
    return relation.stance === "hostile" && isRelationOf(relation, tribeId);
  });
}
