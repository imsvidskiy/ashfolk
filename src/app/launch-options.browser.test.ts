import { describe, expect, it, vi } from "vitest";
import { LARGEST_SEED } from "../features/new-world/seeds.ts";
import { choosesWorld, readLaunchOptions } from "./launch-options.ts";
import { storeQuality } from "./preferences.ts";

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

describe("launch options", () => {
  it("reads the seed, quality, time, pause and camera from the address", () => {
    const options = readLaunchOptions("?seed=7&quality=high&hours=10.5&paused=1&camera=-187,398,240,0.6,1.2");

    expect(options).toEqual({
      camera: { distance: 240, pitch: 0.6, targetX: -187, targetZ: 398, yaw: 1.2 },
      hours: 10.5,
      isPaused: true,
      name: "Duskcrest",
      quality: "high",
      seed: 7,
      shape: "round",
    });
  });

  it("reads the world name and shape from the address", () => {
    const options = readLaunchOptions("?seed=7&name=%20Old%20Ford%20&shape=square");

    expect(options.name).toBe("Old Ford");
    expect(options.shape).toBe("square");
  });

  it("reads a world name from the address as the new-world form does", () => {
    expect(readLaunchOptions("?seed=7&name=Old%20%20%20Ford").name).toBe("Old Ford");
  });

  it("names a world after its seed until it is given a name", () => {
    expect(readLaunchOptions("?seed=7").name).toBe(readLaunchOptions("?seed=7").name);
    expect(readLaunchOptions("?seed=7").name).not.toBe(readLaunchOptions("?seed=8").name);
  });

  it("ignores an unknown shape and a name that is too long", () => {
    silenceWarnings();

    const options = readLaunchOptions(`?seed=7&shape=triangle&name=${"a".repeat(40)}`);

    expect(options.shape).toBe("round");
    expect(options.name).toBe(readLaunchOptions("?seed=7").name);
  });

  it("asks for a world only when the address names no seed", () => {
    expect(choosesWorld("?seed=7")).toBe(true);
    expect(choosesWorld("?quality=high")).toBe(false);
    expect(choosesWorld("")).toBe(false);
  });

  it("keeps the island running unless it is paused explicitly", () => {
    expect(readLaunchOptions("?paused=0").isPaused).toBe(false);
    expect(readLaunchOptions("").isPaused).toBe(false);
  });

  it("fills in what the address leaves out", () => {
    const options = readLaunchOptions("");

    expect(options.camera).toEqual({});
    expect(options.hours).toBeNull();
    expect(options.quality).toBe("medium");
    expect(Number.isInteger(options.seed)).toBe(true);
    expect(options.seed).toBeGreaterThanOrEqual(1);
    expect(options.seed).toBeLessThanOrEqual(LARGEST_SEED);
  });

  it("uses the saved quality when the address names none", () => {
    storeQuality("low");

    expect(readLaunchOptions("?seed=7").quality).toBe("low");
  });

  it("prefers the quality in the address over the saved one", () => {
    storeQuality("low");

    expect(readLaunchOptions("?quality=high").quality).toBe("high");
  });

  it("keeps the valid parameters and warns about the invalid ones", () => {
    const warn = silenceWarnings();

    const options = readLaunchOptions("?seed=island&quality=high&hours=10");

    expect(warn).toHaveBeenCalledExactlyOnceWith("Ignoring invalid launch parameters", expect.any(Array));
    expect(options.quality).toBe("high");
    expect(options.hours).toBe(10);
    expect(options.seed).toBeGreaterThanOrEqual(1);
  });

  it("rejects seeds and hours outside their ranges", () => {
    const warn = silenceWarnings();

    readLaunchOptions(`?seed=${LARGEST_SEED + 1}`);
    readLaunchOptions("?seed=0");
    readLaunchOptions("?hours=25");

    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("rejects a camera without five numbers or with a distance that is not positive", () => {
    const warn = silenceWarnings();

    const shortCamera = readLaunchOptions("?camera=1,2,30");
    const flatCamera = readLaunchOptions("?camera=1,2,0,0.5,0.5");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(shortCamera.camera).toEqual({});
    expect(flatCamera.camera).toEqual({});
  });
});
