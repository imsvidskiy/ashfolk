import { Badge } from "../../design/badge.tsx";
import type { Stance } from "../../simulation/society/rivalry/relations.ts";
import type { RelationView } from "../../simulation/society/rivalry/rivalry-system.ts";
import { relationNote, STANCE_LOOKS } from "./rivalry-labels.ts";

export function StanceBadge({ stance }: { readonly stance: Stance }) {
  const look = STANCE_LOOKS[stance];

  return (
    <Badge icon={look.icon} tone={look.tone}>
      {look.label}
    </Badge>
  );
}

export function RelationNote({ relation }: { readonly relation: RelationView }) {
  const note = relationNote(relation);

  if (note === null) {
    return null;
  }

  return <span className="text-ink-muted truncate text-xs">{note}</span>;
}
