import { describe, expect, it } from "vitest";
import { isClosed, isInsideSolid, shellsOf, withoutBuriedTriangles } from "./buried-triangles.ts";
import { MeshBuilder } from "./mesh-builder.ts";
import { type MeshData, mergeMeshes, triangleCount } from "./mesh-data.ts";
import { card, icosphere, sphere } from "./shapes.ts";
import { transformOf } from "./transforms.ts";

function ball(radius: number, position: readonly [number, number, number] = [0, 0, 0]): MeshData {
  const builder = new MeshBuilder();

  builder.add(icosphere(radius, 1), { transform: transformOf({ position }) });

  return builder.build();
}

function flatCard(): MeshData {
  const builder = new MeshBuilder();

  builder.add(card(4, 4));

  return builder.build();
}

describe("buried triangles", () => {
  it("tells points inside a closed solid from points outside it", () => {
    const solid = ball(1);

    expect(isInsideSolid(solid, [0.2, 0.3, -0.1])).toBe(true);
    expect(isInsideSolid(solid, [1.2, 0, 0])).toBe(false);
    expect(isInsideSolid(solid, [0, 0, 5])).toBe(false);
  });

  it("knows closed solids from open surfaces", () => {
    const builder = new MeshBuilder();

    builder.add(sphere(1, 5, 3));

    expect(isClosed(builder.build())).toBe(true);
    expect(isClosed(ball(1))).toBe(true);
    expect(isClosed(flatCard())).toBe(false);
  });

  it("drops a shape that sits wholly inside another", () => {
    const hidden = withoutBuriedTriangles(ball(0.3, [0.1, 0, 0]), [ball(1)]);

    expect(triangleCount(hidden)).toBe(0);
  });

  it("keeps the part of a shape that pokes out of another", () => {
    const poking = ball(0.5, [1, 0, 0]);

    const kept = withoutBuriedTriangles(poking, [ball(1)]);

    expect(triangleCount(kept)).toBeGreaterThan(0);
    expect(triangleCount(kept)).toBeLessThan(triangleCount(poking));
    expect(kept.bounds.maximum[0]).toBeCloseTo(poking.bounds.maximum[0]);
  });

  it("keeps every triangle when the cover is not a closed solid", () => {
    const inside = ball(0.3, [0, 0.5, 0]);

    expect(withoutBuriedTriangles(inside, [flatCard()])).toBe(inside);
  });

  it("splits a mesh into its separate shells", () => {
    const shells = shellsOf(mergeMeshes([ball(1), ball(0.5, [3, 0, 0])]));

    expect(shells).toHaveLength(2);
    expect(shells.map(triangleCount)).toEqual([80, 80]);
    expect(shells.every(isClosed)).toBe(true);
  });
});
