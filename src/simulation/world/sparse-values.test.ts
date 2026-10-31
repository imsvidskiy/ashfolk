import { describe, expect, it } from "vitest";
import { applySparse, sparseDifference } from "./sparse-values.ts";

describe("sparse values", () => {
  it("keep only the cells that differ from the baseline and put them back", () => {
    const baseline = Float32Array.of(0, 1, 2, 3);
    const values = Float32Array.of(0, 5, 2, -1);

    const sparse = sparseDifference(values, baseline);
    const restored = baseline.slice();

    applySparse(restored, sparse);

    expect([...sparse.cells]).toEqual([1, 3]);
    expect(restored).toEqual(values);
  });

  it("keep a negative zero so the restored layer is exactly the saved one", () => {
    const restored = new Float32Array(2);

    applySparse(restored, sparseDifference(Float32Array.of(-0, 0), new Float32Array(2)));

    expect(Object.is(restored[0], -0)).toBe(true);
    expect(Object.is(restored[1], 0)).toBe(true);
  });

  it("skip saved cells that do not fit the island", () => {
    const target = new Float32Array(2);

    applySparse(target, { cells: Int32Array.of(-1, 1, 5), values: Float64Array.of(7, 8, 9) });

    expect([...target]).toEqual([0, 8]);
  });
});
