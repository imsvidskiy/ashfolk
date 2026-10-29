import { Vector3 } from "three";
import { describe, expect, it, it as test } from "vitest";
import { BUILDINGS } from "../../content/buildings.ts";
import { MaterialSlot } from "../materials.ts";
import { triangleCount } from "../mesh/mesh-data.ts";
import { outermostHit } from "../mesh/surface-probe.ts";
import { highestOpenEdge, meshProblems } from "../testing/mesh-checks.ts";
import { loosePieces, TOUCHING } from "../testing/mesh-connectivity.ts";
import { orderProblems, widestReach } from "../testing/structure-checks.ts";
import { buildBuildingModel, buildingScale, SINGLE_MODEL_KINDS, type SingleModelKind } from "./building-models.ts";
import { GLOW_PART } from "./structure-parts.ts";

const FLOAT_SLACK = 1e-4;
const LEVELS = ["high", "low"] as const;

const WORKING_BUILDINGS: readonly SingleModelKind[] = [
  "forge",
  "granary",
  "kiln",
  "longhouse",
  "smelter",
  "stoneHouse",
  "workshop",
];

const GLOWING_BUILDINGS: readonly SingleModelKind[] = ["forge", "kiln", "smelter"];

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
});

describe("building details", () => {
  it("paints every dwelling and the totem in the tribe color", () => {
    for (const kind of ["hut", "storehouse", "tent", "totem"] as const) {
      expect(buildBuildingModel(kind, "high").channels.slot).toContain(MaterialSlot.Accent);
    }
  });

  it("keeps the embers of a campfire in their own part", () => {
    expect(buildBuildingModel("campfire", "high").channels.part).toContain(GLOW_PART);
  });

  it.each(LEVELS)("shows the %s tent door in front of the cover", (level) => {
    const tent = buildBuildingModel("tent", level);

    const hit = outermostHit(tent, new Vector3(0, 0.5, 0), new Vector3(0, 0, 1));

    if (hit === null) {
      throw new Error("A ray from the middle of the tent should leave through its front");
    }

    expect(tent.channels.slot[tent.indices[hit.triangle * 3]]).toBe(MaterialSlot.Ash);
  });
});

describe("era buildings", () => {
  it.each(SINGLE_MODEL_KINDS)("fits the %s inside its footprint", (kind) => {
    for (const level of LEVELS) {
      expect(widestReach(buildBuildingModel(kind, level))).toBeLessThanOrEqual(BUILDINGS[kind].footprint);
    }
  });

  it.each(WORKING_BUILDINGS)("paints the %s in the tribe color", (kind) => {
    for (const level of LEVELS) {
      expect(buildBuildingModel(kind, level).channels.slot).toContain(MaterialSlot.Accent);
    }
  });

  it.each(GLOWING_BUILDINGS)("lights the fire of the %s", (kind) => {
    for (const level of LEVELS) {
      const mesh = buildBuildingModel(kind, level);

      expect(mesh.channels.part).toContain(GLOW_PART);
      expect(mesh.channels.slot).toContain(MaterialSlot.Ember);
    }
  });

  it.each(LEVELS)("opens the %s longhouse door toward the front", (level) => {
    const longhouse = buildBuildingModel("longhouse", level);

    const hit = outermostHit(longhouse, new Vector3(0, 1.2, 0), new Vector3(0, 0, 1));

    if (hit === null) {
      throw new Error("A ray from the middle of the longhouse should leave through its front");
    }

    expect(longhouse.channels.slot[longhouse.indices[hit.triangle * 3]]).toBe(MaterialSlot.Ash);
  });

  it.each(LEVELS)("paints the %s stone house door in the tribe color", (level) => {
    const house = buildBuildingModel("stoneHouse", level);

    const hit = outermostHit(house, new Vector3(0, 1, 0), new Vector3(0, 0, 1));

    if (hit === null) {
      throw new Error("A ray from the middle of the house should leave through its front");
    }

    expect(house.channels.slot[house.indices[hit.triangle * 3]]).toBe(MaterialSlot.Accent);
  });

  it("builds houses tall enough for grown people to walk in", () => {
    for (const kind of ["longhouse", "stoneHouse"] as const) {
      expect(buildBuildingModel(kind, "high").bounds.maximum[1]).toBeGreaterThan(4);
    }
  });
});
