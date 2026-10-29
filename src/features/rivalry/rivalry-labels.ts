import type { BadgeTone } from "../../design/badge.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import type { RaidPhase } from "../../simulation/society/rivalry/raids.ts";
import type { Stance } from "../../simulation/society/rivalry/relations.ts";
import type { RelationView } from "../../simulation/society/rivalry/rivalry-system.ts";

interface StanceLook {
  readonly icon: GameIconName;
  readonly label: string;
  readonly tone: BadgeTone;
}

export const STANCE_LOOKS: Readonly<Record<Stance, StanceLook>> = {
  friendly: { icon: "peace", label: "Friendly", tone: "meadow" },
  hostile: { icon: "raid", label: "Hostile", tone: "ember" },
  neutral: { icon: "neutral", label: "Neutral", tone: "muted" },
  wary: { icon: "shield", label: "Wary", tone: "dawn" },
};

export const RAID_PHASE_LABELS: Readonly<Record<RaidPhase, string>> = {
  assault: "Fighting at the camp",
  march: "On the march",
  muster: "Gathering warriors",
  retreat: "Heading home",
};

export function relationNote(relation: RelationView): string | null {
  const fallen = relation.firstDeaths + relation.secondDeaths;
  const notes: string[] = [];

  if (relation.feudDays !== null) {
    notes.push(`Feud for ${Math.max(1, Math.round(relation.feudDays))} d`);
  }

  if (relation.isTruce) {
    notes.push("Truce");
  }

  if (relation.isKin) {
    notes.push("Kin");
  }

  if (fallen > 0) {
    notes.push(`${fallen} fallen`);
  }

  if (notes.length === 0) {
    return null;
  }

  return notes.join(" · ");
}
