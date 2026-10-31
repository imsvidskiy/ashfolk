import {
  Frustum,
  type InstancedBufferGeometry,
  type Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import type { WorldMirror } from "../../game/world-mirror.ts";
import { buildBuildingModel } from "../../models/structures/building-models.ts";
import type { BuildingView as BuildingSnapshot } from "../../simulation/frame.ts";
import { CAMERA_FADE_REACH, extentOf } from "../camera-fade.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { drawnMeshes } from "../testing/drawn-meshes.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { TribeLooks } from "../tribe-looks.ts";
import { BuildingView } from "./building-view.ts";

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

interface PlacedHut {
  readonly floor: number;
  readonly isFading: boolean;
  readonly visibility: number;
}

function createView(buildings: BuildingSnapshot[] = [HUT]): { mirror: WorldMirror; view: BuildingView } {
  const mirror = createVegetatedMirror();

  mirror.frame = { ...mirror.frame, buildings };

  return { mirror, view: new BuildingView(new TribeLooks(), new TerrainTextures(mirror), mirror.grid) };
}

function firstInstance(meshes: readonly Mesh<InstancedBufferGeometry>[], attribute: string): number[] {
  const [mesh] = meshes;

  if (mesh === undefined) {
    throw new Error(`Nothing is drawn with ${attribute}`);
  }

  const values = mesh.geometry.getAttribute(attribute);

  return [values.getX(0), values.getY(0), values.getZ(0), values.getW(0)];
}

function closeTo(values: readonly number[]): unknown[] {
  return values.map((value) => {
    return expect.closeTo(value, 5);
  });
}

function isFading(mesh: Mesh): boolean {
  return mesh.material instanceof MeshStandardNodeMaterial && mesh.material.maskNode !== null;
}

function hutFrom(view: BuildingView, mirror: WorldMirror, y: number): PlacedHut {
  const camera = new PerspectiveCamera();

  camera.position.set(HUT.x, y, HUT.z);
  view.update({ camera, detail: 1, frustum: new Frustum(), mirror });

  const [mesh] = drawnMeshes(view.group, "buildingState");

  if (mesh === undefined) {
    throw new Error("The hut isn't drawn");
  }

  return {
    floor: mesh.geometry.getAttribute("buildingPlacement").getY(0),
    isFading: isFading(mesh),
    visibility: mesh.geometry.getAttribute("buildingState").getW(0),
  };
}

function glowOf(view: BuildingView, mirror: WorldMirror, building: Partial<BuildingSnapshot>): number {
  mirror.frame = { ...mirror.frame, buildings: [{ ...HUT, ...building }] };
  hutFrom(view, mirror, 2000);

  const [, glow] = firstInstance(drawnMeshes(view.group, "buildingState"), "buildingState");

  return glow;
}

describe("building view", () => {
  it("hides a building and its plinth while the camera is inside", () => {
    const { mirror, view } = createView();

    const { floor } = hutFrom(view, mirror, 2000);
    const inside = hutFrom(view, mirror, floor + 1);
    const plinths = drawnMeshes(view.group, "plinthLook");

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
    const plinths = drawnMeshes(view.group, "plinthLook");

    expect(above.isFading).toBe(false);
    expect(above.visibility).toBe(1);
    expect(plinths.some(isFading)).toBe(false);
    expect(plinths[0].geometry.getAttribute("plinthLook").getW(0)).toBe(1);
  });

  it("writes where a building stands, how far it is built and how worn it is into its instance", () => {
    const worn: BuildingSnapshot = { ...HUT, health: 0.4, progress: 0.75, rotation: 0.7, style: 2 };
    const { mirror, view } = createView([worn]);

    const { floor } = hutFrom(view, mirror, 2000);
    const buildings = drawnMeshes(view.group, "buildingState");
    const plinths = drawnMeshes(view.group, "plinthLook");
    const accent = new TribeLooks().accent(worn.tribeId);
    const [plinthX, plinthTop, plinthZ, plinthRotation] = firstInstance(plinths, "plinthPlacement");
    const [depth, ...plinthLook] = firstInstance(plinths, "plinthLook");

    expect(firstInstance(buildings, "buildingPlacement")).toEqual(closeTo([worn.x, floor, worn.z, worn.rotation]));
    expect(firstInstance(buildings, "buildingLook")).toEqual(closeTo([worn.progress, accent.r, accent.g, accent.b]));
    expect(firstInstance(buildings, "buildingState")).toEqual(closeTo([0.6, 0, worn.style, 1]));
    expect([plinthX, plinthZ, plinthRotation]).toEqual(closeTo([worn.x, worn.z, worn.rotation]));
    expect(floor - plinthTop).toBeGreaterThan(0);
    expect(floor - plinthTop).toBeLessThan(0.1);
    expect(plinthLook).toEqual(closeTo([0.6, worn.style, 1]));
    expect(depth).toBeGreaterThan(0.5);
    expect(depth).toBeLessThanOrEqual(3.6);
  });

  it("lights finished workplaces and burning campfires and leaves the rest dark", () => {
    const { mirror, view } = createView();

    expect(glowOf(view, mirror, { kind: "forge", progress: 1 })).toBeGreaterThan(0);
    expect(glowOf(view, mirror, { kind: "forge", progress: 0.5 })).toBe(0);
    expect(glowOf(view, mirror, { fuel: 0.6, kind: "campfire" })).toBeGreaterThan(
      glowOf(view, mirror, { fuel: 0.1, kind: "campfire" })
    );
    expect(glowOf(view, mirror, { fuel: 0.1, kind: "campfire" })).toBeGreaterThan(0);
    expect(glowOf(view, mirror, { fuel: 0, kind: "campfire" })).toBe(0);
    expect(glowOf(view, mirror, { kind: "hut" })).toBe(0);
  });
});
