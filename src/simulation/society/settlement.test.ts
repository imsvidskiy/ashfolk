import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { SocietyHarness, settle } from "../testing/test-society.ts";
import { floodStrip, fordAcross, plantInCell } from "../testing/test-world.ts";
import { assignHomes } from "./housing.ts";
import type { Person } from "./person.ts";
import { considerSplit, findCampSite, scoreSite, siteSearchNear } from "./settlement.ts";
import type { Tribe } from "./tribe.ts";

const TRIBE_SIZE = 6;
const LEDGE_X = 120;
const LEDGE_RADIUS = 25;
const MOUNTAIN_RADIUS = 160;

interface SplittingTribe {
  harness: SocietyHarness;
  members: Person[];
  tribe: Tribe;
}

function settleSplittingTribe(youngestAge: number, harness = new SocietyHarness()): SplittingTribe {
  const tribe = settle(harness, 20);
  const members = harness.society.membersOf(tribe);

  for (const person of members) {
    person.age = 40;
  }

  for (const person of members.slice(0, 4)) {
    person.age = youngestAge;
  }

  return { harness, members, tribe };
}

function mountainWithLedge(x: number, z: number): number {
  const distance = Math.max(LEDGE_RADIUS, Math.hypot(x - LEDGE_X, z));

  return 100 + 0.5 * Math.max(0, MOUNTAIN_RADIUS - distance);
}

function plantOaksAround(harness: SocietyHarness, x: number, z: number, everyNthCell: number): void {
  const cells = harness.world.grid.cellsInRadius(x, z, 100);

  for (const [index, cell] of cells.entries()) {
    if (index % everyNthCell === 0) {
      plantInCell(harness.world, cell, PlantSpecies.Oak);
    }
  }
}

function nextDrawAfterSplitCheck(youngestAge: number): number {
  const { harness, members, tribe } = settleSplittingTribe(youngestAge);

  considerSplit(tribe, members, harness.context);

  return harness.random.next();
}

describe("camp sites", () => {
  it("are only chosen where the tribe can walk before its migration runs out", () => {
    const harness = new SocietyHarness({
      world: { crossings: [fordAcross(-24, 24, 400)], dimensions: { cellSize: 10, cellsPerSide: 96 } },
    });

    floodStrip(harness.world, 20, 1.5);
    harness.navigation.rebuild();

    const origin = { x: -100, z: -300 };
    const search = siteSearchNear(origin, 900, null);

    expect(scoreSite({ x: 100, z: -300 }, search, harness.context, [])).toBe(Number.NEGATIVE_INFINITY);
    expect(scoreSite({ x: -100, z: -100 }, search, harness.context, [])).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });

  it("rank the river bank below ground a short walk back from it", () => {
    const harness = new SocietyHarness();

    floodStrip(harness.world, 20, 1.5);
    harness.navigation.rebuild();

    const search = siteSearchNear({ x: 0, z: 0 }, 300, null);

    const onTheBank = scoreSite({ x: -30, z: 100 }, search, harness.context, []);
    const backFromTheBank = scoreSite({ x: -100, z: 100 }, search, harness.context, []);

    expect(onTheBank).toBeLessThan(backFromTheBank);
  });

  it("are unsuitable on steep or burning ground", () => {
    const harness = new SocietyHarness();

    const search = siteSearchNear({ x: 0, z: 0 }, 200, null);

    for (const cell of harness.world.grid.cellsInRadius(0, 0, 30)) {
      harness.world.fields.fire[cell] = 0.5;
    }

    expect(scoreSite({ x: 0, z: 0 }, search, harness.context, [])).toBe(Number.NEGATIVE_INFINITY);
    expect(scoreSite({ x: 200, z: 100 }, search, harness.context, [])).toBeGreaterThan(-5);
  });

  it("are unsuitable on a flat ledge of a steep mountainside unless nothing else is left", () => {
    const harness = new SocietyHarness({ world: { heightAt: mountainWithLedge } });

    const search = siteSearchNear({ x: 0, z: 0 }, 300, null);

    expect(harness.world.slope(harness.world.grid.cellAt(LEDGE_X, 0))).toBeLessThan(0.05);
    expect(scoreSite({ x: LEDGE_X, z: 0 }, search, harness.context, [])).toBe(Number.NEGATIVE_INFINITY);
    expect(scoreSite({ x: -150, z: 0 }, search, harness.context, [])).toBeGreaterThan(-5);

    const roughSearch = { ...search, canSettleRoughGround: true };

    expect(scoreSite({ x: LEDGE_X, z: 0 }, roughSearch, harness.context, [])).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    expect(scoreSite({ x: LEDGE_X, z: 0 }, roughSearch, harness.context, [])).toBeLessThan(
      scoreSite({ x: -150, z: 0 }, roughSearch, harness.context, [])
    );
  });

  it("rank a closed forest below a meadow with a few trees", () => {
    const harness = new SocietyHarness();

    const search = { ...siteSearchNear({ x: 0, z: 0 }, 300, null), canSettleRoughGround: true };
    const meadow = { x: -100, z: -100 };
    const forest = { x: 100, z: 100 };

    plantOaksAround(harness, meadow.x, meadow.z, 8);
    plantOaksAround(harness, forest.x, forest.z, 1);

    expect(scoreSite(forest, search, harness.context, [])).toBeLessThan(
      scoreSite(meadow, search, harness.context, []) - 3
    );
    expect(scoreSite(forest, { ...search, canSettleRoughGround: false }, harness.context, [])).toBe(
      Number.NEGATIVE_INFINITY
    );
  });

  it("do not count burnt trees and bushes as food and wood nearby", () => {
    const harness = new SocietyHarness();

    const search = siteSearchNear({ x: 0, z: 0 }, 200, null);

    const before = scoreSite({ x: 0, z: 0 }, search, harness.context, []);

    for (const cell of harness.world.grid.cellsInRadius(0, 0, 200)) {
      harness.world.vegetation.burnTreesInCell(cell, 1.5);
    }

    expect(scoreSite({ x: 0, z: 0 }, search, harness.context, [])).toBeLessThan(before - 2);
  });

  it("keep away from other tribes", () => {
    const harness = new SocietyHarness();

    const tribe = settle(harness, TRIBE_SIZE);

    const site = findCampSite(siteSearchNear({ x: tribe.campX, z: tribe.campZ }, 400, null), harness.context, [tribe]);

    if (site === null) {
      throw new Error("Expected a camp site");
    }

    expect(Math.hypot(site.x - tribe.campX, site.z - tribe.campZ)).toBeGreaterThan(100);
  });
});

describe("splits", () => {
  it("search for a camp site only when young settlers can leave", () => {
    const idleDraw = settleSplittingTribe(40).harness.random.next();

    expect(nextDrawAfterSplitCheck(40)).toBe(idleDraw);
    expect(nextDrawAfterSplitCheck(20)).not.toBe(idleDraw);
  });

  it("hand the beds the settlers leave to those who stay", () => {
    const { harness, members, tribe } = settleSplittingTribe(
      20,
      new SocietyHarness({ world: { dimensions: { cellSize: 10, cellsPerSide: 192 } } })
    );

    const tent = harness.buildings.add({ kind: "tent", rotation: 0, tribeId: tribe.id, x: 30, z: 30 }, harness.random);

    tribe.buildings.shelterIds.push(tent.id);
    tent.progress = 1;
    assignHomes(tribe, harness.buildings, harness.society.membersOf(tribe));
    considerSplit(tribe, members, harness.context);

    const stayers = harness.society.membersOf(tribe);

    expect(stayers.length).toBeLessThan(members.length);
    expect(
      stayers.filter((person) => {
        return person.homeId === tent.id;
      })
    ).toHaveLength(3);
  });
});
