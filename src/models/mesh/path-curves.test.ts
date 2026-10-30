import { describe, expect, it } from "vitest";
import { curveBodySections, curveSections, curveTube } from "./path-curves.ts";
import type { TubePoint } from "./tubes.ts";

const BENT: readonly TubePoint[] = [
  { radius: 0, x: 0, y: 1, z: 0 },
  { radius: 0.06, x: 0, y: 0.9, z: 0 },
  { radius: 0.05, x: 0.1, y: 0.6, z: 0 },
  { radius: 0.03, x: 0.1, y: 0.2, z: 0.05 },
];

describe("path curves", () => {
  it("keeps a path as it is with a single step", () => {
    expect(curveTube(BENT, 1)).toEqual(BENT);
  });

  it("passes through every point and adds points between them", () => {
    const curved = curveTube(BENT, 2);

    expect(curved).toHaveLength(BENT.length * 2 - 1);
    expect(
      curved.filter((_, index) => {
        return index % 2 === 0;
      })
    ).toEqual(BENT);
  });

  it("keeps each new point between its neighbors along the path", () => {
    const curved = curveTube(BENT, 2);

    for (let index = 1; index < curved.length; index += 2) {
      const before = curved[index - 1];
      const after = curved[index + 1];

      expect(curved[index].y).toBeLessThan(before.y);
      expect(curved[index].y).toBeGreaterThan(after.y);
    }
  });

  it("never pinches a ring next to a pole", () => {
    const curved = curveTube(BENT, 3);

    expect(
      curved.slice(1).every((point) => {
        return point.radius > 0;
      })
    ).toBe(true);
  });

  it("curves loft and body sections through their own sections", () => {
    const sections = curveSections(
      [
        { radiusX: 0, radiusZ: 0, y: 0 },
        { radiusX: 0.1, radiusZ: 0.08, y: 0.05 },
        { centerZ: 0.01, radiusX: 0.12, radiusZ: 0.1, y: 0.2 },
      ],
      2
    );
    const bodies = curveBodySections(
      [
        { centerY: 1, halfHeight: 0, halfWidth: 0, z: -0.5 },
        { centerY: 1, halfHeight: 0.2, halfWidth: 0.15, z: -0.3 },
        { centerY: 1.05, halfHeight: 0.22, halfWidth: 0.16, z: 0.2 },
      ],
      2
    );

    expect(
      sections.map((section) => {
        return section.y;
      })
    ).toEqual([0, expect.any(Number), 0.05, expect.any(Number), 0.2]);
    expect(
      bodies.map((section) => {
        return section.z;
      })
    ).toEqual([-0.5, expect.any(Number), -0.3, expect.any(Number), 0.2]);
    expect(sections[1].radiusX).toBeGreaterThan(0);
    expect(bodies[1].halfHeight).toBeGreaterThan(0);
  });
});
