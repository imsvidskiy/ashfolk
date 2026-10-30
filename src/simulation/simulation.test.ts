import { describe, expect, it, it as test, vi } from "vitest";
import { isLivingTreeSpecies } from "../content/plants.ts";
import type { TechnologyId } from "../content/technologies.ts";
import { DEFAULT_GENERATION_OPTIONS } from "../generation/generation-options.ts";
import { generateWorld } from "../generation/world-generator.ts";
import { buffersWithin } from "../shared/buffers.ts";
import { ignore } from "../shared/ignore.ts";
import type { IslandShapeKind } from "../world/island-shape.ts";
import { islandDimensions } from "../world/island-size.ts";
import { NO_PLANT } from "../world/vegetation-store.ts";
import { isHopping } from "./agents/hops.ts";
import { setDestination } from "./agents/movement.ts";
import { Simulation, type SimulationSnapshot } from "./simulation.ts";
import { takeUpJob } from "./society/decisions.ts";
import { CraftJob } from "./society/jobs/craft-job.ts";
import { personFoe } from "./society/rivalry/foes.ts";
import { RaidJob } from "./society/rivalry/raid-job.ts";
import type { CraftOrder } from "./society/workshops.ts";
import { createCalmSimulation, generateSimulation, snapshotOf } from "./testing/test-simulation.ts";
import { floodCells } from "./testing/test-world.ts";
import { TICK_SECONDS } from "./tick.ts";

const ADVANCED: readonly TechnologyId[] = [
  "fire",
  "shelter",
  "spear",
  "storage",
  "archery",
  "huts",
  "pottery",
  "farming",
];
const SETTLING_SECONDS = 12;
const RUN_SECONDS = 600;
const LONGEST_SPELL_IN_WATER = 5;
const SETTLERS_BY_CROSSINGS = 2;
const FLOOD_RADIUS = 45;
const FLOOD_DEPTH = 1.6;
const SECONDS_TO_SWIM_OUT = 75;
const RAID_PROVISIONS = 200;
const TICKS_BETWEEN_COMPARISONS = 10;
const COMPARISONS = 40;
const ARROWS_IN_FLIGHT = 8;
const SETTLING_STEP = 0.25;
const ROUGH_STARTS: readonly (readonly [IslandShapeKind, number])[] = [
  ["round", 3],
  ["round", 9],
  ["square", 1],
  ["square", 21],
];
const CAMP_SURROUNDINGS = 80;
const CAMP_WOODS = 100;
const RAID_TICKS_AFTER_LOAD = 40;
const RAIDER_HOMECOMING_TICKS = 2000;

interface Walker {
  readonly id: number;
  readonly isHopping: boolean;
  readonly x: number;
  readonly z: number;
}

function meanSlopeAround(simulation: Simulation, x: number, z: number): number {
  const { world } = simulation;

  const land = world.grid.cellsInRadius(x, z, CAMP_SURROUNDINGS).filter((cell) => {
    return !world.isWater(cell);
  });

  return (
    land.reduce((sum, cell) => {
      return sum + world.slope(cell);
    }, 0) / land.length
  );
}

function treesAround(simulation: Simulation, x: number, z: number): number {
  const { grid, vegetation } = simulation.world;

  let trees = 0;

  for (const cell of grid.cellsInRadius(x, z, CAMP_WOODS)) {
    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      trees += vegetation.isAlive(plant) && isLivingTreeSpecies(vegetation.species[plant]) ? 1 : 0;
    }
  }

  return trees;
}

function advanceFor(simulation: Simulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    simulation.advance(0.05);
  }
}

function settleLand(simulation: Simulation): void {
  for (let elapsed = 0; elapsed < SETTLING_SECONDS && simulation.isBusy; elapsed += 0.25) {
    simulation.advance(0.25);
  }
}

function grownSimulation(): Simulation {
  const simulation = generateSimulation();

  simulation.populate();
  simulation.execute({ speed: 16, type: "setSpeed" });
  simulation.execute({ type: "setWeather", weather: "rain" });

  for (const tribe of simulation.society.tribes()) {
    tribe.technologies.add("fire");
    tribe.technologies.add("shelter");
  }

  simulation.runTicks(300);
  simulation.execute({ parameters: { radius: 60 }, powerId: "raise", type: "usePower", x: 120, z: -80 });
  simulation.execute({ parameters: { radius: 30 }, powerId: "fire", type: "usePower", x: -300, z: -200 });
  simulation.execute({ parameters: { radius: 80 }, powerId: "volcano", type: "usePower", x: 300, z: 300 });
  settleLand(simulation);
  simulation.runTicks(300);
  settleLand(simulation);

  return simulation;
}

function raidingSimulation(): Simulation {
  const simulation = grownSimulation();
  const [attacker, defender] = simulation.society.tribes();

  for (const person of simulation.society.people) {
    person.health = 1;
    person.hunger = 0;
  }

  attacker.stock.meat = RAID_PROVISIONS;

  if (simulation.rivalry.launchRaid(attacker, defender, simulation.services) === null) {
    throw new Error("The test tribes could not raid");
  }

  simulation.runTicks(200);

  return simulation;
}

function raidsOf(simulation: Simulation): number[] {
  return simulation.rivalry.raids.map((raid) => {
    return raid.id;
  });
}

function raidersOf(simulation: Simulation, raidId: number): number[] {
  return simulation.society.people
    .filter((person) => {
      return person.job instanceof RaidJob && person.job.raidId === raidId;
    })
    .map((person) => {
      return person.id;
    });
}

function looseArrows(simulation: Simulation): void {
  const [shooter, target] = simulation.society.people.filter((person) => {
    return person.isAlive;
  });

  for (let arrow = 0; arrow < ARROWS_IN_FLIGHT; arrow += 1) {
    simulation.rivalry.loose(shooter, { kind: "bow", material: "stone" }, personFoe(target));
  }
}

function restored(snapshot: SimulationSnapshot): Simulation {
  const simulation = generateSimulation();

  simulation.restore(structuredClone(snapshot));

  return simulation;
}

function plantsByCell(simulation: Simulation): number[][] {
  const { grid, vegetation } = simulation.world;

  return Array.from({ length: grid.cellCount }, (_, cell) => {
    return vegetation.plantsInCell(cell);
  });
}

function populatedIsland(shape: IslandShapeKind): Simulation {
  const simulation = new Simulation(generateWorld(7, { ...DEFAULT_GENERATION_OPTIONS, shape }));

  simulation.populate();

  for (const crossing of simulation.world.crossings.slice(0, SETTLERS_BY_CROSSINGS)) {
    simulation.execute({
      parameters: {},
      powerId: "tribe",
      type: "usePower",
      x: crossing.startX + (crossing.startX - crossing.endX),
      z: crossing.startZ + (crossing.startZ - crossing.endZ),
    });
  }

  return simulation;
}

function walkers(simulation: Simulation): Walker[] {
  const people = simulation.society.people.filter((person) => {
    return person.isAlive;
  });
  const animals = simulation.fauna.animals.filter((animal) => {
    return animal.isAlive;
  });

  return [...people, ...animals].map(({ id, mover }) => {
    return { id, isHopping: isHopping(mover), x: mover.x, z: mover.z };
  });
}

function isInOpenWater(simulation: Simulation, walker: Walker): boolean {
  const { world } = simulation;

  return world.isWaterAt(walker.x, walker.z) && world.crossingAt(walker.x, walker.z) === null && !walker.isHopping;
}

function longestSpellInWater(simulation: Simulation, seconds: number): number {
  const wetSince = new Map<number, number>();

  let longest = 0;

  for (let tick = 0; tick < seconds / TICK_SECONDS; tick += 1) {
    simulation.step();

    for (const walker of walkers(simulation)) {
      if (!isInOpenWater(simulation, walker)) {
        wetSince.delete(walker.id);

        continue;
      }

      const since = wetSince.get(walker.id);

      if (since === undefined) {
        wetSince.set(walker.id, tick);

        continue;
      }

      longest = Math.max(longest, (tick - since) * TICK_SECONDS);
    }
  }

  return longest;
}

describe("time", () => {
  it("runs fixed ticks in proportion to the speed", () => {
    const normal = createCalmSimulation();
    const fast = createCalmSimulation();

    fast.execute({ speed: 4, type: "setSpeed" });
    advanceFor(normal, 2);
    advanceFor(fast, 2);

    expect(normal.tick).toBe(Math.round(2 / TICK_SECONDS));
    expect(fast.tick).toBe(normal.tick * 4);
  });

  it("stands still while paused", () => {
    const simulation = createCalmSimulation();

    simulation.execute({ isPaused: true, type: "setPaused" });
    advanceFor(simulation, 1);

    expect(simulation.tick).toBe(0);
  });

  it("sets the time of day and the season", () => {
    const simulation = createCalmSimulation();

    simulation.execute({ hours: 18, type: "setHours" });
    simulation.execute({ season: 3, type: "setSeason" });

    expect(simulation.calendar.hours).toBeCloseTo(18);
    expect(simulation.calendar.view().seasonName).toBe("Winter");
  });
});

describe("commands", () => {
  it("ignores and reports malformed commands", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(ignore);
    const simulation = createCalmSimulation();

    simulation.execute({ speed: 900, type: "setSpeed" });
    simulation.execute({ type: "launchRocket" });

    expect(simulation.speed).toBe(1);
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("switches between chosen and automatic weather", () => {
    const simulation = createCalmSimulation();

    simulation.execute({ type: "setWeather", weather: "storm" });

    expect(simulation.weather.state.kind).toBe("storm");
    expect(simulation.weather.state.isAutomatic).toBe(false);

    simulation.execute({ type: "setWeather", weather: "automatic" });

    expect(simulation.weather.state.isAutomatic).toBe(true);
  });

  it("validates and applies new world rules", () => {
    const simulation = createCalmSimulation();

    simulation.execute({ rules: { fire: { spreadSpeed: 2 } }, type: "setWorldRules" });

    expect(simulation.rules.fire.spreadSpeed).toBe(2);
    expect(simulation.rules.water.drying).toBe(1);
  });
});

describe("powers", () => {
  it("lights a fire where the power is used", () => {
    const simulation = createCalmSimulation();

    simulation.execute({ parameters: { radius: 20 }, powerId: "fire", type: "usePower", x: 0, z: 0 });

    expect(simulation.fire.burningCount).toBeGreaterThan(5);
  });

  it("keeps applying a brush while the stroke lasts", () => {
    const simulation = createCalmSimulation();

    const cell = simulation.world.grid.cellAt(0, 0);

    simulation.execute({ parameters: { radius: 60 }, powerId: "raise", type: "beginStroke", x: 0, z: 0 });
    advanceFor(simulation, 1);

    const heightAfterOneSecond = simulation.world.terrain.height[cell];

    advanceFor(simulation, 1);
    simulation.execute({ type: "endStroke" });
    advanceFor(simulation, 1);

    expect(heightAfterOneSecond).toBeGreaterThan(110);
    expect(simulation.world.terrain.height[cell] - heightAfterOneSecond).toBeCloseTo(heightAfterOneSecond - 100, -1);
  });

  it("reports why a power could not be used", () => {
    const simulation = createCalmSimulation();

    simulation.world.terrain.waterSurface.fill(200);
    simulation.execute({ parameters: {}, powerId: "tribe", type: "usePower", x: 0, z: 0 });

    expect(simulation.advance(0).notices).toEqual([expect.stringContaining("dry land")]);
  });

  it("drops a meteor after its fall time", () => {
    const simulation = createCalmSimulation();

    simulation.execute({ parameters: { fallTime: 1 }, powerId: "meteor", type: "usePower", x: 0, z: 0 });

    const launch = simulation.advance(0.2);

    const later = Array.from({ length: 20 }, () => {
      return simulation.advance(0.05);
    });

    const laterEffects = later.flatMap((frame) => {
      return frame.effects.map((effect) => {
        return effect.kind;
      });
    });

    expect(
      launch.effects.map((effect) => {
        return effect.kind;
      })
    ).toEqual(["meteor"]);
    expect(laterEffects).toContain("explosion");
    expect(simulation.world.terrain.height[simulation.world.grid.cellAt(0, 0)]).toBeLessThan(80);
  });
});

describe("crowding", () => {
  it("leaves the body of someone who died while walking where they fell", () => {
    const simulation = createCalmSimulation();

    simulation.populate();

    const [fallen, passing] = simulation.society.people;
    const { mover } = fallen;

    setDestination(mover, { x: -mover.x, z: -mover.z }, simulation.navigation);
    simulation.society.kill(fallen, "beast");

    const { x, z } = mover;

    for (let tick = 0; tick < 6; tick += 1) {
      passing.mover.x = x + 0.2;
      passing.mover.z = z + 0.1;
      simulation.runTicks(1);
    }

    expect(mover.x).toBe(x);
    expect(mover.z).toBe(z);
  });
});

describe("determinism", () => {
  it("replays the same world the same way", () => {
    const first = createCalmSimulation();
    const second = createCalmSimulation();

    first.populate();
    second.populate();
    first.runTicks(300);
    second.runTicks(300);

    expect(first.advance(0).people).toEqual(second.advance(0).people);
  });

  it("replays the economy of advanced tribes the same way", () => {
    const runs = [createCalmSimulation(), createCalmSimulation()].map((simulation) => {
      simulation.populate();

      for (const tribe of simulation.society.tribes()) {
        for (const technology of ADVANCED) {
          tribe.technologies.add(technology);
        }

        tribe.stock.wood = 80;
        tribe.stock.stone = 40;
        tribe.stock.clay = 20;
      }

      simulation.runTicks(4000);

      return simulation.advance(0);
    });

    const [first, second] = runs;

    expect(first.people).toEqual(second.people);
    expect(first.tribes).toEqual(second.tribes);
    expect(first.buildings).toEqual(second.buildings);
    expect(first.buildings.length).toBeGreaterThan(2);
  });
});

describe("world snapshots", () => {
  it("restores a grown world into a fresh island from the same seed", () => {
    const original = grownSimulation();
    const snapshot = snapshotOf(original);

    const copy = restored(snapshot);

    expect(original.society.population).toBeGreaterThan(0);
    expect(original.buildings.all.length).toBeGreaterThan(0);
    expect(original.fire.burningCount).toBeGreaterThan(0);
    expect(original.world.heightVersion).toBeGreaterThan(0);
    expect(snapshotOf(copy)).toStrictEqual(snapshot);
  });

  it("keeps simulating as the saving world does once it drops what a save leaves out", { timeout: 60_000 }, () => {
    const original = raidingSimulation();

    original.execute({ speed: 1, type: "setSpeed" });
    looseArrows(original);

    const snapshot = snapshotOf(original);

    original.restore(structuredClone(snapshot));

    const copy = restored(snapshot);

    expect(snapshot.volcanoes).toHaveLength(1);
    expect(snapshot.rivalry.raids).toHaveLength(1);
    expect(snapshot.weather.kind).toBe("rain");
    expect(snapshot.fauna.animals.length).toBeGreaterThan(0);
    expect(snapshot.chronicle.entries.length).toBeGreaterThan(0);
    expect(plantsByCell(copy)).toStrictEqual(plantsByCell(original));
    expect(copy.initialWorld()).toStrictEqual(original.initialWorld());

    for (let comparison = 0; comparison < COMPARISONS; comparison += 1) {
      original.runTicks(TICKS_BETWEEN_COMPARISONS);
      copy.runTicks(TICKS_BETWEEN_COMPARISONS);

      do {
        expect(copy.advance(SETTLING_STEP)).toStrictEqual(original.advance(SETTLING_STEP));
      } while (original.isBusy);

      expect(snapshotOf(copy)).toStrictEqual(snapshotOf(original));
    }
  });

  it("keeps a raid going after the world loads", { timeout: 60_000 }, () => {
    const original = raidingSimulation();
    const [raid] = original.rivalry.raids;

    const copy = restored(snapshotOf(original));

    original.runTicks(RAID_TICKS_AFTER_LOAD);
    copy.runTicks(RAID_TICKS_AFTER_LOAD);

    expect(raidsOf(copy)).toEqual([raid.id]);
    expect(raidsOf(copy)).toEqual(raidsOf(original));
    expect(raidersOf(copy, raid.id)).toEqual(raidersOf(original, raid.id));
    expect(raidersOf(copy, raid.id).length).toBeGreaterThan(0);
  });

  it("brings a raider's plunder home after the world loads", { timeout: 60_000 }, () => {
    const snapshot = snapshotOf(raidingSimulation());
    const { raiders } = snapshot.rivalry;
    const [raider, ...others] = raiders === undefined ? [] : raiders;

    if (raider === undefined) {
      throw new Error("Expected a raider in the save");
    }

    const homeward = { ...raider, leg: "homeward" as const, loot: { ...raider.loot, bronze: 3 }, rations: 1 };

    const copy = restored({ ...snapshot, rivalry: { ...snapshot.rivalry, raiders: [homeward, ...others] } });

    expect(snapshotOf(copy).rivalry.raiders).toContainEqual(homeward);

    const person = copy.society.findPerson(raider.personId);
    const tribe = person === null ? null : copy.society.findTribe(person.tribeId);

    if (person === null || tribe === null) {
      throw new Error("Expected the raider and its tribe after loading");
    }

    const { bronze } = tribe.stock;

    for (let tick = 0; tick < RAIDER_HOMECOMING_TICKS && person.job instanceof RaidJob; tick += 1) {
      copy.runTicks(1);
    }

    expect(person.job).not.toBeInstanceOf(RaidJob);
    expect(tribe.stock.bronze).toBe(bronze + 3);
  });

  it("ends a raid loaded from a save that kept no raiders", { timeout: 60_000 }, () => {
    const snapshot = snapshotOf(raidingSimulation());
    const { raiders, ...olderRivalry } = snapshot.rivalry;

    const copy = restored({ ...snapshot, rivalry: olderRivalry });

    expect(raiders?.length).toBeGreaterThan(0);

    copy.runTicks(1);

    expect(copy.rivalry.raids).toHaveLength(0);
  });

  it("gives back the inputs of a craft in progress", () => {
    const simulation = generateSimulation();

    simulation.populate();

    const [tribe] = simulation.society.tribes();
    const [crafter] = simulation.society.membersOf(tribe);
    const order: CraftOrder = {
      inputs: { wood: 4 },
      material: null,
      outputs: { spears: 1 },
      recipe: "spears",
      station: null,
    };

    tribe.stock.wood = 10;
    takeUpJob(crafter, tribe, simulation.services, (tick) => {
      return new CraftJob(tick, order);
    });

    const saved = snapshotOf(simulation).society.tribes.find((candidate) => {
      return candidate.id === tribe.id;
    });

    expect(tribe.stock.wood).toBe(6);
    expect(saved?.stock.wood).toBe(10);
  });

  it("leaves the running world whole when the save's buffers move to another thread", () => {
    const original = grownSimulation();
    const snapshot = snapshotOf(original);

    const kept = structuredClone(snapshot);

    structuredClone(snapshot, { transfer: buffersWithin(snapshot) });

    expect(snapshotOf(original)).toStrictEqual(kept);
  });

  it("sends the restored world to the renderer in full", () => {
    const original = grownSimulation();

    const copy = restored(snapshotOf(original));

    const initial = copy.initialWorld();

    expect(initial.terrain.height).toEqual(original.world.terrain.height);
    expect(initial.terrain.waterSurface).toEqual(original.world.terrain.waterSurface);
    expect(initial.vegetation.count).toBe(original.world.vegetation.count);
    expect(initial.frame.buildings).toHaveLength(original.buildings.all.length);
    expect(initial.frame.personCount).toBe(original.society.people.length);
    expect(
      initial.frame.tribes.map((tribe) => {
        return tribe.id;
      })
    ).toEqual(
      original.society.tribes().map((tribe) => {
        return tribe.id;
      })
    );
  });

  it("drops jobs and claims that cannot be saved", () => {
    const original = grownSimulation();

    const snapshot = snapshotOf(original);

    expect(
      snapshot.society.people.every((person) => {
        return person.job === null;
      })
    ).toBe(true);
    expect(
      snapshot.society.tribes.every((tribe) => {
        return tribe.claimedPlants.size === 0;
      })
    ).toBe(true);
  });

  it("refuses to save while the land is still settling", () => {
    const simulation = generateSimulation();

    simulation.execute({ parameters: { radius: 60 }, powerId: "raise", type: "usePower", x: 0, z: 0 });
    simulation.advance(0.05);

    expect(simulation.isBusy).toBe(true);
    expect(simulation.snapshot()).toBeNull();
  });
});

describe.each(["round", "square"] as const)("a long day on a %s island", (shape) => {
  test("keeps people and animals out of water and gets them out of a flood", { timeout: 180_000 }, () => {
    const simulation = populatedIsland(shape);

    expect(longestSpellInWater(simulation, RUN_SECONDS)).toBeLessThan(LONGEST_SPELL_IN_WATER);
    expect(simulation.society.population).toBeGreaterThan(14);

    const person = simulation.society.people.find((candidate) => {
      return candidate.isAlive;
    });

    if (person === undefined) {
      throw new Error("Expected someone on the island");
    }

    const { world } = simulation;

    floodCells(world, world.grid.cellsInRadius(person.mover.x, person.mover.z, FLOOD_RADIUS), FLOOD_DEPTH);
    simulation.navigation.rebuild();

    expect(
      walkers(simulation).some((walker) => {
        return isInOpenWater(simulation, walker);
      })
    ).toBe(true);

    simulation.runTicks(SECONDS_TO_SWIM_OUT / TICK_SECONDS);

    expect(
      walkers(simulation).filter((walker) => {
        return isInOpenWater(simulation, walker);
      })
    ).toEqual([]);
  });
});

describe("arrival on islands of every layout", () => {
  it("settles all the first tribes whatever the island's layout", { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const simulation = new Simulation(
        generateWorld(seed, { dimensions: { cellSize: 50, cellsPerSide: 128 }, erosionStrength: 1, shape: "round" })
      );

      simulation.populate();

      expect(simulation.society.tribes()).toHaveLength(3);
    }
  });
});

describe("first camps", () => {
  it.each(ROUGH_STARTS)("stand on open ground on a %s island of seed %i", { timeout: 60_000 }, (shape, seed) => {
    const simulation = new Simulation(generateWorld(seed, { ...DEFAULT_GENERATION_OPTIONS, shape }));

    simulation.populate();

    expect(simulation.society.tribes()).toHaveLength(3);

    for (const tribe of simulation.society.tribes()) {
      expect(meanSlopeAround(simulation, tribe.campX, tribe.campZ)).toBeLessThan(0.26);
      expect(treesAround(simulation, tribe.campX, tribe.campZ)).toBeLessThan(200);
    }
  });

  it("settle rough ground once a small round island of seed 13 runs out of open ground", { timeout: 60_000 }, () => {
    const simulation = new Simulation(
      generateWorld(13, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions("small"), shape: "round" })
    );

    simulation.populate();

    expect(simulation.society.tribes()).toHaveLength(3);
  });
});

describe.each(["small", "large"] as const)("a %s island", (size) => {
  test("settles three tribes", { timeout: 120_000 }, () => {
    const simulation = new Simulation(
      generateWorld(7, { ...DEFAULT_GENERATION_OPTIONS, dimensions: islandDimensions(size) })
    );

    simulation.populate();

    expect(simulation.society.tribes()).toHaveLength(3);
    expect(simulation.fauna.animals.length).toBeGreaterThan(0);
  });
});
