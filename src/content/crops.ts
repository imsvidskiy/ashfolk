import type { ResourceKind } from "./resources.ts";
import type { TechnologyId } from "./technologies.ts";

export const CROP_KINDS = ["wheat", "barley", "flax", "carrots", "turnips", "beans"] as const;

export type CropKind = (typeof CROP_KINDS)[number];

export const CROP_CODE_NONE = 0;

export const FENCED_CROP_OFFSET = 16;

type SeasonWindow = readonly [start: number, end: number];

interface CropDefinition {
  growSeasons: number;
  harvest: SeasonWindow;
  name: string;
  produce: ResourceKind;
  sowing: SeasonWindow;
  technology: TechnologyId;
  yield: number;
}

export const CROPS: Readonly<Record<CropKind, CropDefinition>> = {
  barley: {
    growSeasons: 1.15,
    harvest: [1.3, 2.6],
    name: "Barley",
    produce: "grain",
    sowing: [0.1, 1.1],
    technology: "farming",
    yield: 22,
  },
  beans: {
    growSeasons: 1,
    harvest: [1.5, 2.7],
    name: "Beans",
    produce: "vegetables",
    sowing: [0.3, 1.2],
    technology: "bronze",
    yield: 18,
  },
  carrots: {
    growSeasons: 1.2,
    harvest: [1.6, 3.2],
    name: "Carrots",
    produce: "vegetables",
    sowing: [0.2, 1.2],
    technology: "ploughing",
    yield: 20,
  },
  flax: {
    growSeasons: 1.2,
    harvest: [1.3, 2.5],
    name: "Flax",
    produce: "linen",
    sowing: [0, 0.8],
    technology: "weaving",
    yield: 8,
  },
  turnips: {
    growSeasons: 0.9,
    harvest: [1.9, 3.4],
    name: "Turnips",
    produce: "vegetables",
    sowing: [0.8, 1.7],
    technology: "ploughing",
    yield: 22,
  },
  wheat: {
    growSeasons: 1.4,
    harvest: [1.5, 2.8],
    name: "Wheat",
    produce: "grain",
    sowing: [0, 0.9],
    technology: "farming",
    yield: 24,
  },
};

function isWithin(window: SeasonWindow, season: number): boolean {
  return season >= window[0] && season < window[1];
}

export function cropCode(kind: CropKind): number {
  return CROP_KINDS.indexOf(kind) + 1;
}

export function cropOfCode(code: number): CropKind | null {
  const kind = CROP_KINDS[(code % FENCED_CROP_OFFSET) - 1];

  if (kind === undefined) {
    return null;
  }

  return kind;
}

export function isFencedCode(code: number): boolean {
  return code >= FENCED_CROP_OFFSET;
}

export function isSowingTime(kind: CropKind, season: number): boolean {
  return isWithin(CROPS[kind].sowing, season);
}

export function isHarvestSeason(kind: CropKind, season: number): boolean {
  return isWithin(CROPS[kind].harvest, season);
}

export function hasHarvestPassed(kind: CropKind, season: number): boolean {
  return season >= CROPS[kind].harvest[1];
}
