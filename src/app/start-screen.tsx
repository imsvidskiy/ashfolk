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

      <div className="p-safe absolute inset-0 flex flex-col justify-end overflow-y-auto md:items-start md:justify-start lg:p-5">
        <Island className="mx-auto flex max-h-full w-full max-w-md flex-col overflow-hidden md:mx-0 md:h-full md:w-[clamp(18rem,25vw,25rem)]">
          <header className="flex shrink-0 items-center justify-center gap-2.5 px-5 pt-4 pb-3 md:flex-col md:gap-1 md:pt-7 md:pb-5 lg:pt-10">
            <GameIcon className="size-12 md:size-23 lg:size-27" name="population" size={108} />

            <h1 className="text-ink text-3xl leading-none font-extrabold tracking-tight md:text-4xl lg:text-5xl">
              Ashfolk
            </h1>
          </header>

          <section
            aria-label="World selection"
            className="flex min-h-0 flex-col overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 md:flex-1 md:py-5 lg:px-7"
          >
            <div className="my-auto w-full shrink-0">
              <WorldMenu />
            </div>
          </section>

          <footer className="border-line mx-4 flex shrink-0 justify-center border-t py-1.5 sm:mx-6 md:py-3">
            <ProjectLinks className="flex-nowrap gap-0 [&_a]:h-11 [&_a]:px-2.5" />
          </footer>
        </Island>
      </div>
    </div>
  );
}
