import { loadedHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";

export function ReadyHud() {
  const Hud = useEngineStore((state) => {
    if (state.status.kind !== "ready") {
      return null;
    }

    return loadedHud();
  });

  if (Hud === null) {
    return null;
  }

  return <Hud />;
}
