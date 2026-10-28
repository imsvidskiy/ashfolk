import { GameIcon } from "../../design/game-icon.tsx";
import type { TribeSummary } from "../../simulation/frame.ts";
import type { RelationView } from "../../simulation/society/rivalry/rivalry-system.ts";
import { TribeDot } from "../tribes/tribe-dot.tsx";
import { useWorldStore } from "../world/world-store.ts";
import { RelationNote, StanceBadge } from "./rivalry-parts.tsx";
import { byStance, isRelationOf, otherTribeOf, RAID_PHASE_LABELS, raidOf } from "./stance-looks.ts";

interface NeighbourProps {
  readonly relation: RelationView;
  readonly tribeId: number;
  readonly tribes: readonly TribeSummary[];
}

function Neighbour({ relation, tribeId, tribes }: NeighbourProps) {
  const other = tribes.find((tribe) => tribe.id === otherTribeOf(relation, tribeId));

  if (other === undefined) {
    return null;
  }

  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <TribeDot color={other.color} size="small" />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ink truncate text-sm font-medium">{other.name}</span>

        <RelationNote relation={relation} />
      </span>

      <StanceBadge stance={relation.stance} />
    </li>
  );
}

function RaidLine({ tribeId, tribes }: { readonly tribeId: number; readonly tribes: readonly TribeSummary[] }) {
  const raid = useWorldStore((state) => (state.snapshot === null ? null : raidOf(state.snapshot.rivalry, tribeId)));

  if (raid === null) {
    return null;
  }

  const isAttacker = raid.attackerId === tribeId;
  const other = tribes.find((tribe) => tribe.id === (isAttacker ? raid.defenderId : raid.attackerId));
  const otherName = other === undefined ? "their enemies" : `the ${other.name}`;

  return (
    <p className="bg-ember-soft text-ember flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium">
      <GameIcon name="raid" size={22} />
      {isAttacker ? `Raiding ${otherName}` : `Raided by ${otherName}`} · {RAID_PHASE_LABELS[raid.phase]}
    </p>
  );
}

export function TribeRelations({ tribeId }: { readonly tribeId: number }) {
  const relations = useWorldStore((state) => state.snapshot?.rivalry.relations);
  const tribes = useWorldStore((state) => state.snapshot?.tribes);

  if (relations === undefined || tribes === undefined) {
    return null;
  }

  const own = relations.filter((relation) => isRelationOf(relation, tribeId)).toSorted(byStance);

  if (own.length === 0) {
    return null;
  }

  return (
    <section aria-label="Neighbours" className="flex flex-col gap-1">
      <h3 className="text-ink-soft text-xs font-semibold tracking-wide uppercase">Neighbours</h3>

      <RaidLine tribeId={tribeId} tribes={tribes} />

      <ul className="divide-line divide-y">
        {own.map((relation) => (
          <Neighbour
            key={`${relation.firstId}-${relation.secondId}`}
            relation={relation}
            tribeId={tribeId}
            tribes={tribes}
          />
        ))}
      </ul>
    </section>
  );
}
