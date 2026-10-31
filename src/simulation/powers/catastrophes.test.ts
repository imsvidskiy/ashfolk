import { describe, expect, it } from "vitest";
import { Biome } from "../../content/biomes.ts";
import { Ground } from "../../content/grounds.ts";
import { isTreeSpecies, PlantSpecies, plantSpeciesDefinition } from "../../content/plants.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { isDryLand, type Waypoint } from "../agents/navigation.ts";
import { Simulation } from "../simulation.ts";
import { createVegetatedWorld, floodCells, monumentAround, plantInCell } from "../testing/test-world.ts";
import { raiseTerrain } from "../world/terrain-editing.ts";
import { naturalStrikeSite } from "./catastrophes.ts";

const VALLEY_SIDES = 0.25;
const VALLEY_FALL = 0.02;
const METEOR_Z = -200;
const STORMS = 200;

function valleyHeight(x: number, z: number): number {
  return 200 + Math.abs(x - 5) * VALLEY_SIDES + z * VALLEY_FALL;
}

function createValley(): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 }, heightAt: valleyHeight })
  );

  simulation.weather.setKind("clear");
  simulation.waterRecomputation.recompute();

  return simulation;
}

function settle(simulation: Simulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    simulation.advance(0.1);
  }
}

function waterCellsWithin(simulation: Simulation, x: number, z: number, radius: number): number {
  const { world } = simulation;

  return world.grid.cellsInRadius(x, z, radius).filter((cell) => {
    return world.isWater(cell);
  }).length;
}

function depthAt(simulation: Simulation, x: number, z: number): number {
  return simulation.world.waterDepth(simulation.world.grid.cellAt(x, z));
}

describe("water after the land changes", () => {
  it("runs a river down the valley before anything happens", () => {
    const simulation = createValley();

    expect(simulation.world.water.rivers.length).toBeGreaterThan(0);
    expect(simulation.world.isWaterAt(0, 0)).toBe(true);
    expect(simulation.world.water.lakes).toHaveLength(0);
  });

  it("fills an explosion crater on a river as a pond and lets the river flow on", () => {
    const simulation = createValley();

    simulation.usePower("explosion", 0, 0, {});
    settle(simulation, 8);

    expect(simulation.world.water.lakes).toHaveLength(1);
    expect(depthAt(simulation, 0, 0)).toBeGreaterThan(5);
    expect(simulation.world.isWaterAt(0, -250)).toBe(true);
  });

  it("starts filling a crater lake at once and fills it over a few seconds", () => {
    const simulation = createValley();

    simulation.usePower("meteor", 0, METEOR_Z, { craterRadius: 140, fallTime: 0.5 });
    settle(simulation, 0.7);

    const early = waterCellsWithin(simulation, 0, METEOR_Z, 120);

    settle(simulation, 1.5);

    const later = waterCellsWithin(simulation, 0, METEOR_Z, 120);

    settle(simulation, 6);

    const full = waterCellsWithin(simulation, 0, METEOR_Z, 120);

    expect(simulation.waterRecomputation.isPending).toBe(false);
    expect(early).toBeLessThan(later);
    expect(later).toBeLessThan(full);
    expect(full).toBeGreaterThan(300);
    expect(depthAt(simulation, 0, METEOR_Z)).toBeGreaterThan(30);
  });

  it("draws a river into a crater that tears through its bank", () => {
    const simulation = createValley();

    expect(simulation.world.isWaterAt(35, 0)).toBe(false);

    simulation.usePower("explosion", 35, 0, { radius: 45 });
    settle(simulation, 8);

    expect(depthAt(simulation, 35, 0)).toBeGreaterThan(3);
    expect(simulation.world.isWaterAt(0, -250)).toBe(true);
  });

  it("dams a river that the rim of a nearby crater falls across", () => {
    const simulation = createValley();

    const before = simulation.world.water.lakes.length;

    simulation.usePower("explosion", 50, 0, { radius: 45 });
    settle(simulation, 8);

    const upstream = simulation.world.water.lakes.filter((lake) => {
      return lake.centerZ > 0 && Math.abs(lake.centerX) < 80;
    });

    expect(simulation.world.water.lakes.length).toBeGreaterThan(before);
    expect(upstream.length).toBeGreaterThan(0);
  });

  it("washes away the buildings that a new lake covers", () => {
    const simulation = createValley();

    const shelter = simulation.buildings.add({ kind: "tent", rotation: 0, tribeId: 0, x: 5, z: 80 }, simulation.random);

    shelter.progress = 1;
    raiseTerrain(simulation.world, { radius: 40, x: 5, z: 30 }, 9);
    settle(simulation, 8);

    expect(simulation.world.isWaterAt(5, 80)).toBe(true);
    expect(simulation.buildings.all).not.toContain(shelter);
  });

  it("puts out the fire and clears the shore where lowered land floods", () => {
    const simulation = createValley();
    const { world } = simulation;

    const area = world.grid.cellsInRadius(5, 0, 200);
    const before = waterCellsWithin(simulation, 5, 0, 120);
    const burningWater = new Set<number>();

    simulation.beginStroke("lower", 5, 0, { radius: 100, strength: 100 });
    settle(simulation, 2);
    simulation.endStroke();
    simulation.usePower("fire", 5, 0, { intensity: 100, radius: 120 });

    for (let elapsed = 0; elapsed < 8; elapsed += 0.1) {
      simulation.advance(0.1);

      for (const cell of area) {
        if (world.isWater(cell) && world.isBurning(cell)) {
          burningWater.add(cell);
        }
      }
    }

    const plantsAtTheWater = area.filter((cell) => {
      return world.touchesWater(cell) && world.vegetation.countTreesInCell(cell) > 0;
    });

    expect(waterCellsWithin(simulation, 5, 0, 120)).toBeGreaterThan(before + 10);
    expect([...burningWater]).toEqual([]);
    expect(plantsAtTheWater).toEqual([]);
  });

  it("drowns the plants that the rising water reaches", () => {
    const simulation = createValley();
    const { vegetation } = simulation.world;

    simulation.usePower("meteor", 0, METEOR_Z, { craterRadius: 140, fallTime: 0.5 });
    settle(simulation, 10);

    const drowned = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    }).filter((plant) => {
      const { form } = plantSpeciesDefinition(vegetation.species[plant]);

      const isGrowing = form !== "stone" && form !== "monument";

      return isGrowing && vegetation.isAlive(plant) && simulation.world.touchesWater(vegetation.cell[plant]);
    });

    expect(drowned).toEqual([]);
  });
});

function createForest(): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({ biome: Biome.Forest, dimensions: { cellSize: 10, cellsPerSide: 96 }, ground: Ground.Forest })
  );

  simulation.weather.setKind("clear");
  simulation.weather.setWind(0, 0, 1);

  return simulation;
}

function treesWithin(simulation: Simulation, radius: number, state: number): number {
  const { vegetation } = simulation.world;

  let count = 0;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    const isNear = Math.hypot(vegetation.x[plant], vegetation.z[plant]) < radius;

    if (isNear && vegetation.state[plant] === state && isTreeSpecies(vegetation.species[plant])) {
      count += 1;
    }
  }

  return count;
}

function standingTreesOnScorchedGround(simulation: Simulation): number {
  const { fields, vegetation } = simulation.world;

  let count = 0;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    const isScorched = fields.scorch[vegetation.cell[plant]] > 0.05;

    if (isScorched && vegetation.isAlive(plant) && isTreeSpecies(vegetation.species[plant])) {
      count += 1;
    }
  }

  return count;
}

describe("fire after a blast", () => {
  it("fells the trees around the crater outward and sets the forest beyond burning", () => {
    const simulation = createForest();

    simulation.usePower("explosion", 0, 0, { radius: 45 });

    expect(treesWithin(simulation, 50, PlantState.Alive)).toBe(0);
    expect(treesWithin(simulation, 60, PlantState.Fallen)).toBeGreaterThan(10);
    expect(simulation.fire.burningCount).toBeGreaterThan(60);
  });

  it("lays the felled trees down pointing away from the blast", () => {
    const simulation = createForest();
    const { vegetation } = simulation.world;

    simulation.usePower("explosion", 0, 0, { radius: 45 });

    for (let plant = 0; plant < vegetation.count; plant += 1) {
      if (vegetation.state[plant] !== PlantState.Fallen) {
        continue;
      }

      const outward = Math.atan2(vegetation.x[plant], vegetation.z[plant]);
      const turn = Math.atan2(
        Math.sin(vegetation.rotation[plant] - outward),
        Math.cos(vegetation.rotation[plant] - outward)
      );

      expect(Math.abs(turn)).toBeLessThan(0.3);
    }
  });

  it("burns the forest around the crater and leaves no green tree on scorched ground", () => {
    const simulation = createForest();

    const before = treesWithin(simulation, 85, PlantState.Alive);

    simulation.usePower("explosion", 0, 0, { radius: 45 });

    expect(standingTreesOnScorchedGround(simulation)).toBe(0);

    simulation.runTicks(3000);

    expect(simulation.fire.burningCount).toBeLessThan(40);
    expect(treesWithin(simulation, 85, PlantState.Alive)).toBeLessThan(before * 0.2);
    expect(standingTreesOnScorchedGround(simulation)).toBe(0);
  });

  it("throws burning debris that starts fires beyond the ring", () => {
    const simulation = createForest();

    simulation.usePower("explosion", 0, 0, { radius: 45 });

    const flights = simulation.advance(0).effects.filter((effect) => {
      return effect.kind === "ember";
    });

    expect(flights.length).toBeGreaterThan(5);
    expect(simulation.embers.flying.length).toBe(flights.length);
  });

  it("starts no fire when the debris is not burning", () => {
    const simulation = createForest();

    simulation.usePower("explosion", 0, 0, { burningDebris: false, radius: 45 });
    settle(simulation, 5);

    expect(simulation.fire.burningCount).toBe(0);
    expect(standingTreesOnScorchedGround(simulation)).toBe(0);
  });

  it("starts no fire from a blast in a lake", () => {
    const simulation = createForest();
    const { grid } = simulation.world;

    floodCells(simulation.world, grid.cellsInRadius(0, 0, 70), 6);
    simulation.usePower("explosion", 0, 0, { radius: 45 });
    settle(simulation, 3);

    expect(simulation.fire.burningCount).toBe(0);
    expect(simulation.embers.flying).toHaveLength(0);
  });

  it("burns nothing on bare rock", () => {
    const simulation = new Simulation(
      createVegetatedWorld({
        biome: Biome.Glacier,
        dimensions: { cellSize: 10, cellsPerSide: 96 },
        ground: Ground.Rock,
      })
    );

    simulation.usePower("explosion", 0, 0, { radius: 45 });
    settle(simulation, 5);

    expect(simulation.fire.burningCount).toBe(0);
  });

  it("shatters big rocks near the crater into smaller ones", () => {
    const simulation = createForest();
    const { grid, vegetation } = simulation.world;

    function boulders(isWanted: (height: number) => boolean): number {
      let count = 0;

      for (let plant = 0; plant < vegetation.count; plant += 1) {
        const isNear = Math.hypot(vegetation.x[plant] - 45, vegetation.z[plant] - 5) < 25;

        if (isNear && vegetation.isAlive(plant) && vegetation.species[plant] === PlantSpecies.Boulder) {
          count += isWanted(vegetation.height[plant]) ? 1 : 0;
        }
      }

      return count;
    }

    const boulder = plantInCell(simulation.world, grid.cellAt(42, 0), PlantSpecies.Boulder);

    vegetation.height[boulder] = 3.5;
    simulation.usePower("explosion", 0, 0, { radius: 45 });

    expect(
      boulders((height) => {
        return height > 3;
      })
    ).toBe(0);
    expect(
      boulders((height) => {
        return height < 1.6;
      })
    ).toBeGreaterThan(1);
  });
});

describe("earthquakes", () => {
  it("throw trees down instead of making them vanish", () => {
    const simulation = createForest();

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    expect(treesWithin(simulation, 300, PlantState.Fallen)).toBeGreaterThan(20);
  });

  it("name the thrown trees as fallen when the ground is inspected", () => {
    const simulation = createForest();
    const { vegetation } = simulation.world;

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    const fallen = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    }).findIndex((plant) => {
      return vegetation.state[plant] === PlantState.Fallen;
    });

    expect(fallen).toBeGreaterThanOrEqual(0);

    simulation.setSelection({ kind: "cell", x: vegetation.x[fallen], z: vegetation.z[fallen] });

    expect(simulation.advance(0).inspection).toMatchObject({
      plants: expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining("(fallen)") })]),
    });
  });

  it("leave the cells they throw trees in to regrow and no bare ones", () => {
    const simulation = createForest();
    const { world } = simulation;
    const { vegetation } = world;

    const clearing = world.grid.cellsInRadius(0, 0, 150);

    for (const cell of clearing) {
      world.clearPlants(cell, true);
    }

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    const day = Math.fround(simulation.environment.day);
    const thrownCells = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    })
      .filter((plant) => {
        return vegetation.state[plant] === PlantState.Fallen;
      })
      .map((plant) => {
        return vegetation.cell[plant];
      });

    expect(thrownCells.length).toBeGreaterThan(20);
    expect(
      thrownCells.filter((cell) => {
        return !world.recovering.has(cell) || world.disturbedDay[cell] !== day;
      })
    ).toEqual([]);
    expect(
      clearing.filter((cell) => {
        return world.recovering.has(cell);
      })
    ).toEqual([]);
  });
});

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

describe("determinism", () => {
  function replay(): Simulation {
    const dimensions = { cellSize: 10, cellsPerSide: 96 };

    const simulation = new Simulation(
      createVegetatedWorld({
        dimensions,
        heightAt: valleyHeight,
        monuments: [monumentAround(new WorldGrid(dimensions), 200, 150, 20)],
      })
    );

    simulation.weather.setKind("clear");
    simulation.waterRecomputation.recompute();
    simulation.populate();
    simulation.execute({
      parameters: { craterRadius: 140, fallTime: 0.5 },
      powerId: "meteor",
      type: "usePower",
      x: 0,
      z: METEOR_Z,
    });
    simulation.execute({ parameters: {}, powerId: "explosion", type: "usePower", x: 150, z: 150 });
    simulation.execute({ parameters: {}, powerId: "earthquake", type: "usePower", x: -100, z: 0 });
    settle(simulation, 8);
    simulation.runTicks(1200);

    return simulation;
  }

  it("replays the same catastrophes the same way", () => {
    const first = replay();
    const second = replay();

    expect(second.world.terrain.height).toEqual(first.world.terrain.height);
    expect(second.world.terrain.waterSurface).toEqual(first.world.terrain.waterSurface);
    expect(second.world.fields.scorch).toEqual(first.world.fields.scorch);
    expect(second.world.vegetation.exportBuffers()).toEqual(first.world.vegetation.exportBuffers());
    expect(second.world.monumentConditions).toEqual(first.world.monumentConditions);
    expect(second.advance(0).people).toEqual(first.advance(0).people);
  });
});
