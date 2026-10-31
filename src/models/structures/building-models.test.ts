import { Vector3 } from "three";
import { describe, expect, it, it as test } from "vitest";
import { BUILDINGS } from "../../content/buildings.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { type MeshData, triangleCount } from "../mesh/mesh-data.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { highestOpenEdge, meshProblems } from "../testing/mesh-checks.ts";
import { loosePieces, TOUCHING } from "../testing/mesh-connectivity.ts";
import { orderProblems, widestReach } from "../testing/structure-checks.ts";
import { buildBuildingModel, buildingScale, SINGLE_MODEL_KINDS, type SingleModelKind } from "./building-models.ts";
import { GLOW_PART } from "./structure-parts.ts";

const FLOAT_SLACK = 1e-4;
const LEVELS = ["high", "low"] as const;
const GLOWING_BUILDINGS: readonly SingleModelKind[] = ["campfire", "forge", "kiln", "smelter"];

const TRIBE_BUILDINGS: readonly SingleModelKind[] = SINGLE_MODEL_KINDS.filter((kind) => {
  return kind !== "campfire";
});

const FAR_TRIBE_BUILDINGS: readonly SingleModelKind[] = TRIBE_BUILDINGS.filter((kind) => {
  return kind !== "tent";
});

const FRONT_DOORS: readonly (readonly [SingleModelKind, number, MaterialSlotIndex])[] = [
  ["tent", 0.5, MaterialSlot.Ash],
  ["longhouse", 1.2, MaterialSlot.Ash],
  ["stoneHouse", 1, MaterialSlot.Accent],
];

function frontSlot(mesh: MeshData, height: number): number {
  const hit = outermostHit(mesh, new Vector3(0, height, 0), new Vector3(0, 0, 1));

  if (hit === null) {
    throw new Error("A ray from the middle of the building should leave through its front");
  }

  return mesh.channels.slot[mesh.indices[hit.triangle * 3]];
}

describe.each(SINGLE_MODEL_KINDS)("%s model", (kind) => {
  const high = buildBuildingModel(kind, "high");
  const low = buildBuildingModel(kind, "low");

  test("builds clean geometry at both levels of detail", () => {
    expect(meshProblems(high)).toEqual([]);
    expect(meshProblems(low)).toEqual([]);
    expect(triangleCount(low)).toBeLessThan(triangleCount(high));
  });

  test("keeps every part attached to the ground at both levels of detail", () => {
    const touching = TOUCHING * buildingScale(kind) + FLOAT_SLACK;

    for (const mesh of [high, low]) {
      expect(loosePieces(mesh, touching)).toEqual([]);
    }
  });

  test("closes every surface above the ground at both levels of detail", () => {
    expect(highestOpenEdge(high)).toBeLessThan(0.05);
    expect(highestOpenEdge(low)).toBeLessThan(0.05);
  });

  test("rises in stages from the ground while it is built", () => {
    expect(orderProblems(high)).toEqual([]);
    expect(high.bounds.minimum[1]).toBeGreaterThan(-0.1);
  });

  test("fits inside its footprint at both levels of detail", () => {
    expect(widestReach(high)).toBeLessThanOrEqual(BUILDINGS[kind].footprint);
    expect(widestReach(low)).toBeLessThanOrEqual(BUILDINGS[kind].footprint);
  });
});

describe("building details", () => {
  it.each(TRIBE_BUILDINGS)("paints the %s in the tribe color", (kind) => {
    expect(buildBuildingModel(kind, "high").channels.slot).toContain(MaterialSlot.Accent);
  });

  it.each(FAR_TRIBE_BUILDINGS)("keeps the tribe color on the far %s", (kind) => {
    expect(buildBuildingModel(kind, "low").channels.slot).toContain(MaterialSlot.Accent);
  });

  it.each(GLOWING_BUILDINGS)("lights the fire of the %s in its own part", (kind) => {
    for (const level of LEVELS) {
      const mesh = buildBuildingModel(kind, level);

      expect(mesh.channels.part).toContain(GLOW_PART);
      expect(mesh.channels.slot).toContain(MaterialSlot.Ember);
    }
  });

  it.each(FRONT_DOORS)("shows the %s door at the front", (kind, height, slot) => {
    for (const level of LEVELS) {
      expect(frontSlot(buildBuildingModel(kind, level), height)).toBe(slot);
    }
  });

  it("builds houses tall enough for grown people to walk in", () => {
    for (const kind of ["longhouse", "stoneHouse"] as const) {
      expect(buildBuildingModel(kind, "high").bounds.maximum[1]).toBeGreaterThan(4);
    }
  });
});
