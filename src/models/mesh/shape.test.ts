import { describe, expect, it } from "vitest";
import { signedVolume } from "../testing/mesh-checks.ts";
import { transformShape } from "./shape.ts";
import { cylinder } from "./shapes.ts";
import { MIRROR_X, transformOf } from "./transforms.ts";

const CONE = cylinder({ height: 1, radiusBottom: 0.5, radiusTop: 0.2 });

function outwardShare(normals: Float32Array, positions: Float32Array): number {
  let outward = 0;

  for (let offset = 0; offset < positions.length; offset += 3) {
    const radial = normals[offset] * positions[offset] + normals[offset + 2] * positions[offset + 2];

    outward += radial > 0 ? 1 : 0;
  }

  return outward / (positions.length / 3);
}

describe("shape transforms", () => {
  it("keeps the winding of a shape it only moves and scales", () => {
    const moved = transformShape(CONE, transformOf({ position: [3, 1, 0], scale: 2 }));

    expect(moved.indices).toEqual(CONE.indices);
    expect(signedVolume(moved)).toBeCloseTo(signedVolume(CONE) * 8);
  });

  it("turns the triangles of a mirrored shape so it still faces outwards", () => {
    const mirrored = transformShape(CONE, MIRROR_X);

    expect(signedVolume(mirrored)).toBeCloseTo(signedVolume(CONE));
    expect(outwardShare(mirrored.normals, mirrored.positions)).toBeCloseTo(outwardShare(CONE.normals, CONE.positions));
  });
});
