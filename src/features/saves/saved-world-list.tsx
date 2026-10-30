import { Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { IconButton, TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { FOCUS_RING } from "../../design/styles.ts";
import { ignore } from "../../shared/ignore.ts";
import type { SavedWorldListing } from "./save-database.ts";
import { describePeople, formatSavedAt } from "./saved-time.ts";
import { useSavesStore } from "./saves-store.ts";
import { useNow } from "./use-now.ts";

const CLOCK_MILLISECONDS = 30_000;
const UNAVAILABLE_NOTE = "Saved worlds are unavailable in this browser.";

interface SavedWorldRowProps {
  readonly now: number;
  readonly world: SavedWorldListing;
}

function worldDetails(world: SavedWorldListing, now: number): string {
  const savedAt = formatSavedAt(world.savedAt, now);

  if (!world.isLoadable || world.summary === null) {
    return `Saved by another version of Ashfolk · ${savedAt}`;
  }

  if (world.hasLandChanged) {
    return `The land has changed · ${savedAt}`;
  }

  return `${describePeople(world.summary.population)} · ${savedAt}`;
}

function useSavedWorldRow(world: SavedWorldListing) {
  const continueWorld = useLaunchStore((state) => {
    return state.continueWorld;
  });
  const remove = useSavesStore((state) => {
    return state.remove;
  });
  const [isConfirming, setIsConfirming] = useState(false);

  function handleDelete(): void {
    setIsConfirming(true);
  }

  function handleKeep(): void {
    setIsConfirming(false);
  }

  function handleConfirmDelete(): void {
    remove(world.id).catch(ignore);
  }

  function handleOpen(): void {
    continueWorld(world.id, world);
  }

  return { handleConfirmDelete, handleDelete, handleKeep, handleOpen, isConfirming };
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
          <span className="text-ink truncate text-sm font-medium">{world.name}</span>

          <span className="text-ink-soft flex min-w-0 items-center gap-1 text-xs">
            {world.hasLandChanged ? <TriangleAlert aria-hidden="true" className="shrink-0" size={12} /> : null}

            <span className="truncate">{worldDetails(world, now)}</span>
          </span>
        </span>
      </button>

      <IconButton
        className="text-ink-soft size-9"
        icon={<Trash2 aria-hidden="true" size={16} />}
        label={`Delete ${world.name}`}
        onClick={handleDelete}
      />
    </div>
  );
}

export function SavesUnavailableNote() {
  const canReadSaves = useSavesStore((state) => {
    return state.canReadSaves;
  });

  if (canReadSaves) {
    return null;
  }

  return <p className="text-ink-soft text-sm">{UNAVAILABLE_NOTE}</p>;
}

export function SavedWorldList() {
  const canReadSaves = useSavesStore((state) => {
    return state.canReadSaves;
  });
  const worlds = useSavesStore((state) => {
    return state.worlds;
  });
  const now = useNow(CLOCK_MILLISECONDS);

  if (!canReadSaves) {
    return <SavesUnavailableNote />;
  }

  return (
    <ul aria-label="Your worlds" className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
      {worlds.map((world) => {
        return (
          <li key={world.id}>
            <SavedWorldRow now={now} world={world} />
          </li>
        );
      })}
    </ul>
  );
}
