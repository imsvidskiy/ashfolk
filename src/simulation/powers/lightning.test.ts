import { describe, expect, it } from "vitest";
import { isDryLand, type Waypoint } from "../agents/navigation.ts";
import { Simulation } from "../simulation.ts";
import { createVegetatedWorld, floodCells } from "../testing/test-world.ts";
import { naturalStrikeSite } from "./lightning.ts";

const STORMS = 200;

function createStormyMeadow(): Simulation {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 } }));
  const { world } = simulation;
  const { grid } = world;

  const cells = grid.cellsInRadius(0, 0, grid.worldSize);
  const north = cells.filter((cell) => {
    return grid.cellCenterZ(cell) > 0;
  });

  for (const cell of cells) {
    world.clearPlants(cell, true);
  }

  floodCells(
    world,
    north.filter((cell) => {
      return grid.cellCenterX(cell) < 0;
    }),
    2
  );

  for (const cell of north) {
    if (grid.cellCenterX(cell) >= 0) {
      world.terrain.coastDistance[cell] = -5;
    }
  }

  return simulation;
}

function naturalStrikeSites(simulation: Simulation): Waypoint[] {
  const sites: Waypoint[] = [];

  for (let storm = 0; storm < STORMS; storm += 1) {
    const site = naturalStrikeSite({ x: 0, z: 0 }, simulation.services);

    if (site !== null) {
      sites.push(site);
    }
  }

  return sites;
}

describe("natural lightning", () => {
  it("strikes only dry land on the island", () => {
    const simulation = createStormyMeadow();
    const { world } = simulation;

    const sites = naturalStrikeSites(simulation);

    expect(sites.length).toBeGreaterThan(0);
    expect(
      sites.filter((site) => {
        return !isDryLand(world, world.grid.cellAt(site.x, site.z));
      })
    ).toEqual([]);
  });

  it("falls back to low dry land when no high ground or forest turns up", () => {
    const simulation = createStormyMeadow();

    expect(naturalStrikeSites(simulation).length).toBeGreaterThan(STORMS * 0.6);
  });
});
