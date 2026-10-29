type NumericArray = Float32Array | Int32Array | Uint8Array;

export interface SparseValues {
  cells: Int32Array;
  values: Float64Array;
}

export function sparseDifference(values: NumericArray, baseline: NumericArray): SparseValues {
  const cells: number[] = [];

  for (let cell = 0; cell < values.length; cell += 1) {
    if (!Object.is(values[cell], baseline[cell])) {
      cells.push(cell);
    }
  }

  return {
    cells: Int32Array.from(cells),
    values: Float64Array.from(cells, (cell) => {
      return values[cell];
    }),
  };
}

export function applySparse(target: NumericArray, sparse: SparseValues): void {
  for (const [position, cell] of sparse.cells.entries()) {
    if (cell >= 0 && cell < target.length) {
      target[cell] = sparse.values[position];
    }
  }
}
