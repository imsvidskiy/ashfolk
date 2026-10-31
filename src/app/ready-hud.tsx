import { type ComponentType, useEffect, useState } from "react";
import { ignore } from "../shared/ignore.ts";
import { loadHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";

interface HudModule {
  readonly Hud: ComponentType;
}

function useHudModule(): HudModule | null {
  const [hudModule, setHudModule] = useState<HudModule | null>(null);

  useEffect(() => {
    loadHud().then((loaded) => {
      setHudModule(loaded);
    }, ignore);
  }, []);

  return hudModule;
}

export function ReadyHud() {
  const isReady = useEngineStore((state) => {
    return state.status.kind === "ready";
  });
  const hudModule = useHudModule();

  if (!isReady || hudModule === null) {
    return null;
  }

  return <hudModule.Hud />;
}
