import { useEffect, useState } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { TextButton } from "../../design/buttons.tsx";
import { Island } from "../../design/island.tsx";
import { useIsTouch } from "../../design/use-media-query.ts";
import type { Filming } from "../../game/filming.ts";
import { isTypingTarget } from "../../game/input/keyboard-controls.ts";
import { TAP_TOLERANCE } from "../../game/input/pointer-controls.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { useFilming } from "./use-filming.ts";

const HINT_MILLISECONDS = 2500;

interface TouchTap {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

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

function usePutToolsDownOnTouch(): void {
  const { isInterfaceHidden } = useFilming();

  useEffect(() => {
    if (!isInterfaceHidden) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (event.pointerType !== "touch") {
        return;
      }

      const { isHandSelected, selectedPowerId, selectPower } = usePowerStore.getState();

      if (isHandSelected || selectedPowerId !== null) {
        selectPower(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [isInterfaceHidden]);
}

function useIsHintShown(): boolean {
  const { isInterfaceHidden } = useFilming();
  const isSettingsOpen = useInterfaceStore((state) => {
    return state.isSettingsOpen;
  });
  const [isHintShown, setIsHintShown] = useState(false);

  useEffect(() => {
    if (!isInterfaceHidden || isSettingsOpen) {
      setIsHintShown(false);

      return;
    }

    let timer = 0;
    let tap: TouchTap | null = null;

    function showHint(): void {
      setIsHintShown(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIsHintShown(false);
      }, HINT_MILLISECONDS);
    }

    function handlePointerDown(event: PointerEvent): void {
      if (event.pointerType !== "touch") {
        return;
      }

      tap = event.isPrimary ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
    }

    function handlePointerUp(event: PointerEvent): void {
      if (tap === null || event.pointerId !== tap.pointerId) {
        return;
      }

      const travel = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);

      tap = null;

      if (travel < TAP_TOLERANCE) {
        showHint();
      }
    }

    showHint();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isInterfaceHidden, isSettingsOpen]);

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
  usePutToolsDownOnTouch();

  const engine = useEngine();
  const isHintShown = useIsHintShown();

  if (engine === null || !isHintShown) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-20 flex justify-center"
      role="status"
    >
      <HintContent filming={engine.filming} />
    </div>
  );
}
