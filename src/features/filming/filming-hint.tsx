import { useEffect, useState } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { Island } from "../../design/island.tsx";
import { isTypingTarget } from "../../game/input/keyboard-controls.ts";
import { useFilming } from "./use-filming.ts";

const HINT_MILLISECONDS = 2500;

function isToggleKey(event: KeyboardEvent): boolean {
  if (event.code !== "KeyH" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  return !isTypingTarget(event.target);
}

function useInterfaceKey(): void {
  const engine = useEngine();

  useEffect(() => {
    if (engine === null) {
      return;
    }

    const { filming } = engine;

    function handleKeyDown(event: KeyboardEvent): void {
      if (isToggleKey(event)) {
        filming.set({ isInterfaceHidden: !filming.settings.isInterfaceHidden });
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [engine]);
}

function useIsHintShown(): boolean {
  const { isInterfaceHidden } = useFilming();
  const [isHintShown, setHintShown] = useState(false);

  useEffect(() => {
    setHintShown(isInterfaceHidden);

    if (!isInterfaceHidden) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHintShown(false);
    }, HINT_MILLISECONDS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isInterfaceHidden]);

  return isHintShown;
}

export function FilmingHint() {
  useInterfaceKey();

  const isHintShown = useIsHintShown();

  if (!isHintShown) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-20 flex justify-center" role="status">
      <Island className="px-4 py-2 text-sm">Interface hidden. Press H to show it.</Island>
    </div>
  );
}
