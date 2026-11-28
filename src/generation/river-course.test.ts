import { describe, expect, it } from "vitest";
import { RiverCourse } from "./river-course.ts";

const course = new RiverCourse([
  { x: 0, z: 0 },
  { x: 3, z: 4 },
  { x: 3, z: 4 },
  { x: 3, z: 12 },
  { x: 9, z: 12 },
  { x: 9, z: 12 },
]);

describe("river course", () => {
  it("samples by distance around bends and clamps to the ends", () => {
    expect(course.length).toBe(19);
    expect(course.pointAt(-2)).toEqual({ x: 0, z: 0 });
    expect(course.pointAt(2.5)).toEqual({ x: 1.5, z: 2 });
    expect(course.pointAt(5)).toEqual({ x: 3, z: 4 });
    expect(course.pointAt(9)).toEqual({ x: 3, z: 8 });
    expect(course.pointAt(16)).toEqual({ x: 6, z: 12 });
    expect(course.pointAt(30)).toEqual({ x: 9, z: 12 });
  });

  it("projects onto the nearest segment and stops at the source and mouth", () => {
    expect(course.nearestTo({ x: 1, z: 8 })).toEqual({ along: 9, distance: 2 });
    expect(course.nearestTo({ x: -3, z: -4 })).toEqual({ along: 0, distance: 5 });
    expect(course.nearestTo({ x: 12, z: 16 })).toEqual({ along: 19, distance: 5 });
  });

  it("uses the upstream segment when both sides of a bend are equally near", () => {
    const bend = new RiverCourse([
      { x: 0, z: 0 },
      { x: 0, z: 10 },
      { x: 4, z: 10 },
      { x: 4, z: 0 },
    ]);

    expect(bend.nearestTo({ x: 2, z: 1 })).toEqual({ along: 1, distance: 2 });
  });
});
