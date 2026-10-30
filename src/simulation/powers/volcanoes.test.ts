import { describe, expect, it } from "vitest";
import { Ground } from "../../content/grounds.ts";
import { PlantSpecies } from "../../content/plants.ts";
import type { LavaView } from "../frame.ts";
import { Simulation } from "../simulation.ts";
import { snapshotOf } from "../testing/test-simulation.ts";
import { createVegetatedWorld, floodCells, plantInCell } from "../testing/test-world.ts";
import { TICK_SECONDS } from "../tick.ts";
import { COOLING_SECONDS, SWELL_SECONDS, type Volcano } from "./volcanoes.ts";

const RADIUS = 100;
const BASE_HEIGHT = 100;
const FALL_PER_METER = 0.08;
const RIVER_START = 260;

interface VolcanoWorld {
  hasRiver: boolean;
}

function floodRiver(simulation: Simulation): void {
  const { grid } = simulation.world;

  floodCells(
    simulation.world,
    grid.cellsInRadius(0, 0, grid.worldSize).filter((cell) => {
      return grid.cellCenterX(cell) > RIVER_START;
    }),
    1
  );
}

function createSimulation({ hasRiver }: VolcanoWorld): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({
      dimensions: { cellSize: 10, cellsPerSide: 96 },
      heightAt: (x) => {
        return BASE_HEIGHT - x * FALL_PER_METER;
      },
    })
  );

  simulation.weather.setKind("clear");

  if (hasRiver) {
    floodRiver(simulation);
  }

  return simulation;
}

function runFor(simulation: Simulation, seconds: number): LavaView | null {
  let sent: LavaView | null = null;

  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    const { lava } = simulation.advance(0.1);

    if (lava !== null) {
      sent = lava;
    }
  }

  return sent;
}

function settle(simulation: Simulation): void {
  for (let elapsed = 0; elapsed < 10 && simulation.isBusy; elapsed += 0.1) {
    simulation.advance(0.1);
  }
}

function onlyVolcano(simulation: Simulation): Volcano {
  const [volcano] = simulation.volcanoes.all;

  if (volcano === undefined) {
    throw new Error("Expected a volcano");
  }

  return volcano;
}

interface LavaWarnings {
  farHotCells: number;
  unwarnedHotCells: number;
}

function warnOfLava(simulation: Simulation): LavaWarnings {
  simulation.volcanoes.update(TICK_SECONDS, simulation.services);

  const zones = simulation.hazards.snapshot();
  const { grid } = simulation.world;

  const hotCells = [...onlyVolcano(simulation).lava]
    .filter(([, heat]) => {
      return heat > 0.3;
    })
    .map(([cell]) => {
      return cell;
    });

  function isWarned(cell: number): boolean {
    return zones.some((zone) => {
      return Math.hypot(zone.x - grid.cellCenterX(cell), zone.z - grid.cellCenterZ(cell)) < zone.radius;
    });
  }

  return {
    farHotCells: hotCells.filter((cell) => {
      return Math.hypot(grid.cellCenterX(cell), grid.cellCenterZ(cell)) > RADIUS * 1.5;
    }).length,
    unwarnedHotCells: hotCells.filter((cell) => {
      return !isWarned(cell);
    }).length,
  };
}

function erupt(world: VolcanoWorld, strength = 60): Simulation {
  const simulation = createSimulation(world);

  simulation.execute({ parameters: { radius: RADIUS, strength }, powerId: "volcano", type: "usePower", x: 0, z: 0 });

  return simulation;
}

describe("volcanoes", () => {
  it("swells the ground into a cone with a crater on top", () => {
    const simulation = erupt({ hasRiver: false });
    const { world } = simulation;

    runFor(simulation, SWELL_SECONDS + 0.5);

    const summit = world.heightAt(RADIUS * 0.2, 0) - (BASE_HEIGHT - RADIUS * 0.2 * FALL_PER_METER);
    const crater = world.heightAt(0, 0) - BASE_HEIGHT;
    const flank = world.heightAt(0, RADIUS * 0.6) - BASE_HEIGHT;
    const outside = world.heightAt(0, RADIUS * 1.2) - BASE_HEIGHT;

    expect(summit).toBeGreaterThan(RADIUS * 0.35);
    expect(crater).toBeLessThan(summit - 5);
    expect(flank).toBeGreaterThan(3);
    expect(flank).toBeLessThan(summit);
    expect(outside).toBeCloseTo(0, 5);
  });

  it("sends lava downhill along the same cells every time", () => {
    const first = erupt({ hasRiver: false });
    const second = erupt({ hasRiver: false });

    runFor(first, SWELL_SECONDS + 20);
    runFor(second, SWELL_SECONDS + 20);

    const volcano = onlyVolcano(first);
    const { terrain } = first.world;

    expect([...volcano.lava.keys()]).toEqual([...onlyVolcano(second).lava.keys()]);
    expect(volcano.tongues.length).toBeGreaterThanOrEqual(2);

    for (const tongue of volcano.tongues) {
      expect(tongue.cells.length).toBeGreaterThan(4);

      for (let step = 1; step < tongue.cells.length; step += 1) {
        expect(terrain.height[tongue.cells[step]]).toBeLessThanOrEqual(terrain.height[tongue.cells[step - 1]] + 1.5);
      }

      const [start] = tongue.cells;
      const end = tongue.cells.at(-1);

      expect(end).toBeDefined();
      expect(terrain.height[end === undefined ? start : end]).toBeLessThan(terrain.height[start] - 10);
    }
  });

  it("sets what it touches on fire and turns its path to lava rock", () => {
    const simulation = erupt({ hasRiver: false });

    runFor(simulation, SWELL_SECONDS + 10);

    const volcano = onlyVolcano(simulation);
    const { terrain } = simulation.world;

    expect(simulation.fire.burningCount).toBeGreaterThan(0);
    expect(simulation.embers.flying.length).toBeGreaterThan(0);
    expect(
      [...volcano.lava.keys()].every((cell) => {
        return terrain.ground[cell] === Ground.Basalt;
      })
    ).toBe(true);
    expect(simulation.advance(0).lava).toBeNull();

    simulation.step();

    expect(simulation.advance(0).lava?.cells.length).toBe(volcano.lava.size);
  });

  it("hisses to steam and stops where it meets water", () => {
    const simulation = erupt({ hasRiver: false }, 100);
    const { world } = simulation;

    runFor(simulation, SWELL_SECONDS);
    settle(simulation);
    floodRiver(simulation);
    runFor(simulation, 60);

    const volcano = onlyVolcano(simulation);
    const quenched = volcano.tongues.filter((tongue) => {
      return tongue.quenchedCell >= 0;
    });

    expect(quenched.length).toBeGreaterThan(0);
    expect(
      quenched.every((tongue) => {
        return world.isWater(tongue.quenchedCell);
      })
    ).toBe(true);
    expect(
      [...volcano.lava.keys()].some((cell) => {
        return world.isWater(cell);
      })
    ).toBe(false);
    expect(simulation.advance(0).volcanoes[0].steam.length).toBeGreaterThan(0);
  });

  it("cools into rock and leaves fertile ash that regrows sooner", () => {
    const simulation = erupt({ hasRiver: false }, 5);
    const { world } = simulation;

    runFor(simulation, SWELL_SECONDS + 5);

    const lavaCells = [...onlyVolcano(simulation).lava.keys()];

    const lastLava = runFor(simulation, 30 + COOLING_SECONDS * 1.4);

    const ashCells = world.grid.cellsInRadius(0, 0, RADIUS).filter((cell) => {
      return world.terrain.ground[cell] === Ground.Ash;
    });

    expect(simulation.volcanoes.all).toHaveLength(0);
    expect(lastLava?.cells).toHaveLength(0);
    expect(
      lavaCells.every((cell) => {
        return world.terrain.ground[cell] === Ground.Basalt;
      })
    ).toBe(true);
    expect(
      lavaCells.some((cell) => {
        return world.recovering.has(cell);
      })
    ).toBe(false);
    expect(ashCells.length).toBeGreaterThan(50);
    expect(
      ashCells.every((cell) => {
        return world.recovering.has(cell);
      })
    ).toBe(true);
  });

  it("kills people and animals that stand in hot lava", () => {
    const simulation = erupt({ hasRiver: false });

    simulation.execute({ parameters: { herdSize: 3 }, powerId: "deer", type: "usePower", x: -300, z: -300 });
    simulation.execute({ parameters: { people: 3 }, powerId: "tribe", type: "usePower", x: -300, z: 300 });
    runFor(simulation, SWELL_SECONDS + 5);

    const [lavaCell] = onlyVolcano(simulation).lava.keys();
    const [person] = simulation.society.people;
    const [animal] = simulation.fauna.animals;
    const { grid } = simulation.world;

    expect(lavaCell).toBeDefined();
    expect(person).toBeDefined();
    expect(animal).toBeDefined();

    for (const mover of [person.mover, animal.mover]) {
      mover.x = grid.cellCenterX(lavaCell === undefined ? 0 : lavaCell);
      mover.z = grid.cellCenterZ(lavaCell === undefined ? 0 : lavaCell);
    }

    simulation.step();

    expect(person.isAlive).toBe(false);
    expect(person.causeOfDeath).toBe("lava");
    expect(animal.isAlive).toBe(false);
  });

  it("spares a person the hand carries over hot lava", () => {
    const simulation = erupt({ hasRiver: false });

    simulation.execute({ parameters: { people: 3 }, powerId: "tribe", type: "usePower", x: -300, z: 300 });
    runFor(simulation, SWELL_SECONDS + 5);

    const [lavaCell] = onlyVolcano(simulation).lava.keys();
    const [person] = simulation.society.people;
    const { grid } = simulation.world;

    expect(lavaCell).toBeDefined();
    expect(person).toBeDefined();

    simulation.grab({ id: person.id, kind: "person" });
    simulation.carry(
      grid.cellCenterX(lavaCell === undefined ? 0 : lavaCell),
      grid.cellCenterZ(lavaCell === undefined ? 0 : lavaCell)
    );
    simulation.step();

    expect(person.isAlive).toBe(true);
  });

  it("burns plants set down on hot lava", () => {
    const simulation = erupt({ hasRiver: false });

    runFor(simulation, SWELL_SECONDS + 5);

    const [lavaCell] = onlyVolcano(simulation).lava.keys();
    const cell = lavaCell === undefined ? 0 : lavaCell;

    plantInCell(simulation.world, cell, PlantSpecies.Oak);
    simulation.step();

    expect(simulation.world.vegetation.hasPlantsInCell(cell)).toBe(false);
  });

  it("keeps its lava and ash on the island", () => {
    const simulation = createSimulation({ hasRiver: false });
    const { grid, terrain } = simulation.world;

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (grid.cellCenterX(cell) < -RADIUS * 0.1) {
        terrain.coastDistance[cell] = -5;
      }
    }

    simulation.execute({ parameters: { radius: RADIUS }, powerId: "volcano", type: "usePower", x: 0, z: 0 });
    runFor(simulation, SWELL_SECONDS + 10);

    const offIsland = grid.cellsInRadius(0, 0, RADIUS * 2).filter((cell) => {
      return !simulation.world.isOnIsland(cell);
    });

    expect(onlyVolcano(simulation).lava.size).toBeGreaterThan(0);
    expect(
      offIsland.filter((cell) => {
        return onlyVolcano(simulation).lava.has(cell) || terrain.ground[cell] !== Ground.Meadow;
      })
    ).toEqual([]);
  });

  it("warns people off all of the hot lava until it cools", () => {
    const simulation = erupt({ hasRiver: false }, 100);

    runFor(simulation, SWELL_SECONDS + 30);

    const erupting = warnOfLava(simulation);

    runFor(simulation, onlyVolcano(simulation).eruptionSeconds - 30 + COOLING_SECONDS * 0.4);

    const cooling = warnOfLava(simulation);

    runFor(simulation, COOLING_SECONDS * 1.2);
    simulation.volcanoes.update(TICK_SECONDS, simulation.services);

    expect(erupting.farHotCells).toBeGreaterThan(0);
    expect(erupting.unwarnedHotCells).toBe(0);
    expect(cooling.farHotCells).toBeGreaterThan(0);
    expect(cooling.unwarnedHotCells).toBe(0);
    expect(simulation.volcanoes.all).toHaveLength(0);
    expect(simulation.hazards.snapshot()).toEqual([]);
  });

  it("refuses to rise out of water", () => {
    const simulation = createSimulation({ hasRiver: true });

    simulation.execute({ parameters: { radius: RADIUS }, powerId: "volcano", type: "usePower", x: 400, z: 0 });

    expect(simulation.volcanoes.all).toHaveLength(0);
    expect(simulation.takeNotices()).toEqual(["A volcano needs dry land."]);
  });

  it("refuses to rise past the coast or off the map", () => {
    const simulation = createSimulation({ hasRiver: false });
    const { grid, terrain } = simulation.world;

    terrain.coastDistance[grid.cellAt(-300, 0)] = -5;

    for (const x of [-300, grid.worldSize * 2]) {
      simulation.execute({ parameters: { radius: RADIUS }, powerId: "volcano", type: "usePower", x, z: 0 });
    }

    expect(simulation.volcanoes.all).toHaveLength(0);
    expect(simulation.takeNotices()).toEqual(["A volcano needs dry land.", "A volcano needs dry land."]);
  });

  it("refuses to rise where its cone would touch another volcano's", () => {
    const simulation = erupt({ hasRiver: false });

    simulation.execute({ parameters: { radius: RADIUS }, powerId: "volcano", type: "usePower", x: RADIUS * 1.5, z: 0 });
    simulation.execute({
      parameters: { radius: RADIUS },
      powerId: "volcano",
      type: "usePower",
      x: -RADIUS * 2.5,
      z: 0,
    });

    expect(simulation.volcanoes.all).toHaveLength(2);
    expect(simulation.takeNotices()).toEqual(["Another volcano is too close."]);
  });

  it("saves and loads in the middle of an eruption", () => {
    const simulation = erupt({ hasRiver: true });

    runFor(simulation, SWELL_SECONDS + 4);
    settle(simulation);

    const snapshot = snapshotOf(simulation);
    const loaded = createSimulation({ hasRiver: true });

    loaded.restore(structuredClone(snapshot));

    expect(onlyVolcano(loaded)).toEqual(onlyVolcano(simulation));

    runFor(simulation, 8);
    runFor(loaded, 8);

    expect([...onlyVolcano(loaded).lava.keys()]).toEqual([...onlyVolcano(simulation).lava.keys()]);
    expect(onlyVolcano(loaded).age).toBeCloseTo(onlyVolcano(simulation).age, 5);
  });

  it("loads saves made before volcanoes existed", () => {
    const simulation = erupt({ hasRiver: false });

    runFor(simulation, SWELL_SECONDS + 2);
    settle(simulation);

    const { volcanoes: _volcanoes, ...olderSnapshot } = snapshotOf(simulation);

    expect(simulation.volcanoes.all).toHaveLength(1);

    simulation.restore(structuredClone(olderSnapshot));

    expect(simulation.volcanoes.all).toHaveLength(0);
  });
});
