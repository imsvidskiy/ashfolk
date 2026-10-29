import { describe, expect, it, onTestFinished, vi } from "vitest";
import { defaultPowerParameters } from "../../content/powers.ts";
import type { PowerSelection } from "../../game/tools/power-tool.ts";
import { connectPowers } from "./connect-powers.ts";
import { usePowerStore } from "./power-store.ts";

function addCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  onTestFinished(() => {
    canvas.remove();
  });

  return canvas;
}

function connectSpy() {
  const canvas = addCanvas();
  const selectHand = vi.fn<(isSelected: boolean) => void>();
  const selectPower = vi.fn<(selection: PowerSelection | null) => void>();

  const disconnect = connectPowers({ canvas, selectHand, selectPower });

  onTestFinished(disconnect);

  return { canvas, disconnect, selectHand, selectPower };
}

function clickWithRightButton(target: EventTarget, travel = 0): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, clientX: 100, clientY: 100 }));
  target.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, button: 2, clientX: 100 + travel, clientY: 100 })
  );
}

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

describe("connecting powers to the engine", () => {
  it("hands the current choice to the engine at once", () => {
    usePowerStore.getState().selectPower("rain");

    const { selectPower } = connectSpy();

    expect(selectPower).toHaveBeenCalledExactlyOnceWith({
      parameters: defaultPowerParameters("rain"),
      powerId: "rain",
    });
  });

  it("hands every new choice with its parameters to the engine", () => {
    const { selectPower } = connectSpy();

    usePowerStore.getState().selectPower("fire");
    usePowerStore.getState().setParameter("fire", "intensity", 80);

    expect(selectPower).toHaveBeenLastCalledWith({
      parameters: { ...defaultPowerParameters("fire"), intensity: 80 },
      powerId: "fire",
    });
  });

  it("tells the engine when no power is chosen", () => {
    const { selectPower } = connectSpy();

    usePowerStore.getState().selectPower("fire");
    usePowerStore.getState().selectPower(null);

    expect(selectPower).toHaveBeenLastCalledWith(null);
  });

  it("puts the power away when Escape is pressed", () => {
    connectSpy();

    usePowerStore.getState().selectPower("lightning");
    pressEscape();

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("stops listening after disconnecting", () => {
    const { canvas, disconnect, selectPower } = connectSpy();

    disconnect();
    usePowerStore.getState().selectPower("fire");
    pressEscape();
    clickWithRightButton(canvas);

    expect(selectPower).toHaveBeenCalledOnce();
    expect(usePowerStore.getState().selectedPowerId).toBe("fire");
  });

  it("hands the hand to the engine and takes the power away", () => {
    const { selectHand, selectPower } = connectSpy();

    usePowerStore.getState().selectPower("fire");
    usePowerStore.getState().selectHand();

    expect(selectHand).toHaveBeenLastCalledWith(true);
    expect(selectPower).toHaveBeenLastCalledWith(null);

    usePowerStore.getState().selectPower("rain");

    expect(selectHand).toHaveBeenLastCalledWith(false);
  });

  it("puts the hand away when Escape is pressed", () => {
    const { selectHand } = connectSpy();

    usePowerStore.getState().selectHand();
    pressEscape();

    expect(usePowerStore.getState().isHandSelected).toBe(false);
    expect(selectHand).toHaveBeenLastCalledWith(false);
  });

  it("puts the power away on a right click over the world", () => {
    const { canvas } = connectSpy();

    usePowerStore.getState().selectPower("rain");
    clickWithRightButton(canvas);

    expect(usePowerStore.getState().selectedPowerId).toBeNull();
  });

  it("puts the hand away on a right click over the world", () => {
    const { canvas } = connectSpy();

    usePowerStore.getState().selectHand();
    clickWithRightButton(canvas);

    expect(usePowerStore.getState().isHandSelected).toBe(false);
  });

  it("keeps the power when the right button drags the view or clicks the interface", () => {
    const { canvas } = connectSpy();

    usePowerStore.getState().selectPower("rain");
    clickWithRightButton(canvas, 40);
    clickWithRightButton(document.body);
    clickWithRightButton(addCanvas());

    expect(usePowerStore.getState().selectedPowerId).toBe("rain");
  });
});
