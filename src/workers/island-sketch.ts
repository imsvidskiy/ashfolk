import type { GenerationProgress, IslandSketch } from "../generation/generation-options.ts";

const SKETCH_CELLS_PER_SIDE = 640;
const SKETCH_CELL_COUNT = SKETCH_CELLS_PER_SIDE * SKETCH_CELLS_PER_SIDE;

function sampleCells<Cells extends Float32Array | Uint8Array>(
  source: Cells,
  sampled: Cells,
  sourceCells: number
): Cells {
  const step = sourceCells / SKETCH_CELLS_PER_SIDE;

  for (let row = 0; row < SKETCH_CELLS_PER_SIDE; row += 1) {
    const sourceRow = Math.floor((row + 0.5) * step);

    for (let column = 0; column < SKETCH_CELLS_PER_SIDE; column += 1) {
      sampled[row * SKETCH_CELLS_PER_SIDE + column] =
        source[sourceRow * sourceCells + Math.floor((column + 0.5) * step)];
    }
  }

  return sampled;
}

export function shrinkSketch(island: IslandSketch): IslandSketch {
  const { cellsPerSide, ground, waterSurface } = island;

  if (cellsPerSide <= SKETCH_CELLS_PER_SIDE) {
    return island;
  }

  return {
    cellSize: (island.cellSize * cellsPerSide) / SKETCH_CELLS_PER_SIDE,
    cellsPerSide: SKETCH_CELLS_PER_SIDE,
    coastDistance: sampleCells(island.coastDistance, new Float32Array(SKETCH_CELL_COUNT), cellsPerSide),
    ground: ground === null ? null : sampleCells(ground, new Uint8Array(SKETCH_CELL_COUNT), cellsPerSide),
    height: sampleCells(island.height, new Float32Array(SKETCH_CELL_COUNT), cellsPerSide),
    waterSurface:
      waterSurface === null ? null : sampleCells(waterSurface, new Float32Array(SKETCH_CELL_COUNT), cellsPerSide),
  };
}

export function withSmallSketches(
  onProgress: (progress: GenerationProgress) => void
): (progress: GenerationProgress) => void {
  return (progress) => {
    const { island, stage } = progress;

    onProgress({ island: island === null ? null : shrinkSketch(island), stage });
  };
}
