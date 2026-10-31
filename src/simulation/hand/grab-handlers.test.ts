import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { Simulation } from "../simulation.ts";
import { findTree } from "../society/jobs/chop-job.ts";
import { plantNear } from "../testing/test-jobs.ts";
import { firstMemberTick, MORNING, SocietyHarness, settle } from "../testing/test-society.ts";
import { createVegetatedWorld, floodCells } from "../testing/test-world.ts";
import { PLOT_GROUND } from "../world/world-state.ts";
import { GRAB_HANDLERS } from "./grab-handlers.ts";
import { GRABBABLE_KINDS, type GrabbableKind, type GrabTarget, isGrabbablePlant } from "./grab-target.ts";

const SHORE_X = 150;
const WATER: Waypoint = { x: 250, z: 0 };
const OPEN_GROUND: Waypoint = { x: -45, z: -45 };
const HELD_SECONDS = 5;
const COAST: Waypoint = { x: -45, z: 45 };
const STEEP: Waypoint = { x: 45, z: -45 };
const NEAR_COAST_DISTANCE = 2;
const STEEP_RISE_PER_METER = 4;
const PROVOCATIONS = 200;

interface Subject {
  readonly position: () => Waypoint;
  readonly target: GrabTarget;
}

type SubjectFinder = (simulation: Simulation) => Subject;

const SUBJECTS: Readonly<Record<GrabbableKind, SubjectFinder>> = {
  animal: (simulation) => {
    const [animal] = simulation.fauna.animals;

    if (animal === undefined) {
      throw new Error("The test world has no animals");
    }

    return {
      position() {
        return { x: animal.mover.x, z: animal.mover.z };
      },
      target: { id: animal.id, kind: "animal" },
    };
  },
  person: (simulation) => {
    const [person] = simulation.society.people;

    if (person === undefined) {
      throw new Error("The test world has no people");
    }

    return {
      position() {
        return { x: person.mover.x, z: person.mover.z };
      },
      target: { id: person.id, kind: "person" },
    };
  },
  plant: (simulation) => {
    const { vegetation } = simulation.world;

    const index = firstTree(simulation);

    return {
      position() {
        return { x: vegetation.x[index], z: vegetation.z[index] };
      },
      target: { id: index, kind: "plant" },
    };
  },
};

function firstTree(simulation: Simulation): number {
  const { vegetation } = simulation.world;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (vegetation.isAlive(plant) && isGrabbablePlant(vegetation.species[plant]) && vegetation.x[plant] < 0) {
      return plant;
    }
  }

  throw new Error("The test world has no trees");
}

function otherPlant(simulation: Simulation, excluded: number): number {
  const { vegetation } = simulation.world;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (plant !== excluded && vegetation.isAlive(plant)) {
      return plant;
    }
  }

  throw new Error("The test world has only one plant");
}

function clearSpot(simulation: Simulation, point: Waypoint): void {
  const { grid } = simulation.world;

  simulation.world.clearPlants(grid.cellAt(point.x, point.z), true);
}

function standsInWater(simulation: Simulation, subject: Subject): boolean {
  const { grid, vegetation } = simulation.world;
  const { id, kind } = subject.target;

  if (kind === "plant" && !vegetation.isAlive(id)) {
    return false;
  }

  const { x, z } = subject.position();

  return simulation.world.isWater(grid.cellAt(x, z));
}

function createSimulation(): Simulation {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 64 } }));

  const { grid } = simulation.world;

  const shore: number[] = [];

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (grid.cellCenterX(cell) > SHORE_X) {
      shore.push(cell);
    }
  }

  floodCells(simulation.world, shore, 2);
  simulation.world.clearPlants(grid.cellAt(OPEN_GROUND.x, OPEN_GROUND.z), true);
  simulation.weather.setKind("clear");
  simulation.society.spawnTribe({
    canSettleRoughGround: true,
    context: simulation.services,
    people: 3,
    x: -120,
    z: 60,
  });
  simulation.fauna.spawnHerd("deer", -120, -120, 2, simulation.random);

  return simulation;
}

function advanceFor(simulation: Simulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    simulation.advance(0.1);
  }
}

describe("grab handlers", () => {
  describe.each(GRABBABLE_KINDS)("a held %s", (kind) => {
    it("lifts, follows the pointer and is set down there", () => {
      const simulation = createSimulation();

      const subject = SUBJECTS[kind](simulation);

      simulation.execute({ target: subject.target, type: "grab" });
      simulation.execute({ type: "carry", ...OPEN_GROUND });

      expect(simulation.held).toEqual({ ...subject.target, isPlaceable: true, ...OPEN_GROUND });

      simulation.execute({ type: "drop" });

      expect(simulation.held).toBeNull();
      expect(subject.position()).toEqual(OPEN_GROUND);
    });

    it("refuses water and goes back where it was picked up", () => {
      const simulation = createSimulation();

      const subject = SUBJECTS[kind](simulation);
      const origin = subject.position();

      simulation.execute({ target: subject.target, type: "grab" });
      simulation.execute({ type: "carry", ...WATER });

      expect(simulation.held?.isPlaceable).toBe(false);

      simulation.execute({ type: "drop" });

      expect(subject.position()).toEqual(origin);
    });

    it("goes back where it was picked up when the grab is cancelled", () => {
      const simulation = createSimulation();

      const subject = SUBJECTS[kind](simulation);
      const origin = subject.position();

      simulation.execute({ target: subject.target, type: "grab" });
      simulation.execute({ type: "carry", ...OPEN_GROUND });
      simulation.execute({ type: "cancelGrab" });

      expect(simulation.held).toBeNull();
      expect(subject.position()).toEqual(origin);
    });

    it("goes to dry ground when the spot it was picked up from floods while it is held", () => {
      const simulation = createSimulation();

      const { grid } = simulation.world;

      const subject = SUBJECTS[kind](simulation);
      const origin = subject.position();

      simulation.execute({ target: subject.target, type: "grab" });
      floodCells(simulation.world, [grid.cellAt(origin.x, origin.z)], 2);
      simulation.execute({ type: "cancelGrab" });

      expect(standsInWater(simulation, subject)).toBe(false);
    });

    it("is never saved in the air", () => {
      const simulation = createSimulation();

      const subject = SUBJECTS[kind](simulation);

      simulation.execute({ target: subject.target, type: "grab" });

      expect(simulation.snapshot()).toBeNull();

      simulation.execute({ type: "drop" });

      expect(simulation.snapshot()).not.toBeNull();
    });
  });

  it("keeps people and animals still while they are held", () => {
    const simulation = createSimulation();

    const subjects = [SUBJECTS.person(simulation), SUBJECTS.animal(simulation)];

    for (const subject of subjects) {
      simulation.execute({ target: subject.target, type: "grab" });
      simulation.execute({ type: "carry", ...OPEN_GROUND });
      advanceFor(simulation, HELD_SECONDS);

      expect(subject.position()).toEqual(OPEN_GROUND);

      simulation.execute({ type: "drop" });
    }
  });

  it("drops the job of a person once they are set down", () => {
    const simulation = createSimulation();

    const [person] = simulation.society.people;

    advanceFor(simulation, 2);

    const subject = SUBJECTS.person(simulation);

    simulation.execute({ target: subject.target, type: "grab" });

    expect(person.job).toBeNull();

    simulation.execute({ type: "carry", ...OPEN_GROUND });
    simulation.execute({ type: "drop" });

    expect(person.mover.path).toEqual([]);

    advanceFor(simulation, 2);

    expect(subject.position()).not.toEqual(OPEN_GROUND);
  });

  it("takes a plant out of its cell while it is held and keeps its look when set down", () => {
    const simulation = createSimulation();

    const { grid, vegetation } = simulation.world;

    const subject = SUBJECTS.plant(simulation);
    const plant = subject.target.id;
    const origin = subject.position();
    const look = { height: vegetation.height[plant], seed: vegetation.seed[plant], species: vegetation.species[plant] };

    simulation.execute({ target: subject.target, type: "grab" });

    expect(vegetation.plantsInCell(grid.cellAt(origin.x, origin.z))).not.toContain(plant);

    simulation.execute({ type: "carry", ...OPEN_GROUND });
    simulation.execute({ type: "drop" });

    expect(vegetation.plantsInCell(grid.cellAt(OPEN_GROUND.x, OPEN_GROUND.z))).toEqual([plant]);
    expect({
      height: vegetation.height[plant],
      seed: vegetation.seed[plant],
      species: vegetation.species[plant],
    }).toEqual(look);
  });

  it("refuses to set a plant down in a cell another plant has taken", () => {
    const simulation = createSimulation();

    const { vegetation } = simulation.world;

    const subject = SUBJECTS.plant(simulation);
    const origin = subject.position();
    const taken = otherPlant(simulation, subject.target.id);

    simulation.execute({ target: subject.target, type: "grab" });
    simulation.execute({ type: "carry", x: vegetation.x[taken], z: vegetation.z[taken] });

    expect(simulation.held?.isPlaceable).toBe(false);

    simulation.execute({ type: "drop" });

    expect(subject.position()).toEqual(origin);
  });

  it("refuses to set a plant down too close to the coast", () => {
    const simulation = createSimulation();

    const { grid, terrain } = simulation.world;

    const subject = SUBJECTS.plant(simulation);
    const origin = subject.position();

    clearSpot(simulation, COAST);

    for (const cell of grid.cellsInRadius(COAST.x, COAST.z, grid.cellSize * 2)) {
      terrain.coastDistance[cell] = NEAR_COAST_DISTANCE;
    }

    simulation.execute({ target: subject.target, type: "grab" });
    simulation.execute({ type: "carry", ...COAST });

    expect(simulation.held?.isPlaceable).toBe(false);

    simulation.execute({ type: "drop" });

    expect(subject.position()).toEqual(origin);
  });

  it("refuses to set a plant down on a slope too steep for it", () => {
    const simulation = createSimulation();

    const { grid, terrain } = simulation.world;

    const subject = SUBJECTS.plant(simulation);
    const origin = subject.position();

    clearSpot(simulation, STEEP);

    for (const cell of grid.cellsInRadius(STEEP.x, STEEP.z, grid.cellSize * 2)) {
      terrain.height[cell] = 100 + (grid.cellCenterX(cell) - STEEP.x) * STEEP_RISE_PER_METER;
    }

    simulation.execute({ target: subject.target, type: "grab" });
    simulation.execute({ type: "carry", ...STEEP });

    expect(simulation.held?.isPlaceable).toBe(false);

    simulation.execute({ type: "drop" });

    expect(subject.position()).toEqual(origin);
  });

  it("puts a plant lifted from a tribe plot back on its spot", () => {
    const simulation = createSimulation();

    const { grid, occupancy, vegetation } = simulation.world;

    const subject = SUBJECTS.plant(simulation);
    const plant = subject.target.id;
    const origin = subject.position();
    const [tribe] = simulation.society.tribes();

    if (tribe === undefined) {
      throw new Error("The test world has no tribe");
    }

    const cell = grid.cellAt(origin.x, origin.z);
    const spot = { plant, plantedDay: 0, species: vegetation.species[plant], ...origin };

    occupancy[cell] = PLOT_GROUND;
    tribe.plots.push({ cells: [cell], kind: "woodlot", spots: [spot] });

    simulation.execute({ target: subject.target, type: "grab" });

    expect(spot.plant).toBe(NO_PLANT);

    simulation.execute({ type: "cancelGrab" });

    expect(vegetation.isAlive(plant)).toBe(true);
    expect(subject.position()).toEqual(origin);
    expect(vegetation.plantsInCell(cell)).toContain(plant);
    expect(spot.plant).toBe(plant);
  });

  it("does not put a plant back on a spot another plant took while it was held", () => {
    const simulation = createSimulation();

    const { grid, vegetation } = simulation.world;

    const subject = SUBJECTS.plant(simulation);
    const plant = subject.target.id;
    const origin = subject.position();

    simulation.execute({ target: subject.target, type: "grab" });

    const sapling = simulation.world.plant({
      bornDay: 0,
      height: 1,
      rotation: 0,
      seed: 0,
      species: vegetation.species[plant],
      ...origin,
    });

    simulation.execute({ type: "cancelGrab" });

    expect(vegetation.isAlive(plant)).toBe(false);
    expect(vegetation.plantsInCell(grid.cellAt(origin.x, origin.z))).toContain(sapling);
    expect(vegetation.plantsInCell(grid.cellAt(origin.x, origin.z))).not.toContain(plant);
  });

  it("takes a lifted plant away from the tribe that was working on it", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tribe = settle(harness, 1);
    const tick = firstMemberTick(harness, tribe);

    plantNear(tick, PlantSpecies.Oak, 16);
    tick.person.job = findTree(tick);

    const tree = tick.person.job?.claimedPlant;

    if (tree === undefined) {
      throw new Error("Expected a tree to chop");
    }

    tribe.plots.push({
      cells: [],
      kind: "woodlot",
      spots: [{ plant: tree, plantedDay: 0, species: PlantSpecies.Oak, x: 0, z: 0 }],
    });

    expect(tribe.claimedPlants.has(tree)).toBe(true);

    GRAB_HANDLERS.plant.lift(harness.context, tree);

    expect(tick.person.job).toBeNull();
    expect(tribe.claimedPlants.has(tree)).toBe(false);
    expect(
      tribe.plots.flatMap((plot) => {
        return plot.spots.map((spot) => {
          return spot.plant;
        });
      })
    ).toEqual([NO_PLANT]);
  });

  it("calms an animal that was charging once it is lifted", () => {
    const simulation = createSimulation();

    const herd = simulation.fauna.spawnHerd("mammoth", -60, -120, 1, simulation.random);
    const mammoth = herd === null ? null : simulation.fauna.findAnimal(herd.memberIds[0]);

    if (mammoth === null) {
      throw new Error("Expected a mammoth");
    }

    const assailant = { id: 1, x: mammoth.mover.x + 10, z: mammoth.mover.z };

    for (let provocation = 0; provocation < PROVOCATIONS && !simulation.fauna.isMenacing(mammoth); provocation += 1) {
      simulation.fauna.provoke(mammoth, assailant, simulation.services.rules);
    }

    expect(simulation.fauna.isMenacing(mammoth)).toBe(true);

    simulation.execute({ target: { id: mammoth.id, kind: "animal" }, type: "grab" });

    expect(simulation.fauna.isMenacing(mammoth)).toBe(false);
  });

  it("ignores things that cannot be lifted", () => {
    const simulation = createSimulation();

    simulation.execute({ target: { id: 999_999, kind: "person" }, type: "grab" });
    simulation.execute({ target: { id: 999_999, kind: "plant" }, type: "grab" });

    expect(simulation.held).toBeNull();
    expect(simulation.isBusy).toBe(false);
  });
});
