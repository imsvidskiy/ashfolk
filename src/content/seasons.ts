import { FULL_TURN } from "../shared/math.ts";

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;

export const SEASON_COUNT = SEASONS.length;

const SEASONAL_TEMPERATURE_SWING = 10;
const MIDSUMMER = 1.5;
const WINTER_START = 3;
const GROWING_SEASON_START = 0.2;
const GROWING_SEASON_END = 2.6;

type SeasonName = (typeof SEASONS)[number];

export function seasonName(season: number): SeasonName {
  const name = SEASONS[Math.floor(season) % SEASON_COUNT];

  if (name === undefined) {
    throw new RangeError(`Season ${season} is outside the year`);
  }

  return name;
}

export function seasonTemperatureOffset(season: number): number {
  return SEASONAL_TEMPERATURE_SWING * Math.cos((FULL_TURN * (season - MIDSUMMER)) / SEASON_COUNT);
}

export function isWinter(season: number): boolean {
  return season >= WINTER_START;
}

export function isGrowingSeason(season: number): boolean {
  return season >= GROWING_SEASON_START && season < GROWING_SEASON_END;
}
