import { LAKE_NAMES, PEAK_NAMES, POND_NAMES, WATER_NAME_QUALIFIERS } from "../content/landmarks.ts";
import { MONUMENTS } from "../content/monuments.ts";
import { FULL_TURN } from "../shared/math.ts";
import { createRandom, shuffle } from "../shared/random.ts";
import type { Monument } from "../world/monuments.ts";
import { type Lake, pondOutlineRadius, type Spring } from "../world/water.ts";
import type { WorldGrid } from "../world/world-grid.ts";

export const SMALLEST_NAMED_POND_ACROSS = 60;

const LANDMARK_STREAM = 31;
const LAKE_NAME_STREAM = 1;
const POND_NAME_STREAM = 2;
const POND_OUTLINE_SAMPLES = 64;
const PEAK_LIFT = 30;
const LAKE_LIFT = 4;
const MONUMENT_LIFT = 9;

export type LandmarkKind = "lake" | "monument" | "peak" | "pond";

export interface Landmark {
  readonly detail: string | null;
  readonly id: string;
  readonly kind: LandmarkKind;
  readonly lift: number;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export interface LandmarkSource {
  readonly grid: WorldGrid;
  readonly heights: Float32Array;
  readonly lakes: readonly Lake[];
  readonly monuments: readonly Monument[];
  readonly seed: number;
  readonly springs: readonly Spring[];
}

function highestCell(heights: Float32Array): number {
  let highest = 0;

  for (let cell = 1; cell < heights.length; cell += 1) {
    if (heights[cell] > heights[highest]) {
      highest = cell;
    }
  }

  return highest;
}

function peakLandmark(source: LandmarkSource, name: string): Landmark {
  const cell = highestCell(source.heights);

  return {
    detail: `${Math.round(source.heights[cell])} m`,
    id: "peak",
    kind: "peak",
    lift: PEAK_LIFT,
    name,
    x: source.grid.cellCenterX(cell),
    z: source.grid.cellCenterZ(cell),
  };
}

export function pondAcross(spring: Spring): number {
  let area = 0;

  for (let sample = 0; sample < POND_OUTLINE_SAMPLES; sample += 1) {
    const radius = pondOutlineRadius(spring, (sample / POND_OUTLINE_SAMPLES) * FULL_TURN);

    area += (radius * radius * FULL_TURN) / POND_OUTLINE_SAMPLES / 2;
  }

  return 2 * Math.sqrt(area / Math.PI);
}

export function waterNameAt(names: readonly string[], index: number): string {
  const name = names[index % names.length];
  const round = Math.floor(index / names.length);

  if (round === 0) {
    return name;
  }

  const qualifier = WATER_NAME_QUALIFIERS[(round - 1) % WATER_NAME_QUALIFIERS.length];
  const cycle = Math.floor((round - 1) / WATER_NAME_QUALIFIERS.length);

  return cycle === 0 ? `${qualifier} ${name}` : `${qualifier} ${name} ${cycle + 1}`;
}

function isNamedPond(spring: Spring): boolean {
  return spring.kind === "pond" && pondAcross(spring) >= SMALLEST_NAMED_POND_ACROSS;
}

function lakeLandmark(lake: Lake, name: string): Landmark {
  return { detail: null, id: `lake-${lake.id}`, kind: "lake", lift: LAKE_LIFT, name, x: lake.centerX, z: lake.centerZ };
}

function pondLandmark(spring: Spring, name: string): Landmark {
  return { detail: null, id: `pond-${spring.river}`, kind: "pond", lift: LAKE_LIFT, name, x: spring.x, z: spring.z };
}

function monumentLandmark(monument: Monument): Landmark {
  return {
    detail: MONUMENTS[monument.kind].name,
    id: `monument-${monument.id}`,
    kind: "monument",
    lift: MONUMENT_LIFT,
    name: monument.name,
    x: monument.x,
    z: monument.z,
  };
}

export function findLandmarks(source: LandmarkSource): Landmark[] {
  const random = createRandom(source.seed).derive(LANDMARK_STREAM);
  const lakeNames = shuffle(random.derive(LAKE_NAME_STREAM), [...LAKE_NAMES]);
  const pondNames = shuffle(random.derive(POND_NAME_STREAM), [...POND_NAMES]);

  const lakes = source.lakes
    .toSorted((first, second) => {
      return first.id - second.id;
    })
    .map((lake, index) => {
      return lakeLandmark(lake, waterNameAt(lakeNames, index));
    });
  const ponds = source.springs.filter(isNamedPond).map((spring, index) => {
    return pondLandmark(spring, waterNameAt(pondNames, index));
  });
  const monuments = source.monuments.map((monument) => {
    return monumentLandmark(monument);
  });

  return [peakLandmark(source, random.pick(PEAK_NAMES)), ...lakes, ...ponds, ...monuments];
}
