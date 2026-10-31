import { Vector3 } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import type { ParameterValueMap } from "../../content/parameters.ts";
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

function hoveredRadius(
  powerId: PowerId,
  parameters: ParameterValueMap = defaultPowerParameters(powerId)
): number | undefined {
  const { cursor, tool } = createPowerTool();

  tool.select({ parameters, powerId });
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
    const parameters = defaultPowerParameters("explosion");
    const { radius } = parameters;

    tool.begin(PRESSED);
    tool.move(DRAGGED);
    tool.end();

    expect(send.mock.calls.flat()).toEqual([{ parameters, powerId: "explosion", type: "usePower", x: 10, z: 20 }]);
    expect(cursor.show.mock.calls).toEqual([
      [PRESSED, radius, true],
      [DRAGGED, radius, false],
    ]);
  });

  it("sizes the cursor by the radius, the crater or the scatter, and marks powers without one", () => {
    const { radius } = defaultPowerParameters("fire");
    const { craterRadius } = defaultPowerParameters("meteor");
    const { scatter } = defaultPowerParameters("lightning");

    expect(hoveredRadius("fire")).toBe(radius);
    expect(hoveredRadius("meteor")).toBe(craterRadius);
    expect(hoveredRadius("lightning")).toBe(scatter);
    expect(hoveredRadius("deer")).toBe(12);
  });

  it("keeps the cursor at the marker size when the scatter is smaller", () => {
    expect(hoveredRadius("lightning", { ...defaultPowerParameters("lightning"), scatter: 5 })).toBe(12);
  });

  it("ends the stroke and hides the cursor when the power is put away", () => {
    const { cursor, send, tool } = createPowerTool("fire");

    tool.begin(PRESSED);
    tool.select(null);

    expect(send).toHaveBeenLastCalledWith({ type: "endStroke" });
    expect(cursor.hide).toHaveBeenCalledOnce();
    expect(tool.isActive()).toBe(false);
  });

  it("ends the stroke when the gesture is canceled", () => {
    const { send, tool } = createPowerTool("fire");

    tool.begin(PRESSED);
    tool.cancel();

    expect(send).toHaveBeenLastCalledWith({ type: "endStroke" });
  });

  it("hides the cursor once the pointer leaves the ground", () => {
    const { cursor, tool } = createPowerTool("fire");

    tool.hover(null);

    expect(cursor.hide).toHaveBeenCalledOnce();
    expect(cursor.show).not.toHaveBeenCalled();
  });
});
