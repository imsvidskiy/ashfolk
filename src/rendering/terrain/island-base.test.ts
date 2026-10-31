import { Material, Mesh } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { IslandBase } from "./island-base.ts";
import { islandPlinthHeight } from "./island-base-geometry.ts";
import { TerrainTextures } from "./terrain-textures.ts";

describe("island base", () => {
  it("frees the cliff and underside materials with the meshes", () => {
    const mirror = createVegetatedMirror();
    const textures = new TerrainTextures(mirror);
    const base = new IslandBase(mirror, textures, islandPlinthHeight(mirror, textures.outline));

    const materials = [base.mesh, ...base.mesh.children].flatMap((object) => {
      return object instanceof Mesh && object.material instanceof Material ? [object.material] : [];
    });
    const disposals = materials.map((material) => {
      return vi.spyOn(material, "dispose");
    });

    base.dispose();

    expect(disposals).toHaveLength(2);

    for (const disposal of disposals) {
      expect(disposal).toHaveBeenCalledOnce();
    }
  });
});
