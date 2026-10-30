import { describe, expect, it } from "vitest";
import type { LavaView } from "../../simulation/frame.ts";
import { LavaField } from "./lava-field.ts";

const CELLS_PER_SIDE = 16;
const FIRST = 20;
const SECOND = 21;

function lava(cells: readonly number[], heat: readonly number[]): LavaView {
  return { cells: Int32Array.from(cells), heat: Uint8Array.from(heat) };
}

function heatAt(field: LavaField, cell: number): number {
  const { data } = field.texture.image;

  if (!(data instanceof Uint8Array)) {
    throw new Error("The lava texture should hold bytes");
  }

  return data[cell];
}

describe("lava field", () => {
  it("writes the heat of each lava cell", () => {
    const field = new LavaField(CELLS_PER_SIDE);

    const { version } = field.texture;

    field.update(lava([FIRST, SECOND], [255, 90]));

    expect(heatAt(field, FIRST)).toBe(255);
    expect(heatAt(field, SECOND)).toBe(90);
    expect(field.texture.version).not.toBe(version);
  });

  it("clears cells that cooled or left the flow", () => {
    const field = new LavaField(CELLS_PER_SIDE);

    field.update(lava([FIRST, SECOND], [255, 255]));

    const { version } = field.texture;

    field.update(lava([SECOND], [120]));

    expect(heatAt(field, FIRST)).toBe(0);
    expect(heatAt(field, SECOND)).toBe(120);
    expect(field.texture.version).not.toBe(version);

    field.update(lava([], []));

    expect(heatAt(field, SECOND)).toBe(0);
  });

  it("leaves the texture alone when no lava changed", () => {
    const field = new LavaField(CELLS_PER_SIDE);

    field.update(lava([FIRST], [200]));

    const { version } = field.texture;

    field.update(null);

    expect(field.texture.version).toBe(version);
    expect(heatAt(field, FIRST)).toBe(200);

    field.update(lava([], []));

    const cleared = field.texture.version;

    field.update(lava([], []));

    expect(cleared).not.toBe(version);
    expect(field.texture.version).toBe(cleared);
  });

  it("uploads a lava view once while frames repeat it", () => {
    const field = new LavaField(CELLS_PER_SIDE);
    const flow = lava([FIRST], [200]);

    field.update(flow);

    const { version } = field.texture;

    field.update(flow);

    expect(field.texture.version).toBe(version);
  });
});
