import { describe, expect, it } from "vitest";
import { colorChannels } from "../../shared/color.ts";
import { skyPaletteAt } from "./sky-palette.ts";

function brightness(color: number): number {
  const [red, green, blue] = colorChannels(color);

  return red + green + blue;
}

function saturation(color: number): number {
  const channels = colorChannels(color);

  return Math.max(...channels) - Math.min(...channels);
}

describe("sky palette", () => {
  it("is brighter at noon than at midnight", () => {
    const noon = skyPaletteAt(0.9, 0, 0);
    const midnight = skyPaletteAt(-0.6, 0, 0);

    expect(brightness(noon.abyss)).toBeGreaterThan(brightness(midnight.abyss));
    expect(brightness(noon.horizon)).toBeGreaterThan(brightness(midnight.horizon));
    expect(brightness(noon.zenith)).toBeGreaterThan(brightness(midnight.zenith));
  });

  it("warms the horizon around sunset", () => {
    const sunset = skyPaletteAt(0.02, 0, 0);

    const [red, , blue] = colorChannels(sunset.horizon);

    expect(red).toBeGreaterThan(blue);
  });

  it("grays the sky under heavy clouds", () => {
    const clear = skyPaletteAt(0.8, 0, 0);
    const overcast = skyPaletteAt(0.8, 1, 0);

    expect(saturation(overcast.zenith)).toBeLessThan(saturation(clear.zenith));
  });

  it("darkens the overcast sky further in heavy rain", () => {
    const overcast = skyPaletteAt(0.8, 1, 0);
    const rainy = skyPaletteAt(0.8, 1, 1);

    expect(brightness(rainy.abyss)).toBeLessThan(brightness(overcast.abyss));
    expect(brightness(rainy.horizon)).toBeLessThan(brightness(overcast.horizon));
    expect(brightness(rainy.ambientSky)).toBeLessThan(brightness(overcast.ambientSky));
  });

  it("changes smoothly with the sun height", () => {
    for (let height = -0.4; height < 0.6; height += 0.01) {
      const before = skyPaletteAt(height, 0.3, 0.2);
      const after = skyPaletteAt(height + 0.01, 0.3, 0.2);

      expect(Math.abs(brightness(before.horizon) - brightness(after.horizon))).toBeLessThan(0.15);
    }
  });
});
