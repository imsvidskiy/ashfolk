import { distanceSquared } from "../../shared/math.ts";
import { MinHeap } from "../../shared/min-heap.ts";
import { NOT_CLEAR, Passage, traceHops } from "../../world/brooks.ts";
import type { Crossing } from "../../world/crossings.ts";
import { NEIGHBOR_OFFSETS } from "../../world/world-grid.ts";
import type { WorldState } from "../world/world-state.ts";
import { BrookHops } from "./brook-hops.ts";
import type { Waypoint } from "./navigation.ts";
import { nearestSpotWhere, nearestWalkableSpot } from "./walkable-ground.ts";

export const NO_REGION = -1;

const AREA_SIZE = 40;
const NO_AREA = -1;
const NO_CROSSING = -1;
const NOWHERE = -1;
const IMPASSABLE = 0;
const MODERATE_SLOPE = 0.55;
const STEEP_SLOPE = 0.9;
const STEEPNESS_COST = 6;
const HOP_COST = 4;
const DECK_SAMPLE_SPACING = 0.5;
const STRAIGHTENING_LOOKAHEAD = 32;
const SNAP_RADIUS = 120;
const REGION_SEARCH_RADII: readonly number[] = [40, 120, 300];
const RETREAT_STEP = 5;
const FORWARD_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
];

interface AreaStep {
  readonly area: number;
  readonly crossing: number;
}

interface Route {
  readonly cost: number;
  readonly waypoints: Waypoint[];
}

function walkingCost(slope: number | null): number {
  if (slope === null) {
    return IMPASSABLE;
  }

  if (slope > STEEP_SLOPE) {
    return 1 + STEEPNESS_COST;
  }

  return slope > MODERATE_SLOPE ? 1 + STEEPNESS_COST * 0.4 : 1;
}

export class LandAreas {
  readonly #areaHeap = new MinHeap(1024);
  readonly #areaOfCell: Int32Array;
  readonly #cellClosed: Int32Array;
  readonly #cellCost: Float32Array;
  readonly #cellFrom: Int32Array;
  readonly #cellHeap = new MinHeap(1024);
  readonly #cellScore: Float64Array;
  readonly #cellSeen: Int32Array;
  readonly #cellsPerArea: number;
  readonly #hops = new BrookHops();
  readonly #world: WorldState;
  #allowedStamp = 0;
  #anchorX = new Float64Array(0);
  #anchorZ = new Float64Array(0);
  #areaAllowed = new Int32Array(0);
  #areaClosed = new Int32Array(0);
  #areaCount = 0;
  #areaFrom = new Int32Array(0);
  #areaScore = new Float64Array(0);
  #areaSeen = new Int32Array(0);
  #areaVia = new Int32Array(0);
  #crossings: readonly Crossing[] = [];
  #edgeCost = new Float64Array(0);
  #edgeCrossing = new Int32Array(0);
  #edgeStart = new Int32Array(1);
  #edgeTarget = new Int32Array(0);
  #regionOfArea = new Int32Array(0);
  #searchNumber = 0;

  constructor(world: WorldState) {
    const { cellCount, cellSize } = world.grid;

    this.#world = world;
    this.#cellsPerArea = Math.max(1, Math.round(AREA_SIZE / cellSize));
    this.#areaOfCell = new Int32Array(cellCount);
    this.#cellCost = new Float32Array(cellCount);
    this.#cellScore = new Float64Array(cellCount);
    this.#cellFrom = new Int32Array(cellCount);
    this.#cellSeen = new Int32Array(cellCount);
    this.#cellClosed = new Int32Array(cellCount);
  }

  rebuild(): void {
    const world = this.#world;

    for (let cell = 0; cell < world.grid.cellCount; cell += 1) {
      this.#cellCost[cell] = walkingCost(world.walkableSlope(cell));
      this.#areaOfCell[cell] = NO_AREA;
    }

    this.#crossings = world.crossings;
    this.#hops.rebuild(world.grid, (cell) => {
      return this.#passageOf(cell);
    });
    this.#linkAreas(this.#findAreas());
    this.#findRegions();
  }

  isWalkable(cell: number): boolean {
    return cell >= 0 && this.#cellCost[cell] > IMPASSABLE;
  }

  keepsFooting(cell: number): boolean {
    return this.#cellCost[cell] === Math.fround(walkingCost(this.#world.walkableSlope(cell)));
  }

  regionNear(point: Waypoint): number {
    const region = this.#regionAtLand(point);

    if (region !== NO_REGION) {
      return region;
    }

    const crossing = this.#world.crossingAt(point.x, point.z);

    if (crossing !== null) {
      return this.#regionAtLand({ x: crossing.startX, z: crossing.startZ });
    }

    return this.#regionAtLand(nearestWalkableSpot(this.#world, point, SNAP_RADIUS));
  }

  nearestInRegion(point: Waypoint, region: number, fallback: Waypoint): Waypoint {
    for (const radius of REGION_SEARCH_RADII) {
      const spot = nearestSpotWhere(this.#world, point, radius, (_world, cell) => {
        return this.isWalkable(cell) && this.#regionOfArea[this.#areaOfCell[cell]] === region;
      });

      if (spot !== null) {
        return spot;
      }
    }

    return this.#retreatToward(point, fallback, region);
  }

  isClear(from: Waypoint, to: Waypoint): boolean {
    const hops = traceHops(this.#world.grid, from, to, (cell, enter, leave) => {
      const passage = this.#passageOf(cell);

      if (passage === Passage.Ground) {
        return passage;
      }

      return this.#staysOnDeck(from, to, enter, leave) ? Passage.Ground : passage;
    });

    return hops !== NOT_CLEAR;
  }

  walkLength(from: Waypoint, to: Waypoint): number {
    const start = this.#onLand(from);
    const goal = this.#onLand(to);

    if (start === null || goal === null) {
      return Number.POSITIVE_INFINITY;
    }

    const { grid } = this.#world;

    const startArea = this.#areaOfCell[grid.cellAt(start.x, start.z)];
    const goalArea = this.#areaOfCell[grid.cellAt(goal.x, goal.z)];

    if (this.#regionOfArea[startArea] !== this.#regionOfArea[goalArea]) {
      return Number.POSITIVE_INFINITY;
    }

    const steps = this.#searchAreas(startArea, goalArea);

    if (steps === null) {
      return Number.POSITIVE_INFINITY;
    }

    let length = 0;
    let previous = start;

    for (const step of steps.slice(1)) {
      const anchor = { x: this.#anchorX[step.area], z: this.#anchorZ[step.area] };

      length += Math.hypot(anchor.x - previous.x, anchor.z - previous.z);
      previous = anchor;
    }

    return length + Math.hypot(goal.x - previous.x, goal.z - previous.z);
  }

  route(from: Waypoint, to: Waypoint): Waypoint[] | null {
    const goal = this.#onLand(to);

    if (goal === null) {
      return null;
    }

    const tail = goal === to ? [] : [to];
    const fromCell = this.#world.grid.cellAt(from.x, from.z);
    const crossing = this.#world.crossingAt(from.x, from.z);

    if (crossing !== null && !this.isWalkable(fromCell)) {
      return this.#routeOffDeck(from, goal, crossing, tail);
    }

    const start = this.#onLand(from);

    if (start === null) {
      return null;
    }

    const found = this.#routeOnLand(start, goal);

    if (found === null) {
      return null;
    }

    const head = start === from ? [] : [start];

    return [...head, ...found.waypoints, ...tail];
  }

  #routeOffDeck(from: Waypoint, goal: Waypoint, crossing: Crossing, tail: readonly Waypoint[]): Waypoint[] | null {
    let best: Route | null = null;

    for (const end of [
      { x: crossing.startX, z: crossing.startZ },
      { x: crossing.endX, z: crossing.endZ },
    ]) {
      const found = this.#routeOnLand(end, goal);

      if (found === null) {
        continue;
      }

      const cost = Math.hypot(end.x - from.x, end.z - from.z) + found.cost;

      if (best === null || cost < best.cost) {
        best = { cost, waypoints: [end, ...found.waypoints] };
      }
    }

    if (best === null) {
      return null;
    }

    return [...best.waypoints, ...tail];
  }

  #onLand(point: Waypoint): Waypoint | null {
    const cell = this.#world.grid.cellAt(point.x, point.z);

    if (this.isWalkable(cell)) {
      return point;
    }

    const spot = nearestWalkableSpot(this.#world, point, SNAP_RADIUS);

    if (!this.#world.isWalkableAt(spot.x, spot.z)) {
      return null;
    }

    return spot;
  }

  #regionAtLand(point: Waypoint): number {
    const cell = this.#world.grid.cellAt(point.x, point.z);

    if (!this.isWalkable(cell)) {
      return NO_REGION;
    }

    return this.#regionOfArea[this.#areaOfCell[cell]];
  }

  #routeOnLand(from: Waypoint, to: Waypoint): Route | null {
    const { grid } = this.#world;

    const startArea = this.#areaOfCell[grid.cellAt(from.x, from.z)];
    const goalArea = this.#areaOfCell[grid.cellAt(to.x, to.z)];

    if (this.#regionOfArea[startArea] !== this.#regionOfArea[goalArea]) {
      return null;
    }

    const steps = this.#searchAreas(startArea, goalArea);

    if (steps === null) {
      return null;
    }

    const waypoints: Waypoint[] = [];

    let legFrom = from;
    let legAreas = [startArea];
    let previousArea = startArea;

    for (const step of steps.slice(1)) {
      const enteredFrom = previousArea;

      previousArea = step.area;

      if (step.crossing === NO_CROSSING) {
        legAreas.push(step.area);

        continue;
      }

      const [entry, exit] = this.#endsFrom(this.#crossings[step.crossing], enteredFrom);

      waypoints.push(...this.#refineLeg(legFrom, entry, legAreas), exit);
      legFrom = exit;
      legAreas = [step.area];
    }

    waypoints.push(...this.#refineLeg(legFrom, to, legAreas));

    return { cost: this.#areaScore[goalArea], waypoints };
  }

  #endsFrom(crossing: Crossing, area: number): readonly [Waypoint, Waypoint] {
    const start = { x: crossing.startX, z: crossing.startZ };
    const end = { x: crossing.endX, z: crossing.endZ };

    if (this.#areaOfCell[this.#world.grid.cellAt(start.x, start.z)] === area) {
      return [start, end];
    }

    return [end, start];
  }

  #refineLeg(from: Waypoint, to: Waypoint, areas: readonly number[]): Waypoint[] {
    const { grid } = this.#world;

    this.#allowedStamp += 1;

    for (const area of areas) {
      this.#areaAllowed[area] = this.#allowedStamp;
    }

    const cells = this.#searchCells(grid.cellAt(from.x, from.z), grid.cellAt(to.x, to.z));

    if (cells === null) {
      return [to];
    }

    const points = cells.slice(1, -1).map((cell) => {
      return { x: grid.cellCenterX(cell), z: grid.cellCenterZ(cell) };
    });

    return this.#straighten(from, [...points, to]);
  }

  #straighten(from: Waypoint, points: readonly Waypoint[]): Waypoint[] {
    const straightened: Waypoint[] = [];

    let current = from;
    let next = 0;

    while (next < points.length) {
      let farthest = next;

      for (
        let candidate = next + 1;
        candidate < Math.min(points.length, next + STRAIGHTENING_LOOKAHEAD);
        candidate += 1
      ) {
        if (!this.isClear(current, points[candidate])) {
          break;
        }

        farthest = candidate;
      }

      straightened.push(points[farthest]);
      current = points[farthest];
      next = farthest + 1;
    }

    return straightened;
  }

  #staysOnDeck(from: Waypoint, to: Waypoint, enter: number, leave: number): boolean {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const samples = Math.max(1, Math.ceil(((leave - enter) * length) / DECK_SAMPLE_SPACING));

    for (let sample = 0; sample <= samples; sample += 1) {
      const amount = enter + ((leave - enter) * sample) / samples;

      if (this.#world.crossingAt(from.x + (to.x - from.x) * amount, from.z + (to.z - from.z) * amount) === null) {
        return false;
      }
    }

    return true;
  }

  #canStep(column: number, row: number, columnStep: number, rowStep: number): boolean {
    const { grid } = this.#world;

    const nextColumn = column + columnStep;
    const nextRow = row + rowStep;

    if (!(grid.contains(nextColumn, nextRow) && this.isWalkable(grid.index(nextColumn, nextRow)))) {
      return false;
    }

    if (columnStep === 0 || rowStep === 0) {
      return true;
    }

    return this.isWalkable(grid.index(nextColumn, row)) && this.isWalkable(grid.index(column, nextRow));
  }

  #passageOf(cell: number): Passage {
    if (this.isWalkable(cell)) {
      return Passage.Ground;
    }

    const world = this.#world;

    return world.isBrook(cell) && !world.isObstructed(cell) ? Passage.Brook : Passage.Blocked;
  }

  #findAreas(): number[][] {
    const { grid } = this.#world;

    const blocksPerSide = Math.ceil(grid.cellsPerSide / this.#cellsPerArea);
    const areas: number[][] = [];

    for (let blockRow = 0; blockRow < blocksPerSide; blockRow += 1) {
      for (let blockColumn = 0; blockColumn < blocksPerSide; blockColumn += 1) {
        const firstColumn = blockColumn * this.#cellsPerArea;
        const firstRow = blockRow * this.#cellsPerArea;

        for (let row = firstRow; row < Math.min(grid.cellsPerSide, firstRow + this.#cellsPerArea); row += 1) {
          for (
            let column = firstColumn;
            column < Math.min(grid.cellsPerSide, firstColumn + this.#cellsPerArea);
            column += 1
          ) {
            const cell = grid.index(column, row);

            if (this.isWalkable(cell) && this.#areaOfCell[cell] === NO_AREA) {
              areas.push(this.#floodBlock(cell, areas.length, { column: firstColumn, row: firstRow }));
            }
          }
        }
      }
    }

    return areas;
  }

  #floodBlock(first: number, area: number, corner: { column: number; row: number }): number[] {
    const { grid } = this.#world;

    const cells = [first];
    const last = { column: corner.column + this.#cellsPerArea - 1, row: corner.row + this.#cellsPerArea - 1 };

    this.#areaOfCell[first] = area;

    for (const cell of cells) {
      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);

      for (const offset of NEIGHBOR_OFFSETS) {
        const nextColumn = column + offset.column;
        const nextRow = row + offset.row;

        const isInBlock =
          nextColumn >= corner.column && nextRow >= corner.row && nextColumn <= last.column && nextRow <= last.row;

        if (!(isInBlock && this.#canStep(column, row, offset.column, offset.row))) {
          continue;
        }

        const next = grid.index(nextColumn, nextRow);

        if (this.#areaOfCell[next] === NO_AREA) {
          this.#areaOfCell[next] = area;
          cells.push(next);
        }
      }
    }

    return cells;
  }

  #linkAreas(areas: readonly (readonly number[])[]): void {
    const { grid } = this.#world;

    const count = areas.length;

    this.#areaCount = count;
    this.#clearSearches(count);
    this.#placeAnchors(areas);

    const neighbors: Map<number, number>[] = Array.from({ length: count }, () => {
      return new Map<number, number>();
    });
    const crossingsTo: Map<number, number>[] = Array.from({ length: count }, () => {
      return new Map<number, number>();
    });

    for (let cell = 0; cell < grid.cellCount; cell += 1) {
      if (!this.isWalkable(cell)) {
        continue;
      }

      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);
      const area = this.#areaOfCell[cell];

      for (const [columnStep, rowStep] of FORWARD_STEPS) {
        if (this.#canStep(column, row, columnStep, rowStep)) {
          this.#linkNeighbors(neighbors, area, this.#areaOfCell[grid.index(column + columnStep, row + rowStep)]);
        }
      }

      for (const next of this.#hops.from(cell)) {
        this.#linkNeighbors(neighbors, area, this.#areaOfCell[next]);
      }
    }

    for (const [index, crossing] of this.#crossings.entries()) {
      this.#linkCrossing(crossing, index, crossingsTo);
    }

    this.#packEdges(neighbors, crossingsTo);
  }

  #linkNeighbors(neighbors: readonly Map<number, number>[], area: number, other: number): void {
    if (other === area || neighbors[area].has(other)) {
      return;
    }

    const cost = this.#landCost(area, other);

    neighbors[area].set(other, cost);
    neighbors[other].set(area, cost);
  }

  #clearSearches(count: number): void {
    this.#areaScore = new Float64Array(count);
    this.#areaFrom = new Int32Array(count);
    this.#areaVia = new Int32Array(count);
    this.#areaSeen = new Int32Array(count);
    this.#areaClosed = new Int32Array(count);
    this.#areaAllowed = new Int32Array(count);
    this.#regionOfArea = new Int32Array(count).fill(NO_REGION);
  }

  #placeAnchors(areas: readonly (readonly number[])[]): void {
    const { grid } = this.#world;

    this.#anchorX = new Float64Array(areas.length);
    this.#anchorZ = new Float64Array(areas.length);

    for (const [area, cells] of areas.entries()) {
      const centerX =
        cells.reduce((sum, cell) => {
          return sum + grid.cellCenterX(cell);
        }, 0) / cells.length;
      const centerZ =
        cells.reduce((sum, cell) => {
          return sum + grid.cellCenterZ(cell);
        }, 0) / cells.length;

      let [anchor] = cells;
      let bestDistance = distanceSquared(grid.cellCenterX(anchor), grid.cellCenterZ(anchor), centerX, centerZ);

      for (const cell of cells) {
        const distance = distanceSquared(grid.cellCenterX(cell), grid.cellCenterZ(cell), centerX, centerZ);

        if (distance < bestDistance) {
          anchor = cell;
          bestDistance = distance;
        }
      }

      this.#anchorX[area] = grid.cellCenterX(anchor);
      this.#anchorZ[area] = grid.cellCenterZ(anchor);
    }
  }

  #landCost(from: number, to: number): number {
    const { grid } = this.#world;

    const fromCell = grid.cellAt(this.#anchorX[from], this.#anchorZ[from]);
    const toCell = grid.cellAt(this.#anchorX[to], this.#anchorZ[to]);

    const distance = Math.hypot(this.#anchorX[to] - this.#anchorX[from], this.#anchorZ[to] - this.#anchorZ[from]);

    return (distance * (this.#cellCost[fromCell] + this.#cellCost[toCell])) / 2;
  }

  #linkCrossing(crossing: Crossing, index: number, crossingsTo: Map<number, number>[]): void {
    const { grid } = this.#world;

    const startCell = grid.cellAt(crossing.startX, crossing.startZ);
    const endCell = grid.cellAt(crossing.endX, crossing.endZ);

    if (!(this.isWalkable(startCell) && this.isWalkable(endCell))) {
      return;
    }

    const startArea = this.#areaOfCell[startCell];
    const endArea = this.#areaOfCell[endCell];

    if (startArea === endArea || crossingsTo[startArea].has(endArea)) {
      return;
    }

    crossingsTo[startArea].set(endArea, index);
    crossingsTo[endArea].set(startArea, index);
  }

  #crossingCost(index: number, from: number, to: number): number {
    const crossing = this.#crossings[index];

    const [entry, exit] = this.#endsFrom(crossing, from);

    const approach = Math.hypot(entry.x - this.#anchorX[from], entry.z - this.#anchorZ[from]);
    const span = Math.hypot(exit.x - entry.x, exit.z - entry.z);
    const departure = Math.hypot(this.#anchorX[to] - exit.x, this.#anchorZ[to] - exit.z);

    return approach + span + departure;
  }

  #packEdges(neighbors: readonly Map<number, number>[], crossingsTo: readonly Map<number, number>[]): void {
    const count = this.#areaCount;
    const starts = new Int32Array(count + 1);

    for (let area = 0; area < count; area += 1) {
      starts[area + 1] = starts[area] + neighbors[area].size + crossingsTo[area].size;
    }

    const total = starts[count];

    this.#edgeStart = starts;
    this.#edgeTarget = new Int32Array(total);
    this.#edgeCost = new Float64Array(total);
    this.#edgeCrossing = new Int32Array(total).fill(NO_CROSSING);

    for (let area = 0; area < count; area += 1) {
      let edge = starts[area];

      for (const [other, cost] of neighbors[area]) {
        this.#edgeTarget[edge] = other;
        this.#edgeCost[edge] = cost;
        edge += 1;
      }

      for (const [other, crossing] of crossingsTo[area]) {
        this.#edgeTarget[edge] = other;
        this.#edgeCost[edge] = this.#crossingCost(crossing, area, other);
        this.#edgeCrossing[edge] = crossing;
        edge += 1;
      }
    }
  }

  #findRegions(): void {
    let region = 0;

    for (let first = 0; first < this.#areaCount; first += 1) {
      if (this.#regionOfArea[first] !== NO_REGION) {
        continue;
      }

      const queue = [first];

      this.#regionOfArea[first] = region;

      for (const area of queue) {
        for (let edge = this.#edgeStart[area]; edge < this.#edgeStart[area + 1]; edge += 1) {
          const other = this.#edgeTarget[edge];

          if (this.#regionOfArea[other] === NO_REGION) {
            this.#regionOfArea[other] = region;
            queue.push(other);
          }
        }
      }

      region += 1;
    }
  }

  #areaHeuristic(area: number, goal: number): number {
    return Math.hypot(this.#anchorX[goal] - this.#anchorX[area], this.#anchorZ[goal] - this.#anchorZ[area]);
  }

  #searchAreas(start: number, goal: number): AreaStep[] | null {
    this.#searchNumber += 1;

    const search = this.#searchNumber;
    const heap = this.#areaHeap;

    heap.clear();
    this.#areaScore[start] = 0;
    this.#areaSeen[start] = search;
    this.#areaFrom[start] = NOWHERE;
    this.#areaVia[start] = NO_CROSSING;
    heap.push(start, this.#areaHeuristic(start, goal));

    while (heap.size > 0) {
      const area = heap.pop();

      if (area === goal) {
        return this.#areaSteps(goal);
      }

      if (this.#areaClosed[area] === search) {
        continue;
      }

      this.#areaClosed[area] = search;
      this.#expandArea(area, goal, search);
    }

    return null;
  }

  #expandArea(area: number, goal: number, search: number): void {
    for (let edge = this.#edgeStart[area]; edge < this.#edgeStart[area + 1]; edge += 1) {
      const other = this.#edgeTarget[edge];

      if (this.#areaClosed[other] === search) {
        continue;
      }

      const score = this.#areaScore[area] + this.#edgeCost[edge];

      if (this.#areaSeen[other] !== search || score < this.#areaScore[other]) {
        this.#areaSeen[other] = search;
        this.#areaScore[other] = score;
        this.#areaFrom[other] = area;
        this.#areaVia[other] = this.#edgeCrossing[edge];
        this.#areaHeap.push(other, score + this.#areaHeuristic(other, goal));
      }
    }
  }

  #areaSteps(goal: number): AreaStep[] {
    const steps: AreaStep[] = [];

    for (let area = goal; area !== NOWHERE; area = this.#areaFrom[area]) {
      steps.push({ area, crossing: this.#areaVia[area] });
    }

    return steps.reverse();
  }

  #searchCells(start: number, goal: number): number[] | null {
    const { grid } = this.#world;

    this.#searchNumber += 1;

    const search = this.#searchNumber;
    const heap = this.#cellHeap;

    heap.clear();
    this.#cellScore[start] = 0;
    this.#cellSeen[start] = search;
    this.#cellFrom[start] = NOWHERE;
    heap.push(start, this.#cellHeuristic(start, goal));

    while (heap.size > 0) {
      const cell = heap.pop();

      if (cell === goal) {
        return this.#cellSteps(goal);
      }

      if (this.#cellClosed[cell] === search) {
        continue;
      }

      this.#cellClosed[cell] = search;

      const column = grid.columnOf(cell);
      const row = grid.rowOf(cell);

      for (const offset of NEIGHBOR_OFFSETS) {
        if (this.#canStep(column, row, offset.column, offset.row)) {
          this.#reachCell(
            cell,
            grid.index(column + offset.column, row + offset.row),
            goal,
            offset.distance * grid.cellSize
          );
        }
      }

      for (const next of this.#hops.from(cell)) {
        const distance = grid.distanceBetween(cell, next);

        this.#reachCell(cell, next, goal, distance + HOP_COST);
      }
    }

    return null;
  }

  #reachCell(cell: number, next: number, goal: number, distance: number): void {
    const search = this.#searchNumber;

    if (this.#areaAllowed[this.#areaOfCell[next]] !== this.#allowedStamp || this.#cellClosed[next] === search) {
      return;
    }

    const score = this.#cellScore[cell] + (distance * (this.#cellCost[cell] + this.#cellCost[next])) / 2;

    if (this.#cellSeen[next] !== search || score < this.#cellScore[next]) {
      this.#cellSeen[next] = search;
      this.#cellScore[next] = score;
      this.#cellFrom[next] = cell;
      this.#cellHeap.push(next, score + this.#cellHeuristic(next, goal));
    }
  }

  #cellHeuristic(cell: number, goal: number): number {
    const { grid } = this.#world;

    const columns = Math.abs(grid.columnOf(cell) - grid.columnOf(goal));
    const rows = Math.abs(grid.rowOf(cell) - grid.rowOf(goal));

    return (Math.max(columns, rows) + (Math.SQRT2 - 1) * Math.min(columns, rows)) * grid.cellSize;
  }

  #cellSteps(goal: number): number[] {
    const cells: number[] = [];

    for (let cell = goal; cell !== NOWHERE; cell = this.#cellFrom[cell]) {
      cells.push(cell);
    }

    return cells.reverse();
  }

  #retreatToward(point: Waypoint, fallback: Waypoint, region: number): Waypoint {
    const length = Math.hypot(fallback.x - point.x, fallback.z - point.z);
    const steps = Math.ceil(length / RETREAT_STEP);

    for (let step = 1; step < steps; step += 1) {
      const amount = step / steps;

      const candidate = { x: point.x + (fallback.x - point.x) * amount, z: point.z + (fallback.z - point.z) * amount };

      if (this.#regionAtLand(candidate) === region) {
        return candidate;
      }
    }

    return fallback;
  }
}
