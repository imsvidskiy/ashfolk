import { loadedHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";

export function ReadyHud() {
  const isReady = useEngineStore((state) => {
    return state.status.kind === "ready";
  });
  const Hud = loadedHud();

  if (!isReady || Hud === null) {
    return null;
  }

  return <Hud />;
}
