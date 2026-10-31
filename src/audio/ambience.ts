import { Biome } from "../content/biomes.ts";
import { fallsAsSnow } from "../content/weather.ts";
import { clamp } from "../shared/math.ts";
import type { TerrainSnapshot, WeatherView } from "../simulation/frame.ts";
import type { CalendarView } from "../simulation/nature/calendar.ts";
import { isOnIsland } from "../world/coast.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import type { AmbienceLayer, AmbienceLevels, AmbienceSample, LandShares } from "./ambience-levels.ts";
import type { HearingView } from "./hearing-view.ts";
import { AMBIENCE_LAYERS } from "./sound-catalog.ts";
import type { SoundEngine, SoundLoop } from "./sound-engine.ts";

const SAMPLES_PER_SIDE = 7;
const SAMPLE_COUNT = SAMPLES_PER_SIDE * SAMPLES_PER_SIDE;
const REACH_VIEW_SHARE = 0.4;
const NEAREST_REACH = 40;
const FARTHEST_REACH = 1200;
const LEVEL_SMOOTHING_SECONDS = 2.5;
const STARTING_LEVEL = 0.02;
const RELEASE_SECONDS = 30;
const STOP_FADE_SECONDS = 1.5;

const LAND_GROUPS: ReadonlyMap<number, readonly (keyof LandShares)[]> = new Map([
  [Biome.Beach, ["open"]],
  [Biome.Desert, ["dry"]],
  [Biome.Forest, ["forest"]],
  [Biome.Meadow, ["open"]],
  [Biome.Mesa, ["dry"]],
  [Biome.Scrub, ["open", "dry"]],
  [Biome.Steppe, ["open", "dry"]],
  [Biome.Swamp, ["swamp"]],
  [Biome.Taiga, ["cold"]],
  [Biome.Tundra, ["cold"]],
]);

const LAYERS = Object.keys(AMBIENCE_LAYERS).filter((key): key is AmbienceLayer => {
  return key in AMBIENCE_LAYERS;
});

export interface AmbienceWorld {
  readonly grid: WorldGrid;
  readonly isBrookAt: (x: number, z: number) => boolean;
  readonly isWaterAt: (x: number, z: number) => boolean;
  readonly terrain: Pick<TerrainSnapshot, "baseTemperature" | "biome" | "coastDistance">;
}

export interface AmbienceView extends HearingView {
  readonly calendar: CalendarView;
  readonly weather: WeatherView;
}

interface LandAround {
  readonly brook: number;
  readonly land: LandShares;
  readonly water: number;
}

interface PlayingLayer {
  readonly loop: SoundLoop;
  quietSince: number;
}

function landAround(world: AmbienceWorld, view: AmbienceView): LandAround {
  const { grid, terrain } = world;

  const reach = clamp(view.viewDistance * REACH_VIEW_SHARE, NEAREST_REACH, FARTHEST_REACH);
  const step = (reach * 2) / (SAMPLES_PER_SIDE - 1);
  const shares = { cold: 0, dry: 0, forest: 0, open: 0, swamp: 0 };
  let brook = 0;
  let water = 0;

  for (let row = 0; row < SAMPLES_PER_SIDE; row += 1) {
    for (let column = 0; column < SAMPLES_PER_SIDE; column += 1) {
      const x = view.focusX - reach + column * step;
      const z = view.focusZ - reach + row * step;
      const cell = grid.cellAt(x, z);

      if (!isOnIsland(terrain.coastDistance, cell)) {
        continue;
      }

      if (world.isBrookAt(x, z)) {
        brook += 1;

        continue;
      }

      if (world.isWaterAt(x, z)) {
        water += 1;

        continue;
      }

      const groups = LAND_GROUPS.get(terrain.biome[cell]);

      if (groups === undefined) {
        continue;
      }

      for (const group of groups) {
        shares[group] += 1;
      }
    }
  }

  return {
    brook: brook / SAMPLE_COUNT,
    land: {
      cold: shares.cold / SAMPLE_COUNT,
      dry: shares.dry / SAMPLE_COUNT,
      forest: shares.forest / SAMPLE_COUNT,
      open: shares.open / SAMPLE_COUNT,
      swamp: shares.swamp / SAMPLE_COUNT,
    },
    water: water / SAMPLE_COUNT,
  };
}

export function sampleAmbience(world: AmbienceWorld, view: AmbienceView): AmbienceSample {
  const { calendar, weather } = view;

  const cell = world.grid.cellAt(view.focusX, view.focusZ);
  const ground = cell < 0 ? 0 : world.terrain.baseTemperature[cell];
  const { brook, land, water } = landAround(world, view);

  return {
    brook,
    hours: calendar.hours,
    isHot: weather.kind === "heat",
    isSnowing: fallsAsSnow(weather.kind, ground + weather.airTemperatureOffset),
    land,
    precipitation: weather.precipitation,
    season: calendar.season,
    storm: weather.storm,
    viewDistance: view.viewDistance,
    water,
    windSpeed: weather.windSpeed,
  };
}

export class AmbienceMixer {
  readonly #engine: SoundEngine;
  readonly #playing = new Map<AmbienceLayer, PlayingLayer>();

  constructor(engine: SoundEngine) {
    this.#engine = engine;
  }

  update(levels: AmbienceLevels, now: number): void {
    for (const layer of LAYERS) {
      this.#updateLayer(layer, levels[layer], now);
    }
  }

  dispose(): void {
    for (const { loop } of this.#playing.values()) {
      loop.stop(STOP_FADE_SECONDS);
    }

    this.#playing.clear();
  }

  #updateLayer(layer: AmbienceLayer, level: number, now: number): void {
    const playing = this.#playing.get(layer);

    if (playing === undefined) {
      this.#start(layer, level, now);

      return;
    }

    playing.loop.setVolume(level, LEVEL_SMOOTHING_SECONDS);

    if (level >= STARTING_LEVEL) {
      playing.quietSince = now;

      return;
    }

    if (now - playing.quietSince > RELEASE_SECONDS) {
      playing.loop.stop(STOP_FADE_SECONDS);
      this.#playing.delete(layer);
      this.#engine.unload(AMBIENCE_LAYERS[layer]);
    }
  }

  #start(layer: AmbienceLayer, level: number, now: number): void {
    if (level < STARTING_LEVEL || !this.#engine.isAudible) {
      return;
    }

    const loop = this.#engine.loop(AMBIENCE_LAYERS[layer], null, { seconds: LEVEL_SMOOTHING_SECONDS, volume: level });

    if (loop !== null) {
      this.#playing.set(layer, { loop, quietSince: now });
    }
  }
}
