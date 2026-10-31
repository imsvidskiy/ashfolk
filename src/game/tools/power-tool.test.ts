import { Vector3 } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { defaultPowerParameters, type PowerId } from "../../content/powers.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import { PowerTool } from "./power-tool.ts";

const PRESSED = new Vector3(10, 0, 20);
const DRAGGED = new Vector3(30, 0, -15);

function createPowerTool(powerId: PowerId | null = null) {
  const cursor = {
    hide: vi.fn<() => void>(),
    show: vi.fn<(point: Vector3, radius: number, isPressed: boolean) => void>(),
  };
  const send = vi.fn<(command: SimulationCommand) => void>();

  const tool = new PowerTool(send, cursor);

  if (powerId !== null) {
    tool.select({ parameters: defaultPowerParameters(powerId), powerId });
  }

  return { cursor, send, tool };
}

function hoveredRadius(powerId: PowerId): number | undefined {
  const { cursor, tool } = createPowerTool(powerId);

  tool.hover(PRESSED);

  return cursor.show.mock.lastCall?.[1];
}

describe("power tool", () => {
  it("begins only on the ground while a power is selected", () => {
    const { tool } = createPowerTool();

    expect(tool.canBegin(PRESSED)).toBe(false);

    tool.select({ parameters: defaultPowerParameters("flatten"), powerId: "flatten" });

    expect(tool.canBegin(null)).toBe(false);
    expect(tool.canBegin(PRESSED)).toBe(true);
  });

  it("strokes a brush power from the press to the release", () => {
    const { send, tool } = createPowerTool("fire");

    tool.begin(PRESSED);
    tool.move(DRAGGED);
    tool.end();
    tool.end();

    expect(send.mock.calls.flat()).toEqual([
      { parameters: defaultPowerParameters("fire"), powerId: "fire", type: "beginStroke", x: 10, z: 20 },
      { type: "moveStroke", x: 30, z: -15 },
      { type: "endStroke" },
    ]);
  });

  it("uses a point power once on the press and then only moves the cursor", () => {
    const { cursor, send, tool } = createPowerTool("explosion");

    tool.begin(PRESSED);
    tool.move(DRAGGED);
    tool.end();

    expect(send.mock.calls.flat()).toEqual([
      { parameters: defaultPowerParameters("explosion"), powerId: "explosion", type: "usePower", x: 10, z: 20 },
    ]);
    expect(cursor.show.mock.calls).toEqual([
      [PRESSED, 45, true],
      [DRAGGED, 45, false],
    ]);
  });

  it("sizes the cursor by the radius, the crater or the scatter, and marks powers without one", () => {
    expect(hoveredRadius("fire")).toBe(25);
    expect(hoveredRadius("meteor")).toBe(140);
    expect(hoveredRadius("lightning")).toBe(30);
    expect(hoveredRadius("deer")).toBe(12);
  });

  it("ends the stroke and hides the cursor when the power is put away", () => {
    const { cursor, send, tool } = createPowerTool("fire");

    tool.begin(PRESSED);
    tool.select(null);

    expect(send).toHaveBeenLastCalledWith({ type: "endStroke" });
    expect(cursor.hide).toHaveBeenCalledOnce();
    expect(tool.isActive()).toBe(false);
  });

  it("hides the cursor once the pointer leaves the ground", () => {
    const { cursor, tool } = createPowerTool("fire");

    tool.hover(null);

    expect(cursor.hide).toHaveBeenCalledOnce();
    expect(cursor.show).not.toHaveBeenCalled();
  });
});
