import { Vector3 } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { defaultPowerParameters } from "../../content/powers.ts";
import type { SimulationCommand } from "../../simulation/commands.ts";
import { PowerTool } from "./power-tool.ts";

function createPowerTool(): PowerTool {
  const cursor = { hide: vi.fn<() => void>(), show: vi.fn<() => void>() };

  return new PowerTool(vi.fn<(command: SimulationCommand) => void>(), cursor);
}

describe("power tool", () => {
  it("begins only on the ground while a power is selected", () => {
    const tool = createPowerTool();

    expect(tool.canBegin(new Vector3(10, 0, 20))).toBe(false);

    tool.select({ parameters: defaultPowerParameters("flatten"), powerId: "flatten" });

    expect(tool.canBegin(null)).toBe(false);
    expect(tool.canBegin(new Vector3(10, 0, 20))).toBe(true);
  });
});
