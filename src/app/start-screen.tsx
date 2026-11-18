import { useEffect } from "react";
import { GameIcon } from "../design/game-icon.tsx";
import { Island } from "../design/island.tsx";
import { ProjectLinks } from "../features/project/project-links.tsx";
import { preloadGame } from "./engine-launcher.ts";
import { StartBackdrop } from "./start-backdrop.tsx";
import { WorldMenu } from "./world-menu.tsx";

export function StartScreen() {
  useEffect(() => {
    preloadGame().catch((error: unknown) => {
      console.warn("The game could not be loaded ahead", error);
    });
  }, []);

  return (
    <div className="bg-canvas absolute inset-0 isolate">
      <StartBackdrop />

      <div className="p-safe absolute inset-0 grid grid-rows-[minmax(0,1fr)] place-items-center">
        <Island className="flex max-h-full w-full max-w-96 flex-col overflow-hidden">
          <header className="flex shrink-0 flex-col items-center justify-center gap-1 px-5 pt-5 sm:pt-6 [@media(max-height:30rem)]:flex-row [@media(max-height:30rem)]:gap-2 [@media(max-height:30rem)]:pt-2">
            <GameIcon className="size-16 sm:size-20 [@media(max-height:30rem)]:size-10" name="population" size={80} />

            <h1 className="text-ink text-3xl leading-none font-extrabold tracking-tight sm:text-4xl">Ashfolk</h1>
          </header>

          <section
            aria-label="World selection"
            className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
          >
            <WorldMenu />
          </section>

          <footer className="border-line mx-5 flex shrink-0 justify-center border-t py-1.5 sm:mx-6">
            <ProjectLinks className="flex-nowrap gap-0 [&_a]:h-11 [&_a]:px-2.5" />
          </footer>
        </Island>
      </div>
    </div>
  );
}
