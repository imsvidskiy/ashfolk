import { RotateCcw } from "lucide-react";
import { TextButton } from "../design/buttons.tsx";
import { Logo } from "../design/logo.tsx";
import type { GenerationProgress, GenerationStage } from "../generation/generation-options.ts";
import type { EngineStatus } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { useLaunchStore } from "./launch-store.ts";

const STAGE_LABELS: Readonly<Record<GenerationStage, string>> = {
  climate: "Settling the climate",
  erosion: "Weathering the mountains",
  relief: "Raising the island",
  vegetation: "Planting the forests",
  water: "Filling rivers and lakes",
};

function stageLabel(progress: GenerationProgress | null): string {
  if (progress === null) {
    return "Waking the world";
  }

  return STAGE_LABELS[progress.stage];
}

function startAgain(): void {
  useLaunchStore.getState().relaunch({});
}

interface LoadingMessageProps {
  readonly name: string;
  readonly progress: GenerationProgress | null;
}

function LoadingMessage({ name, progress }: LoadingMessageProps) {
  return (
    <div className="flex flex-col items-center gap-3 text-center" role="status">
      <Logo />

      <h2 className="text-ink text-3xl wrap-break-word">{name}</h2>

      <p className="text-ink-soft text-sm">{stageLabel(progress)}…</p>
    </div>
  );
}

interface FailureMessageProps {
  readonly message: string;
  readonly title: string;
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

function StatusMessage({ status }: { readonly status: Exclude<EngineStatus, { kind: "ready" }> }) {
  const name = useLaunchStore((state) => state.launch.name);

  switch (status.kind) {
    case "failed":
      return <FailureMessage message={status.message} title="The island could not rise" />;
    case "loading":
      return <LoadingMessage name={name} progress={status.progress} />;
    case "stopped":
      return <StoppedMessage message={status.message} />;
    default:
      return status satisfies never;
  }
}

export function LoadingScreen() {
  const status = useEngineStore((state) => state.status);

  if (status.kind === "ready") {
    return null;
  }

  return (
    <div className="bg-canvas absolute inset-0 grid place-items-center p-6">
      <StatusMessage status={status} />
    </div>
  );
}
