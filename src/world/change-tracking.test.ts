import { describe, expect, it } from "vitest";
import { grownRegion, RegionChangeTracker, RowChangeTracker, regionOfCells } from "./change-tracking.ts";
import { WorldGrid } from "./world-grid.ts";

describe("row change tracker", () => {
  it("reports nothing until a row changes", () => {
    const tracker = new RowChangeTracker(16);

    expect(tracker.takeRuns()).toEqual([]);
  });

  it("merges neighboring rows into runs", () => {
    const tracker = new RowChangeTracker(16);

    tracker.markRow(2);
    tracker.markRow(3);
    tracker.markRows(7, 9);
    tracker.markRow(15);

    expect(tracker.takeRuns()).toEqual([
      { firstRow: 2, rowCount: 2 },
      { firstRow: 7, rowCount: 3 },
      { firstRow: 15, rowCount: 1 },
    ]);
  });

  it("clears the marks after taking them", () => {
    const tracker = new RowChangeTracker(8);

    tracker.markAll();
    tracker.takeRuns();

    expect(tracker.takeRuns()).toEqual([]);
  });
});

describe("region change tracker", () => {
  it("grows the region to cover every edit", () => {
    const tracker = new RegionChangeTracker();

    tracker.markRegion({ firstColumn: 4, firstRow: 4, lastColumn: 6, lastRow: 5 });
    tracker.markRegion({ firstColumn: 1, firstRow: 5, lastColumn: 3, lastRow: 9 });

    expect(tracker.takeRegion()).toEqual({ firstColumn: 1, firstRow: 4, lastColumn: 6, lastRow: 9 });
    expect(tracker.takeRegion()).toBeNull();
  });
});

describe("grown region", () => {
  it("grows a box by the given number of cells", () => {
    const region = { firstColumn: 4, firstRow: 5, lastColumn: 6, lastRow: 8 };

    expect(grownRegion(region, 1, 16)).toEqual({ firstColumn: 3, firstRow: 4, lastColumn: 7, lastRow: 9 });
  });

  it("keeps a grown box inside the grid", () => {
    const region = { firstColumn: 0, firstRow: 0, lastColumn: 15, lastRow: 15 };

    expect(grownRegion(region, 2, 16)).toEqual(region);
  });
});

describe("region of cells", () => {
  const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 16 });

  it("bounds the cells and grows the box by the margin", () => {
    const cells = [grid.index(4, 6), grid.index(9, 3), grid.index(5, 11)];

    expect(regionOfCells(grid, cells, 0)).toEqual({ firstColumn: 4, firstRow: 3, lastColumn: 9, lastRow: 11 });
    expect(regionOfCells(grid, cells, 1)).toEqual({ firstColumn: 3, firstRow: 2, lastColumn: 10, lastRow: 12 });
  });
});
