import { useEffect } from "react";
import { GameIcon } from "../design/game-icon.tsx";
import { ProjectLinks } from "../features/project/project-links.tsx";
import { preloadGame } from "./engine-launcher.ts";
import { StartBackdrop } from "./start-backdrop.tsx";
import { WorldMenu } from "./world-menu.tsx";

const CONTENT_WIDTH = "mx-auto w-full max-w-[88rem] px-5 sm:px-10 lg:px-16";

function TitleScene() {
  return (
    <header className="relative isolate min-h-[15rem] flex-1 overflow-hidden sm:min-h-[21rem]">
      <StartBackdrop />

      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-linear-to-b from-[#e6e8d9]/65 to-transparent sm:h-52" />

      <div
        className={`${CONTENT_WIDTH} relative flex items-center gap-3 pt-[max(1.4rem,env(safe-area-inset-top))] sm:gap-5 sm:pt-9 lg:pt-12`}
      >
        <GameIcon className="size-17 drop-shadow-sm sm:size-24" name="population" size={96} />

        <div className="min-w-0">
          <h1 className="text-[3.1rem] leading-[0.92] font-black tracking-[-0.07em] text-[#263d30] sm:text-7xl lg:text-[5.5rem]">
            Ashfolk
          </h1>

          <p className="mt-2 max-w-72 text-sm leading-snug font-bold text-[#3f5041] sm:mt-3 sm:max-w-none sm:text-lg">
            Shape a floating island and guide its first tribes.
          </p>
        </div>
      </div>
    </header>
  );
}

export function StartScreen() {
  useEffect(() => {
    preloadGame().catch((error: unknown) => {
      console.warn("The game could not be loaded ahead", error);
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#faf7ed]">
      <div className="flex min-h-full flex-col">
        <TitleScene />

        <section aria-label="World selection" className="text-ink relative border-t border-[#c8c9b7] bg-[#faf7ed]">
          <div className={`${CONTENT_WIDTH} py-5 sm:py-7 lg:py-8`}>
            <WorldMenu />
          </div>
        </section>

        <footer className="border-t border-[#ded9ca] pb-[env(safe-area-inset-bottom)]">
          <div className={`${CONTENT_WIDTH} py-2`}>
            <ProjectLinks className="-mx-2 justify-start sm:gap-3" />
          </div>
        </footer>
      </div>
    </div>
  );
}
