import { describe, expect, it } from "vitest";
import { MeshBuilder } from "./mesh-builder.ts";
import { type MeshData, vertexCount } from "./mesh-data.ts";
import { sphere } from "./shapes.ts";
import { transformOf } from "./transforms.ts";
import { tube } from "./tubes.ts";

const LIMB = [0, 0.9, 1.05, 1.3, 2].map((y) => {
  return { radius: 0.3, x: 0, y, z: 0 };
});

function seamOf(reach: number | null): { seam?: number } {
  return reach === null ? {} : { seam: reach };
}

function limbOnBody(bodySeam: number | null, limbSeam: number | null): MeshData {
  const builder = new MeshBuilder();

  builder.add(sphere(1, 24, 16), seamOf(bodySeam));
  builder.add(tube(LIMB, { radialSegments: 12 }), { ...seamOf(limbSeam), style: { part: 1 } });

  return builder.build();
}

function normalAngle(first: MeshData, second: MeshData, vertex: number): number {
  const offset = vertex * 3;

  const dot =
    first.normals[offset] * second.normals[offset] +
    first.normals[offset + 1] * second.normals[offset + 1] +
    first.normals[offset + 2] * second.normals[offset + 2];

  return Math.acos(Math.min(1, dot));
}

function verticesWhere(mesh: MeshData, test: (x: number, y: number, z: number, part: number) => boolean): number[] {
  return Array.from({ length: vertexCount(mesh) }, (_, vertex) => {
    return vertex;
  }).filter((vertex) => {
    return test(
      mesh.positions[vertex * 3],
      mesh.positions[vertex * 3 + 1],
      mesh.positions[vertex * 3 + 2],
      mesh.channels.part[vertex]
    );
  });
}

function verticalness(mesh: MeshData, vertices: readonly number[]): number {
  return (
    vertices.reduce((sum, vertex) => {
      return sum + Math.abs(mesh.normals[vertex * 3 + 1]);
    }, 0) / vertices.length
  );
}

describe("seam normals", () => {
  const plain = limbOnBody(null, null);
  const blended = limbOnBody(0.3, 0.3);

  it("turns both surfaces toward each other where a limb leaves a body", () => {
    const limbAtSeam = verticesWhere(plain, (_x, y, _z, part) => {
      return part === 1 && Math.abs(y - 1.05) < 1e-4;
    });
    const bodyAtSeam = verticesWhere(plain, (x, y, z, part) => {
      return part === 0 && y > 0.9 && Math.hypot(x, z) > 0.3;
    });

    expect(limbAtSeam.length).toBeGreaterThan(0);
    expect(bodyAtSeam.length).toBeGreaterThan(0);
    expect(verticalness(blended, limbAtSeam)).toBeGreaterThan(verticalness(plain, limbAtSeam) + 0.2);
    expect(verticalness(blended, bodyAtSeam)).toBeLessThan(verticalness(plain, bodyAtSeam) - 0.1);
  });

  it("leaves normals away from the seam alone", () => {
    const far = verticesWhere(plain, (_x, y) => {
      return y < 0.2 || y > 1.6;
    });

    for (const vertex of far) {
      expect(normalAngle(plain, blended, vertex)).toBeLessThan(1e-3);
    }
  });

  it("blends only surfaces that ask for it", () => {
    const halfway = limbOnBody(0.3, null);

    for (let vertex = 0; vertex < vertexCount(plain); vertex += 1) {
      expect(normalAngle(plain, halfway, vertex)).toBeLessThan(1e-3);
    }
  });

  it("blends a part toward a body that is only a reference and leaves no trace of it", () => {
    const builder = new MeshBuilder();

    builder.add(tube(LIMB, { radialSegments: 12 }), { seam: 0.3, style: { part: 1 } });
    builder.addSeamReference(sphere(1, 24, 16));

    const limb = builder.build();
    const alone = limbOnBody(null, null);

    const limbOnly = verticesWhere(alone, (_x, _y, _z, part) => {
      return part === 1;
    });
    const atSeam = verticesWhere(limb, (_x, y) => {
      return Math.abs(y - 1.05) < 1e-4;
    });

    expect(vertexCount(limb)).toBe(limbOnly.length);
    expect(verticalness(limb, atSeam)).toBeGreaterThan(0.2);
  });

  it("does not shade a surface by a part hidden just beneath it", () => {
    function withHiddenCore(seam: number | null): MeshData {
      const builder = new MeshBuilder();

      builder.add(sphere(1, 24, 16), seamOf(seam));
      builder.add(sphere(0.3, 12, 8), { ...seamOf(seam), transform: transformOf({ position: [0, 0.62, 0] }) });

      return builder.build();
    }

    const bare = withHiddenCore(null);
    const shaded = withHiddenCore(0.3);

    for (let vertex = 0; vertex < vertexCount(bare); vertex += 1) {
      expect(normalAngle(bare, shaded, vertex)).toBeLessThan(1e-3);
    }
  });
});
