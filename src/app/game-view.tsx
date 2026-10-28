import { useEffect, useRef } from "react";
import { EngineLauncher } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import type { LaunchOptions } from "./launch-options.ts";

interface GameViewProps {
  readonly launch: LaunchOptions;
  readonly worldId: string;
}

export function GameView({ launch, worldId }: GameViewProps) {
  const setStatus = useEngineStore((state) => state.setStatus);
  const containerReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerReference.current;

    if (container === null) {
      return;
    }

    const launcher = new EngineLauncher(container, launch, worldId, setStatus);

    return () => launcher.cancel();
  }, [launch, setStatus, worldId]);

  return <div className="absolute inset-0" ref={containerReference} />;
}
