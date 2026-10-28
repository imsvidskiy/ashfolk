import { ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { IconButton, TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { FOCUS_RING } from "../../design/styles.ts";
import type { SavedWorldListing } from "./save-database.ts";
import { describeSummary, formatSavedAt } from "./saved-time.ts";
import { useSavesStore } from "./saves-store.ts";
import { useNow } from "./use-now.ts";

const CLOCK_MILLISECONDS = 30_000;

function worldDetails(world: SavedWorldListing): string {
  if (!world.isLoadable || world.summary === null) {
    return "Saved by another version of Dawnfolk";
  }

  return describeSummary(world.summary);
}

function useSavedWorldRow(world: SavedWorldListing) {
  const continueWorld = useLaunchStore((state) => state.continueWorld);
  const remove = useSavesStore((state) => state.remove);
  const [isConfirming, setIsConfirming] = useState(false);

  function handleDelete(): void {
    setIsConfirming(true);
  }

  function handleKeep(): void {
    setIsConfirming(false);
  }

  function handleConfirmDelete(): void {
    remove(world.id).catch(() => undefined);
  }

  function handleOpen(): void {
    continueWorld(world.id, world);
  }

  return { handleConfirmDelete, handleDelete, handleKeep, handleOpen, isConfirming };
}

interface SavedWorldRowProps {
  readonly now: number;
  readonly world: SavedWorldListing;
}

function SavedWorldRow({ now, world }: SavedWorldRowProps) {
  const { handleConfirmDelete, handleDelete, handleKeep, handleOpen, isConfirming } = useSavedWorldRow(world);

  if (isConfirming) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
        <p className="text-ink min-w-0 truncate text-sm">Delete {world.name}?</p>

        <div className="flex shrink-0 items-center gap-1">
          <TextButton className="h-8 px-3" onClick={handleKeep} tone="quiet">
            Keep
          </TextButton>

          <TextButton className="h-8 px-3" onClick={handleConfirmDelete} tone="danger">
            Delete
          </TextButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 pr-1">
      <button
        className={cn(
          FOCUS_RING,
          "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150",
          "enabled:hover:bg-paper-hover disabled:cursor-not-allowed disabled:opacity-60"
        )}
        disabled={!world.isLoadable}
        onClick={handleOpen}
        type="button"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-ink truncate text-sm font-medium">{world.name}</span>

            <span className="text-ink-soft shrink-0 text-xs">{formatSavedAt(world.savedAt, now)}</span>
          </span>

          <span className="text-ink-soft truncate text-xs">{worldDetails(world)}</span>
        </span>

        {world.isLoadable ? <ChevronRight aria-hidden="true" className="text-ink-soft shrink-0" size={16} /> : null}
      </button>

      <IconButton
        className="size-9"
        icon={<Trash2 aria-hidden="true" size={16} />}
        label={`Delete ${world.name}`}
        onClick={handleDelete}
      />
    </div>
  );
}

export function SavedWorldList() {
  const worlds = useSavesStore((state) => state.worlds);
  const now = useNow(CLOCK_MILLISECONDS);

  return (
    <ul aria-label="Your worlds" className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
      {worlds.map((world) => (
        <li key={world.id}>
          <SavedWorldRow now={now} world={world} />
        </li>
      ))}
    </ul>
  );
}
