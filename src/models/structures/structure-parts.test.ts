import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { SurfacePoint } from "../mesh/mesh-builder.ts";
import { rising, upwardShade } from "./structure-parts.ts";

function pointAt(height: number): SurfacePoint {
  return { along: 0, around: 0, normal: new Vector3(0, 1, 0), position: new Vector3(0, height, 0) };
}

describe("structure parts", () => {
  it("rises from one value to another between two heights", () => {
    const order = rising(0.4, 0.7, 1.1, 2.2);

    expect(order(pointAt(1.1))).toBeCloseTo(0.4);
    expect(order(pointAt(1.65))).toBeCloseTo(0.55);
    expect(order(pointAt(2.2))).toBeCloseTo(0.7);
    expect(order(pointAt(0))).toBeCloseTo(0.4);
    expect(order(pointAt(3))).toBeCloseTo(0.7);
  });

  it("shades from the darkest value at the bottom to full light at the top", () => {
    const shade = upwardShade(0.6, 0.5, 2.5);

    expect(shade(pointAt(0.5))).toBeCloseTo(0.6);
    expect(shade(pointAt(1.5))).toBeCloseTo(0.8);
    expect(shade(pointAt(2.5))).toBeCloseTo(1);
    expect(shade(pointAt(0))).toBeCloseTo(0.6);
    expect(shade(pointAt(4))).toBeCloseTo(1);
  });
});
