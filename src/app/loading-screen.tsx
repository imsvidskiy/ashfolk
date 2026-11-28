import { RefreshCw, RotateCcw } from "lucide-react";
import { useState } from "react";
import { TextButton } from "../design/buttons.tsx";
import { Island } from "../design/island.tsx";
import type { IslandSketch } from "../generation/generation-options.ts";
import type { EngineStatus, LoadingStage } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { IslandSketchView } from "./island-sketch-view.tsx";
import { useLaunchStore } from "./launch-store.ts";
import { reloadPage } from "./reload-page.ts";

const RECOVERY_PANEL = "flex max-w-md flex-col items-center gap-5 p-6";

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

function retryLaunch(): void {
  useLaunchStore.getState().retryLaunch();
}

function startAgain(): void {
  useLaunchStore.getState().relaunch({});
}

function useReloadAfterSave(saved: Promise<unknown>) {
  const [isReloading, setIsReloading] = useState(false);

  function handleReload(): void {
    setIsReloading(true);
    saved.then(reloadPage, reloadPage);
  }

  return { handleReload, isReloading };
}

function Caption({ name, stage }: CaptionProps) {
  const label = STAGE_LABELS[stage];

  return (
    <div className="p-safe absolute inset-x-0 bottom-0 flex justify-center">
      <Island className="max-w-full px-5 py-2.5">
        <div className="flex flex-col items-center gap-0.5 text-center" role="status">
          <h2 className="text-ink text-lg leading-tight font-bold wrap-anywhere">{name}</h2>

          <p className="text-ink-soft animate-stage-in text-sm" key={label}>
            {label}…
          </p>
        </div>
      </Island>
    </div>
  );
}

function LoadingScene({ island, name, stage }: LoadingSceneProps) {
  return (
    <div className="bg-island-sky absolute inset-0 overflow-hidden">
      <div aria-hidden="true" className="animate-descend absolute inset-0 grid place-items-center">
        <IslandSketchView className="size-[min(72dvh,86vw)]" island={island} />
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

function RecoveryMessage({ message, onRetry, title }: FailureMessageProps & { readonly onRetry: () => void }) {
  const chooseWorld = useLaunchStore((state) => {
    return state.chooseWorld;
  });

  return (
    <Island className={RECOVERY_PANEL}>
      <FailureMessage message={message} title={title} />

      <div className="flex gap-2">
        <TextButton onClick={onRetry} tone="accent">
          <RotateCcw aria-hidden="true" size={16} />
          Start again
        </TextButton>

        <TextButton onClick={chooseWorld} tone="outline">
          Worlds
        </TextButton>
      </div>
    </Island>
  );
}

function GraphicsLostMessage({ saved }: { readonly saved: Promise<unknown> }) {
  const { handleReload, isReloading } = useReloadAfterSave(saved);

  return (
    <Island className={RECOVERY_PANEL}>
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
  const name = useLaunchStore((state) => {
    return state.launch.name;
  });

  switch (status.kind) {
    case "failed":
      return <RecoveryMessage message={status.message} onRetry={retryLaunch} title="The island could not rise" />;
    case "graphicsLost":
      return <GraphicsLostMessage saved={status.saved} />;
    case "loading":
      return <LoadingScene island={status.island} name={name} stage={status.stage} />;
    case "stopped":
      return <RecoveryMessage message={status.message} onRetry={startAgain} title="The simulation stopped" />;
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
