import { describe, expect, it } from "vitest";
import { signedVolume } from "../testing/mesh-checks.ts";
import { MeshBuilder } from "./mesh-builder.ts";
import { mergeMeshes, triangleCount, vertexCount } from "./mesh-data.ts";
import { box } from "./shapes.ts";
import { transformOf } from "./transforms.ts";

describe("merging meshes", () => {
  it("offsets the indices of every following mesh", () => {
    const first = new MeshBuilder();
    const second = new MeshBuilder();

    first.add(box(1, 1, 1));
    second.add(box(1, 1, 1), { transform: transformOf({ position: [3, 0, 0] }) });

    const merged = mergeMeshes([first.build(), second.build()]);

    expect(vertexCount(merged)).toBe(48);
    expect(triangleCount(merged)).toBe(24);
    expect(Math.max(...merged.indices)).toBe(47);
    expect(merged.bounds.maximum[0]).toBe(3.5);
    expect(signedVolume(merged)).toBeCloseTo(2);
  });
});
