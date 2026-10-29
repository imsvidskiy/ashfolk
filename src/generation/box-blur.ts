import type { WorldGrid } from "../world/world-grid.ts";

export function boxBlur(grid: WorldGrid, values: Float32Array, radius: number): Float32Array {
  const size = grid.cellsPerSide;
  const across = new Float32Array(values.length);
  const result = new Float32Array(values.length);

  function blurLine(source: Float32Array, target: Float32Array, first: number, stride: number): void {
    let sum = 0;
    let count = 0;

    for (let index = 0; index < Math.min(radius, size); index += 1) {
      sum += source[first + index * stride];
      count += 1;
    }

    for (let index = 0; index < size; index += 1) {
      const entering = index + radius;
      const leaving = index - radius - 1;

      if (entering < size) {
        sum += source[first + entering * stride];
        count += 1;
      }

      if (leaving >= 0) {
        sum -= source[first + leaving * stride];
        count -= 1;
      }

      target[first + index * stride] = sum / count;
    }
  }

  for (let row = 0; row < size; row += 1) {
    blurLine(values, across, row * size, 1);
  }

  for (let column = 0; column < size; column += 1) {
    blurLine(across, result, column, size);
  }

  return result;
}
