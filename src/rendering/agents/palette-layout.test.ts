import { describe, expect, it } from "vitest";
import { MaterialSlot } from "../../models/materials.ts";
import { colorIndexBySlot, colorTexel, paletteWidth, rootTexel, TEXELS_PER_BONE } from "./palette-layout.ts";

const LAYOUT = { boneCount: 4, colorSlots: [MaterialSlot.Skin, MaterialSlot.Hair] };

describe("palette layout", () => {
  it("gives every bone row, the root and each color a texel of its own and wastes none", () => {
    const boneTexels = Array.from({ length: LAYOUT.boneCount * TEXELS_PER_BONE }, (_, texel) => {
      return texel;
    });
    const colorTexels = LAYOUT.colorSlots.map((_slot, index) => {
      return colorTexel(LAYOUT, index);
    });
    const texels = [...boneTexels, rootTexel(LAYOUT), ...colorTexels];

    expect(new Set(texels).size).toBe(texels.length);
    expect(Math.min(...texels)).toBe(0);
    expect(Math.max(...texels)).toBe(paletteWidth(LAYOUT) - 1);
    expect(texels).toHaveLength(paletteWidth(LAYOUT));
  });

  it("maps each palette slot to its color and every other slot to none", () => {
    const indices = colorIndexBySlot(LAYOUT, 56);

    expect(indices[MaterialSlot.Skin]).toBe(0);
    expect(indices[MaterialSlot.Hair]).toBe(1);
    expect(
      indices.filter((index) => {
        return index >= 0;
      })
    ).toHaveLength(2);
    expect(indices).toHaveLength(56);
  });
});
