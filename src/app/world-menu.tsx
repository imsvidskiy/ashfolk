import { ArrowLeft, ArrowRight, ChevronDown, Layers3, Play, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { IconButton, TextButton } from "../design/buttons.tsx";
import { cn } from "../design/cn.ts";
import { FOCUS_RING } from "../design/styles.ts";
import { LARGEST_SEED, readSeed } from "../features/new-world/seeds.ts";
import { useWorldDraft } from "../features/new-world/use-world-draft.ts";
import { NameField, SeedField, ShapeChoice, SizeChoice } from "../features/new-world/world-fields.tsx";
import type { SavedWorldListing } from "../features/saves/save-database.ts";
import { describePeople, formatSavedAt } from "../features/saves/saved-time.ts";
import { SavedWorldList, SavesUnavailableNote } from "../features/saves/saved-world-list.tsx";
import { useNow } from "../features/saves/use-now.ts";
import { useLaunchStore } from "./launch-store.ts";
import { useWorldMenu } from "./use-world-menu.ts";

const ACTION = "h-11 gap-2 px-4 font-bold pointer-coarse:h-11";

const SAVE_CLOCK_MILLISECONDS = 30_000;

interface SubviewProps {
  readonly children: ReactNode;
  readonly onBack: (() => void) | null;
  readonly title: string;
}

function Subview({ children, onBack, title }: SubviewProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const canGoBack = onBack !== null;

  useEffect(() => {
    if (canGoBack) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [canGoBack]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {onBack === null ? null : (
          <IconButton
            className="-ml-2"
            icon={<ArrowLeft aria-hidden="true" size={18} />}
            label="Back"
            onClick={onBack}
          />
        )}

        <h2
          className="text-ink text-xl leading-tight font-bold tracking-tight outline-none"
          ref={heading}
          tabIndex={-1}
        >
          {title}
        </h2>
      </div>

      {children}
    </div>
  );
}

function NewWorldForm() {
  const launch = useLaunchStore((state) => {
    return state.launch;
  });
  const createWorld = useLaunchStore((state) => {
    return state.createWorld;
  });
  const draft = useWorldDraft(launch, createWorld);

  return (
    <form aria-label="New world" className="flex flex-col gap-3" onSubmit={draft.handleSubmit}>
      <NameField onChange={draft.handleNameChange} onRoll={draft.handleNameRoll} value={draft.nameText} />

      <details className="group/options">
        <summary
          className={cn(
            FOCUS_RING,
            "text-ink-soft hover:bg-paper-hover flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-sm font-semibold [&::-webkit-details-marker]:hidden"
          )}
        >
          <span>Island options</span>

          <span className="text-ink-muted ml-auto text-xs font-medium capitalize">
            {draft.shape} · {draft.size}
          </span>

          <ChevronDown aria-hidden="true" className="group-open/options:rotate-180" size={16} />
        </summary>

        <div className="border-line mt-1 mb-2 flex flex-col gap-4 border-t pt-4">
          <ShapeChoice onChange={draft.handleShapeChange} value={draft.shape} />

          <SizeChoice onChange={draft.handleSizeChange} value={draft.size} />

          <SeedField onChange={draft.handleSeedChange} onRoll={draft.handleSeedRoll} value={draft.seedText} />
        </div>
      </details>

      {readSeed(draft.seedText) === null ? (
        <p className="text-ember text-sm" role="status">
          Use a seed from 1 to {LARGEST_SEED.toLocaleString("en")} in Island options.
        </p>
      ) : null}

      <TextButton className={ACTION} disabled={draft.choice === null} tone="accent" type="submit">
        Grow the island
        <ArrowRight aria-hidden="true" size={19} />
      </TextButton>
    </form>
  );
}

function LatestWorld({ onContinue, world }: { readonly onContinue: () => void; readonly world: SavedWorldListing }) {
  const now = useNow(SAVE_CLOCK_MILLISECONDS);
  const savedAt = formatSavedAt(world.savedAt, now);
  const population = world.summary === null ? "" : describePeople(world.summary.population);
  const details = world.hasLandChanged ? "The land has changed" : population;

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <p className="text-ink-muted text-xs font-semibold">Last played</p>

      <h2 className="text-ink mt-1 max-w-full text-3xl leading-tight font-bold tracking-tight wrap-anywhere">
        {world.name}
      </h2>

      <p className="text-ink-soft mt-1 text-sm">
        {details === "" ? null : `${details} · `}Saved {savedAt}
      </p>

      <TextButton
        aria-label={`Continue ${world.name}`}
        className={cn(ACTION, "mt-5 w-full")}
        onClick={onContinue}
        tone="accent"
      >
        <Play aria-hidden="true" fill="currentColor" size={15} />
        Continue
      </TextButton>
    </div>
  );
}

export function WorldMenu() {
  const {
    handleAllWorlds,
    handleBack,
    handleContinue,
    handleNewWorld,
    hasListedWorlds,
    hasWorlds,
    latest,
    newWorldButton,
    view,
    worldsButton,
  } = useWorldMenu();

  if (!hasListedWorlds) {
    return (
      <p className="text-ink-soft text-center text-sm" role="status">
        Finding your worlds…
      </p>
    );
  }

  if (!hasWorlds || view === "new") {
    return (
      <Subview onBack={hasWorlds ? handleBack : null} title={hasWorlds ? "New world" : "Your first island"}>
        {hasWorlds ? null : (
          <p className="text-ink-soft -mt-2 text-sm">Give your island a name and guide its first tribe.</p>
        )}

        <NewWorldForm />

        <SavesUnavailableNote />
      </Subview>
    );
  }

  if (view === "worlds") {
    return (
      <Subview onBack={handleBack} title="Your worlds">
        <SavedWorldList />
      </Subview>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {latest === undefined ? (
        <div>
          <h2 className="text-ink text-xl font-bold tracking-tight">Your worlds</h2>

          <p className="text-ink-soft mt-1 text-sm">These saved worlds can’t be opened in this version.</p>
        </div>
      ) : (
        <LatestWorld onContinue={handleContinue} world={latest} />
      )}

      <div className="flex flex-wrap items-center justify-center gap-1">
        <TextButton
          className={cn(ACTION, "px-3")}
          onClick={handleNewWorld}
          ref={newWorldButton}
          tone={latest === undefined ? "accent" : "quiet"}
        >
          <Plus aria-hidden="true" size={17} />
          New world
        </TextButton>

        <TextButton className={cn(ACTION, "px-3")} onClick={handleAllWorlds} ref={worldsButton} tone="quiet">
          <Layers3 aria-hidden="true" size={17} />
          All worlds
        </TextButton>
      </div>
    </div>
  );
}
