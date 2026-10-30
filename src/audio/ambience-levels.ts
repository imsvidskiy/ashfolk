import { isWinter, seasonName } from "../content/seasons.ts";
import { MAXIMUM_WIND_SPEED } from "../content/weather.ts";
import { smoothstep } from "../shared/math.ts";
import type { AMBIENCE_LAYERS } from "./sound-catalog.ts";

export type AmbienceLayer = keyof typeof AMBIENCE_LAYERS;

export type AmbienceLevels = Readonly<Record<AmbienceLayer, number>>;

export interface LandShares {
  readonly cold: number;
  readonly dry: number;
  readonly forest: number;
  readonly open: number;
  readonly swamp: number;
}

export interface AmbienceSample {
  readonly brook: number;
  readonly hours: number;
  readonly isHot: boolean;
  readonly isSnowing: boolean;
  readonly land: LandShares;
  readonly precipitation: number;
  readonly season: number;
  readonly storm: number;
  readonly viewDistance: number;
  readonly water: number;
  readonly windSpeed: number;
}

function daylight(hours: number): number {
  return smoothstep(5, 7, hours) * (1 - smoothstep(19, 21, hours));
}

function dawn(hours: number): number {
  return smoothstep(4.5, 6, hours) * (1 - smoothstep(7.5, 9, hours));
}

function seasonLife(season: number): number {
  return isWinter(season) ? 0.2 : 1;
}

export function ambienceLevels(sample: AmbienceSample): AmbienceLevels {
  const { hours, land } = sample;

  const wind = Math.min(1, sample.windSpeed / (MAXIMUM_WIND_SPEED * 0.5));
  const rain = sample.isSnowing ? 0 : sample.precipitation;
  const snow = sample.isSnowing ? sample.precipitation : 0;
  const nearness = 1 - smoothstep(400, 3200, sample.viewDistance);
  const height = smoothstep(1500, 6000, sample.viewDistance);
  const day = daylight(hours);
  const night = 1 - day;
  const shelter = 1 - 0.85 * Math.max(rain, snow, sample.storm);
  const life = seasonLife(sample.season) * shelter * nearness;
  const warmth = seasonName(sample.season) === "Summer" ? 1 : 0.6;

  return {
    birdsDawn: dawn(hours) * (land.open + land.forest + land.cold) * life,
    birdsForest: day * land.forest * life,
    birdsMeadow: day * land.open * life,
    birdsTaiga: day * land.cold * life,
    cicadas: day * Math.max(sample.isHot ? 1 : 0, land.dry * 0.7) * warmth * life,
    crickets: night * Math.min(1, land.open + land.forest + land.dry) * warmth * life,
    frogs: land.swamp * (0.4 + 0.6 * night) * seasonLife(sample.season) * nearness,
    rainHeavy: smoothstep(0.6, 1, rain) * Math.max(0.6, nearness),
    rainLight: rain * (1 - smoothstep(0.6, 1, rain) * 0.7) * Math.max(0.5, nearness),
    stream: Math.min(1, sample.brook * 3) * nearness,
    waves: Math.min(1, sample.water * 1.5) * nearness,
    windHigh: height * (0.5 + 0.5 * wind),
    windLight: (1 - smoothstep(0.35, 0.75, wind)) * (0.3 + 0.7 * wind) * (1 - height * 0.6),
    windSnowy: Math.min(1, snow * (0.4 + wind)),
    windStrong: smoothstep(0.3, 0.9, Math.max(wind, sample.storm)) * (1 - snow * 0.5),
  };
}
