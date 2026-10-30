import { describe, expect, it } from "vitest";
import { MinHeap } from "./min-heap.ts";

describe("min heap", () => {
  it("pops items from the lowest priority up", () => {
    const heap = new MinHeap(2);
    const priorities = [5, 1, 9, 3, 7, 2, 8];

    for (const [item, priority] of priorities.entries()) {
      heap.push(item, priority);
    }

    const order: number[] = [];

    while (heap.size > 0) {
      order.push(heap.pop());
    }

    expect(order).toEqual([1, 5, 3, 0, 4, 6, 2]);
  });

  it("forgets every item when cleared", () => {
    const heap = new MinHeap();

    heap.push(1, 1);
    heap.push(2, 2);
    heap.clear();
    heap.push(3, 3);

    expect(heap.size).toBe(1);
    expect(heap.pop()).toBe(3);
  });

  it("refuses to pop when empty", () => {
    expect(() => {
      return new MinHeap().pop();
    }).toThrow(RangeError);
  });
});
