import type { EngineHandle } from "../../game/engine-handle.ts";
import type { PowerSelection } from "../../game/tools/power-tool.ts";
import { type PowerStore, parametersOf, usePowerStore } from "./power-store.ts";

const SECONDARY_BUTTON = 2;

const CLICK_SLOP = 5;

function selectionOf(state: PowerStore): PowerSelection | null {
  const { selectedPowerId } = state;

  if (selectedPowerId === null) {
    return null;
  }

  return { parameters: parametersOf(state.parameters, selectedPowerId), powerId: selectedPowerId };
}

function clearOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    usePowerStore.getState().selectPower(null);
  }
}

function clearOnRightClick(): () => void {
  let pressedAt: { readonly x: number; readonly y: number } | null = null;

  function handlePointerDown(event: PointerEvent): void {
    const isOnWorld = event.button === SECONDARY_BUTTON && event.target instanceof HTMLCanvasElement;

    pressedAt = isOnWorld ? { x: event.clientX, y: event.clientY } : null;
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.button !== SECONDARY_BUTTON || pressedAt === null) {
      return;
    }

    const travel = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);

    pressedAt = null;

    if (travel < CLICK_SLOP) {
      usePowerStore.getState().selectPower(null);
    }
  }

  window.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("pointerup", handlePointerUp);

  return () => {
    window.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("pointerup", handlePointerUp);
  };
}

export function connectPowers(engine: Pick<EngineHandle, "selectHand" | "selectPower">): () => void {
  function apply(state: PowerStore): void {
    engine.selectPower(selectionOf(state));
    engine.selectHand(state.isHandSelected);
  }

  apply(usePowerStore.getState());

  const unsubscribe = usePowerStore.subscribe(apply);

  const stopRightClick = clearOnRightClick();

  window.addEventListener("keydown", clearOnEscape);

  return () => {
    unsubscribe();
    stopRightClick();
    window.removeEventListener("keydown", clearOnEscape);
  };
}
