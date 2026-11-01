import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { signedVolume } from "../testing/mesh-checks.ts";
import { MeshBuilder } from "./mesh-builder.ts";
import { vertexCount } from "./mesh-data.ts";
import { facetShape } from "./shape.ts";
import { box, cylinder, icosphere } from "./shapes.ts";
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

  it("gives each face of a faceted shape one slot, read at its center", () => {
    const builder = new MeshBuilder();

    builder.add(facetShape(icosphere(1, 1)), {
      style: {
        slot: (point) => {
          return point.position.x > 0.3 ? 2 : 1;
        },
      },
      transform: transformOf({ position: [0.5, 0, 0] }),
    });

    const { channels, indices, positions } = builder.build();

    for (let corner = 0; corner < indices.length; corner += 3) {
      const face = [indices[corner], indices[corner + 1], indices[corner + 2]];
      const centerX = (positions[face[0] * 3] + positions[face[1] * 3] + positions[face[2] * 3]) / 3;

      for (const vertex of face) {
        expect(channels.slot[vertex]).toBe(centerX > 0.3 ? 2 : 1);
      }
    }
  });

  it("gives each face of a turned faceted shape the slot of its turned normal", () => {
    const builder = new MeshBuilder();

    builder.add(facetShape(icosphere(1, 1)), {
      style: {
        slot: (point) => {
          return point.normal.y > 0.6 ? 2 : 1;
        },
      },
      transform: transformOf({ rotation: [Math.PI / 2, 0, 0] }),
    });

    const { channels, indices, positions } = builder.build();
    const corners = [new Vector3(), new Vector3(), new Vector3()] as const;

    for (let corner = 0; corner < indices.length; corner += 3) {
      const face = [indices[corner], indices[corner + 1], indices[corner + 2]];

      for (const [index, vertex] of face.entries()) {
        corners[index].fromArray(positions, vertex * 3);
      }

      const normal = new Vector3()
        .subVectors(corners[1], corners[0])
        .cross(new Vector3().subVectors(corners[2], corners[0]))
        .normalize();

      for (const vertex of face) {
        expect(channels.slot[vertex]).toBe(normal.y > 0.6 ? 2 : 1);
      }
    }

    expect(channels.slot).toContain(2);
  });

  it("reads the slot at each vertex of a smooth shape", () => {
    const builder = new MeshBuilder();

    builder.add(icosphere(1, 1), {
      style: {
        slot: (point) => {
          return point.position.x > 0 ? 2 : 1;
        },
      },
    });

    const { channels, positions } = builder.build();

    for (let vertex = 0; vertex < channels.slot.length; vertex += 1) {
      expect(channels.slot[vertex]).toBe(positions[vertex * 3] > 0 ? 2 : 1);
    }
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

  it("copies each vertex's own channels after the shapes already placed", () => {
    const source = new MeshBuilder({
      sway: (point) => {
        return point.position.y;
      },
    });

    source.add(box(1, 1, 1), { style: { slot: 3 } });
    source.add(box(1, 1, 1), { style: { slot: 4 }, transform: transformOf({ position: [0, 2, 0] }) });

    const part = source.build();
    const builder = new MeshBuilder({ slot: 1 });

    builder.add(box(1, 1, 1));
    builder.addMesh(part, { transform: transformOf({ position: [0, 5, 0] }) });

    const copy = builder.build();
    const copied = vertexCount(part);
    const firstCopied = vertexCount(copy) - copied;

    expect(new Set(copy.channels.slot.subarray(0, firstCopied))).toEqual(new Set([1]));

    for (let vertex = 0; vertex < copied; vertex += 1) {
      const height = part.positions[vertex * 3 + 1];

      expect(copy.channels.slot[firstCopied + vertex]).toBe(height > 1 ? 4 : 3);
      expect(copy.channels.sway[firstCopied + vertex]).toBe(height);
    }
  });
});
