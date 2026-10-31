import { useRef, useSyncExternalStore } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import { FOCUS_RING, PAPER_SURFACE } from "../../design/styles.ts";
import type { EngineHandle } from "../../game/engine-handle.ts";
import type { Landmark, LandmarkKind } from "../../game/landmarks.ts";
import type { TribeSummary } from "../../simulation/frame.ts";
import type { RivalryView } from "../../simulation/society/rivalry/rivalry-system.ts";
import { useShowTribe } from "../inspector/use-focus-camera.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { isFeuding, raidOf } from "../rivalry/rivalry-queries.ts";
import { TribeDot } from "../tribes/tribe-dot.tsx";
import { useWorldStore, type WorldSnapshot } from "../world/world-store.ts";
import { useLabelLayout } from "./use-label-layout.ts";

const TRIBE_LIFT = 18;
const LANDMARK_RANKS: Readonly<Record<LandmarkKind, number>> = { lake: 1, monument: 2, peak: 0, pond: 3 };
const LABEL_FRAME =
  "invisible absolute top-0 left-0 opacity-0 transition-[opacity,visibility] duration-200 will-change-transform data-shown:visible data-shown:opacity-100";

type TribeMood = "calm" | "feuding" | "raiding";

interface TribeLabelProps {
  readonly isSelected: boolean;
  readonly mood: TribeMood;
  readonly tribe: TribeSummary;
}

function selectedTribeIdOf(state: { readonly snapshot: WorldSnapshot | null }): number | null {
  const inspection = state.snapshot?.inspection;

  if (inspection?.kind !== "tribe") {
    return null;
  }

  return inspection.summary.id;
}

function moodOf(rivalry: RivalryView, tribeId: number): TribeMood {
  if (raidOf(rivalry, tribeId) !== null) {
    return "raiding";
  }

  return isFeuding(rivalry, tribeId) ? "feuding" : "calm";
}

function useLandmarks(engine: EngineHandle): readonly Landmark[] {
  function subscribe(onChange: () => void): () => void {
    return engine.session.subscribe(onChange);
  }

  function landmarksNow(): readonly Landmark[] {
    return engine.landmarks;
  }

  return useSyncExternalStore(subscribe, landmarksNow);
}

function LandmarkDetail({ detail }: { readonly detail: string | null }) {
  if (detail === null) {
    return null;
  }

  return <span className="text-xs font-medium tabular-nums opacity-90">{detail}</span>;
}

function LandmarkLabel({ landmark }: { readonly landmark: Landmark }) {
  return (
    <li
      className={cn(LABEL_FRAME, "flex flex-col items-center text-white text-shadow-black/55 text-shadow-md")}
      data-label=""
      data-lift={landmark.lift}
      data-rank={LANDMARK_RANKS[landmark.kind]}
      data-x={landmark.x}
      data-z={landmark.z}
    >
      <span
        className={cn("text-sm font-semibold tracking-wide", {
          italic: landmark.kind === "lake" || landmark.kind === "pond",
        })}
      >
        {landmark.name}
      </span>

      <LandmarkDetail detail={landmark.detail} />
    </li>
  );
}

function FeudMark({ mood }: { readonly mood: TribeMood }) {
  if (mood === "calm") {
    return null;
  }

  const label = mood === "raiding" ? "Raid under way" : "In a feud";

  return (
    <span className="flex" title={label}>
      <GameIcon label={label} name="raid" size={18} />
    </span>
  );
}

function TribeLabel({ isSelected, mood, tribe }: TribeLabelProps) {
  const showTribe = useShowTribe(tribe);

  return (
    <li
      className={cn(LABEL_FRAME, "flex flex-col items-center")}
      data-label=""
      data-lift={TRIBE_LIFT}
      data-priority=""
      data-x={tribe.campX}
      data-z={tribe.campZ}
    >
      <button
        aria-current={isSelected}
        className={cn(
          PAPER_SURFACE,
          FOCUS_RING,
          "hover:bg-canvas pointer-events-auto flex items-center gap-2 rounded-full py-1 pr-3 pl-1.5 text-xs transition-colors",
          { "ring-dawn ring-2": isSelected, "ring-ember/80 ring-2": mood === "raiding" && !isSelected }
        )}
        onClick={showTribe}
        type="button"
      >
        <TribeDot color={tribe.color} />

        <span className="text-ink font-semibold">{tribe.name}</span>

        <span className="text-dawn-strong font-semibold tabular-nums">{tribe.population}</span>

        <FeudMark mood={mood} />

        <span className="text-ink-muted group-data-far:hidden">{tribe.eraName}</span>
      </button>

      <span aria-hidden="true" className="h-2 w-px bg-white/90" />
    </li>
  );
}

function TribeLabels() {
  const tribes = useWorldStore((state) => {
    return state.snapshot?.tribes;
  });
  const rivalry = useWorldStore((state) => {
    return state.snapshot?.rivalry;
  });
  const selectedTribeId = useWorldStore(selectedTribeIdOf);

  if (tribes === undefined || rivalry === undefined || tribes.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Tribes">
      {tribes.map((tribe) => {
        return (
          <TribeLabel
            isSelected={tribe.id === selectedTribeId}
            key={tribe.id}
            mood={moodOf(rivalry, tribe.id)}
            tribe={tribe}
          />
        );
      })}
    </ul>
  );
}

function LabelLayer({ engine }: { readonly engine: EngineHandle }) {
  const landmarks = useLandmarks(engine);
  const layerReference = useRef<HTMLDivElement>(null);

  useLabelLayout(layerReference, engine);

  return (
    <div className="group pointer-events-none fixed inset-0 overflow-hidden" ref={layerReference}>
      <ul aria-label="Places">
        {landmarks.map((landmark) => {
          return <LandmarkLabel key={landmark.id} landmark={landmark} />;
        })}
      </ul>

      <TribeLabels />
    </div>
  );
}

export function WorldLabels() {
  const engine = useEngine();
  const areLabelsShown = useInterfaceStore((state) => {
    return state.areLabelsShown;
  });

  if (engine === null || !areLabelsShown) {
    return null;
  }

  return <LabelLayer engine={engine} />;
}
