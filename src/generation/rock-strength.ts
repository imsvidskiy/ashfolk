import { clamp } from "../shared/math.ts";
import { createNoiseSampler } from "../shared/noise.ts";
import { createRandom } from "../shared/random.ts";
import type { WorldGrid } from "../world/world-grid.ts";

const STRENGTH_SPAN = 420;
const STRENGTH_OCTAVES = 4;
const STRENGTH_GAIN = 0.55;
const STRENGTH_STRETCH = 1.7;

export function measureRockStrength(grid: WorldGrid, seed: number): Float32Array {
  const noise = createNoiseSampler(createRandom(seed * 19 + 7));
  const strength = new Float32Array(grid.cellCount);

  for (let row = 0; row < grid.cellsPerSide; row += 1) {
    const z = grid.centerZ(row) / STRENGTH_SPAN;

    for (let column = 0; column < grid.cellsPerSide; column += 1) {
      const x = grid.centerX(column) / STRENGTH_SPAN;
      const value = noise.fractal(x, z, { gain: STRENGTH_GAIN, octaves: STRENGTH_OCTAVES });

      strength[grid.index(column, row)] = clamp(value * STRENGTH_STRETCH, -1, 1);
    }
  }

  return strength;
}
