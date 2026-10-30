import { Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CAMERA_FADE_REACH, columnVisibility, extentOf } from "./camera-fade.ts";

const TREE = { height: 12, radius: 4 };
const BASE = new Vector3(10, 100, -5);
const RIM = BASE.x + TREE.radius;
const TOP = BASE.y + TREE.height;

function visibilityFrom(x: number, y: number, z: number): number {
  return columnVisibility(new Vector3(x, y, z), BASE, TREE);
}

describe("camera fade", () => {
  it("measures how tall and wide a model stands around its origin", () => {
    const extent = extentOf(new Float32Array([3, 0, 4, -1, 7, 0, 0, 2, -2]));

    expect(extent.height).toBe(7);
    expect(extent.radius).toBe(5);
  });

  it("hides an object while the camera is inside it, under its crown or just beside it", () => {
    expect(visibilityFrom(10, 106, -5)).toBe(0);
    expect(visibilityFrom(12, 101.5, -5)).toBe(0);
    expect(visibilityFrom(RIM + 0.1, 105, -5)).toBe(0);
  });

  it("fades the object back in over a few meters", () => {
    const halfway = visibilityFrom(RIM + CAMERA_FADE_REACH / 2, 105, -5);

    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(1);
    expect(visibilityFrom(RIM + CAMERA_FADE_REACH + 0.1, 105, -5)).toBe(1);
  });

  it("keeps the object whole when the camera is high above it", () => {
    expect(visibilityFrom(10, TOP + CAMERA_FADE_REACH + 0.1, -5)).toBe(1);
    expect(visibilityFrom(10, 300, -5)).toBe(1);
  });

  it("measures the distance from the crown's rim diagonally", () => {
    const offset = (CAMERA_FADE_REACH + 0.1) / Math.SQRT2;

    expect(visibilityFrom(RIM + offset, TOP + offset, -5)).toBe(1);
  });
});
