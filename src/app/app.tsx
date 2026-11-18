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
  const name = useLaunchStore((state) => {
    return state.launch.name;
  });
  const request = useLaunchStore((state) => {
    return state.request;
  });

  useEffect(() => {
    document.title = `${name} · Ashfolk`;
  }, [name]);

  return (
    <>
      <h1 className="sr-only">Ashfolk</h1>

      <GameView request={request} />

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
