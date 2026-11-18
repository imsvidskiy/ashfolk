import { ArrowLeft, ArrowRight, Layers3, Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { IconButton, TextButton } from "../design/buttons.tsx";
import { useWorldDraft } from "../features/new-world/use-world-draft.ts";
import { NameField, SeedField, ShapeChoice, SizeChoice } from "../features/new-world/world-fields.tsx";
import type { SavedWorldListing } from "../features/saves/save-database.ts";
import { describePeople, formatSavedAt } from "../features/saves/saved-time.ts";
import { SavedWorldList, SavesUnavailableNote } from "../features/saves/saved-world-list.tsx";
import { useNow } from "../features/saves/use-now.ts";
import { useLaunchStore } from "./launch-store.ts";
import { useWorldMenu } from "./use-world-menu.ts";

const PRIMARY_ACTION =
  "h-12 gap-4 bg-[#304b3a] px-7 text-base font-extrabold text-white hover:bg-[#21392c] pointer-coarse:h-12";

const SECONDARY_ACTION =
  "h-12 gap-2 border-[#c7c3ad] px-5 font-bold text-[#33493a] hover:bg-[#ede9db] pointer-coarse:h-12";

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
          className="text-2xl leading-tight font-extrabold tracking-tight text-[#273d31] outline-none sm:text-3xl"
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
    <form
      aria-label="New world"
      className="grid items-end gap-x-7 gap-y-4 sm:grid-cols-2 xl:grid-cols-[1fr_0.76fr_1fr_0.8fr_auto]"
      onSubmit={draft.handleSubmit}
    >
      <NameField onChange={draft.handleNameChange} onRoll={draft.handleNameRoll} value={draft.nameText} />

      <ShapeChoice onChange={draft.handleShapeChange} value={draft.shape} />

      <SizeChoice onChange={draft.handleSizeChange} value={draft.size} />

      <SeedField onChange={draft.handleSeedChange} onRoll={draft.handleSeedRoll} value={draft.seedText} />

      <TextButton
        className={`${PRIMARY_ACTION} mt-1 sm:col-span-2 sm:justify-self-start xl:col-span-1 xl:mt-0`}
        disabled={draft.choice === null}
        tone="accent"
        type="submit"
      >
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
    <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
      <div className="min-w-0 sm:max-w-[72%]">
        <p className="text-xs font-extrabold tracking-widest text-[#696d56] uppercase">Last played</p>

        <h2 className="mt-1 truncate text-[2rem] leading-tight font-extrabold tracking-tight text-[#273d31] sm:text-4xl">
          {world.name}
        </h2>

        <p className="mt-1 text-sm text-[#5c6354]">
          {details === "" ? null : `${details} · `}Saved {savedAt}
        </p>
      </div>

      <TextButton aria-label={`Continue ${world.name}`} className={PRIMARY_ACTION} onClick={onContinue} tone="accent">
        Continue
        <ArrowRight aria-hidden="true" size={19} />
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
      <p className="text-sm font-bold text-[#52634f]" role="status">
        Finding your worlds…
      </p>
    );
  }

  if (!hasWorlds || view === "new") {
    return (
      <Subview onBack={hasWorlds ? handleBack : null} title="New world">
        <NewWorldForm />

        <SavesUnavailableNote />
      </Subview>
    );
  }

  if (view === "worlds") {
    return (
      <Subview onBack={handleBack} title="Your worlds">
        <div className="max-w-3xl">
          <SavedWorldList />
        </div>
      </Subview>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
      {latest === undefined ? (
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#273d31]">Your worlds</h2>

          <p className="mt-1 text-sm text-[#5c6354]">These saved worlds can’t be opened in this version.</p>
        </div>
      ) : (
        <LatestWorld onContinue={handleContinue} world={latest} />
      )}

      <div className="grid grid-cols-2 gap-3 lg:border-l lg:border-[#d8d1bd] lg:pl-10">
        <TextButton
          className={latest === undefined ? PRIMARY_ACTION : SECONDARY_ACTION}
          onClick={handleNewWorld}
          ref={newWorldButton}
          tone={latest === undefined ? "accent" : "outline"}
        >
          <Plus aria-hidden="true" size={17} />
          New world
        </TextButton>

        <TextButton className={SECONDARY_ACTION} onClick={handleAllWorlds} ref={worldsButton} tone="outline">
          <Layers3 aria-hidden="true" size={17} />
          All worlds
        </TextButton>
      </div>
    </div>
  );
}
