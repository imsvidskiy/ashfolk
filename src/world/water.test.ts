import { describe, expect, it } from "vitest";
import { hasWater, NO_WATER, pondEdgeReach, pondOutlineExtent, pondOutlineRadius, type Spring } from "./water.ts";

const SAMPLES = 128;
const SHAPE_SEEDS = 64;
const OUTLET_STEP = 0.08;
const DIRECTION_TURN = 2.4;

function pondWithSeed(seed: number, outlet = 0): Spring {
  return {
    cells: [],
    directionX: Math.cos(outlet),
    directionZ: Math.sin(outlet),
    kind: "pond",
    level: 0,
    radius: 20,
    river: 0,
    seed,
    x: 5,
    z: -3,
  };
}

function lengthToWidth(pond: Spring): number {
  let length = 0;
  let lengthAngle = 0;

  for (let sample = 0; sample < SAMPLES / 2; sample += 1) {
    const angle = (sample / SAMPLES) * Math.PI * 2;
    const span = pondOutlineRadius(pond, angle) + pondOutlineRadius(pond, angle + Math.PI);

    if (span > length) {
      length = span;
      lengthAngle = angle;
    }
  }

  const across = lengthAngle + Math.PI / 2;

  return length / (pondOutlineRadius(pond, across) + pondOutlineRadius(pond, across + Math.PI));
}

function inverseSquareRadius(pond: Spring, angle: number): number {
  return (pond.radius / pondOutlineRadius(pond, angle)) ** 2;
}

function ellipseBend(pond: Spring, angle: number): number {
  return (
    inverseSquareRadius(pond, angle + OUTLET_STEP) +
    inverseSquareRadius(pond, angle - OUTLET_STEP) -
    2 * Math.cos(2 * OUTLET_STEP) * inverseSquareRadius(pond, angle)
  );
}

function quantileOf(values: readonly number[], share: number): number {
  const sorted = values.toSorted((first, second) => {
    return first - second;
  });

  return sorted[Math.floor(share * (sorted.length - 1))];
}

function outlineOf(pond: Spring): number[] {
  return Array.from({ length: SAMPLES }, (_, sample) => {
    return pondOutlineRadius(pond, (sample / SAMPLES) * Math.PI * 2);
  });
}

describe("pond outline", () => {
  it("draws the same shore for the same seed and different shores for other seeds", () => {
    expect(outlineOf(pondWithSeed(0.31))).toEqual(outlineOf(pondWithSeed(0.31)));
    expect(outlineOf(pondWithSeed(0.31))).not.toEqual(outlineOf(pondWithSeed(0.62)));
  });

  it("stretches and bends the shore well past a circle and keeps it inside its extent", () => {
    for (const seed of [0.05, 0.27, 0.48, 0.71, 0.93]) {
      const pond = pondWithSeed(seed);
      const outline = outlineOf(pond);

      expect(Math.max(...outline) / Math.min(...outline)).toBeGreaterThan(1.3);
      expect(Math.min(...outline)).toBeGreaterThan(0);
      expect(Math.max(...outline)).toBeLessThanOrEqual(pondOutlineExtent(pond));
    }
  });

  it("measures the reach to the shore along the outline", () => {
    const pond = pondWithSeed(0.4);
    const radius = pondOutlineRadius(pond, Math.PI / 3);

    const x = pond.x + Math.cos(Math.PI / 3) * (radius - 2);
    const z = pond.z + Math.sin(Math.PI / 3) * (radius - 2);

    expect(pondEdgeReach(pond, x, z)).toBeCloseTo(2, 5);
  });

  it("keeps a plain ellipse without lobes, spits or ripples where the river leaves the pond", () => {
    for (let index = 0; index < SHAPE_SEEDS; index += 1) {
      const outlet = index * DIRECTION_TURN;
      const pond = pondWithSeed((index + 0.5) / SHAPE_SEEDS, outlet);

      const drift = ellipseBend(pond, outlet + OUTLET_STEP) - ellipseBend(pond, outlet - OUTLET_STEP);

      expect(Math.abs(drift) / inverseSquareRadius(pond, outlet)).toBeLessThan(1e-9);
    }
  });

  it("draws ponds from nearly round to long and narrow", () => {
    const ratios = Array.from({ length: SHAPE_SEEDS }, (_, index) => {
      return lengthToWidth(pondWithSeed((index + 0.5) / SHAPE_SEEDS));
    });

    expect(quantileOf(ratios, 0.1)).toBeLessThan(1.3);
    expect(quantileOf(ratios, 0.5)).toBeGreaterThan(1.4);
    expect(quantileOf(ratios, 0.9)).toBeGreaterThan(2.1);
  });
});

describe("the water rule", () => {
  it("counts water only where it stands clearly above the ground", () => {
    expect(hasWater(100.5, 100)).toBe(true);
    expect(hasWater(100.04, 100)).toBe(false);
    expect(hasWater(99, 100)).toBe(false);
    expect(hasWater(NO_WATER, NO_WATER - 1)).toBe(false);
  });
});
