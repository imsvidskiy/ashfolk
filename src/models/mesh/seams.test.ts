import { describe, expect, it } from "vitest";
import { smoothstep } from "../../shared/math.ts";
import { verticesWhere } from "../testing/mesh-checks.ts";
import { MeshBuilder } from "./mesh-builder.ts";
import { type MeshData, vertexCount } from "./mesh-data.ts";
import { disc, sphere } from "./shapes.ts";
import { transformOf } from "./transforms.ts";
import { tube } from "./tubes.ts";

const DISC_REACH = 0.3;

const LIMB = [0, 0.9, 1.05, 1.3, 2].map((y) => {
  return { radius: 0.3, x: 0, y, z: 0 };
});
const PIERCING_LIMB = [-1, 0.05, 0.15, 0.25, 1].map((y) => {
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

function pointsWhere(mesh: MeshData, test: (x: number, y: number, z: number, part: number) => boolean): number[] {
  return verticesWhere(mesh, (vertex) => {
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
    const limbAtSeam = pointsWhere(plain, (_x, y, _z, part) => {
      return part === 1 && Math.abs(y - 1.05) < 1e-4;
    });
    const bodyAtSeam = pointsWhere(plain, (x, y, z, part) => {
      return part === 0 && y > 0.9 && Math.hypot(x, z) > 0.3;
    });

    expect(limbAtSeam.length).toBeGreaterThan(0);
    expect(bodyAtSeam.length).toBeGreaterThan(0);
    expect(verticalness(blended, limbAtSeam)).toBeGreaterThan(verticalness(plain, limbAtSeam) + 0.2);
    expect(verticalness(blended, bodyAtSeam)).toBeLessThan(verticalness(plain, bodyAtSeam) - 0.1);
  });

  it("leaves normals away from the seam alone", () => {
    const far = pointsWhere(plain, (_x, y) => {
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

    const limbOnly = pointsWhere(alone, (_x, _y, _z, part) => {
      return part === 1;
    });
    const atSeam = pointsWhere(limb, (_x, y) => {
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

  it("blends toward coarse triangles whose centers lie beyond the reach", () => {
    function limbThroughDisc(seam: number | null): MeshData {
      const builder = new MeshBuilder();

      builder.add(tube(PIERCING_LIMB, { radialSegments: 12 }), seamOf(seam));
      builder.addSeamReference(disc(3, 6));

      return builder.build();
    }

    const unblendedLimb = limbThroughDisc(null);
    const blendedLimb = limbThroughDisc(DISC_REACH);
    const aboveDisc = pointsWhere(unblendedLimb, (_x, y) => {
      return y > 0 && y < DISC_REACH;
    });

    expect(aboveDisc.length).toBeGreaterThan(0);

    for (const vertex of aboveDisc) {
      const offset = vertex * 3;
      const heightAboveDisc = unblendedLimb.positions[offset + 1];

      const weight = smoothstep(DISC_REACH, 0, heightAboveDisc);
      const towardX = unblendedLimb.normals[offset] * (1 - weight);
      const towardY = unblendedLimb.normals[offset + 1] * (1 - weight) + weight;
      const towardZ = unblendedLimb.normals[offset + 2] * (1 - weight);
      const length = Math.hypot(towardX, towardY, towardZ);

      expect(blendedLimb.normals[offset]).toBeCloseTo(towardX / length, 4);
      expect(blendedLimb.normals[offset + 1]).toBeCloseTo(towardY / length, 4);
      expect(blendedLimb.normals[offset + 2]).toBeCloseTo(towardZ / length, 4);
    }
  });
});
