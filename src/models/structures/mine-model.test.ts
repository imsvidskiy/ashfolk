import { Triangle } from "three";
import { describe, expect, it as test } from "vitest";
import { BUILDINGS } from "../../content/buildings.ts";
import { MINED_DEPOSIT_KINDS } from "../../content/deposits.ts";
import { MaterialSlot, type MaterialSlotIndex } from "../materials.ts";
import { type MeshData, triangleCount } from "../mesh/mesh-data.ts";
import { orderProblems, soundnessProblems, widestReach } from "../testing/structure-checks.ts";
import { buildMineModel, type MineOre } from "./mine-model.ts";

const ORE_SLOTS: Readonly<Record<MineOre, MaterialSlotIndex>> = {
  copper: MaterialSlot.CopperOre,
  iron: MaterialSlot.IronOre,
  tin: MaterialSlot.TinOre,
};

function hillsideOreShare(mesh: MeshData, ore: MaterialSlotIndex): number {
  const face = new Triangle();
  let rockArea = 0;
  let oreArea = 0;

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const first = mesh.indices[index];
    const slot = mesh.channels.slot[first];

    if (mesh.channels.buildOrder[first] >= 0.36 || (slot !== ore && slot !== MaterialSlot.Stone)) {
      continue;
    }

    face.a.fromArray(mesh.positions, first * 3);
    face.b.fromArray(mesh.positions, mesh.indices[index + 1] * 3);
    face.c.fromArray(mesh.positions, mesh.indices[index + 2] * 3);
    const area = face.getArea();

    rockArea += area;

    if (slot === ore) {
      oreArea += area;
    }
  }

  return oreArea / rockArea;
}

describe.each(MINED_DEPOSIT_KINDS)("%s mine", (ore) => {
  const high = buildMineModel(ore, "high");
  const low = buildMineModel(ore, "low");

  test("builds clean, grounded geometry at both levels of detail", () => {
    expect(soundnessProblems(high)).toEqual([]);
    expect(soundnessProblems(low)).toEqual([]);
    expect(triangleCount(low)).toBeLessThan(triangleCount(high));
    expect(orderProblems(high)).toEqual([]);
  });

  test("paints the mine in the tribe color", () => {
    expect(high.channels.slot).toContain(MaterialSlot.Accent);
    expect(low.channels.slot).toContain(MaterialSlot.Accent);
  });

  test("heaps its own ore and no other", () => {
    expect(high.channels.slot).toContain(ORE_SLOTS[ore]);

    for (const other of MINED_DEPOSIT_KINDS.filter((kind) => {
      return kind !== ore;
    })) {
      expect(high.channels.slot).not.toContain(ORE_SLOTS[other]);
    }
  });

  test("keeps narrow ore veins visible in the hillside at both viewing distances", () => {
    const nearby = hillsideOreShare(high, ORE_SLOTS[ore]);
    const distant = hillsideOreShare(low, ORE_SLOTS[ore]);

    expect(nearby).toBeGreaterThan(0.025);
    expect(nearby).toBeLessThan(0.09);
    expect(Math.abs(nearby - distant)).toBeLessThan(0.01);
  });

  test("fits inside the mine footprint", () => {
    expect(widestReach(high)).toBeLessThanOrEqual(BUILDINGS.mine.footprint);
    expect(widestReach(low)).toBeLessThanOrEqual(BUILDINGS.mine.footprint);
  });
});
