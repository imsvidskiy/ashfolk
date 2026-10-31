import { describe, expect, it } from "vitest";
import type { Selection } from "./commands.ts";
import type { Animal } from "./fauna/fauna.ts";
import { describeTribe } from "./frame-packing.ts";
import { type Inspection, inspect } from "./inspection.ts";
import type { Building } from "./society/buildings.ts";
import { MORNING, SocietyHarness, settle } from "./testing/test-society.ts";
import { floodCells } from "./testing/test-world.ts";

const MISSING_ID = 999;

function inspectIn(harness: SocietyHarness, selection: Selection): Inspection | null {
  const { buildings, fauna, society, world } = harness;

  const tribes = society.tribes().map((tribe) => {
    return describeTribe(tribe, society.membersOf(tribe), { buildings, world });
  });

  return inspect(selection, { buildings, environment: harness.context.environment, fauna, society, tribes, world });
}

function hutAt(harness: SocietyHarness, tribeId: number, x: number): Building {
  return harness.buildings.add({ kind: "hut", rotation: 0, tribeId, x, z: 60 }, harness.random);
}

function mammothIn(harness: SocietyHarness): Animal {
  const herd = harness.fauna.spawnHerd("mammoth", -150, -150, 1, harness.random);
  const mammoth = herd === null ? null : harness.fauna.findAnimal(herd.memberIds[0]);

  if (mammoth === null) {
    throw new Error("Expected a mammoth");
  }

  return mammoth;
}

describe("inspection", () => {
  it("tells what an animal is doing, how hurt it is and whether it is young", () => {
    const harness = new SocietyHarness({ day: MORNING });
    const mammoth = mammothIn(harness);

    mammoth.health = 2.5;
    mammoth.youth = 1;
    mammoth.pose = "graze";

    const grazing = inspectIn(harness, { id: mammoth.id, kind: "animal" });

    mammoth.pose = "run";

    expect(grazing).toMatchObject({ activity: "Grazing", health: 0.5, isYoung: true, name: "Mammoth" });
    expect(inspectIn(harness, { id: mammoth.id, kind: "animal" })).toMatchObject({ activity: "Running away" });
  });

  it("names the tribe of a building and tells whether it burns", () => {
    const harness = new SocietyHarness({ day: MORNING });
    const tribe = settle(harness, 2);

    const hut = hutAt(harness, tribe.id, 60);
    const stray = hutAt(harness, MISSING_ID, -60);

    hut.health = 35;
    hut.burningSeconds = 2;

    expect(inspectIn(harness, { id: hut.id, kind: "building" })).toMatchObject({
      health: 0.5,
      isBurning: true,
      name: "Hut",
      tribeName: tribe.name,
    });
    expect(inspectIn(harness, { id: stray.id, kind: "building" })).toMatchObject({
      isBurning: false,
      tribeName: "No tribe",
    });
  });

  it("describes a tribe by the summary sent with the same frame", () => {
    const harness = new SocietyHarness({ day: MORNING });
    const tribe = settle(harness, 3);

    expect(inspectIn(harness, { id: tribe.id, kind: "tribe" })).toMatchObject({
      kind: "tribe",
      summary: { id: tribe.id, name: tribe.name, population: 3 },
    });
  });

  it("calls a flooded cell water whatever biome lies under it", () => {
    const harness = new SocietyHarness({ day: MORNING });
    const { world } = harness;

    floodCells(world, [world.grid.cellAt(100, 100)], 1.5);

    expect(inspectIn(harness, { kind: "cell", x: 100, z: 100 })).toMatchObject({
      biomeName: "Water",
      waterDepth: expect.closeTo(1.5),
    });
    expect(inspectIn(harness, { kind: "cell", x: -100, z: 100 })).toMatchObject({ biomeName: "Meadow" });
  });

  it("finds nothing for things that are gone or places off the island", () => {
    const harness = new SocietyHarness({ day: MORNING });
    const { grid } = harness.world;

    expect(inspectIn(harness, { id: MISSING_ID, kind: "animal" })).toBeNull();
    expect(inspectIn(harness, { id: MISSING_ID, kind: "building" })).toBeNull();
    expect(inspectIn(harness, { id: MISSING_ID, kind: "person" })).toBeNull();
    expect(inspectIn(harness, { id: MISSING_ID, kind: "tribe" })).toBeNull();
    expect(inspectIn(harness, { kind: "cell", x: grid.worldSize, z: 0 })).toBeNull();
  });
});
