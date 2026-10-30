import { lazy, Suspense, useEffect } from "react";
import { TooltipProvider } from "../design/tooltip.tsx";
import { connectInstall } from "../features/install/install-store.ts";
import { connectSound } from "../features/sound/sound.ts";
import { loadHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { GameView } from "./game-view.tsx";
import { useLaunchStore } from "./launch-store.ts";
import { LoadingScreen } from "./loading-screen.tsx";
import { StartScreen } from "./start-screen.tsx";

const Hud = lazy(() => {
  return loadHud().then((module) => {
    return { default: module.Hud };
  });
});

function GameScreen() {
  const launch = useLaunchStore((state) => {
    return state.launch;
  });
  const worldId = useLaunchStore((state) => {
    return state.worldId;
  });
  const isReady = useEngineStore((state) => {
    return state.status.kind === "ready";
  });

  useEffect(() => {
    document.title = `${launch.name} · Dawnfolk`;
  }, [launch.name]);

  return (
    <>
      <h1 className="sr-only">Dawnfolk</h1>

      <GameView launch={launch} worldId={worldId} />

      {isReady ? (
        <Suspense fallback={null}>
          <Hud />
        </Suspense>
      ) : null}

      <LoadingScreen />
    </>
  );
}

export function App() {
  const isChoosingWorld = useLaunchStore((state) => {
    return state.isChoosingWorld;
  });

  useEffect(() => {
    return connectSound(window);
  }, []);

  useEffect(() => {
    return connectInstall(window);
  }, []);

  return (
    <TooltipProvider>
      <main className="fixed inset-0 overflow-hidden">{isChoosingWorld ? <StartScreen /> : <GameScreen />}</main>
    </TooltipProvider>
  );
}
