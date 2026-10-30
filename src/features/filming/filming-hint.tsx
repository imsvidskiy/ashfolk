import { useEffect, useState } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { TextButton } from "../../design/buttons.tsx";
import { Island } from "../../design/island.tsx";
import { useIsTouch } from "../../design/use-media-query.ts";
import type { Filming } from "../../game/filming.ts";
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
  const [isHintShown, setIsHintShown] = useState(false);

  useEffect(() => {
    if (!isInterfaceHidden) {
      setIsHintShown(false);

      return;
    }

    let timer = 0;

    function showHint(): void {
      setIsHintShown(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIsHintShown(false);
      }, HINT_MILLISECONDS);
    }

    function handlePointerDown(event: PointerEvent): void {
      if (event.pointerType === "touch") {
        showHint();
      }
    }

    showHint();
    window.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isInterfaceHidden]);

  return isHintShown;
}

function useShowInterface(filming: Filming) {
  return () => {
    filming.set({ isInterfaceHidden: false });
  };
}

function HintContent({ filming }: { readonly filming: Filming }) {
  const isTouch = useIsTouch();
  const handleShow = useShowInterface(filming);

  return (
    <Island className="pointer-events-auto flex items-center gap-2 py-1.5 pr-1.5 pl-4 text-sm">
      <span>{isTouch ? "Interface hidden." : "Interface hidden. Press H to show it."}</span>

      <TextButton className="h-8 px-3" onClick={handleShow} tone="quiet">
        Show
      </TextButton>
    </Island>
  );
}

export function FilmingHint() {
  useInterfaceKey();

  const engine = useEngine();
  const isHintShown = useIsHintShown();

  if (engine === null || !isHintShown) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-20 flex justify-center" role="status">
      <HintContent filming={engine.filming} />
    </div>
  );
}
