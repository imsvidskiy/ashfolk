import { ArrowLeft, ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { IconButton, TextButton } from "../design/buttons.tsx";
import { Island } from "../design/island.tsx";
import { useWorldDraft } from "../features/new-world/use-world-draft.ts";
import { NameField, SeedField, ShapeChoice, SizeChoice } from "../features/new-world/world-fields.tsx";
import { ProjectLinks } from "../features/project/project-links.tsx";
import { SavedWorldList, SavesUnavailableNote } from "../features/saves/saved-world-list.tsx";
import { useSavesStore } from "../features/saves/saves-store.ts";
import { ignore } from "../shared/ignore.ts";
import { loadGameEngine, loadHud } from "./engine-launcher.ts";
import { useLaunchStore } from "./launch-store.ts";
import { StartBackdrop } from "./start-backdrop.tsx";

const BIG_BUTTON_CLASS = "h-12 pointer-coarse:h-12 text-base";

type CardView = "home" | "new" | "worlds";

interface SubviewProps {
  readonly children: ReactNode;
  readonly onBack: (() => void) | null;
  readonly title: string;
}

function useTitleCard() {
  const worlds = useSavesStore((state) => {
    return state.worlds;
  });
  const continueWorld = useLaunchStore((state) => {
    return state.continueWorld;
  });
  const [view, setView] = useState<CardView>("home");

  const latest = worlds.find((world) => {
    return world.isLoadable;
  });

  function handleBack(): void {
    setView("home");
  }

  function handleNewWorld(): void {
    setView("new");
  }

  function handleAllWorlds(): void {
    setView("worlds");
  }

  function handleContinue(): void {
    if (latest !== undefined) {
      continueWorld(latest.id, latest);
    }
  }

  return {
    handleAllWorlds,
    handleBack,
    handleContinue,
    handleNewWorld,
    hasWorlds: worlds.length > 0,
    latest,
    view,
  };
}

function Subview({ children, onBack, title }: SubviewProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        {onBack === null ? null : (
          <IconButton
            className="-ml-2"
            icon={<ArrowLeft aria-hidden="true" size={18} />}
            label="Back"
            onClick={onBack}
          />
        )}

        <h2 className="text-ink text-xl font-bold">{title}</h2>
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
    <form aria-label="New world" className="flex flex-col gap-5" onSubmit={draft.handleSubmit}>
      <NameField onChange={draft.handleNameChange} onRoll={draft.handleNameRoll} value={draft.nameText} />

      <ShapeChoice onChange={draft.handleShapeChange} value={draft.shape} />

      <SizeChoice onChange={draft.handleSizeChange} value={draft.size} />

      <SeedField onChange={draft.handleSeedChange} onRoll={draft.handleSeedRoll} value={draft.seedText} />

      <TextButton className={BIG_BUTTON_CLASS} disabled={draft.choice === null} tone="accent" type="submit">
        Grow the island
        <ArrowRight aria-hidden="true" size={18} />
      </TextButton>
    </form>
  );
}

function TitleCard() {
  const { handleAllWorlds, handleBack, handleContinue, handleNewWorld, hasWorlds, latest, view } = useTitleCard();

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
        <SavedWorldList />
      </Subview>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {latest === undefined ? null : (
        <TextButton className={BIG_BUTTON_CLASS} onClick={handleContinue} tone="accent">
          Continue {latest.name}
          <ArrowRight aria-hidden="true" size={18} />
        </TextButton>
      )}

      <div className="grid grid-cols-2 gap-3">
        <TextButton className={BIG_BUTTON_CLASS} onClick={handleNewWorld} tone="outline">
          New world
        </TextButton>

        <TextButton className={BIG_BUTTON_CLASS} onClick={handleAllWorlds} tone="outline">
          All worlds
        </TextButton>
      </div>
    </div>
  );
}

export function StartScreen() {
  const refresh = useSavesStore((state) => {
    return state.refresh;
  });

  useEffect(() => {
    refresh().catch(ignore);
    Promise.all([loadGameEngine(), loadHud()]).catch((error: unknown) => {
      console.warn("The game could not be loaded ahead", error);
    });
  }, [refresh]);

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <StartBackdrop />

      <div className="relative flex min-h-full flex-col items-center justify-end gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-center sm:p-8">
        <Island className="flex w-full max-w-md flex-col gap-6 p-7">
          <header className="flex flex-col items-center gap-2 text-center">
            <img alt="" className="size-16" height="64" src="/logo.svg" width="64" />

            <h1 className="text-ink text-4xl font-extrabold tracking-tight">Ashfolk</h1>

            <p className="text-ink-soft">Guide the first tribes on a floating island.</p>
          </header>

          <hr className="border-line" />

          <TitleCard />
        </Island>

        <Island className="px-2 py-1.5">
          <ProjectLinks />
        </Island>
      </div>
    </div>
  );
}
