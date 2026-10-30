import { describe, expect, it } from "vitest";
import { createVolumeNoise } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import { shapeProblems, signedVolume } from "../testing/mesh-checks.ts";
import { facetShape, type Shape, shapeVertexCount } from "./shape.ts";
import { blob, box, card, cone, cylinder, disc, icosphere, lathe, loft, panel, sphere, torus } from "./shapes.ts";

function centroid(shape: Shape): [number, number, number] {
  const sum: [number, number, number] = [0, 0, 0];
  const count = shapeVertexCount(shape);

  for (let offset = 0; offset < shape.positions.length; offset += 3) {
    sum[0] += shape.positions[offset];
    sum[1] += shape.positions[offset + 1];
    sum[2] += shape.positions[offset + 2];
  }

  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

function outwardShare(shape: Shape): number {
  const center = centroid(shape);

  let outward = 0;

  for (let offset = 0; offset < shape.positions.length; offset += 3) {
    const dot =
      (shape.positions[offset] - center[0]) * shape.normals[offset] +
      (shape.positions[offset + 1] - center[1]) * shape.normals[offset + 1] +
      (shape.positions[offset + 2] - center[2]) * shape.normals[offset + 2];

    if (dot > 0) {
      outward += 1;
    }
  }

  return outward / shapeVertexCount(shape);
}

function polygonArea(radius: number, segments: number): number {
  return (segments / 2) * radius * radius * Math.sin((2 * Math.PI) / segments);
}

describe("closed shapes", () => {
  it("builds a sphere that encloses the expected volume", () => {
    const shape = sphere(2, 24, 16);

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeCloseTo((4 / 3) * Math.PI * 8, -0.5);
    expect(outwardShare(shape)).toBe(1);
  });

  it("builds a capped cylinder and a cone", () => {
    const column = cylinder({ height: 3, radialSegments: 10, radiusBottom: 1, radiusTop: 1 });
    const spike = cone(1, 3, 10);

    expect(shapeProblems(column)).toEqual([]);
    expect(shapeProblems(spike)).toEqual([]);
    expect(signedVolume(column)).toBeCloseTo(polygonArea(1, 10) * 3, 4);
    expect(signedVolume(spike)).toBeCloseTo((polygonArea(1, 10) * 3) / 3, 4);
  });

  it("builds a box with exact volume and flat faces", () => {
    const shape = box(2, 3, 4);

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeCloseTo(24, 6);
    expect(shapeVertexCount(shape)).toBe(24);
  });

  it("builds an icosphere at every detail level", () => {
    for (const detail of [0, 1, 2]) {
      const shape = icosphere(1, detail);

      expect(shapeProblems(shape)).toEqual([]);
      expect(shape.indices.length / 3).toBe(20 * 4 ** detail);
      expect(signedVolume(shape)).toBeGreaterThan(0);
      expect(outwardShare(shape)).toBe(1);
    }
  });

  it("closes a lathe that starts and ends in poles", () => {
    const shape = lathe(
      [
        { radius: 0, y: 0 },
        { radius: 1, y: 0.5 },
        { radius: 0.6, y: 1.5 },
        { radius: 0, y: 2 },
      ],
      12
    );

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeGreaterThan(0);
  });

  it("lofts elliptical sections into a closed body", () => {
    const shape = loft(
      [
        { radiusX: 0, radiusZ: 0, y: 0 },
        { radiusX: 0.3, radiusZ: 0.2, y: 0.1 },
        {
          centerZ: 0.05,
          radiusX: 0.4,
          radiusZ: 0.25,
          ripple: (around) => {
            return 1 + 0.1 * Math.sin(around * 40);
          },
          y: 0.6,
        },
        { radiusX: 0, radiusZ: 0, y: 0.8 },
      ],
      16
    );

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeGreaterThan(0);
    expect(outwardShare(shape)).toBeGreaterThan(0.95);
  });

  it("closes a curved panel into a thin shell", () => {
    const shape = panel({
      angularSegments: 8,
      endAngle: Math.PI * 1.5,
      sections: [
        { radiusX: 0.5, radiusZ: 0.4, y: 0 },
        { radiusX: 0.45, radiusZ: 0.35, y: 0.5 },
        { radiusX: 0.3, radiusZ: 0.25, y: 1 },
      ],
      startAngle: Math.PI * 0.5,
      thickness: 0.04,
    });

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeGreaterThan(0);
    expect(signedVolume(shape)).toBeLessThan(0.06);
  });

  it("builds a torus around the vertical axis", () => {
    const shape = torus(2, 0.25, 24, 8);

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeCloseTo(2 * Math.PI * 2 * polygonArea(0.25, 8), 0);
  });

  it("keeps blobs closed and close to their radius", () => {
    const shape = blob({ noise: createVolumeNoise(createRandom(4)), radius: 2, roughness: 0.2 });

    expect(shapeProblems(shape)).toEqual([]);
    expect(signedVolume(shape)).toBeGreaterThan((4 / 3) * Math.PI * 1.4 ** 3);
    expect(signedVolume(shape)).toBeLessThan((4 / 3) * Math.PI * 2.6 ** 3);
  });
});

describe("open shapes", () => {
  it("builds a card that faces both ways", () => {
    const shape = card(1, 2);

    expect(shapeProblems(shape)).toEqual([]);
    expect(shape.normals[2]).toBe(1);
    expect(shape.normals.at(-1)).toBe(-1);
  });

  it("builds a disc that faces up", () => {
    const shape = disc(1, 16);

    expect(shapeProblems(shape)).toEqual([]);

    for (let offset = 0; offset < shape.normals.length; offset += 3) {
      expect(shape.normals[offset + 1]).toBe(1);
    }
  });
});

describe("faceting", () => {
  it("gives every triangle its own vertices with a flat normal", () => {
    const shape = facetShape(icosphere(1, 0));

    expect(shapeVertexCount(shape)).toBe(60);
    expect(shape.normals[0]).toBeCloseTo(shape.normals[3]);
    expect(shape.normals[1]).toBeCloseTo(shape.normals[4]);
    expect(signedVolume(shape)).toBeGreaterThan(0);
  });
});
