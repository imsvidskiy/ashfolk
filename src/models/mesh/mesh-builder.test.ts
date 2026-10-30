import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { signedVolume } from "../testing/mesh-checks.ts";
import { MeshBuilder } from "./mesh-builder.ts";
import { box, cylinder } from "./shapes.ts";
import { MIRROR_X, segmentLength, segmentTransform, transformOf } from "./transforms.ts";

describe("mesh builder", () => {
  it("places shapes with their transform", () => {
    const builder = new MeshBuilder();

    builder.add(box(1, 1, 1), { transform: transformOf({ position: [10, 0, 0], scale: 2 }) });

    const mesh = builder.build();

    expect(mesh.bounds.minimum).toEqual([9, -1, -1]);
    expect(mesh.bounds.maximum).toEqual([11, 1, 1]);
  });

  it("aligns a segment between two points", () => {
    const start = [1, 2, 3] as const;
    const end = [4, 6, 3] as const;
    const builder = new MeshBuilder();

    builder.add(cylinder({ height: segmentLength(start, end), radiusBottom: 0.01, radiusTop: 0.01 }), {
      transform: segmentTransform(start, end),
    });

    const { bounds } = builder.build();

    expect(segmentLength(start, end)).toBe(5);
    expect(bounds.minimum[0]).toBeCloseTo(1, 1);
    expect(bounds.maximum[0]).toBeCloseTo(4, 1);
    expect(bounds.maximum[1]).toBeCloseTo(6, 1);
  });

  it("stamps constant and computed channel values", () => {
    const builder = new MeshBuilder({ slot: 3 });

    builder.add(cylinder({ height: 2, radiusBottom: 1, radiusTop: 1 }), {
      style: {
        part: 5,
        sway: (point) => {
          return point.position.y / 2;
        },
      },
    });

    const mesh = builder.build();

    expect(new Set(mesh.channels.slot)).toEqual(new Set([3]));
    expect(new Set(mesh.channels.part)).toEqual(new Set([5]));
    expect(new Set(mesh.channels.shade)).toEqual(new Set([1]));
    expect(Math.min(...mesh.channels.sway)).toBe(0);
    expect(Math.max(...mesh.channels.sway)).toBe(1);
  });

  it("keeps mirrored shapes facing outwards", () => {
    const builder = new MeshBuilder();

    builder.add(cylinder({ height: 1, radiusBottom: 0.5, radiusTop: 0.2 }), {
      transform: new Matrix4().multiplyMatrices(MIRROR_X, transformOf({ position: [1, 0, 0] })),
    });

    const mesh = builder.build();

    expect(signedVolume(mesh)).toBeGreaterThan(0);
    expect(mesh.bounds.maximum[0]).toBeLessThan(0);
  });

  it("copies whole meshes and overrides only the requested channels", () => {
    const source = new MeshBuilder({ part: 2, slot: 7 });

    source.add(box(1, 1, 1));

    const part = source.build();
    const builder = new MeshBuilder();

    builder.addMesh(part, { style: { part: 9 }, transform: transformOf({ position: [0, 5, 0] }) });

    const copy = builder.build();

    expect(new Set(copy.channels.slot)).toEqual(new Set([7]));
    expect(new Set(copy.channels.part)).toEqual(new Set([9]));
    expect(copy.bounds.minimum[1]).toBeCloseTo(4.5);
  });
});
