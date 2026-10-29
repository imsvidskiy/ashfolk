import { Scene, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Atmosphere } from "./atmosphere.ts";

const CLEAR_SKY = {
  cloudCover: 0,
  flash: 0,
  fog: 0,
  hours: 12,
  precipitation: 0,
  season: 1,
  snowfall: 0,
  storm: 0,
  windX: 0,
  windZ: 0,
};

const HOUR_STEP = 0.001;
const MOONLIGHT = 0.7;
const ANKLE_HEIGHT = 0.085;
const FAR_VIEW = 2500;
const ISLAND_HALF_SIZE = 2560;

function createAtmosphere(): Atmosphere {
  return new Atmosphere(new Scene(), { cloudSeaAltitude: -200, islandHalfSize: ISLAND_HALF_SIZE, shadowMapSize: 1024 });
}

function lightAt(atmosphere: Atmosphere, hours: number): number {
  atmosphere.update({ ...CLEAR_SKY, hours }, new Vector3(0, 600, 500), new Vector3(), 800, 0);

  return atmosphere.sun.intensity;
}

function shadowReachAt(atmosphere: Atmosphere, focus: Vector3, viewDistance: number): number {
  atmosphere.update(CLEAR_SKY, new Vector3(0, 600, 500), focus, viewDistance, 0);

  return atmosphere.sun.shadow.camera.right;
}

function largestStep(atmosphere: Atmosphere, fromHours: number, toHours: number): number {
  let largest = 0;
  let previous = lightAt(atmosphere, fromHours);

  for (let hours = fromHours + HOUR_STEP; hours <= toHours; hours += HOUR_STEP) {
    const light = lightAt(atmosphere, hours);

    largest = Math.max(largest, Math.abs(light - previous));
    previous = light;
  }

  return largest;
}

describe("atmosphere", () => {
  it("fades the moonlight in after sunset", () => {
    const atmosphere = createAtmosphere();

    expect(largestStep(atmosphere, 19, 21)).toBeLessThan(0.02);
  });

  it("fades the moonlight out before sunrise", () => {
    const atmosphere = createAtmosphere();

    expect(largestStep(atmosphere, 3.5, 5)).toBeLessThan(0.02);
  });

  it("keeps the full moonlight at midnight", () => {
    const atmosphere = createAtmosphere();

    expect(lightAt(atmosphere, 0)).toBeCloseTo(MOONLIGHT, 5);
  });

  it("keeps shadows attached to the feet that cast them", () => {
    const atmosphere = createAtmosphere();

    atmosphere.update(CLEAR_SKY, new Vector3(0, 20, 25), new Vector3(), 30, 0);

    const { bias, camera } = atmosphere.sun.shadow;

    expect(Math.abs(bias) * (camera.far - camera.near)).toBeLessThan(ANKLE_HEIGHT);
  });

  it("follows the view distance with its shadow reach until filming widens it", () => {
    const atmosphere = createAtmosphere();

    const near = shadowReachAt(atmosphere, new Vector3(), FAR_VIEW);

    atmosphere.setShadows(4096, true);

    const filmed = shadowReachAt(atmosphere, new Vector3(1000, 0, 0), FAR_VIEW);

    expect(near).toBeLessThan(FAR_VIEW);
    expect(filmed).toBeGreaterThan(ISLAND_HALF_SIZE * Math.SQRT2 + 1000);
  });

  it("keeps filmed shadows attached to the feet", () => {
    const atmosphere = createAtmosphere();

    atmosphere.setShadows(8192, true);
    atmosphere.update(CLEAR_SKY, new Vector3(0, 20, 25), new Vector3(), 30, 0);

    const { bias, camera, mapSize } = atmosphere.sun.shadow;

    expect(mapSize.x).toBe(8192);
    expect(camera.near).toBeGreaterThan(0);
    expect(Math.abs(bias) * (camera.far - camera.near)).toBeLessThan(ANKLE_HEIGHT);
  });
});
