import { useEffect, useRef } from "react";
import { EngineLauncher, WAKING_STATUS } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { useLaunchStore, type WorldLaunch } from "./launch-store.ts";

interface GameViewProps {
  readonly request: WorldLaunch;
}

export function GameView({ request }: GameViewProps) {
  const setStatus = useEngineStore((state) => {
    return state.setStatus;
  });
  const containerReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerReference.current;

    if (container === null) {
      return;
    }

    const launcher = new EngineLauncher(
      container,
      request.options,
      request.savedWorldId,
      (status) => {
        const current = useLaunchStore.getState();

        if (!current.isChoosingWorld && current.request === request) {
          setStatus(status);
        }
      },
      (choice) => {
        useLaunchStore.getState().restoreChoice(request, choice);
      }
    );

    return () => {
      launcher.cancel();
      setStatus(WAKING_STATUS);
    };
  }, [request, setStatus]);

  return <div className="absolute inset-0" ref={containerReference} />;
}
