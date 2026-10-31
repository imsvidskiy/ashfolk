import type { EventHandle, Tick } from "./sketch.ts";

declare const Biome: { readonly Lava: number; readonly Water: number };
declare const FIRE: MirroredField;
declare const GUST_X: FieldHandle;
declare const GUST_Z: FieldHandle;
declare const MOVABLE: TagHandle;
declare const TREE: TagHandle;
declare const WIND_RESISTANCE: PropertyHandle;
declare const TORNADO_CAUSE: DeathCause;
declare const WIND: DamageHandle;
declare const FIRE_WHIRL: EventHandle<{ readonly cell: number; readonly strength: number }>;
declare const HAZARD_STRUCK_CAMP: EventHandle<HazardStruckCamp>;
declare function defineFilter(descriptor: FilterDescriptor): FilterHandle;
declare function defineAreaQuery(descriptor: AreaQueryDescriptor): AreaQueryHandle;
declare function createDisc(): Disc;
declare function setDisc(disc: Disc, x: number, z: number, radius: number): void;
declare function createCellList(limit: number): CellList;
declare function createAreaResult(query: AreaQueryHandle): AreaResult;
declare function tornadoPositionAt(path: TornadoPath, age: number, out: Point): void;
declare function stampSwirl(gust: GustWriters, cells: CellList, count: number, center: Point, force: number): void;
declare function windHoldOf(tally: KindTally, resistance: PropertyHandle): number;

type FieldHandle = { readonly name: string };
type MirroredField = FieldHandle & { readonly channel: string };
type TagHandle = { readonly tag: string };
type PropertyHandle = { readonly property: string };
type DeathCause = { readonly cause: string };
type DamageHandle = { readonly damage: string };
type ThingGroupIndex = 0 | 1 | 2 | 3 | 4 | 5;
type Point = { x: number; z: number };
type TornadoPath = { readonly seed: number };
type KindTally = { readonly counts: Float32Array };
type HazardStruckCamp = { readonly cause: DeathCause; readonly tribe: number; readonly x: number; readonly z: number };

interface FilterDescriptor {
  readonly all?: readonly TagHandle[];
  readonly groups: readonly ThingGroupIndex[];
}

interface FilterHandle {
  readonly descriptor: FilterDescriptor;
}

interface AreaQueryDescriptor {
  readonly fields: readonly { readonly field: FieldHandle; readonly threshold: number }[];
  readonly hasBiomes: boolean;
  readonly hasWater: boolean;
  readonly things: readonly { readonly filter: FilterHandle; readonly measure: "byTribe" | "tally" }[];
}

interface AreaQueryHandle {
  readonly descriptor: AreaQueryDescriptor;
}

interface Disc {
  readonly kind: "disc";
  radius: number;
  x: number;
  z: number;
}

interface CellList {
  readonly cells: Int32Array;
  readonly distancesSquared: Float64Array;
}

interface FieldMeasure {
  readonly countAbove: number;
  readonly maximum: number;
}

interface ThingMeasure {
  readonly count: number;
  readonly dominantTribe: number;
  readonly tally: KindTally;
}

interface AreaResult {
  readonly biomeTally: Float32Array;
  readonly dominantBiome: number;
  readonly waterShare: number;
  field(field: FieldHandle): FieldMeasure;
  things(filter: FilterHandle): ThingMeasure;
}

interface PreparedFilter {
  readonly groups: number;
}

interface PreparedAreaQuery {
  readonly handle: AreaQueryHandle;
}

interface FieldWriter {
  add(cell: number, amount: number): void;
}

interface GustWriters {
  readonly x: FieldWriter;
  readonly z: FieldWriter;
}

interface Blow {
  readonly cause: DeathCause;
  readonly damage: DamageHandle;
  readonly dangerSeconds: number;
  readonly filter: PreparedFilter;
  fright: number;
  harm: number;
  push: number;
  swirl: number;
  uproot: number;
}

interface Surroundings {
  cellAt(x: number, z: number): number;
  collectCells(shape: Disc, out: CellList): number;
  filter(handle: FilterHandle): PreparedFilter;
  measure(query: PreparedAreaQuery, shape: Disc, out: AreaResult): void;
  prepare(handle: AreaQueryHandle): PreparedAreaQuery;
}

interface EventSink {
  emit<Payload>(event: EventHandle<Payload>, payload: Payload): void;
}

interface CellWriterStore {
  writer(field: FieldHandle): FieldWriter;
}

interface ModuleContext {
  readonly cells: CellWriterStore;
  readonly events: EventSink;
  readonly query: Surroundings;
  readonly strike: (area: Disc, blow: Blow) => void;
}

interface System {
  readonly cadence?: number;
  readonly id: string;
  readonly phase: "emit";
  readonly run: (tick: Tick) => void;
}

interface TornadoColumns {
  readonly age: Float32Array;
  readonly calmUntil: Float32Array;
  readonly path: TornadoPath[];
  readonly radius: Float32Array;
  readonly serial: Uint32Array;
  readonly strength: Float32Array;
  count: number;
}

const CORE_SHARE = 0.4;
const FOREST_DRAG = 0.3;
const WATERSPOUT_SHARE = 0.6;
const STRENGTH_RATE = 0.2;
const MAXIMUM_STRENGTH = 2;
const PEOPLE_HARM = 0.5;
const BUILDING_HARM = 0.2;
const FLUNG = 4;
const SWIRL = 6;
const TORNADO_CELL_LIMIT = 700;
const CAMP_NOTICE_SECONDS = 30;

export const PEOPLE = defineFilter({ groups: [3] });

const SWEPT = defineFilter({ all: [MOVABLE], groups: [1, 3] });

const STANDING = defineFilter({ groups: [2] });

const TREES = defineFilter({ all: [TREE], groups: [0] });

const TORNADO_VIEW = defineAreaQuery({
  fields: [{ field: FIRE, threshold: 0 }],
  hasBiomes: true,
  hasWater: true,
  things: [
    { filter: TREES, measure: "tally" },
    { filter: PEOPLE, measure: "byTribe" },
  ],
});

interface TornadoParts {
  readonly area: Disc;
  readonly cells: CellList;
  readonly center: Point;
  readonly context: ModuleContext;
  readonly core: Disc;
  readonly gust: GustWriters;
  readonly result: AreaResult;
  readonly standingBlow: Blow;
  readonly sweptBlow: Blow;
  readonly view: PreparedAreaQuery;
}

export function createTornadoSystem(context: ModuleContext, tornadoes: TornadoColumns): System {
  const { cells, query } = context;
  const parts: TornadoParts = {
    area: createDisc(),
    cells: createCellList(TORNADO_CELL_LIMIT),
    center: { x: 0, z: 0 },
    context,
    core: createDisc(),
    gust: { x: cells.writer(GUST_X), z: cells.writer(GUST_Z) },
    result: createAreaResult(TORNADO_VIEW),
    standingBlow: createBlow(query.filter(STANDING)),
    sweptBlow: createBlow(query.filter(SWEPT)),
    view: query.prepare(TORNADO_VIEW),
  };

  return {
    id: "tornado",
    phase: "emit",
    run: (tick) => {
      for (let slot = 0; slot < tornadoes.count; slot += 1) {
        rage(parts, tornadoes, slot, tick);
      }
    },
  };
}

function rage(parts: TornadoParts, tornadoes: TornadoColumns, slot: number, tick: Tick): void {
  const { area, center, context, core, result } = parts;
  const radius = tornadoes.radius[slot];

  tornadoPositionAt(tornadoes.path[slot], tornadoes.age[slot], center);
  setDisc(area, center.x, center.z, radius);
  setDisc(core, center.x, center.z, radius * CORE_SHARE);
  context.query.measure(parts.view, area, result);

  const target = targetStrength(result);
  const current = tornadoes.strength[slot];
  const strength = Math.min(MAXIMUM_STRENGTH, current + (target - current) * STRENGTH_RATE * tick.seconds);
  const force = strength * tick.seconds;
  const count = context.query.collectCells(area, parts.cells);

  tornadoes.strength[slot] = strength;
  stampSwirl(parts.gust, parts.cells, count, center, force);
  strikeCore(parts, force);
  parts.standingBlow.harm = BUILDING_HARM * force;
  context.strike(area, parts.standingBlow);
  noticeSurroundings(parts, tornadoes, slot, tick);
}

function targetStrength(result: AreaResult): number {
  if (result.dominantBiome === Biome.Water || result.waterShare > WATERSPOUT_SHARE) {
    return MAXIMUM_STRENGTH;
  }

  if (result.dominantBiome === Biome.Lava) {
    return 1;
  }

  return 1 - FOREST_DRAG * windHoldOf(result.things(TREES).tally, WIND_RESISTANCE);
}

function strikeCore(parts: TornadoParts, force: number): void {
  const blow = parts.sweptBlow;

  blow.harm = PEOPLE_HARM * force;
  blow.push = FLUNG * force;
  blow.swirl = SWIRL * force;
  blow.uproot = force;
  parts.context.strike(parts.core, blow);
}

function noticeSurroundings(parts: TornadoParts, tornadoes: TornadoColumns, slot: number, tick: Tick): void {
  const { center, context, result } = parts;
  const fire = result.field(FIRE);
  const people = result.things(PEOPLE);

  if (tornadoes.calmUntil[slot] > tick.index) {
    return;
  }

  if (fire.countAbove > 0) {
    context.events.emit(FIRE_WHIRL, { cell: context.query.cellAt(center.x, center.z), strength: fire.maximum });
  }

  if (people.count > 0) {
    context.events.emit(HAZARD_STRUCK_CAMP, { cause: TORNADO_CAUSE, tribe: people.dominantTribe, x: center.x, z: center.z });
  }

  if (fire.countAbove > 0 || people.count > 0) {
    tornadoes.calmUntil[slot] = tick.index + CAMP_NOTICE_SECONDS / tick.seconds;
  }
}

function createBlow(filter: PreparedFilter): Blow {
  return {
    cause: TORNADO_CAUSE,
    damage: WIND,
    dangerSeconds: 4,
    filter,
    fright: 1,
    harm: 0,
    push: 0,
    swirl: 0,
    uproot: 0,
  };
}
