import { type ComponentType, useEffect, useState } from "react";
import { ignore } from "../shared/ignore.ts";
import { loadHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";

interface HudModule {
  readonly Hud: ComponentType;
}

function useHudModule(shouldLoad: boolean): HudModule | null {
  const [hudModule, setHudModule] = useState<HudModule | null>(null);

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }

    loadHud().then((loaded) => {
      setHudModule(loaded);
    }, ignore);
  }, [shouldLoad]);

  return hudModule;
}

export function ReadyHud() {
  const isReady = useEngineStore((state) => {
    return state.status.kind === "ready";
  });
  const isIslandGrowing = useEngineStore((state) => {
    return state.status.kind !== "loading" || state.status.stage !== "waking";
  });
  const hudModule = useHudModule(isIslandGrowing);

  if (!isReady || hudModule === null) {
    return null;
  }

  return <hudModule.Hud />;
}
