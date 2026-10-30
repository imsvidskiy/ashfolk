import { describe, expect, it } from "vitest";
import { fallsAsSnow, SNOWFALL_TEMPERATURE } from "./weather.ts";

describe("weather", () => {
  it("snows in snowy weather or when it is cold enough", () => {
    expect(fallsAsSnow("snow", 10)).toBe(true);
    expect(fallsAsSnow("rain", SNOWFALL_TEMPERATURE - 1)).toBe(true);
    expect(fallsAsSnow("rain", SNOWFALL_TEMPERATURE)).toBe(false);
  });
});
