import { describe, expect, it } from "vitest";
import { Biome } from "../content/biomes.ts";
import type { WeatherView } from "../simulation/frame.ts";
import { Calendar } from "../simulation/nature/calendar.ts";
import { WorldGrid } from "../world/world-grid.ts";
import { AmbienceMixer, type AmbienceWorld, sampleAmbience } from "./ambience.ts";
import type { AmbienceLevels, AmbienceSample } from "./ambience-levels.ts";
import { AMBIENCE_LAYERS } from "./sound-catalog.ts";
import { createTestSoundEngine } from "./testing/test-sound-engine.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });

const CLEAR: WeatherView = {
  airTemperatureOffset: 0,
  cloudCover: 0.1,
  fog: 0,
  isAutomatic: true,
  kind: "clear",
  name: "Clear",
  precipitation: 0,
  storm: 0,
  userTemperatureOffset: 0,
  windBaseSpeed: 6,
  windDirection: 90,
  windSpeed: 6,
  windX: 1,
  windZ: 0,
};

const QUIET: AmbienceLevels = {
  birdsDawn: 0,
  birdsForest: 0,
  birdsMeadow: 0,
  birdsTaiga: 0,
  cicadas: 0,
  crickets: 0,
  frogs: 0,
  rainHeavy: 0,
  rainLight: 0,
  stream: 0,
  waves: 0,
  windHigh: 0,
  windLight: 0,
  windSnowy: 0,
  windStrong: 0,
};

interface TestWorld {
  readonly biome?: number;
  readonly coastDistance?: number;
  readonly isBrook?: boolean;
  readonly isWater?: boolean;
  readonly temperature?: number;
}

function createWorld(options: TestWorld = {}): AmbienceWorld {
  const { biome = Biome.Forest, coastDistance = 100, isBrook = false, isWater = false, temperature = 15 } = options;

  return {
    grid,
    isBrookAt: () => {
      return isBrook;
    },
    isWaterAt: () => {
      return isWater || isBrook;
    },
    terrain: {
      baseTemperature: new Float32Array(grid.cellCount).fill(temperature),
      biome: new Uint8Array(grid.cellCount).fill(biome),
      coastDistance: new Float32Array(grid.cellCount).fill(coastDistance),
    },
  };
}

function sample(world: AmbienceWorld, weather: WeatherView = CLEAR): AmbienceSample {
  return sampleAmbience(world, { calendar: new Calendar().view(), focusX: 0, focusZ: 0, viewDistance: 100, weather });
}

describe("sampling the ambience", () => {
  it("hears a forest from forest cells", () => {
    const { land, water } = sample(createWorld());

    expect(land.forest).toBe(1);
    expect(land.open).toBe(0);
    expect(water).toBe(0);
  });

  it("counts water cells as water and not as land", () => {
    const { brook, land, water } = sample(createWorld({ isWater: true }));

    expect(water).toBe(1);
    expect(brook).toBe(0);
    expect(Object.values(land)).toEqual([0, 0, 0, 0, 0]);
  });

  it("counts brooks as brooks and not as open water", () => {
    const { brook, land, water } = sample(createWorld({ isBrook: true }));

    expect(brook).toBe(1);
    expect(water).toBe(0);
    expect(land.forest).toBe(0);
  });

  it("hears nothing from the sky past the island edge", () => {
    const { brook, land, water } = sample(createWorld({ coastDistance: 0 }));

    expect(Object.values(land)).toEqual([0, 0, 0, 0, 0]);
    expect(water).toBe(0);
    expect(brook).toBe(0);
  });

  it("turns rain into snow over cold ground", () => {
    const rain: WeatherView = { ...CLEAR, kind: "rain", precipitation: 0.6 };

    expect(sample(createWorld({ temperature: 10 }), rain).isSnowing).toBe(false);
    expect(sample(createWorld({ temperature: 10 }), { ...rain, airTemperatureOffset: -12 }).isSnowing).toBe(true);
  });
});

describe("mixing the ambience", () => {
  it("lets a layer go only after it stays quiet for half a minute", () => {
    const { engine, loop, loops, unload } = createTestSoundEngine();
    const mixer = new AmbienceMixer(engine);

    mixer.update({ ...QUIET, birdsMeadow: 0.5 }, 0);
    mixer.update(QUIET, 10);
    mixer.update(QUIET, 30);

    expect(loop).toHaveBeenCalledOnce();
    expect(loop).toHaveBeenCalledWith(AMBIENCE_LAYERS.birdsMeadow, null, expect.any(Object));
    expect(loops[0]?.stop).not.toHaveBeenCalled();

    mixer.update(QUIET, 31);

    expect(loops[0]?.stop).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledWith(AMBIENCE_LAYERS.birdsMeadow);
  });

  it("starts no layer below the starting level", () => {
    const { engine, loop } = createTestSoundEngine();
    const mixer = new AmbienceMixer(engine);

    mixer.update({ ...QUIET, crickets: 0.01 }, 0);

    expect(loop).not.toHaveBeenCalled();
  });
});
