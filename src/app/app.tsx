import { useEffect } from "react";
import { TooltipProvider } from "../design/tooltip.tsx";
import { connectInstall } from "../features/install/install-store.ts";
import { connectSound } from "../features/sound/sound.ts";
import { GameView } from "./game-view.tsx";
import { useLaunchStore } from "./launch-store.ts";
import { LoadingScreen } from "./loading-screen.tsx";
import { ReadyHud } from "./ready-hud.tsx";
import { StartScreen } from "./start-screen.tsx";

function GameScreen() {
  const launch = useLaunchStore((state) => {
    return state.launch;
  });
  const worldId = useLaunchStore((state) => {
    return state.worldId;
  });

  useEffect(() => {
    document.title = `${launch.name} · Ashfolk`;
  }, [launch.name]);

  return (
    <>
      <h1 className="sr-only">Ashfolk</h1>

      <GameView launch={launch} worldId={worldId} />

      <ReadyHud />

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
