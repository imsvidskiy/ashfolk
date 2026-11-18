import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IconButton } from "../design/buttons.tsx";
import { GameIcon } from "../design/game-icon.tsx";
import { Island } from "../design/island.tsx";
import { WithTooltip } from "../design/tooltip.tsx";
import { useShouldReduceMotion } from "../design/use-media-query.ts";
import { ProjectLinks } from "../features/project/project-links.tsx";
import { preloadGame } from "./engine-launcher.ts";
import { StartBackdrop } from "./start-backdrop.tsx";
import { WorldMenu } from "./world-menu.tsx";

function useFilmPlayback() {
  const shouldReduceMotion = useShouldReduceMotion();
  const [playback, setPlayback] = useState<boolean | null>(null);
  const isPlaying = playback === null ? !shouldReduceMotion : playback;

  const handleBlocked = useCallback(() => {
    setPlayback(false);
  }, []);

  function handleToggle(): void {
    setPlayback(!isPlaying);
  }

  return { handleBlocked, handleToggle, isPlaying, shouldShowPoster: shouldReduceMotion && playback === null };
}

export function StartScreen() {
  const { handleBlocked, handleToggle, isPlaying, shouldShowPoster } = useFilmPlayback();
  const filmLabel = isPlaying ? "Pause island film" : "Play island film";

  useEffect(() => {
    preloadGame().catch((error: unknown) => {
      console.warn("The game could not be loaded ahead", error);
    });
  }, []);

  return (
    <div className="bg-canvas absolute inset-0 isolate">
      <StartBackdrop isPlaying={isPlaying} onBlocked={handleBlocked} shouldShowPoster={shouldShowPoster} />

      <div className="absolute inset-0 overflow-y-auto">
        <div className="p-safe flex min-h-full flex-col items-center justify-center">
          <div className="flex w-full max-w-96 flex-col items-center gap-2.5 py-2">
            <Island className="w-full px-5 sm:px-6">
              <header className="border-line flex items-center gap-3 border-b py-4 sm:py-5">
                <GameIcon className="size-13 shrink-0 sm:size-15" name="population" size={60} />

                <div>
                  <h1 className="text-ink text-3xl leading-none font-extrabold tracking-tight">Ashfolk</h1>

                  <p className="text-ink-soft mt-1 text-sm leading-snug">
                    Shape a floating island and guide its first tribes.
                  </p>
                </div>
              </header>

              <section aria-label="World selection" className="py-4 sm:py-5">
                <WorldMenu />
              </section>
            </Island>

            <footer className="flex max-w-full items-center justify-center gap-2">
              <Island className="min-w-0 px-1 py-0.5">
                <ProjectLinks className="gap-0 max-sm:[&_a]:px-2 max-[23rem]:[&_a]:px-1 max-sm:[&_a>span]:hidden" />
              </Island>

              <Island className="shrink-0 p-0.5">
                <WithTooltip content={filmLabel} side="top">
                  <IconButton
                    className="size-9 pointer-coarse:size-10"
                    icon={isPlaying ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}
                    label={filmLabel}
                    onClick={handleToggle}
                  />
                </WithTooltip>
              </Island>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
