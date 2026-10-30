import { describe, expect, it } from "vitest";
import { shapeProblems, signedVolume } from "../testing/mesh-checks.ts";
import { type Shape, shapeVertexCount } from "./shape.ts";
import { ribbon, tube } from "./tubes.ts";

function ringCenter(shape: Shape, firstVertex: number, segments: number): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];

  for (let vertex = firstVertex; vertex < firstVertex + segments; vertex += 1) {
    center[0] += shape.positions[vertex * 3] / segments;
    center[1] += shape.positions[vertex * 3 + 1] / segments;
    center[2] += shape.positions[vertex * 3 + 2] / segments;
  }

  return center;
}

describe("tubes", () => {
  const path = [
    { radius: 0.4, x: 0, y: 0, z: 0 },
    { radius: 0.3, x: 0.2, y: 1, z: 0 },
    { radius: 0.2, x: 0.8, y: 1.8, z: 0.3 },
  ];

  it("closes both ends with caps", () => {
    const shape = tube(path, { radialSegments: 8 });

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeGreaterThan(0);
  });

  it("closes a tapering branch with a pointed tip", () => {
    const shape = tube([...path, { radius: 0, x: 1.2, y: 2.2, z: 0.4 }], { hasEndCap: false, radialSegments: 8 });

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeGreaterThan(0);
  });

  it("runs along the path from start to end", () => {
    const shape = tube(path, { hasEndCap: false, hasStartCap: false, radialSegments: 6 });

    const firstRing = ringCenter(shape, 0, 6);
    const lastRing = ringCenter(shape, 12, 6);

    expect(shape.along[0]).toBe(0);
    expect(shape.along.at(-1)).toBe(1);
    expect(Math.hypot(...firstRing)).toBeCloseTo(0, 5);
    expect(Math.hypot(lastRing[0] - 0.8, lastRing[1] - 1.8, lastRing[2] - 0.3)).toBeCloseTo(0, 5);
  });

  it("builds a ribbon that faces up on top and down underneath", () => {
    const shape = ribbon([
      { radius: 0.2, x: 0, y: 1, z: 0 },
      { radius: 0.3, x: 1, y: 1.2, z: 0 },
      { radius: 0, x: 2, y: 0.8, z: 0 },
    ]);

    const half = shapeVertexCount(shape) / 2;

    expect(shapeProblems(shape)).toEqual([]);
    expect(shape.normals[4]).toBeGreaterThan(0.5);
    expect(shape.normals[half * 3 + 4]).toBeLessThan(-0.5);
  });
});
