import { describe, expect, it } from "vitest";
import { MeshBuilder } from "../mesh/mesh-builder.ts";
import { type MeshData, mergeMeshes } from "../mesh/mesh-data.ts";
import { box, sphere } from "../mesh/shapes.ts";
import { type Triple, transformOf } from "../mesh/transforms.ts";
import { detachedPieces, meshPieces } from "./mesh-connectivity.ts";

const TOLERANCE = 0.01;

function boxAt(position: Triple, size: number): MeshData {
  const builder = new MeshBuilder();

  builder.add(box(size, size, size), { transform: transformOf({ position }) });

  return builder.build();
}

describe("mesh connectivity", () => {
  it("splits a mesh into the pieces that share vertices", () => {
    const mesh = mergeMeshes([boxAt([0, 0.5, 0], 1), boxAt([3, 0.5, 0], 1)]);

    expect(meshPieces(mesh)).toHaveLength(2);
  });

  it("keeps parts that overlap a grounded part attached", () => {
    const mesh = mergeMeshes([boxAt([0, 0.5, 0], 1), boxAt([0.2, 1.3, 0], 0.8)]);

    expect(detachedPieces(mesh, TOLERANCE)).toEqual([]);
  });

  it("keeps a part hidden inside another attached", () => {
    const mesh = mergeMeshes([boxAt([0, 1, 0], 2), boxAt([0, 1, 0], 0.5)]);

    expect(detachedPieces(mesh, TOLERANCE)).toEqual([]);
  });

  it("finds a part that floats beside the rest", () => {
    const floating = new MeshBuilder();

    floating.add(sphere(0.2), { transform: transformOf({ position: [0, 1.25, 0] }) });

    const mesh = mergeMeshes([boxAt([0, 0.5, 0], 1), floating.build()]);

    const detached = detachedPieces(mesh, TOLERANCE);

    expect(detached).toHaveLength(1);
    expect(detached[0].minimum[1]).toBeCloseTo(1.05);
  });

  it("finds a lone part that hovers above the ground", () => {
    expect(detachedPieces(boxAt([0, 1, 0], 1), TOLERANCE)).toHaveLength(1);
  });
});
