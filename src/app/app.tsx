import { lazy, Suspense, useEffect } from "react";
import { TooltipProvider } from "../design/tooltip.tsx";
import { loadHud } from "./engine-launcher.ts";
import { useEngineStore } from "./engine-store.ts";
import { GameView } from "./game-view.tsx";
import { useLaunchStore } from "./launch-store.ts";
import { LoadingScreen } from "./loading-screen.tsx";
import { StartScreen } from "./start-screen.tsx";

const Hud = lazy(() => loadHud().then((module) => ({ default: module.Hud })));

function GameScreen() {
  const launch = useLaunchStore((state) => state.launch);
  const worldId = useLaunchStore((state) => state.worldId);
  const isReady = useEngineStore((state) => state.status.kind === "ready");

  useEffect(() => {
    document.title = `${launch.name} · Dawnfolk`;
  }, [launch.name]);

  return (
    <>
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
  const isChoosingWorld = useLaunchStore((state) => state.isChoosingWorld);

  return (
    <TooltipProvider>
      <main className="fixed inset-0 overflow-hidden">
        <h1 className="sr-only">Dawnfolk</h1>

        {isChoosingWorld ? <StartScreen /> : <GameScreen />}
      </main>
    </TooltipProvider>
  );
}
