import { LAKE_NAMES, PEAK_NAMES } from "../content/landmarks.ts";
import { MONUMENTS } from "../content/monuments.ts";
import { createRandom } from "../shared/random.ts";
import { countForArea } from "../world/island-size.ts";
import type { Monument } from "../world/monuments.ts";
import type { Lake } from "../world/water.ts";
import type { WorldGrid } from "../world/world-grid.ts";

const LANDMARK_STREAM = 31;
const NORMAL_NAMED_LAKES = 3;
const SMALLEST_NAMED_LAKE = 60;
const PEAK_LIFT = 30;
const LAKE_LIFT = 4;
const MONUMENT_LIFT = 9;

type LandmarkKind = "lake" | "monument" | "peak";

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

function lakeLandmark(lake: Lake, name: string): Landmark {
  return { detail: null, id: `lake-${lake.id}`, kind: "lake", lift: LAKE_LIFT, name, x: lake.centerX, z: lake.centerZ };
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
  const firstLakeName = random.integer(0, LAKE_NAMES.length);
  const largestLakes = source.lakes
    .filter((lake) => {
      return lake.cellCount >= SMALLEST_NAMED_LAKE;
    })
    .toSorted((first, second) => {
      return second.cellCount - first.cellCount;
    })
    .slice(0, countForArea(source.grid, NORMAL_NAMED_LAKES));
  const lakes = largestLakes.map((lake, index) => {
    return lakeLandmark(lake, LAKE_NAMES[(firstLakeName + index) % LAKE_NAMES.length]);
  });
  const monuments = source.monuments.map((monument) => {
    return monumentLandmark(monument);
  });

  return [peakLandmark(source, random.pick(PEAK_NAMES)), ...lakes, ...monuments];
}
