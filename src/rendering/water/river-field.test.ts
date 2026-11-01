import { RedFormat } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { drawnRiverHalfWidth, NO_WATER, packRiverLines, type River, type RiverPoint } from "../../world/water.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { floatDataTexture } from "../data-textures.ts";
import { buildRiverField, RiverField, sampleRiverField } from "./river-field.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 64 });
const NARROW_WIDTH = 4;
const WIDE_WIDTH = 20;
const SPACING = 2.5;
const EDGE_SLACK = 0.05;
const SOURCE_REACH = 7.5;
const POND_START = 100;
const RIVER_CELL_REACH = 15;
const CELL_DEPTH = 1;
const MOUTH_DEPTH = 0.7;
const STREAM_WIDTH = 3;
const JUNCTION_EDGE_SLACK = 1;

function pointAt(x: number, z: number, width: number): RiverPoint {
  return { depth: 1, flow: 1, surface: 100, width, x, z };
}

function straightRiver(id: number, x: number, width: number): River {
  const points = Array.from({ length: 121 }, (_, index) => {
    return pointAt(x, -150 + index * SPACING, width);
  });

  return { id, points, reachesEdge: false };
}

function joiningStream(id: number, x: number, endZ: number): River {
  const points = Array.from({ length: 61 }, (_, index) => {
    return pointAt(x, endZ + 150 - index * SPACING, STREAM_WIDTH);
  });

  return { id, points, reachesEdge: false };
}

function bentRiver(width: number): River {
  const points: RiverPoint[] = [];

  for (let index = 0; index <= 60; index += 1) {
    points.push(pointAt(-150 + index * SPACING, 0, width));
  }

  for (let step = 1; step <= 31; step += 1) {
    const angle = (step / 31) * (Math.PI / 2);

    points.push(pointAt(30 * Math.sin(angle), 30 - 30 * Math.cos(angle), width));
  }

  for (let index = 1; index <= 48; index += 1) {
    points.push(pointAt(30, 30 + index * SPACING, width));
  }

  return { id: 0, points, reachesEdge: false };
}

function fieldData(field: RiverField): number[] {
  const { data } = field.texture.image;

  return data instanceof Uint8Array ? Array.from(data) : [];
}

function isNeverDry(): boolean {
  return false;
}

function fieldOf(rivers: readonly River[], isDry: (cell: number) => boolean = isNeverDry): Uint8Array {
  const field = new Uint8Array(grid.cellCount * 4);
  const source = {
    height: new Float32Array(grid.cellCount),
    riverStrength: new Uint8Array(grid.cellCount).fill(60),
    waterSurface: Float32Array.from({ length: grid.cellCount }, (_, cell) => {
      return isDry(cell) ? NO_WATER : 1;
    }),
  };

  buildRiverField(grid, packRiverLines(rivers), source, field);

  return field;
}

describe("buildRiverField", () => {
  it("draws a straight river exactly as wide as its drawn width, between cell centers too", () => {
    for (const width of [NARROW_WIDTH, WIDE_WIDTH]) {
      const field = fieldOf([straightRiver(0, 3, width)]);
      const halfWidth = drawnRiverHalfWidth(width / 2);

      for (const z of [-40, -33, -25, 0, 7.5, 41]) {
        expect(sampleRiverField(grid, field, 3 + halfWidth - 0.3, z).edge).toBeGreaterThan(0);
        expect(sampleRiverField(grid, field, 3 - halfWidth - 0.3, z).edge).toBeLessThan(0);
        expect(Math.abs(sampleRiverField(grid, field, 3 + halfWidth, z).edge)).toBeLessThan(EDGE_SLACK);
      }
    }
  });

  it("keeps a wide river wet where a narrow stream ends on its centerline", () => {
    const main = {
      id: 0,
      points: Array.from({ length: 121 }, (_, index) => {
        return pointAt(-150 + index * SPACING, 0.3, WIDE_WIDTH);
      }),
      reachesEdge: false,
    };
    const field = fieldOf([main, joiningStream(1, 0.7, 0.3)]);
    const reach = drawnRiverHalfWidth(WIDE_WIDTH / 2) - JUNCTION_EDGE_SLACK;

    for (let x = -40; x <= 40; x += 0.5) {
      for (let across = -reach; across <= reach; across += 0.5) {
        expect(sampleRiverField(grid, field, x, 0.3 + across).edge).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the edge of a bend continuous", () => {
    const field = fieldOf([bentRiver(NARROW_WIDTH)]);

    let previous = sampleRiverField(grid, field, 0, -20).edge;

    for (let step = 1; step <= 160; step += 1) {
      const { edge } = sampleRiverField(grid, field, step * 0.25, -20 + step * 0.25);

      expect(Math.abs(edge - previous)).toBeLessThan(0.5);
      previous = edge;
    }
  });

  it("leaves dry land between two streams forty meters apart", () => {
    const field = fieldOf([straightRiver(0, -20, NARROW_WIDTH), straightRiver(1, 20, NARROW_WIDTH)]);

    for (const z of [-30, -5, 0, 12, 33]) {
      expect(sampleRiverField(grid, field, 0, z).edge).toBeLessThan(-10);
      expect(sampleRiverField(grid, field, -20, z).edge).toBeGreaterThan(0);
      expect(sampleRiverField(grid, field, 20, z).edge).toBeGreaterThan(0);
    }
  });

  it("stops drawing a river where its water is gone", () => {
    const field = fieldOf([straightRiver(0, 3, NARROW_WIDTH)], (cell) => {
      return grid.cellCenterZ(cell) > 0;
    });

    expect(sampleRiverField(grid, field, 3, -40).hasRiver).toBe(true);
    expect(sampleRiverField(grid, field, 3, 40).hasRiver).toBe(false);
  });

  it("ends a river close past its source, no wider than the river", () => {
    for (const startX of [-2.5, 0, 3, 5]) {
      const field = fieldOf([straightRiver(0, startX, NARROW_WIDTH)]);
      const halfWidth = drawnRiverHalfWidth(NARROW_WIDTH / 2);

      expect(sampleRiverField(grid, field, startX, -150).edge).toBeGreaterThan(0);

      for (let across = -6; across <= 6; across += 0.5) {
        expect(sampleRiverField(grid, field, startX + across, -150 - SOURCE_REACH).edge).toBeLessThan(0);
      }

      for (const along of [-4, -1, 2]) {
        expect(sampleRiverField(grid, field, startX + halfWidth + 0.3, -150 + along).edge).toBeLessThan(0);
      }
    }
  });
});

describe("RiverField", () => {
  it("keeps a pond from filling the cells of the river that runs into it, but not its own cells", () => {
    function isPond(cell: number): boolean {
      return grid.cellCenterZ(cell) > POND_START;
    }

    function isRiverCell(cell: number): boolean {
      return !isPond(cell) && Math.abs(grid.cellCenterX(cell) - 3) < RIVER_CELL_REACH;
    }

    const source = {
      height: new Float32Array(grid.cellCount),
      riverStrength: Uint8Array.from({ length: grid.cellCount }, (_, cell) => {
        return isRiverCell(cell) ? 60 : 0;
      }),
      waterSurface: Float32Array.from({ length: grid.cellCount }, (_, cell) => {
        return isPond(cell) || isRiverCell(cell) ? 1 : NO_WATER;
      }),
    };
    const shoreDepths = Float32Array.from({ length: grid.cellCount }, (_, cell) => {
      return isPond(cell) || isRiverCell(cell) ? CELL_DEPTH : -CELL_DEPTH;
    });
    const shore = {
      data: shoreDepths,
      stride: 1,
      texture: floatDataTexture(shoreDepths, grid.cellsPerSide, grid.cellsPerSide, RedFormat),
    };
    const field = new RiverField(grid, packRiverLines([straightRiver(0, 3, NARROW_WIDTH)]), source, shore);

    expect(field.depthAt(15, 95, CELL_DEPTH)).toBeLessThan(0);
    expect(field.depthAt(3, 95, CELL_DEPTH)).toBeCloseTo(MOUTH_DEPTH);
    expect(field.depthAt(15, 125, CELL_DEPTH)).toBe(CELL_DEPTH);

    field.dispose();
    shore.texture.dispose();
  });

  it("follows a lake as it fills as if the field were built again", () => {
    function isLake(cell: number): boolean {
      return grid.cellCenterZ(cell) > POND_START;
    }

    const lines = packRiverLines([straightRiver(0, 3, NARROW_WIDTH)]);
    const source = {
      height: new Float32Array(grid.cellCount),
      riverStrength: Uint8Array.from({ length: grid.cellCount }, (_, cell) => {
        return isLake(cell) || Math.abs(grid.cellCenterX(cell) - 3) >= RIVER_CELL_REACH ? 0 : 60;
      }),
      waterSurface: Float32Array.from({ length: grid.cellCount }, (_, cell) => {
        return isLake(cell) || Math.abs(grid.cellCenterX(cell) - 3) >= RIVER_CELL_REACH ? NO_WATER : 1;
      }),
    };
    const shoreDepths = new Float32Array(grid.cellCount);
    const shore = {
      data: shoreDepths,
      stride: 1,
      texture: floatDataTexture(shoreDepths, grid.cellsPerSide, grid.cellsPerSide, RedFormat),
    };
    const filling = new RiverField(grid, lines, source, shore);

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (isLake(cell)) {
        source.waterSurface[cell] = 1;
      }
    }

    const filled = new RiverField(grid, lines, source, shore);

    expect(fieldData(filling)).not.toEqual(fieldData(filled));

    filling.updateStandingWater(source);

    expect(fieldData(filling)).toEqual(fieldData(filled));

    filling.dispose();
    filled.dispose();
    shore.texture.dispose();
  });
});
