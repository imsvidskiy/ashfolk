import { mirroredWater } from "../world/water.ts";
import type { InitialWorld, PackedRows, SimulationFrame, TribeSummary } from "./frame.ts";
import {
  allRows,
  describeBuilding,
  describeTribe,
  describeWeather,
  packAnimals,
  packBurningCells,
  packChangedSurfaceRows,
  packGroundRows,
  packLava,
  packPeople,
  packRegion,
  packSurfaceRows,
} from "./frame-packing.ts";
import { type Inspection, inspect } from "./inspection.ts";
import type { Environment } from "./nature/environment.ts";
import type { Simulation } from "./simulation.ts";

export class FrameBuilder {
  readonly #simulation: Simulation;
  #sentSurface: Uint8Array | null = null;

  constructor(simulation: Simulation) {
    this.#simulation = simulation;
  }

  build(): SimulationFrame {
    const simulation = this.#simulation;
    const { buildings, environment, fauna, fire, services, society, volcanoes, world } = simulation;

    const burningCells = Int32Array.from(fire.burningCells());
    const tribes = this.#tribes();

    return {
      animalCount: fauna.animals.length,
      animals: packAnimals(fauna.animals),
      buildings: buildings.all.map((building) => {
        return describeBuilding(building, world);
      }),
      burningCells,
      burningIntensity: packBurningCells(world, burningCells),
      calendar: simulation.calendar.view(),
      chronicle: simulation.chronicle.takeEntries(),
      effects: simulation.effects.takeEffects(),
      groundRows: packGroundRows(world, world.groundChanges.takeRuns()),
      hasRealTimeWork: simulation.hasRealTimeWork,
      heightPatch: packRegion(world, world.terrain.height, world.heightChanges.takeRegion()),
      held: simulation.held,
      inspection: this.#inspection(tribes, environment),
      isBusy: simulation.isBusy,
      isPaused: simulation.isPaused,
      lava: packLava(volcanoes.takeLava()),
      notices: simulation.takeNotices(),
      people: packPeople(society.people, (id) => {
        return society.findTribe(id);
      }),
      personCount: society.people.length,
      rivalry: simulation.rivalry.view(simulation.calendar.day),
      rules: simulation.rules,
      secondsSinceTick: simulation.secondsSinceTick,
      speed: simulation.speed,
      surfaceRows: this.#changedSurfaceRows(),
      tick: simulation.tick,
      tribes,
      vegetation: world.vegetation.takeChanges(),
      volcanoes: volcanoes.views(services),
      water: simulation.takeWaterUpdate(),
      waterLevels: packRegion(world, world.terrain.waterSurface, world.waterLevelChanges.takeRegion()),
      weather: describeWeather(simulation.weather, environment),
    };
  }

  initialWorld(): InitialWorld {
    const { world } = this.#simulation;
    const { terrain } = world;

    world.surfaceChanges.takeRuns();
    world.groundChanges.takeRuns();
    world.heightChanges.takeRegion();
    world.waterLevelChanges.takeRegion();
    world.vegetation.discardChanges();

    const rows = allRows(world);
    const [surface] = packSurfaceRows(world, rows);
    const [ground] = packGroundRows(world, rows);

    this.#sentSurface = surface.data.slice();

    return {
      crossings: world.crossings,
      dimensions: { cellSize: world.grid.cellSize, cellsPerSide: world.grid.cellsPerSide },
      frame: this.build(),
      ground: ground.data,
      monuments: world.monuments,
      seed: world.seed,
      shape: world.shape,
      surface: surface.data,
      terrain: {
        baseTemperature: Float32Array.from(terrain.baseTemperature),
        biome: Uint8Array.from(terrain.biome),
        coastDistance: Float32Array.from(terrain.coastDistance),
        ground: Uint8Array.from(terrain.ground),
        height: Float32Array.from(terrain.height),
        moisture: Float32Array.from(terrain.moisture),
        riverStrength: Uint8Array.from(terrain.riverStrength),
        variation: Float32Array.from(terrain.variation),
        waterSurface: Float32Array.from(terrain.waterSurface),
      },
      vegetation: world.vegetation.exportBuffers(),
      water: mirroredWater(world.water),
    };
  }

  #changedSurfaceRows(): PackedRows[] {
    const { world } = this.#simulation;

    const runs = world.surfaceChanges.takeRuns();

    if (this.#sentSurface === null) {
      return packSurfaceRows(world, runs);
    }

    return packChangedSurfaceRows(world, runs, this.#sentSurface);
  }

  #inspection(tribes: readonly TribeSummary[], environment: Environment): Inspection | null {
    const simulation = this.#simulation;
    const { selection } = simulation;

    if (selection === null) {
      return null;
    }

    return inspect(selection, {
      buildings: simulation.buildings,
      environment,
      fauna: simulation.fauna,
      society: simulation.society,
      tribes,
      world: simulation.world,
    });
  }

  #tribes(): TribeSummary[] {
    const { buildings, society, world } = this.#simulation;

    const tribes = society.tribes();
    const members = society.membersOfEach(tribes);

    return tribes.map((tribe, position) => {
      return describeTribe(tribe, members[position], { buildings, world });
    });
  }
}
