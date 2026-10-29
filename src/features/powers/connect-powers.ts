import type { EngineHandle } from "../../game/engine-handle.ts";
import { TAP_TOLERANCE } from "../../game/input/pointer-controls.ts";
import type { PowerSelection } from "../../game/tools/power-tool.ts";
import { type PowerStore, parametersOf, usePowerStore } from "./power-store.ts";

const SECONDARY_BUTTON = 2;

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

function clearOnRightClick(world: HTMLCanvasElement): () => void {
  let pressedAt: { readonly x: number; readonly y: number } | null = null;

  function handlePointerDown(event: PointerEvent): void {
    pressedAt = event.button === SECONDARY_BUTTON ? { x: event.clientX, y: event.clientY } : null;
  }

  function handlePointerUp(event: PointerEvent): void {
    if (event.button !== SECONDARY_BUTTON || pressedAt === null) {
      return;
    }

    const travel = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);

    pressedAt = null;

    if (travel < TAP_TOLERANCE) {
      usePowerStore.getState().selectPower(null);
    }
  }

  world.addEventListener("pointerdown", handlePointerDown);
  world.addEventListener("pointerup", handlePointerUp);

  return () => {
    world.removeEventListener("pointerdown", handlePointerDown);
    world.removeEventListener("pointerup", handlePointerUp);
  };
}

export function connectPowers(engine: Pick<EngineHandle, "canvas" | "selectHand" | "selectPower">): () => void {
  function apply(state: PowerStore): void {
    engine.selectPower(selectionOf(state));
    engine.selectHand(state.isHandSelected);
  }

  apply(usePowerStore.getState());

  const unsubscribe = usePowerStore.subscribe(apply);

  const stopRightClick = clearOnRightClick(engine.canvas);

  window.addEventListener("keydown", clearOnEscape);

  return () => {
    unsubscribe();
    stopRightClick();
    window.removeEventListener("keydown", clearOnEscape);
  };
}
