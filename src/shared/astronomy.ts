import { clamp, FULL_TURN } from "./math.ts";

const LATITUDE = (42 * Math.PI) / 180;
const AXIAL_TILT = (23.4 * Math.PI) / 180;
const RADIANS_PER_HOUR = (15 * Math.PI) / 180;
const MOON_ORBIT_TILT = 0.9;

export interface Direction {
  x: number;
  y: number;
  z: number;
}

function directionOf(azimuth: number, altitude: number): Direction {
  const horizontal = Math.cos(altitude);

  return { x: Math.sin(azimuth) * horizontal, y: Math.sin(altitude), z: -Math.cos(azimuth) * horizontal };
}

function afternoonAzimuth(azimuth: number, hourAngle: number): number {
  if (hourAngle > 0) {
    return FULL_TURN - azimuth;
  }

  return azimuth;
}

function sunDeclination(season: number): number {
  return AXIAL_TILT * Math.sin((FULL_TURN * season) / 4);
}

export function sunDirection(hours: number, season: number): Direction {
  const declination = sunDeclination(season);
  const hourAngle = (hours - 12) * RADIANS_PER_HOUR;

  const sineOfAltitude =
    Math.sin(LATITUDE) * Math.sin(declination) + Math.cos(LATITUDE) * Math.cos(declination) * Math.cos(hourAngle);

  const altitude = Math.asin(sineOfAltitude);

  const cosineOfAzimuth =
    (Math.sin(declination) - Math.sin(altitude) * Math.sin(LATITUDE)) /
    (Math.cos(altitude) * Math.cos(LATITUDE) + 1e-6);

  const morningAzimuth = Math.acos(clamp(cosineOfAzimuth, -1, 1));

  return directionOf(afternoonAzimuth(morningAzimuth, hourAngle), altitude);
}

export function moonDirection(hours: number): Direction {
  const hourAngle = hours * RADIANS_PER_HOUR;

  const altitude = Math.asin(Math.cos(LATITUDE) * Math.cos(hourAngle) * MOON_ORBIT_TILT);

  return directionOf(hourAngle + Math.PI, altitude);
}
