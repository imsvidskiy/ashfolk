import { describe, expect, it } from "vitest";
import { buffersWithin } from "./buffers.ts";

describe("buffers within a value", () => {
  it("finds each buffer once, through objects, arrays, maps and sets", () => {
    const shared = new Float32Array(4);
    const nested = new Uint8Array(2);
    const listed = new Int32Array(1);

    const found = buffersWithin({
      cells: [shared, new Float32Array(shared.buffer, 4, 1)],
      layers: new Map([["ground", { values: nested }]]),
      marks: new Set([listed]),
      name: "island",
      tick: 3,
    });

    expect(found).toHaveLength(3);
    expect(found).toContain(shared.buffer);
    expect(found).toContain(nested.buffer);
    expect(found).toContain(listed.buffer);
  });

  it("leaves out shared memory, which cannot move between threads", () => {
    expect(buffersWithin({ cells: new Int32Array(new SharedArrayBuffer(8)) })).toEqual([]);
  });
});
