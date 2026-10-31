import { describe, expect, it } from "vitest";
import { WorldGrid } from "./world-grid.ts";

const grid = new WorldGrid({ cellSize: 10, cellsPerSide: 8 });

function columnsAndRows(cells: readonly number[]): string[] {
  return cells.map((cell) => {
    return `${grid.columnOf(cell)},${grid.rowOf(cell)}`;
  });
}

describe("world grid", () => {
  it("lists the cells a segment crosses, in order", () => {
    expect(columnsAndRows(grid.cellsAlong(-35, -35, -5, -35))).toEqual(["0,0", "1,0", "2,0", "3,0"]);
  });

  it("catches the corner cell a diagonal clips", () => {
    const cells = columnsAndRows(grid.cellsAlong(-20.1, -19.8, -19.8, -20.1));

    expect(cells).toEqual(["1,2", "2,2", "2,1"]);
  });

  it("stays in one cell for a short step inside it", () => {
    expect(columnsAndRows(grid.cellsAlong(3, 3, 4, 4))).toEqual(["4,4"]);
  });

  it("stops at the first cell along a segment that matches", () => {
    const visited: string[] = [];

    const isFound = grid.someCellAlong(-35, -35, -5, -35, (cell) => {
      visited.push(`${grid.columnOf(cell)},${grid.rowOf(cell)}`);

      return grid.columnOf(cell) === 1;
    });

    expect(isFound).toBe(true);
    expect(visited).toEqual(["0,0", "1,0"]);
  });

  it("finds nothing along a segment when no cell matches", () => {
    expect(
      grid.someCellAlong(-35, -35, -5, -35, (cell) => {
        return grid.rowOf(cell) === 1;
      })
    ).toBe(false);
  });

  it("finds a neighbor inside the grid and none past each edge", () => {
    expect(grid.neighborIndex(3, 3, { column: 1, row: -1 })).toBe(grid.index(4, 2));
    expect(grid.neighborIndex(0, 3, { column: -1, row: 0 })).toBe(-1);
    expect(grid.neighborIndex(7, 3, { column: 1, row: 0 })).toBe(-1);
    expect(grid.neighborIndex(3, 0, { column: 0, row: -1 })).toBe(-1);
    expect(grid.neighborIndex(3, 7, { column: 0, row: 1 })).toBe(-1);
  });

  it("measures the distance between cell centers", () => {
    expect(grid.distanceBetween(grid.index(2, 2), grid.index(3, 2))).toBeCloseTo(10);
    expect(grid.distanceBetween(grid.index(2, 2), grid.index(3, 3))).toBeCloseTo(10 * Math.SQRT2);
  });

  it("lists the cells whose centers lie within a radius, inside the grid", () => {
    expect(columnsAndRows(grid.cellsInRadius(grid.centerX(4), grid.centerZ(4), 10))).toEqual([
      "4,3",
      "3,4",
      "4,4",
      "5,4",
      "4,5",
    ]);
    expect(columnsAndRows(grid.cellsInRadius(grid.centerX(0), grid.centerZ(0), 15))).toEqual([
      "0,0",
      "1,0",
      "0,1",
      "1,1",
    ]);
  });

  it("tells the cells on the rim of the grid", () => {
    expect(grid.isOnEdge(grid.index(0, 3))).toBe(true);
    expect(grid.isOnEdge(grid.index(4, 7))).toBe(true);
    expect(grid.isOnEdge(grid.index(1, 6))).toBe(false);
  });

  it("clamps the bounds of a circle to the grid", () => {
    expect(grid.circleBounds(-35, 30, 12)).toEqual({ firstColumn: 0, firstRow: 5, lastColumn: 1, lastRow: 7 });
  });
});
