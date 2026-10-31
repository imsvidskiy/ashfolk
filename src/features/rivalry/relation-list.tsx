import { ArrowRight } from "lucide-react";
import { GameIcon } from "../../design/game-icon.tsx";
import { RowButton, RowCount } from "../../design/row-button.tsx";
import type { TribeSummary } from "../../simulation/frame.ts";
import type { RaidView, RelationView } from "../../simulation/society/rivalry/rivalry-system.ts";
import { useShowSpot } from "../inspector/use-focus-camera.ts";
import { TribeDot } from "../tribes/tribe-dot.tsx";
import { useWorldStore } from "../world/world-store.ts";
import { RAID_PHASE_LABELS } from "./rivalry-labels.ts";
import { RelationNote, StanceBadge } from "./rivalry-parts.tsx";
import { byStance, tribeWithId } from "./rivalry-queries.ts";

const QUIET_ISLAND = "Every tribe keeps to itself for now. Rivalries grow where lands and hunting grounds meet.";

interface TribePair<Item> {
  readonly first: TribeSummary;
  readonly item: Item;
  readonly second: TribeSummary;
}

function tribePairs<Item>(
  items: readonly Item[],
  tribes: readonly TribeSummary[],
  idsOf: (item: Item) => readonly [number, number]
): TribePair<Item>[] {
  const pairs: TribePair<Item>[] = [];

  for (const item of items) {
    const [firstId, secondId] = idsOf(item);

    const first = tribeWithId(tribes, firstId);
    const second = tribeWithId(tribes, secondId);

    if (first !== undefined && second !== undefined) {
      pairs.push({ first, item, second });
    }
  }

  return pairs;
}

function RaidRow({ entry }: { readonly entry: TribePair<RaidView> }) {
  const { first: attacker, item: raid, second: defender } = entry;

  const showCamp = useShowSpot(defender.campX, defender.campZ);

  return (
    <RowButton
      className="bg-ember-soft hover:bg-ember/20"
      leading={<GameIcon name="raid" />}
      onClick={showCamp}
      trailing={<RowCount count={raid.raiders} unit="warriors" />}
    >
      <span className="text-ink truncate text-sm font-semibold">
        {attacker.name} <ArrowRight aria-hidden="true" className="text-ink-soft inline" size={13} /> {defender.name}
      </span>

      <span className="text-ink-soft truncate text-xs">{RAID_PHASE_LABELS[raid.phase]}</span>
    </RowButton>
  );
}

function RelationRow({ entry }: { readonly entry: TribePair<RelationView> }) {
  const { first, item: relation, second } = entry;

  const showBorder = useShowSpot((first.campX + second.campX) / 2, (first.campZ + second.campZ) / 2);

  return (
    <RowButton
      leading={
        <span className="flex shrink-0 gap-0.5">
          <TribeDot color={first.color} />

          <TribeDot color={second.color} />
        </span>
      }
      onClick={showBorder}
      trailing={<StanceBadge stance={relation.stance} />}
    >
      <span className="text-ink truncate text-sm font-semibold">{`${first.name} · ${second.name}`}</span>

      <RelationNote relation={relation} />
    </RowButton>
  );
}

function RaidSection({ entries }: { readonly entries: readonly TribePair<RaidView>[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section aria-label="Raids under way" className="flex flex-col gap-1">
      <h3 className="text-ink-soft px-2.5 text-xs font-semibold">Raids under way</h3>

      <ul className="flex flex-col gap-1">
        {entries.map((entry) => {
          return <RaidRow entry={entry} key={entry.item.id} />;
        })}
      </ul>
    </section>
  );
}

export function RelationList() {
  const rivalry = useWorldStore((state) => {
    return state.snapshot?.rivalry;
  });
  const tribes = useWorldStore((state) => {
    return state.snapshot?.tribes;
  });

  if (rivalry === undefined || tribes === undefined || rivalry.relations.length === 0) {
    return <p className="text-ink-muted p-3 text-sm">{QUIET_ISLAND}</p>;
  }

  const relations = rivalry.relations.toSorted(byStance);

  return (
    <div className="flex flex-col gap-3">
      <RaidSection
        entries={tribePairs(rivalry.raids, tribes, (raid) => {
          return [raid.attackerId, raid.defenderId];
        })}
      />

      <ul aria-label="Relations" className="flex flex-col gap-0.5">
        {tribePairs(relations, tribes, (relation) => {
          return [relation.firstId, relation.secondId];
        }).map((entry) => {
          return <RelationRow entry={entry} key={`${entry.first.id}-${entry.second.id}`} />;
        })}
      </ul>
    </div>
  );
}
