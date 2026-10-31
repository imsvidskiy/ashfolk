import { RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import { TextButton } from "../design/buttons.tsx";
import { cn } from "../design/cn.ts";
import { Island } from "../design/island.tsx";
import type { IslandSketch } from "../generation/generation-options.ts";
import { CloudSeaBackdrop } from "./cloud-sea-backdrop.tsx";
import type { EngineStatus, LoadingStage } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { IslandSketchView } from "./island-sketch-view.tsx";
import { useLaunchStore } from "./launch-store.ts";
import { reloadPage } from "./reload-page.ts";

const CAPTION_GLOW = "[text-shadow:0_0_12px_rgb(255_255_255/0.9),0_0_2px_rgb(255_255_255/0.9)]";

const STAGE_LABELS: Readonly<Record<LoadingStage, string>> = {
  climate: "Settling the climate",
  erosion: "Weathering the mountains",
  lighting: "Lighting the island",
  relief: "Raising the island",
  vegetation: "Planting the forests",
  waking: "Waking the world",
  water: "Filling rivers and lakes",
};

interface LoadingSceneProps {
  readonly island: IslandSketch | null;
  readonly name: string;
  readonly seed: number;
  readonly stage: LoadingStage;
}

interface CaptionProps {
  readonly name: string;
  readonly stage: LoadingStage;
}

interface FailureMessageProps {
  readonly message: string;
  readonly title: string;
}

function startAgain(): void {
  useLaunchStore.getState().relaunch({});
}

function Caption({ name, stage }: CaptionProps) {
  const label = STAGE_LABELS[stage];

  return (
    <div className="p-safe absolute inset-x-0 bottom-0">
      <div className="flex flex-col items-center gap-1 py-3 text-center" role="status">
        <h2 className={cn("text-ink text-2xl tracking-tight wrap-break-word", CAPTION_GLOW)}>{name}</h2>

        <p className={cn("text-ink-soft animate-stage-in italic", CAPTION_GLOW)} key={label}>
          {label}…
        </p>
      </div>
    </div>
  );
}

function LoadingScene({ island, name, seed, stage }: LoadingSceneProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div aria-hidden="true" className="animate-descend absolute inset-0">
        <CloudSeaBackdrop seed={seed} />

        <div className="absolute inset-0 grid place-items-center">
          <IslandSketchView className="size-[min(72dvh,86vw)]" island={island} />
        </div>
      </div>

      <Caption name={name} stage={stage} />
    </div>
  );
}

function FailureMessage({ message, title }: FailureMessageProps) {
  return (
    <div className="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
      <h2 className="text-ink text-3xl">{title}</h2>

      <p className="text-ink-soft text-sm">{message}</p>
    </div>
  );
}

function StoppedMessage({ message }: { readonly message: string }) {
  return (
    <div className="flex flex-col items-center gap-5">
      <FailureMessage message={message} title="The simulation stopped" />

      <TextButton onClick={startAgain} tone="accent">
        <RotateCcw aria-hidden="true" size={16} />
        Start again
      </TextButton>
    </div>
  );
}

function useReloadAfterSave(saved: Promise<unknown>) {
  const [isReloading, setIsReloading] = useState(false);

  function handleReload(): void {
    setIsReloading(true);
    saved.then(reloadPage, reloadPage);
  }

  return { handleReload, isReloading };
}

function GraphicsLostMessage({ saved }: { readonly saved: Promise<unknown> }) {
  const { handleReload, isReloading } = useReloadAfterSave(saved);

  return (
    <Island className="flex max-w-md flex-col items-center gap-5 p-6">
      <FailureMessage
        message="Your browser's graphics stopped working. Reload to carry on from your last save, or try Chrome."
        title="The island went dark"
      />

      <TextButton disabled={isReloading} onClick={handleReload} tone="accent">
        <RefreshCw aria-hidden="true" size={16} />
        Reload
      </TextButton>
    </Island>
  );
}

function StatusMessage({ status }: { readonly status: Exclude<EngineStatus, { kind: "ready" }> }) {
  const { name, seed } = useLaunchStore((state) => {
    return state.launch;
  });

  switch (status.kind) {
    case "failed":
      return <FailureMessage message={status.message} title="The island could not rise" />;
    case "graphicsLost":
      return <GraphicsLostMessage saved={status.saved} />;
    case "loading":
      return <LoadingScene island={status.island} name={name} seed={seed} stage={status.stage} />;
    case "stopped":
      return <StoppedMessage message={status.message} />;
    default:
      return status satisfies never;
  }
}

export function LoadingScreen() {
  const status = useEngineStore((state) => {
    return state.status;
  });

  if (status.kind === "ready") {
    return null;
  }

  return (
    <div className="bg-canvas absolute inset-0 grid place-items-center p-6">
      <StatusMessage status={status} />
    </div>
  );
}
