import { describe, expect, it } from "vitest";
import { nextTechnology, TECHNOLOGIES, type TechnologyId } from "./technologies.ts";

describe("technologies", () => {
  it("unlock in order of their requirements", () => {
    const known = new Set<TechnologyId>();
    const order: TechnologyId[] = [];

    for (let next = nextTechnology(known); next !== undefined; next = nextTechnology(known)) {
      known.add(next.id);
      order.push(next.id);
    }

    expect(order).toEqual(
      TECHNOLOGIES.map((technology) => {
        return technology.id;
      })
    );
  });
});
