import { ChevronLeft, Crosshair, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { type AgeGroup, ageGroupOf } from "../../content/life-stages.ts";
import { IconButton, TextButton } from "../../design/buttons.tsx";
import { GameIcon } from "../../design/game-icon.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import { ScrollPanel } from "../../design/scroll-panel.tsx";
import { ignore } from "../../shared/ignore.ts";
import type { Inspection, PersonInspection } from "../../simulation/inspection.ts";
import { AnimalDetails, BuildingDetails, CellDetails, PersonDetails, TribeDetails } from "./inspector-details.tsx";

const KIND_ICONS: Readonly<Record<Inspection["kind"], GameIconName>> = {
  animal: "paw",
  building: "hut",
  cell: "smooth",
  person: "person",
  tribe: "tent",
};

const PERSON_NOUNS: Readonly<Record<AgeGroup, { readonly female: string; readonly male: string }>> = {
  adult: { female: "Woman", male: "Man" },
  child: { female: "Girl", male: "Boy" },
  elder: { female: "Elder woman", male: "Elder man" },
};

interface InspectorCardProps {
  readonly inspection: Inspection;
  readonly onBack?: (() => void) | undefined;
  readonly onClose: () => void;
}

function personNoun(person: PersonInspection): string {
  const nouns = PERSON_NOUNS[ageGroupOf(person.age)];

  return person.isFemale ? nouns.female : nouns.male;
}

export function titleOf(inspection: Inspection): string {
  switch (inspection.kind) {
    case "cell":
      return inspection.biomeName;
    case "tribe":
      return inspection.summary.name;
    default:
      return inspection.name;
  }
}

function subtitleOf(inspection: Inspection): string {
  switch (inspection.kind) {
    case "animal":
      return inspection.isYoung ? "Young animal" : "Wild animal";
    case "building":
      return inspection.tribeName;
    case "cell":
      return `${Math.round(inspection.x)}, ${Math.round(inspection.z)}`;
    case "person":
      return `${personNoun(inspection)}, ${inspection.age} · ${inspection.tribeName}`;
    case "tribe":
      return inspection.summary.isMigrating ? "On the move" : "Settled";
    default:
      return inspection satisfies never;
  }
}

function isFollowable(inspection: Inspection): boolean {
  return inspection.kind === "person" || inspection.kind === "animal";
}

function useFollowing() {
  const engine = useEngine();

  function subscribe(onChange: () => void): () => void {
    if (engine === null) {
      return ignore;
    }

    return engine.subscribeToRenders(onChange);
  }

  function isFollowingNow(): boolean {
    if (engine === null) {
      return false;
    }

    return engine.camera.isFollowing;
  }

  const isFollowing = useSyncExternalStore(subscribe, isFollowingNow);

  function handleFollow(): void {
    if (engine === null) {
      return;
    }

    if (engine.camera.isFollowing) {
      engine.stopFollowing();

      return;
    }

    engine.followSelection();
  }

  return { handleFollow, isFollowing };
}

function InspectionDetails({ inspection }: { readonly inspection: Inspection }) {
  switch (inspection.kind) {
    case "animal":
      return <AnimalDetails animal={inspection} />;
    case "building":
      return <BuildingDetails building={inspection} />;
    case "cell":
      return <CellDetails cell={inspection} />;
    case "person":
      return <PersonDetails person={inspection} />;
    case "tribe":
      return <TribeDetails tribe={inspection} />;
    default:
      return inspection satisfies never;
  }
}

function FollowButton({ inspection }: { readonly inspection: Inspection }) {
  const { handleFollow, isFollowing } = useFollowing();

  if (!isFollowable(inspection)) {
    return null;
  }

  return (
    <IconButton
      icon={<Crosshair aria-hidden="true" size={17} />}
      isPressed={isFollowing}
      label="Follow with the camera"
      onClick={handleFollow}
    />
  );
}

function CloseButton({ onClose }: { readonly onClose: () => void }) {
  return <IconButton icon={<X aria-hidden="true" size={18} />} label="Close the card" onClick={onClose} />;
}

function BackRow({ onBack, onClose }: { readonly onBack: () => void; readonly onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <TextButton
        aria-label="Back to the journal"
        className="-ml-1 h-8 gap-1 pr-3 pl-1.5 pointer-coarse:h-10"
        onClick={onBack}
        tone="quiet"
      >
        <ChevronLeft aria-hidden="true" size={18} />
        Journal
      </TextButton>

      <CloseButton onClose={onClose} />
    </div>
  );
}

export function InspectorCard({ inspection, onBack, onClose }: InspectorCardProps) {
  return (
    <section aria-label="Selection details" className="flex min-h-0 flex-col gap-3">
      {onBack === undefined ? null : <BackRow onBack={onBack} onClose={onClose} />}

      <header className="flex items-center gap-3">
        <span className="bg-paper-hover grid size-10 shrink-0 place-items-center rounded-xl">
          <GameIcon name={KIND_ICONS[inspection.kind]} size={30} />
        </span>

        <div className="min-w-0 flex-1">
          <h2
            className="text-ink truncate text-lg leading-tight font-semibold outline-none"
            data-panel-heading=""
            tabIndex={-1}
          >
            {titleOf(inspection)}
          </h2>

          <p className="text-ink-muted truncate text-xs">{subtitleOf(inspection)}</p>
        </div>

        <FollowButton inspection={inspection} />

        {onBack === undefined ? <CloseButton onClose={onClose} /> : null}
      </header>

      <ScrollPanel className="-mx-1 px-1 pb-1">
        <InspectionDetails inspection={inspection} />
      </ScrollPanel>
    </section>
  );
}
