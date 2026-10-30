import { describe, expect, it } from "vitest";
import { SEASONS } from "../content/seasons.ts";
import { type AmbienceSample, ambienceLevels } from "./ambience-levels.ts";

const SUMMER = SEASONS.indexOf("Summer");
const WINTER = SEASONS.indexOf("Winter");

const MEADOW_NOON: AmbienceSample = {
  brook: 0,
  hours: 12,
  isHot: false,
  isSnowing: false,
  land: { cold: 0, dry: 0, forest: 0, open: 1, swamp: 0 },
  precipitation: 0,
  season: SUMMER,
  storm: 0,
  viewDistance: 120,
  water: 0,
  windSpeed: 6,
};

describe("ambience levels", () => {
  it("fills a calm summer meadow with birds and a light breeze", () => {
    const levels = ambienceLevels(MEADOW_NOON);

    expect(levels.birdsMeadow).toBeGreaterThan(0.8);
    expect(levels.windLight).toBeGreaterThan(0.2);
    expect(levels.rainLight).toBe(0);
    expect(levels.crickets).toBe(0);
  });

  it("trades the birds for crickets at night", () => {
    const levels = ambienceLevels({ ...MEADOW_NOON, hours: 23 });

    expect(levels.birdsMeadow).toBe(0);
    expect(levels.crickets).toBeGreaterThan(0.8);
  });

  it("keeps the crickets of a steppe night as loud as a meadow's", () => {
    const meadow = ambienceLevels({ ...MEADOW_NOON, hours: 23 });
    const steppe = ambienceLevels({ ...MEADOW_NOON, hours: 23, land: { ...MEADOW_NOON.land, dry: 1, open: 1 } });

    expect(steppe.crickets).toBe(meadow.crickets);
    expect(steppe.crickets).toBeLessThanOrEqual(1);
  });

  it("plays rain as its own layer and quiets the animals", () => {
    const levels = ambienceLevels({ ...MEADOW_NOON, precipitation: 1, storm: 1, windSpeed: 40 });

    expect(levels.rainHeavy).toBeGreaterThan(0.8);
    expect(levels.windStrong).toBeGreaterThan(0.5);
    expect(levels.birdsMeadow).toBeLessThan(0.2);
  });

  it("turns falling snow into snowy wind, not rain", () => {
    const levels = ambienceLevels({ ...MEADOW_NOON, isSnowing: true, precipitation: 1, season: WINTER });

    expect(levels.windSnowy).toBeGreaterThan(0.5);
    expect(levels.rainLight).toBe(0);
    expect(levels.rainHeavy).toBe(0);
  });

  it("hears the sea and the streams near water", () => {
    const levels = ambienceLevels({ ...MEADOW_NOON, brook: 0.4, water: 0.7 });

    expect(levels.waves).toBe(1);
    expect(levels.stream).toBe(1);
  });

  it("keeps only the high wind from far above", () => {
    const levels = ambienceLevels({ ...MEADOW_NOON, viewDistance: 6000, water: 0.5 });

    expect(levels.windHigh).toBeGreaterThan(0.5);
    expect(levels.birdsMeadow).toBe(0);
    expect(levels.waves).toBe(0);
  });

  it("lets frogs call from swamps", () => {
    const levels = ambienceLevels({ ...MEADOW_NOON, hours: 22, land: { ...MEADOW_NOON.land, open: 0, swamp: 1 } });

    expect(levels.frogs).toBeGreaterThan(0.8);
  });
});
