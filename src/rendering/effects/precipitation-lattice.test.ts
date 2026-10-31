import { Vector2 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { LatticeCover } from "./precipitation-lattice.ts";

const HALF_SIZE = 100;
const TILE_SIZE = 10;
const AREA = { centerX: 0, centerZ: 0, radius: 20 };
const NO_DRIFT = new Vector2();

describe("precipitation lattice", () => {
  it("covers the tiles around the area with as many slots as the share it shows", () => {
    const cover = new LatticeCover(HALF_SIZE);

    cover.cover(AREA, TILE_SIZE, 2.5, NO_DRIFT);

    expect(cover.origin.value.toArray()).toEqual([-2, -2]);
    expect(cover.columns.value).toBe(5);
    expect(cover.slots.value).toBe(3);
    expect(cover.count).toBe(5 * 5 * 3);
  });

  it("stops at the edge of the island", () => {
    const cover = new LatticeCover(HALF_SIZE);

    cover.cover({ ...AREA, centerX: 95 }, TILE_SIZE, 1, NO_DRIFT);

    expect(cover.origin.value.x).toBe(7);
    expect(cover.columns.value).toBe(4);

    cover.cover({ ...AREA, centerX: 300 }, TILE_SIZE, 1, NO_DRIFT);

    expect(cover.count).toBe(0);
  });

  it("covers nothing while nothing falls", () => {
    const cover = new LatticeCover(HALF_SIZE);

    cover.cover(AREA, TILE_SIZE, 0, NO_DRIFT);

    expect(cover.count).toBe(0);
  });

  it("carries each tile's drops along as the lattice drifts by whole tiles", () => {
    const cover = new LatticeCover(HALF_SIZE);

    cover.cover(AREA, TILE_SIZE, 1, NO_DRIFT);

    const still = cover.identity.value.x - cover.origin.value.x;

    cover.cover(AREA, TILE_SIZE, 1, new Vector2(3, 0));

    expect(cover.identity.value.x - cover.origin.value.x).toBe(still - 3);
  });
});
