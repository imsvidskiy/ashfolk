import type { BuildingKind } from "../../content/buildings.ts";
import type { DepositKind } from "../../content/deposits.ts";
import type { TechnologyId } from "../../content/technologies.ts";
import { DEFAULT_WORLD_RULES, type WorldRules } from "../../content/world-rules.ts";
import { createRandom, type RandomSource } from "../../shared/random.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { HazardMap } from "../agents/hazards.ts";
import { NavigationGrid } from "../agents/navigation.ts";
import { isDryFooting } from "../agents/walkable-ground.ts";
import { Chronicle } from "../chronicle.ts";
import { EffectLog } from "../effects.ts";
import { FaunaSystem } from "../fauna/fauna.ts";
import { IdentifierSource } from "../identifiers.ts";
import { Calendar } from "../nature/calendar.ts";
import { describeEnvironment } from "../nature/environment.ts";
import { FireSystem } from "../nature/fire.ts";
import { WeatherSystem } from "../nature/weather.ts";
import { type Building, type BuildingPlacement, BuildingSystem } from "../society/buildings.ts";
import type { Job } from "../society/jobs/job.ts";
import type { Person } from "../society/person.ts";
import { RivalrySystem } from "../society/rivalry/rivalry-system.ts";
import { SocietySystem } from "../society/society.ts";
import type { PersonTick, SocietyContext } from "../society/society-context.ts";
import type { Tribe } from "../society/tribe.ts";
import { TICK_SECONDS } from "../tick.ts";
import { WorldState } from "../world/world-state.ts";
import { createVegetatedWorld, depositAround, type TestWorldOptions } from "./test-world.ts";

export const MORNING = 0.3;
export const STRIP_HALF_WIDTH = 10;
export const THROUGH_MINING: readonly TechnologyId[] = [
  "fire",
  "shelter",
  "spear",
  "fishing",
  "storage",
  "archery",
  "huts",
  "pottery",
  "farming",
  "totem",
  "weaving",
  "orchards",
  "mining",
];

const SEED = 3;
const DIMENSIONS = { cellSize: 10, cellsPerSide: 96 };

interface SocietyHarnessOptions {
  day: number;
  isFaunaAwake: boolean;
  rules: WorldRules;
  world: Partial<TestWorldOptions>;
}

type StructurePlacement = Omit<BuildingPlacement, "rotation" | "tribeId">;

export function settle(harness: SocietyHarness, people: number): Tribe {
  const tribe = harness.spawnTribe(people);

  if (tribe === null) {
    throw new Error("Expected the tribe to settle");
  }

  return tribe;
}

export function tickFor(harness: SocietyHarness, person: Person, tribe: Tribe): PersonTick {
  return { context: harness.context, person, seconds: TICK_SECONDS, tribe };
}

export function firstMemberTick(harness: SocietyHarness, tribe: Tribe): PersonTick {
  const [person] = harness.society.membersOf(tribe);

  return tickFor(harness, person, tribe);
}

export function runToCompletion(job: Job, tick: PersonTick, limitSeconds: number): boolean {
  let current: Job | null = job;

  for (let elapsed = 0; elapsed < limitSeconds; elapsed += tick.seconds) {
    current = current.update(tick);

    if (current === null) {
      return true;
    }
  }

  return false;
}

export function teach(tribe: Tribe, technologies: readonly TechnologyId[], eraIndex: number | null = null): Tribe {
  for (const technology of technologies) {
    tribe.technologies.add(technology);
  }

  if (eraIndex !== null) {
    tribe.eraIndex = eraIndex;
  }

  return tribe;
}

export function addShelter(harness: SocietyHarness, tribe: Tribe, kind: BuildingKind, x: number, z: number): Building {
  const shelter = harness.buildings.add({ kind, rotation: 0, tribeId: tribe.id, x, z }, harness.random);

  tribe.buildings.shelterIds.push(shelter.id);

  return shelter;
}

export function addStructure(harness: SocietyHarness, tribe: Tribe, placement: StructurePlacement): Building {
  const structure = harness.buildings.add({ ...placement, rotation: 0, tribeId: tribe.id }, harness.random);

  structure.progress = 1;
  tribe.buildings.structureIds.push(structure.id);

  return structure;
}

export function createMiningHarness(kind: DepositKind = "copper"): SocietyHarness {
  const grid = new WorldGrid(DIMENSIONS);

  return new SocietyHarness({
    day: MORNING,
    world: { deposits: [depositAround(grid, kind, 160, 40)], dimensions: DIMENSIONS },
  });
}

export function moveToSeason(harness: SocietyHarness, season: number): void {
  harness.calendar.setSeason(season);
  harness.context.environment = describeEnvironment(harness.calendar, harness.weather);
}

export function createStripHarness(): SocietyHarness {
  const harness = new SocietyHarness({ day: MORNING });

  const { grid, terrain } = harness.world;

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (Math.abs(grid.cellCenterX(cell)) > STRIP_HALF_WIDTH) {
      terrain.waterSurface[cell] = terrain.height[cell] + 2;
    }
  }

  harness.navigation.rebuild();

  return harness;
}

export function isOnDryLand(harness: SocietyHarness, person: Person): boolean {
  return harness.world.isWalkableAt(person.mover.x, person.mover.z);
}

export function isOnDryFooting(harness: SocietyHarness, x: number, z: number): boolean {
  return isDryFooting(harness.world, harness.world.grid.cellAt(x, z));
}

export class SocietyHarness {
  readonly buildings: BuildingSystem;
  readonly calendar = new Calendar();
  readonly chronicle = new Chronicle();
  readonly context: SocietyContext;
  readonly effects = new EffectLog();
  readonly fauna: FaunaSystem;
  readonly fire: FireSystem;
  readonly hazards: HazardMap;
  readonly identifiers = new IdentifierSource();
  readonly isFaunaAwake: boolean;
  readonly navigation: NavigationGrid;
  readonly random: RandomSource;
  readonly rivalry: RivalrySystem;
  readonly society: SocietySystem;
  readonly weather = new WeatherSystem();
  readonly world: WorldState;

  constructor(options: Partial<SocietyHarnessOptions> = {}) {
    const settings: SocietyHarnessOptions = {
      day: 0.36,
      isFaunaAwake: false,
      rules: DEFAULT_WORLD_RULES,
      world: { dimensions: DIMENSIONS },
      ...options,
    };

    this.isFaunaAwake = settings.isFaunaAwake;
    this.world = new WorldState(createVegetatedWorld(settings.world, SEED));
    this.calendar.day = settings.day;
    this.random = createRandom(SEED);
    this.navigation = new NavigationGrid(this.world);
    this.fire = new FireSystem(this.world);
    this.hazards = new HazardMap(this.world, this.fire);
    this.fauna = new FaunaSystem(this.world, this.navigation, this.identifiers);
    this.buildings = new BuildingSystem(this.world, this.identifiers);
    this.society = new SocietySystem({
      buildings: this.buildings,
      chronicle: this.chronicle,
      identifiers: this.identifiers,
      world: this.world,
    });
    this.rivalry = new RivalrySystem({ chronicle: this.chronicle, effects: this.effects, seed: SEED });
    this.weather.setKind("clear");
    this.context = {
      buildings: this.buildings,
      chronicle: this.chronicle,
      effects: this.effects,
      environment: describeEnvironment(this.calendar, this.weather),
      fauna: this.fauna,
      fire: this.fire,
      hazards: this.hazards,
      identifiers: this.identifiers,
      navigation: this.navigation,
      people: this.society,
      random: this.random,
      rivalry: this.rivalry,
      rules: settings.rules,
      world: this.world,
    };
  }

  run(seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += TICK_SECONDS) {
      this.step();
    }
  }

  step(): void {
    const days = this.calendar.advance(TICK_SECONDS);

    this.context.environment = describeEnvironment(this.calendar, this.weather);
    this.chronicle.day = this.calendar.day;
    this.fire.update(
      TICK_SECONDS,
      { airTemperatureOffset: 0, day: this.calendar.day, drought: 0.5 },
      this.context.rules,
      this.random
    );
    this.buildings.update({
      days,
      fire: this.fire,
      random: this.random,
      seconds: TICK_SECONDS,
      weather: { drought: 0.5, precipitation: 0, windSpeed: 10 },
    });
    this.society.update(TICK_SECONDS, days, this.context);
    this.rivalry.update(TICK_SECONDS, days, this.context);
    this.#wakeFauna(days);
    this.hazards.update(TICK_SECONDS);
  }

  spawnTribe(people: number): Tribe | null {
    return this.society.spawnTribe({
      canSettleRoughGround: false,
      context: this.context,
      people,
      x: 0,
      z: 0,
    });
  }

  #wakeFauna(days: number): void {
    if (!this.isFaunaAwake) {
      return;
    }

    this.fauna.update({
      days,
      hours: this.calendar.hours,
      random: this.random,
      rules: this.context.rules,
      season: this.calendar.season,
      seconds: TICK_SECONDS,
      threats: {
        dangerNear: (x, z, radius) => {
          return this.hazards.dangerNear(x, z, radius);
        },
        hunterNear: () => {
          return null;
        },
        people: this.rivalry.senses(this.context),
      },
    });
  }
}
