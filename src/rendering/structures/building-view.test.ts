import { Frustum, InstancedBufferGeometry, Mesh, MeshStandardNodeMaterial, PerspectiveCamera } from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { buildBuildingModel } from "../../models/structures/building-models.ts";
import type { BuildingView as BuildingSnapshot } from "../../simulation/frame.ts";
import { CAMERA_FADE_REACH, extentOf } from "../camera-fade.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { TribeLooks } from "../tribe-looks.ts";
import { BuildingView } from "./building-view.ts";

interface PlacedHut {
  readonly floor: number;
  readonly isFading: boolean;
  readonly visibility: number;
}

const HUT: BuildingSnapshot = {
  extent: 0,
  fuel: 0,
  health: 1,
  id: 1,
  kind: "hut",
  progress: 1,
  rotation: 0,
  seed: 0,
  style: 0,
  tribeId: 0,
  variant: 0,
  x: 120,
  z: 140,
};

function createView(): { mirror: WorldMirror; view: BuildingView } {
  const mirror = createVegetatedMirror();

  mirror.frame = { ...mirror.frame, buildings: [HUT] };

  return { mirror, view: new BuildingView(new TribeLooks(), new TerrainTextures(mirror), mirror.grid) };
}

function drawnMeshes(view: BuildingView, attribute: string): Mesh<InstancedBufferGeometry>[] {
  return view.group.children.filter((child): child is Mesh<InstancedBufferGeometry> => {
    return (
      child instanceof Mesh &&
      child.geometry instanceof InstancedBufferGeometry &&
      child.visible &&
      child.geometry.instanceCount > 0 &&
      child.geometry.getAttribute(attribute) !== undefined
    );
  });
}

function isFading(mesh: Mesh): boolean {
  return mesh.material instanceof MeshStandardNodeMaterial && mesh.material.maskNode !== null;
}

function hutFrom(view: BuildingView, mirror: WorldMirror, y: number): PlacedHut {
  const camera = new PerspectiveCamera();

  camera.position.set(HUT.x, y, HUT.z);
  view.update({ camera, detail: 1, frustum: new Frustum(), mirror });

  const [mesh] = drawnMeshes(view, "buildingState");

  if (mesh === undefined) {
    throw new Error("The hut isn't drawn");
  }

  return {
    floor: mesh.geometry.getAttribute("buildingPlacement").getY(0),
    isFading: isFading(mesh),
    visibility: mesh.geometry.getAttribute("buildingState").getW(0),
  };
}

describe("building view", () => {
  it("hides a building and its plinth while the camera is inside", () => {
    const { mirror, view } = createView();

    const { floor } = hutFrom(view, mirror, 2000);
    const inside = hutFrom(view, mirror, floor + 1);
    const plinths = drawnMeshes(view, "plinthLook");

    expect(inside.isFading).toBe(true);
    expect(inside.visibility).toBe(0);
    expect(plinths).toHaveLength(1);
    expect(plinths.every(isFading)).toBe(true);
    expect(plinths[0].geometry.getAttribute("plinthLook").getW(0)).toBe(0);
  });

  it("keeps a building whole once the camera rises past the top of its model", () => {
    const { mirror, view } = createView();

    const { height } = extentOf(buildBuildingModel("hut", "high").positions);
    const { floor } = hutFrom(view, mirror, 2000);
    const above = hutFrom(view, mirror, floor + height + CAMERA_FADE_REACH + 0.1);
    const plinths = drawnMeshes(view, "plinthLook");

    expect(above.isFading).toBe(false);
    expect(above.visibility).toBe(1);
    expect(plinths.some(isFading)).toBe(false);
    expect(plinths[0].geometry.getAttribute("plinthLook").getW(0)).toBe(1);
  });
});
