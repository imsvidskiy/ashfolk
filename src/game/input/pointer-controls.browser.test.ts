import { PerspectiveCamera, type Vector3 } from "three/webgpu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodCamera } from "../camera/god-camera.ts";
import { GroundPicker } from "./ground-picker.ts";
import { PointerControls, type TapHandler, type ToolGestures } from "./pointer-controls.ts";

const WORLD_HALF_SIZE = 4000;
const CANVAS_WIDTH = 390;
const CANVAS_HEIGHT = 844;
const HOLD_MILLISECONDS = 400;

type ToolSpy = ReturnType<typeof createTool>;

interface Rig {
  readonly camera: GodCamera;
  readonly canvas: HTMLCanvasElement;
  readonly controls: PointerControls;
  readonly tool: ToolSpy;
}

const rigs: Rig[] = [];

function settle(camera: GodCamera): void {
  for (let step = 0; step < 60; step += 1) {
    camera.update(0.1);
  }
}

function isAlwaysTrue(): boolean {
  return true;
}

function isNeverTrue(): boolean {
  return false;
}

function createTool(canBegin: () => boolean, isActive: () => boolean) {
  return {
    begin: vi.fn<ToolGestures["begin"]>(),
    canBegin,
    cancel: vi.fn<ToolGestures["cancel"]>(),
    canHoldThroughPinch: true,
    end: vi.fn<ToolGestures["end"]>(),
    hover: vi.fn<ToolGestures["hover"]>(),
    isActive,
    move: vi.fn<ToolGestures["move"]>(),
    tap: vi.fn<TapHandler["tap"]>(),
  };
}

function createRig(
  canBegin: () => boolean = isAlwaysTrue,
  leading: ToolSpy | null = null,
  isActive: () => boolean = isAlwaysTrue
): Rig {
  const canvas = document.createElement("canvas");

  canvas.style.cssText = `position: fixed; left: 0; top: 0; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px`;
  canvas.setPointerCapture = vi.fn();
  document.body.append(canvas);

  const perspective = new PerspectiveCamera(45, CANVAS_WIDTH / CANVAS_HEIGHT, 1, 40_000);
  const camera = new GodCamera(
    perspective,
    () => {
      return 0;
    },
    WORLD_HALF_SIZE
  );

  camera.jumpTo({ distance: 600, targetX: 0, targetZ: 0 });
  settle(camera);

  const tool = createTool(canBegin, isActive);
  const tools = leading === null ? [tool] : [leading, tool];
  const picker = new GroundPicker(
    perspective,
    () => {
      return 0;
    },
    WORLD_HALF_SIZE
  );
  const rig = { camera, canvas, controls: new PointerControls(canvas, camera, picker, tools, tool), tool };

  rigs.push(rig);

  return rig;
}

function touch(rig: Rig, type: string, pointerId: number, x: number, y: number): void {
  rig.canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      isPrimary: pointerId === 1,
      pointerId,
      pointerType: "touch",
    })
  );
}

function mouse(rig: Rig, type: string, x: number, y: number): void {
  rig.canvas.dispatchEvent(
    new PointerEvent(type, { button: 0, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" })
  );
}

function wheel(rig: Rig, deltaY: number): void {
  rig.canvas.dispatchEvent(new WheelEvent("wheel", { cancelable: true, clientX: 195, clientY: 420, deltaY }));
}

function runFrames(rig: Rig): void {
  for (let step = 0; step < 30; step += 1) {
    rig.camera.update(0.05);
    rig.controls.update();
  }
}

function lastMovedPoint(tool: ToolSpy): Vector3 {
  const call = tool.move.mock.lastCall;

  if (call === undefined) {
    throw new Error("The tool should have moved");
  }

  return call[0];
}

function wait(milliseconds: number): void {
  vi.advanceTimersByTime(milliseconds);
}

describe("pointer controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const rig of rigs.splice(0)) {
      rig.controls.dispose();
      rig.canvas.remove();
    }
  });

  it("zooms with a pinch and never uses the power while a tool is selected", () => {
    const rig = createRig();

    const before = rig.camera.state.distance;

    touch(rig, "pointerdown", 1, 150, 420);
    touch(rig, "pointerdown", 2, 240, 420);

    for (let step = 1; step <= 10; step += 1) {
      touch(rig, "pointermove", 1, 150 + step * 4, 420);
      touch(rig, "pointermove", 2, 240 - step * 4, 420);
    }

    touch(rig, "pointerup", 1, 190, 420);
    touch(rig, "pointerup", 2, 200, 420);
    settle(rig.camera);

    expect(rig.tool.begin).not.toHaveBeenCalled();
    expect(rig.tool.move).not.toHaveBeenCalled();
    expect(rig.tool.tap).not.toHaveBeenCalled();
    expect(rig.camera.state.distance).toBeGreaterThan(before);
  });

  it("ignores a pinch whose second finger lands after a short pause", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 150, 420);
    wait(60);
    touch(rig, "pointerdown", 2, 240, 420);
    touch(rig, "pointermove", 1, 170, 420);
    touch(rig, "pointermove", 2, 220, 420);
    touch(rig, "pointerup", 1, 170, 420);
    wait(HOLD_MILLISECONDS);
    touch(rig, "pointerup", 2, 220, 420);

    expect(rig.tool.begin).not.toHaveBeenCalled();
  });

  it("uses the power once on a single tap", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 195, 420);
    touch(rig, "pointerup", 1, 195, 420);

    expect(rig.tool.begin).toHaveBeenCalledTimes(1);
    expect(rig.tool.end).toHaveBeenCalledTimes(1);
    expect(rig.tool.tap).not.toHaveBeenCalled();
  });

  it("starts a stroke once one finger has stayed down alone", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 195, 420);

    expect(rig.tool.begin).not.toHaveBeenCalled();

    wait(HOLD_MILLISECONDS);

    expect(rig.tool.begin).toHaveBeenCalledTimes(1);

    touch(rig, "pointermove", 1, 215, 430);

    expect(rig.tool.move).toHaveBeenCalled();

    touch(rig, "pointerup", 1, 215, 430);

    expect(rig.tool.end).toHaveBeenCalledTimes(1);
  });

  it("drops a waiting touch that the browser cancels", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 195, 420);
    touch(rig, "pointercancel", 1, 195, 420);
    wait(HOLD_MILLISECONDS);

    expect(rig.tool.begin).not.toHaveBeenCalled();
  });

  it("starts at once with a mouse", () => {
    const rig = createRig();

    mouse(rig, "pointerdown", 195, 420);

    expect(rig.tool.begin).toHaveBeenCalledTimes(1);
  });

  it("sends a gesture only to the first active tool", () => {
    const inactive = createTool(isAlwaysTrue, isNeverTrue);
    const rig = createRig(isAlwaysTrue, inactive);

    mouse(rig, "pointerdown", 195, 420);
    mouse(rig, "pointermove", 205, 420);
    mouse(rig, "pointerup", 205, 420);

    expect(rig.tool.begin).toHaveBeenCalledTimes(1);
    expect(rig.tool.move).toHaveBeenCalled();
    expect(rig.tool.end).toHaveBeenCalledTimes(1);
    expect(
      [inactive.begin, inactive.move, inactive.end].map((spy) => {
        return spy.mock.calls.length;
      })
    ).toEqual([0, 0, 0]);
  });

  it("leaves a later tool alone while an earlier one is active", () => {
    const leading = createTool(isAlwaysTrue, isAlwaysTrue);
    const rig = createRig(isAlwaysTrue, leading);

    mouse(rig, "pointerdown", 195, 420);
    mouse(rig, "pointermove", 205, 420);
    mouse(rig, "pointerup", 205, 420);

    expect(leading.begin).toHaveBeenCalledTimes(1);
    expect(leading.end).toHaveBeenCalledTimes(1);
    expect(
      [rig.tool.begin, rig.tool.move, rig.tool.end].map((spy) => {
        return spy.mock.calls.length;
      })
    ).toEqual([0, 0, 0]);
  });

  it("pans when the tool has nothing to take under the pointer", () => {
    const rig = createRig(isNeverTrue);

    const before = rig.camera.state.targetX;

    mouse(rig, "pointerdown", 195, 420);

    for (let step = 1; step <= 10; step += 1) {
      mouse(rig, "pointermove", 195 + step * 10, 420);
    }

    mouse(rig, "pointerup", 295, 420);
    settle(rig.camera);

    expect(rig.tool.begin).not.toHaveBeenCalled();
    expect(rig.tool.move).not.toHaveBeenCalled();
    expect(rig.camera.state.targetX).not.toBeCloseTo(before);
  });

  it("cancels the tool rather than finishing it when the browser takes the pointer away", () => {
    const rig = createRig();

    mouse(rig, "pointerdown", 195, 420);
    mouse(rig, "pointermove", 205, 420);
    mouse(rig, "pointercancel", 205, 420);

    expect(rig.tool.cancel).toHaveBeenCalledTimes(1);
    expect(rig.tool.end).not.toHaveBeenCalled();
  });

  it("keeps carrying through a pinch and zooms the camera with it", () => {
    const rig = createRig();

    const before = rig.camera.state;

    touch(rig, "pointerdown", 1, 195, 420);
    wait(HOLD_MILLISECONDS);
    touch(rig, "pointerdown", 2, 260, 520);

    for (let step = 1; step <= 10; step += 1) {
      touch(rig, "pointermove", 2, 260 + step * 8, 520 + step * 8);
    }

    runFrames(rig);
    touch(rig, "pointerup", 2, 340, 600);
    touch(rig, "pointermove", 1, 215, 430);
    touch(rig, "pointerup", 1, 215, 430);

    expect(rig.tool.begin).toHaveBeenCalledTimes(1);
    expect(rig.tool.cancel).not.toHaveBeenCalled();
    expect(rig.tool.end).toHaveBeenCalledTimes(1);
    expect(rig.camera.state.distance).toBeLessThan(before.distance);
    expect(rig.camera.state.yaw).toBeCloseTo(before.yaw);
  });

  it("cancels a tool that cannot hold through a pinch", () => {
    const brush = { ...createTool(isAlwaysTrue, isAlwaysTrue), canHoldThroughPinch: false };
    const rig = createRig(isAlwaysTrue, brush);

    touch(rig, "pointerdown", 1, 195, 420);
    wait(HOLD_MILLISECONDS);
    touch(rig, "pointerdown", 2, 260, 520);

    expect(brush.begin).toHaveBeenCalledTimes(1);
    expect(brush.cancel).toHaveBeenCalledTimes(1);
  });

  it("drops what it carries when the holding finger lifts during a pinch", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 195, 420);
    wait(HOLD_MILLISECONDS);
    touch(rig, "pointerdown", 2, 260, 520);
    touch(rig, "pointerup", 1, 195, 420);
    touch(rig, "pointermove", 2, 280, 520);
    touch(rig, "pointerup", 2, 280, 520);

    expect(rig.tool.end).toHaveBeenCalledTimes(1);
    expect(rig.tool.tap).not.toHaveBeenCalled();
  });

  it("returns what it carries when the browser cancels the holding finger during a pinch", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 195, 420);
    wait(HOLD_MILLISECONDS);
    touch(rig, "pointerdown", 2, 260, 520);
    touch(rig, "pointercancel", 1, 195, 420);
    touch(rig, "pointerup", 2, 260, 520);

    expect(rig.tool.cancel).toHaveBeenCalledTimes(1);
    expect(rig.tool.end).not.toHaveBeenCalled();
  });

  it("keeps the holding finger in charge when a third finger comes and goes during a pinch", () => {
    const rig = createRig();

    touch(rig, "pointerdown", 1, 195, 420);
    wait(HOLD_MILLISECONDS);
    touch(rig, "pointerdown", 2, 260, 520);
    touch(rig, "pointerdown", 3, 120, 600);
    touch(rig, "pointerup", 3, 120, 600);

    const moves = rig.tool.move.mock.calls.length;

    touch(rig, "pointermove", 2, 300, 560);
    touch(rig, "pointerup", 2, 300, 560);

    expect(rig.tool.move).toHaveBeenCalledTimes(moves);
    expect(rig.tool.end).not.toHaveBeenCalled();

    touch(rig, "pointerup", 1, 195, 420);

    expect(rig.tool.end).toHaveBeenCalledTimes(1);
  });

  it("carries to the ground under the still pointer as the camera zooms", () => {
    const rig = createRig();

    mouse(rig, "pointerdown", 100, 300);
    mouse(rig, "pointermove", 110, 300);

    const beforeZoom = lastMovedPoint(rig.tool);

    wheel(rig, 600);
    runFrames(rig);

    const afterZoom = lastMovedPoint(rig.tool);

    mouse(rig, "pointerup", 110, 300);

    expect(afterZoom.distanceTo(beforeZoom)).toBeGreaterThan(1);
    expect(rig.tool.cancel).not.toHaveBeenCalled();
    expect(rig.tool.end).toHaveBeenCalledTimes(1);
  });

  it("moves a still carry once, again on a new frame, and again when grabbed afresh at the same pixel", () => {
    const rig = createRig();

    mouse(rig, "pointerdown", 100, 300);
    rig.tool.move.mockClear();
    rig.controls.update();
    rig.controls.update();
    rig.controls.update();

    expect(rig.tool.move).toHaveBeenCalledTimes(1);

    rig.controls.rehover();
    rig.controls.update();

    expect(rig.tool.move).toHaveBeenCalledTimes(2);

    mouse(rig, "pointerup", 100, 300);
    mouse(rig, "pointerdown", 100, 300);
    rig.controls.update();

    expect(rig.tool.move).toHaveBeenCalledTimes(3);

    mouse(rig, "pointerup", 100, 300);
  });

  it("leaves taps to the tool while one is selected", () => {
    const rig = createRig(isNeverTrue);

    mouse(rig, "pointerdown", 195, 420);
    mouse(rig, "pointerup", 195, 420);

    expect(rig.tool.tap).not.toHaveBeenCalled();
  });

  it("taps to select when no tool is selected", () => {
    const rig = createRig(isNeverTrue, null, isNeverTrue);

    mouse(rig, "pointerdown", 195, 420);
    mouse(rig, "pointerup", 195, 420);

    expect(rig.tool.tap).toHaveBeenCalledTimes(1);
  });

  it("hovers once a frame with the screen point, and again when the camera moves", () => {
    const rig = createRig();

    mouse(rig, "pointermove", 120, 200);

    expect(rig.tool.hover).not.toHaveBeenCalled();

    rig.controls.update();
    rig.controls.update();

    expect(rig.tool.hover).toHaveBeenCalledTimes(1);
    expect(rig.tool.hover.mock.lastCall?.[1]).toEqual({ x: 120, y: 200 });

    rig.controls.rehover();
    rig.controls.update();

    expect(rig.tool.hover).toHaveBeenCalledTimes(2);

    wheel(rig, 400);
    runFrames(rig);

    expect(rig.tool.hover.mock.calls.length).toBeGreaterThan(2);

    mouse(rig, "pointerleave", 120, 200);

    expect(rig.tool.hover).toHaveBeenLastCalledWith(null, null);
  });
});
