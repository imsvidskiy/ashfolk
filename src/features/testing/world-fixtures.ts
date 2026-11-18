import type { ResourceKind } from "../../content/resources.ts";
import { DEFAULT_WORLD_RULES } from "../../content/world-rules.ts";
import type { ChronicleEntry } from "../../simulation/chronicle.ts";
import type { SimulationFrame, StockView, TribeSummary, WeatherView } from "../../simulation/frame.ts";
import type {
  AnimalInspection,
  BuildingInspection,
  CellInspection,
  PersonInspection,
} from "../../simulation/inspection.ts";
import type { CalendarView } from "../../simulation/nature/calendar.ts";
import type { RaidView, RelationView } from "../../simulation/society/rivalry/rivalry-system.ts";
import { useWorldStore, type WorldSnapshot } from "../world/world-store.ts";

export function createCalendar(overrides: Partial<CalendarView> = {}): CalendarView {
  return {
    day: 0.42,
    dayOfSeason: 1,
    daySeconds: 240,
    daysPerSeason: 3,
    hours: 10,
    isTimeFrozen: false,
    season: 0,
    seasonName: "Spring",
    year: 1,
    ...overrides,
  };
}

export function createWeather(overrides: Partial<WeatherView> = {}): WeatherView {
  return {
    airTemperatureOffset: 0,
    cloudCover: 0.1,
    fog: 0,
    isAutomatic: true,
    kind: "clear",
    name: "Clear",
    precipitation: 0,
    storm: 0,
    userTemperatureOffset: 0,
    windBaseSpeed: 14,
    windDirection: 90,
    windSpeed: 14,
    windX: 1,
    windZ: 0,
    ...overrides,
  };
}

export function createStock(overrides: Partial<Record<ResourceKind, number>> = {}): StockView {
  const stock: Record<ResourceKind, number> = {
    arrows: 0,
    berries: 0,
    bows: 0,
    bronze: 0,
    clay: 0,
    copper: 0,
    copperOre: 0,
    fish: 0,
    fruit: 0,
    grain: 0,
    iron: 0,
    ironOre: 0,
    linen: 0,
    meat: 0,
    pottery: 0,
    spears: 0,
    stone: 0,
    tinOre: 0,
    vegetables: 0,
    wood: 0,
  };

  return { ...stock, ...overrides };
}

export function createTribe(overrides: Partial<TribeSummary> = {}): TribeSummary {
  return {
    births: 2,
    buildings: [],
    campX: -851,
    campZ: 616,
    children: 3,
    color: "#c8553d",
    deaths: 1,
    era: { count: 6, index: 0, nextName: "Stone Age" },
    eraName: "Wanderers",
    faith: 40,
    farmland: { crops: [], fields: 0, orchardTrees: 0, woodlotTrees: 0 },
    furColor: "#7a5638",
    goal: { isBlocked: false, need: null, progress: 0.5, technologyName: "Fire making" },
    id: 1,
    isMigrating: false,
    name: "Bear Clan",
    population: 7,
    stock: createStock({ berries: 10.4, stone: 3, wood: 8.6 }),
    technologies: ["Gathering"],
    tools: "stone",
    ...overrides,
  };
}

export function createPersonInspection(overrides: Partial<PersonInspection> = {}): PersonInspection {
  return {
    activity: "Resting",
    age: 26,
    energy: 0.9,
    health: 1,
    hunger: 0.24,
    id: 4,
    isFemale: false,
    kind: "person",
    name: "Esk",
    tribeName: "Bear Clan",
    warmth: 1,
    x: -849,
    z: 613,
    ...overrides,
  };
}

export function createAnimalInspection(overrides: Partial<AnimalInspection> = {}): AnimalInspection {
  return {
    activity: "Grazing",
    health: 0.8,
    id: 9,
    isYoung: false,
    kind: "animal",
    name: "Deer",
    x: 120,
    z: -40,
    ...overrides,
  };
}

export function createBuildingInspection(overrides: Partial<BuildingInspection> = {}): BuildingInspection {
  return {
    fuel: 0.6,
    health: 1,
    id: 2,
    isBurning: false,
    kind: "building",
    name: "Campfire",
    progress: 1,
    tribeName: "Bear Clan",
    x: -851,
    z: 616,
    ...overrides,
  };
}

export function createCellInspection(overrides: Partial<CellInspection> = {}): CellInspection {
  return {
    biomeName: "Broadleaf forest",
    fire: 0,
    groundName: "Grass",
    height: 212.4,
    kind: "cell",
    plants: [{ isBurnt: false, name: "Oak" }],
    scorch: 0,
    snow: 0,
    temperature: 14.2,
    waterDepth: 0,
    wetness: 0.3,
    x: -120.4,
    z: 340.7,
    ...overrides,
  };
}

export function createRelation(overrides: Partial<RelationView> = {}): RelationView {
  return {
    feudDays: null,
    firstDeaths: 0,
    firstId: 1,
    isKin: false,
    isTruce: false,
    secondDeaths: 0,
    secondId: 2,
    stance: "neutral",
    standing: 0,
    ...overrides,
  };
}

export function createRaid(overrides: Partial<RaidView> = {}): RaidView {
  return {
    aim: "plunder",
    attackerId: 2,
    defenderId: 1,
    fallenDefenders: 0,
    fallenRaiders: 0,
    id: 1,
    phase: "march",
    raiders: 4,
    ...overrides,
  };
}

export function createChronicleEntry(overrides: Partial<ChronicleEntry> = {}): ChronicleEntry {
  return {
    category: "arrival",
    day: 0.4,
    id: 1,
    text: "The Bear Clan arrives on the island.",
    tribeId: 1,
    x: -851,
    z: 616,
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    calendar: createCalendar(),
    inspection: null,
    isPaused: false,
    rivalry: { raids: [], relations: [] },
    rules: DEFAULT_WORLD_RULES,
    speed: 1,
    tribes: [createTribe(), createTribe({ color: "#3f7cc4", id: 2, name: "Wolf Clan" })],
    weather: createWeather(),
    ...overrides,
  };
}

export function createFrame(overrides: Partial<SimulationFrame> = {}): SimulationFrame {
  return {
    animalCount: 0,
    animals: new Float32Array(0),
    buildings: [],
    burningCells: new Int32Array(0),
    burningIntensity: new Uint8Array(0),
    calendar: createCalendar(),
    chronicle: [],
    effects: [],
    groundRows: [],
    hasRealTimeWork: false,
    heightPatch: null,
    held: null,
    inspection: null,
    isBusy: false,
    isPaused: false,
    lava: { cells: new Int32Array(0), heat: new Uint8Array(0) },
    notices: [],
    people: new Float32Array(0),
    personCount: 0,
    rivalry: { raids: [], relations: [] },
    rules: DEFAULT_WORLD_RULES,
    secondsSinceTick: 0,
    speed: 1,
    surfaceRows: [],
    tick: 0,
    tribes: [createTribe()],
    vegetation: null,
    volcanoes: [],
    water: null,
    waterLevels: null,
    weather: createWeather(),
    ...overrides,
  };
}

export function showWorld(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  const snapshot = createSnapshot(overrides);

  useWorldStore.setState({ snapshot });

  return snapshot;
}

export function resetWorld(): void {
  useWorldStore.setState({ chronicle: [], notices: [], snapshot: null });
}
