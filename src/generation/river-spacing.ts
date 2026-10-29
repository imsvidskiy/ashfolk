import { isOnIsland, touchesOffIsland } from "../world/coast.ts";
import type { WorldGrid } from "../world/world-grid.ts";
import { chainCells, type DrainageBasins, isNearLake, NO_CELL, type RiverChain, riverWidthFor } from "./hydrology.ts";

const SMALLEST_SPACING = 40;
const SPACING_WIDTHS = 2.5;
const LARGEST_SPACING = 65;
const SPACING_CELLS = 1.5;
const JUNCTION_APPROACH = 80;
const HEAD_CLEARANCE = 60;
const NATURAL_APPROACH = 2;
const SHORTEST_RIVER = 250;
const CAPTURE_REACH = 350;
const CAPTURE_DROP = 0.12;
const CAPTURE_FACING = 0.5;
const CAPTURE_BUMP = 8;
const FLOW_LOOKAROUND = 3;
const PARALLEL_REACH = 180;
const PARALLEL_RUN = 400;

export const SOURCE_REACH = 100;

export interface RiverLand {
  readonly basins: DrainageBasins;
  readonly coastDistance: Float32Array;
  readonly grid: WorldGrid;
  readonly heights: Float32Array;
}

interface Spacing extends RiverLand {
  readonly nearbyOffsets: readonly NearbyOffset[];
  readonly owners: Int32Array;
  readonly reach: number;
}

interface NearbyOffset {
  readonly column: number;
  readonly distance: number;
  readonly row: number;
}

interface JoinedSource {
  readonly at: number;
  readonly isFree: boolean;
  readonly trunk: number;
}

interface NearbyRiver {
  readonly cell: number;
  readonly distance: number;
}

function pathLength(grid: WorldGrid, cells: readonly number[]): number {
  let length = 0;

  for (let index = 1; index < cells.length; index += 1) {
    length += grid.distanceBetween(cells[index - 1], cells[index]);
  }

  return length;
}

function widthAt(spacing: Spacing, cell: number): number {
  const { basins } = spacing;

  return riverWidthFor(basins.network.accumulation[cell], basins.riverThreshold);
}

function spacingBetween(spacing: Spacing, cell: number, other: number): number {
  const wider = Math.max(widthAt(spacing, cell), widthAt(spacing, other));

  return Math.max(
    SMALLEST_SPACING,
    spacing.grid.cellSize * SPACING_CELLS,
    Math.min(LARGEST_SPACING, SPACING_WIDTHS * wider)
  );
}

function nearestRiver(
  spacing: Spacing,
  cell: number,
  meters: number,
  isAllowed: (other: number) => boolean
): NearbyRiver | null {
  for (const offset of spacing.nearbyOffsets) {
    if (offset.distance > meters) {
      return null;
    }

    const other = riverCellAt(spacing, cell, offset);

    if (other !== NO_CELL && isAllowed(other)) {
      return { cell: other, distance: offset.distance };
    }
  }

  return null;
}

function hasRiverWithin(spacing: Spacing, cell: number, meters: number, allowedOwner: number): boolean {
  const { owners } = spacing;

  return (
    nearestRiver(spacing, cell, meters, (other) => {
      return owners[other] !== allowedOwner;
    }) !== null
  );
}

function anyRiver(): boolean {
  return true;
}

function followToRiver(spacing: Spacing, chain: RiverChain): RiverChain {
  const { lakeIds, network } = spacing.basins;

  if (chain.joinsCell === NO_CELL || spacing.owners[chain.joinsCell] !== NO_CELL) {
    return chain;
  }

  const cells = [...chain.cells];

  for (let cell = chain.joinsCell; cell !== NO_CELL; cell = network.receivers[cell]) {
    if (spacing.owners[cell] !== NO_CELL) {
      return { cells, joinsCell: cell, mouthReceiver: cell };
    }

    if (lakeIds[cell] !== NO_CELL) {
      return { cells, joinsCell: NO_CELL, mouthReceiver: cell };
    }

    cells.push(cell);
  }

  return { cells, joinsCell: NO_CELL, mouthReceiver: NO_CELL };
}

function endAtCoast(spacing: Spacing, chain: RiverChain): RiverChain {
  const { coastDistance, grid } = spacing;

  if (chain.joinsCell !== NO_CELL || chain.mouthReceiver !== NO_CELL) {
    return chain;
  }

  const mouth = chain.cells.findIndex((cell) => {
    return grid.isOnEdge(cell) || touchesOffIsland(grid, coastDistance, cell);
  });

  if (mouth < 0) {
    return chain;
  }

  return { ...chain, cells: chain.cells.slice(0, mouth + 1) };
}

function clearHead(spacing: Spacing, cells: readonly number[]): number {
  const clearance = Math.max(HEAD_CLEARANCE, spacing.grid.cellSize * SPACING_CELLS);

  return cells.findIndex((cell) => {
    const nearest = nearestRiver(spacing, cell, spacing.reach, anyRiver);

    return nearest === null || nearest.distance >= clearance;
  });
}

function isNaturalConfluence(spacing: Spacing, chain: RiverChain, from: number): boolean {
  const { grid } = spacing;

  if (chain.joinsCell === NO_CELL) {
    return false;
  }

  const approach = [...chain.cells.slice(from), chain.joinsCell];
  const closest = spacingBetween(spacing, chain.cells[from], chain.joinsCell);

  return pathLength(grid, approach) <= NATURAL_APPROACH * closest;
}

function junctionFor(spacing: Spacing, cell: number): number {
  const { heights } = spacing;

  const nearest = nearestRiver(spacing, cell, spacing.reach, anyRiver);

  if (nearest === null || nearest.distance >= spacingBetween(spacing, cell, nearest.cell)) {
    return NO_CELL;
  }

  const lower = nearestRiver(spacing, cell, spacing.reach, (other) => {
    return heights[other] <= heights[cell];
  });

  if (lower === null || lower.distance >= spacingBetween(spacing, cell, lower.cell)) {
    return NO_CELL;
  }

  return lower.cell;
}

function flowDirection(grid: WorldGrid, cells: readonly number[], index: number): { x: number; z: number } {
  const from = cells[Math.max(0, index - FLOW_LOOKAROUND)];
  const to = cells[Math.min(cells.length - 1, index + FLOW_LOOKAROUND)];

  const x = grid.cellCenterX(to) - grid.cellCenterX(from);
  const z = grid.cellCenterZ(to) - grid.cellCenterZ(from);
  const length = Math.max(1e-6, Math.hypot(x, z));

  return { x: x / length, z: z / length };
}

function connectorCells(grid: WorldGrid, from: number, to: number, direction: { x: number; z: number }): number[] {
  const startX = grid.cellCenterX(from);
  const startZ = grid.cellCenterZ(from);
  const endX = grid.cellCenterX(to);
  const endZ = grid.cellCenterZ(to);
  const lead = Math.hypot(endX - startX, endZ - startZ) / 2;
  const controlX = startX + direction.x * lead;
  const controlZ = startZ + direction.z * lead;
  const steps = Math.ceil((4 * lead) / grid.cellSize);

  const cells: number[] = [];

  for (let step = 1; step < steps; step += 1) {
    const along = step / steps;
    const before = (1 - along) * (1 - along);
    const middle = 2 * along * (1 - along);
    const after = along * along;
    const cell = grid.cellAt(
      before * startX + middle * controlX + after * endX,
      before * startZ + middle * controlZ + after * endZ
    );

    if (cell !== from && cell !== to && cell !== cells.at(-1)) {
      cells.push(cell);
    }
  }

  return cells;
}

function isConnectorClear(spacing: Spacing, connector: readonly number[], from: number, to: number): boolean {
  const { basins, coastDistance, grid, heights, owners } = spacing;

  const drop = heights[from] - heights[to];

  return connector.every((cell, index) => {
    const expected = heights[from] - (drop * (index + 1)) / (connector.length + 1);

    return (
      owners[cell] === NO_CELL &&
      basins.lakeIds[cell] === NO_CELL &&
      isOnIsland(coastDistance, cell) &&
      heights[cell] <= expected + CAPTURE_BUMP &&
      nearestRiver(spacing, cell, SMALLEST_SPACING, (other) => {
        return owners[other] !== owners[to] || grid.distanceBetween(other, to) > JUNCTION_APPROACH;
      }) === null
    );
  });
}

function byDistance(first: NearbyOffset, second: NearbyOffset): number {
  return first.distance - second.distance;
}

function offsetsWithin(grid: WorldGrid, meters: number): NearbyOffset[] {
  const reach = Math.ceil(meters / grid.cellSize);
  const offsets: NearbyOffset[] = [];

  for (let row = -reach; row <= reach; row += 1) {
    for (let column = -reach; column <= reach; column += 1) {
      const distance = Math.hypot(column, row) * grid.cellSize;

      if (distance > 0 && distance <= meters) {
        offsets.push({ column, distance, row });
      }
    }
  }

  return offsets.sort(byDistance);
}

function riverCellAt(spacing: Spacing, cell: number, offset: NearbyOffset): number {
  const { grid, owners } = spacing;

  const column = grid.columnOf(cell) + offset.column;
  const row = grid.rowOf(cell) + offset.row;

  if (!grid.contains(column, row)) {
    return NO_CELL;
  }

  const other = grid.index(column, row);

  return owners[other] === NO_CELL ? NO_CELL : other;
}

function captureFor(spacing: Spacing, cells: readonly number[], head: number, index: number): RiverChain | null {
  const { grid, heights, nearbyOffsets, owners } = spacing;

  const cell = cells[index];
  const direction = flowDirection(grid, cells, index);

  for (const offset of nearbyOffsets) {
    const other = riverCellAt(spacing, cell, offset);

    if (other === NO_CELL) {
      continue;
    }

    const facing = ((offset.column * direction.x + offset.row * direction.z) * grid.cellSize) / offset.distance;

    if (facing < CAPTURE_FACING || heights[cell] - heights[other] < CAPTURE_DROP * offset.distance) {
      continue;
    }

    const connector = connectorCells(grid, cell, other, direction);

    if (
      isConnectorClear(spacing, connector, cell, other) &&
      !hasRiverWithin(spacing, other, SMALLEST_SPACING, owners[other])
    ) {
      return { cells: [...cells.slice(head, index + 1), ...connector], joinsCell: other, mouthReceiver: other };
    }
  }

  return null;
}

function spacedChain(spacing: Spacing, chain: RiverChain): RiverChain | null {
  const followed = endAtCoast(spacing, followToRiver(spacing, chain));

  const head = clearHead(spacing, followed.cells);

  if (head < 0) {
    return null;
  }

  for (let index = head; index < followed.cells.length; index += 1) {
    if (isNaturalConfluence(spacing, followed, index)) {
      break;
    }

    const junction = junctionFor(spacing, followed.cells[index]);

    if (junction !== NO_CELL) {
      return { cells: followed.cells.slice(head, index + 1), joinsCell: junction, mouthReceiver: junction };
    }

    const capture = captureFor(spacing, followed.cells, head, index);

    if (capture !== null) {
      return capture;
    }
  }

  return { ...followed, cells: followed.cells.slice(head) };
}

function runsBesideRiver(spacing: Spacing, chain: RiverChain): boolean {
  const { grid, owners } = spacing;

  const trunk = chain.joinsCell === NO_CELL ? NO_CELL : owners[chain.joinsCell];

  let run = 0;

  for (const [index, cell] of chain.cells.entries()) {
    const isBeside = hasRiverWithin(spacing, cell, PARALLEL_REACH, trunk);

    run = isBeside && index > 0 ? run + grid.distanceBetween(chain.cells[index - 1], cell) : 0;

    if (run >= PARALLEL_RUN) {
      return true;
    }
  }

  return false;
}

function claim(spacing: Spacing, spaced: RiverChain[], chain: RiverChain, index: number): void {
  for (const cell of chain.cells) {
    spacing.owners[cell] = index;
  }

  spaced[index] = chain;
}

function sourceJoined(spacing: Spacing, spaced: readonly RiverChain[], chain: RiverChain): JoinedSource | null {
  const { grid, owners } = spacing;

  if (chain.joinsCell === NO_CELL) {
    return null;
  }

  const trunk = owners[chain.joinsCell];

  if (isFedByLake(spacing, spaced[trunk])) {
    return null;
  }

  const { cells } = spaced[trunk];
  const at = cells.indexOf(chain.joinsCell);

  if (at < 0 || pathLength(grid, cells.slice(0, at + 1)) >= SOURCE_REACH) {
    return null;
  }

  const headCells = new Set(cells.slice(0, at));
  const isFree = spaced.every((other) => {
    return !headCells.has(other.joinsCell);
  });

  return { at, isFree, trunk };
}

function extendUpstream(spacing: Spacing, spaced: RiverChain[], source: JoinedSource, upper: RiverChain): void {
  const trunk = spaced[source.trunk];

  for (const cell of trunk.cells.slice(0, source.at)) {
    spacing.owners[cell] = NO_CELL;
  }

  claim(spacing, spaced, { ...trunk, cells: [...upper.cells, ...trunk.cells.slice(source.at)] }, source.trunk);
}

function isFedByLake(spacing: Spacing, chain: RiverChain): boolean {
  const { basins, grid } = spacing;

  const [head] = chain.cells;

  return isNearLake(
    grid,
    basins.lakeIds,
    grid.cellCenterX(head),
    grid.cellCenterZ(head),
    grid.cellSize * SPACING_CELLS
  );
}

function isLongEnough(spacing: Spacing, chain: RiverChain): boolean {
  return pathLength(spacing.grid, chainCells(chain)) >= SHORTEST_RIVER || isFedByLake(spacing, chain);
}

function byMouthFlow(basins: DrainageBasins): (first: RiverChain, second: RiverChain) => number {
  const { accumulation } = basins.network;

  function mouthOf(chain: RiverChain): number {
    const mouth = chain.cells.at(-1);

    return mouth === undefined ? NO_CELL : mouth;
  }

  return (first, second) => {
    const difference = accumulation[mouthOf(second)] - accumulation[mouthOf(first)];

    return difference === 0 ? mouthOf(first) - mouthOf(second) : difference;
  };
}

export function spaceRiverChains(land: RiverLand, chains: readonly RiverChain[]): RiverChain[] {
  const { basins, grid } = land;

  const spacing: Spacing = {
    ...land,
    nearbyOffsets: offsetsWithin(grid, Math.max(CAPTURE_REACH, PARALLEL_REACH)),
    owners: new Int32Array(grid.cellCount).fill(NO_CELL),
    reach: Math.max(LARGEST_SPACING, HEAD_CLEARANCE, grid.cellSize * SPACING_CELLS),
  };

  const spaced: RiverChain[] = [];

  for (const chain of [...chains].sort(byMouthFlow(basins))) {
    const kept = spacedChain(spacing, chain);

    if (kept === null || !isLongEnough(spacing, kept) || runsBesideRiver(spacing, kept)) {
      continue;
    }

    const source = sourceJoined(spacing, spaced, kept);

    if (source === null) {
      claim(spacing, spaced, kept, spaced.length);
      continue;
    }

    if (source.isFree) {
      extendUpstream(spacing, spaced, source, kept);
    }
  }

  return spaced;
}
