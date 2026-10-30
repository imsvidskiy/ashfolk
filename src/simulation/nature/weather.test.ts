import { describe, expect, it } from "vitest";
import { WEATHER } from "../../content/weather.ts";
import { DEFAULT_WORLD_RULES, type WorldRules, worldRulesSchema } from "../../content/world-rules.ts";
import { createRandom } from "../../shared/random.ts";
import { pickSeasonalWeather, WeatherSystem, type WeatherTick } from "./weather.ts";

function tickOf(elapsedSeconds: number): WeatherTick {
  return { day: 1, elapsedDays: elapsedSeconds / 240, elapsedSeconds, season: 0.5 };
}

function runFor(weather: WeatherSystem, seconds: number, rules: WorldRules = DEFAULT_WORLD_RULES): number {
  const random = createRandom(9);
  let strikes = 0;

  for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
    strikes += weather.update(tickOf(1), rules, random).lightningStrikes;
  }

  return strikes;
}

describe("seasonal weather", () => {
  it("never snows in summer and never brings a heatwave in winter", () => {
    const random = createRandom(2);

    const summer = new Set(
      Array.from({ length: 400 }, () => {
        return pickSeasonalWeather(1.5, random);
      })
    );
    const winter = new Set(
      Array.from({ length: 400 }, () => {
        return pickSeasonalWeather(3.5, random);
      })
    );

    expect(summer.has("snow")).toBe(false);
    expect(summer.has("blizzard")).toBe(false);
    expect(winter.has("heat")).toBe(false);
    expect(winter.has("snow")).toBe(true);
  });
});

describe("weather system", () => {
  it("eases clouds and rain towards the chosen weather", () => {
    const weather = new WeatherSystem();

    weather.setKind("rain");
    runFor(weather, 60);

    expect(weather.state.cloudCover).toBeGreaterThan(0.85);
    expect(weather.state.precipitation).toBeGreaterThan(0.6);
    expect(weather.state.isAutomatic).toBe(false);
  });

  it("lets the rain, clouds and storm settle exactly once the sky clears", () => {
    const weather = new WeatherSystem();

    weather.setKind("storm");
    runFor(weather, 60);
    weather.setKind("clear");
    runFor(weather, 120);

    expect(weather.state.precipitation).toBe(0);
    expect(weather.state.storm).toBe(0);
    expect(weather.state.fog).toBe(0);
    expect(weather.state.cloudCover).toBe(WEATHER.clear.cloudCover);
  });

  it("changes the weather on its own when automatic", () => {
    const weather = new WeatherSystem();
    const random = createRandom(5);

    const changes = Array.from({ length: 20 }, () => {
      weather.state.nextChangeInDays = 0;

      const { changedTo } = weather.update(tickOf(1), DEFAULT_WORLD_RULES, random);

      return { changedTo, kind: weather.state.kind, nextChangeInDays: weather.state.nextChangeInDays };
    });

    const changed = changes.filter((change) => {
      return change.changedTo !== null;
    });

    expect(
      changes.every((change) => {
        return change.nextChangeInDays > 0.2;
      })
    ).toBe(true);
    expect(changed.length).toBeGreaterThan(1);
    expect(
      changed.every((change) => {
        return change.changedTo === change.kind;
      })
    ).toBe(true);
  });

  it("keeps a manual choice", () => {
    const weather = new WeatherSystem();

    weather.state.nextChangeInDays = 0;

    weather.setKind("fog");
    runFor(weather, 2000);

    expect(weather.state.kind).toBe("fog");
  });

  it("throws lightning during storms only", () => {
    const stormy = new WeatherSystem();
    const clear = new WeatherSystem();

    stormy.setKind("storm");
    clear.setKind("clear");

    expect(runFor(stormy, 300)).toBeGreaterThan(5);
    expect(runFor(clear, 300)).toBe(0);
  });

  it("throws no lightning when the rule turns it off", () => {
    const weather = new WeatherSystem();
    const calmRules = worldRulesSchema.parse({ storms: { lightningFrequency: 0 } });

    weather.setKind("storm");

    expect(runFor(weather, 300, calmRules)).toBe(0);
  });

  it("scales the wind with the wind rule", () => {
    const normal = new WeatherSystem();
    const windless = new WeatherSystem();
    const stillRules = worldRulesSchema.parse({ storms: { windStrength: 0 } });

    runFor(normal, 30);
    runFor(windless, 30, stillRules);

    expect(normal.state.windSpeed).toBeGreaterThan(5);
    expect(windless.state.windSpeed).toBe(0);
  });

  it("blows away from the direction the wind comes from", () => {
    const weather = new WeatherSystem();

    weather.setWind(270, 20, 1);

    const wind = weather.windVector();

    expect(wind.x).toBeCloseTo(1);
    expect(wind.z).toBeCloseTo(0);
  });
});
