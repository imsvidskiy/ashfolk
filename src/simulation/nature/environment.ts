import { SEASON_COUNT } from "../../content/seasons.ts";
import { isSnowfallWeather } from "../../content/weather.ts";
import { sunDirection } from "../../shared/astronomy.ts";
import { clamp, FULL_TURN } from "../../shared/math.ts";
import type { Calendar } from "./calendar.ts";
import type { WeatherSystem } from "./weather.ts";

const HEATWAVE_DROUGHT = 0.35;
const SUMMER_PEAK_SEASON = 1.6;

export interface Environment {
  airTemperatureOffset: number;
  day: number;
  daySeconds: number;
  drought: number;
  hours: number;
  isNight: boolean;
  isSnowfall: boolean;
  isTimeFrozen: boolean;
  precipitation: number;
  season: number;
  sunlight: number;
  windSpeed: number;
  windX: number;
  windZ: number;
}

export function droughtLevel(season: number, precipitation: number, isHeatwave: boolean): number {
  const summer = Math.max(0, Math.cos((FULL_TURN * (season - SUMMER_PEAK_SEASON)) / SEASON_COUNT));
  const heat = isHeatwave ? HEATWAVE_DROUGHT : 0;

  return clamp(0.42 + 0.35 * summer - 0.7 * precipitation + heat, 0, 1);
}

export function describeEnvironment(calendar: Calendar, weather: WeatherSystem): Environment {
  const { season } = calendar;
  const { state } = weather;

  const wind = weather.windVector();
  const sun = sunDirection(calendar.hours, season);

  const airTemperatureOffset =
    calendar.seasonalTemperatureOffset() + calendar.diurnalTemperatureOffset() + weather.airTemperatureOffset;

  return {
    airTemperatureOffset,
    day: calendar.day,
    daySeconds: calendar.daySeconds,
    drought: droughtLevel(season, state.precipitation, state.kind === "heat"),
    hours: calendar.hours,
    isNight: calendar.isNight,
    isSnowfall: isSnowfallWeather(state.kind),
    isTimeFrozen: calendar.isTimeFrozen,
    precipitation: state.precipitation,
    season,
    sunlight: Math.max(0, sun.y) * (1 - state.cloudCover),
    windSpeed: state.windSpeed,
    windX: wind.x,
    windZ: wind.z,
  };
}
