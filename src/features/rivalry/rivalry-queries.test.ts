import { describe, expect, it } from "vitest";
import { createRaid, createRelation } from "../testing/world-fixtures.ts";
import { byStance, isFeuding, raidOf } from "./rivalry-queries.ts";

describe("rivalry queries", () => {
  it("sorts relations from hostile to friendly with the lowest standing first", () => {
    const relations = [
      createRelation({ firstId: 1, stance: "friendly", standing: 10 }),
      createRelation({ firstId: 2, stance: "wary", standing: -5 }),
      createRelation({ firstId: 3, stance: "hostile", standing: -20 }),
      createRelation({ firstId: 4, stance: "wary", standing: -15 }),
      createRelation({ firstId: 5, stance: "neutral", standing: 0 }),
    ];

    expect(
      relations.toSorted(byStance).map((relation) => {
        return relation.firstId;
      })
    ).toEqual([3, 4, 2, 5, 1]);
  });

  it("finds the raid a tribe takes part in on either side", () => {
    const raid = createRaid({ attackerId: 2, defenderId: 1 });
    const rivalry = { raids: [raid], relations: [] };

    expect(raidOf(rivalry, 1)).toBe(raid);
    expect(raidOf(rivalry, 2)).toBe(raid);
    expect(raidOf(rivalry, 3)).toBeNull();
  });

  it("counts only hostile relations as feuds", () => {
    const rivalry = {
      raids: [],
      relations: [
        createRelation({ firstId: 1, secondId: 2, stance: "hostile" }),
        createRelation({ firstId: 2, secondId: 3, stance: "wary" }),
      ],
    };

    expect(isFeuding(rivalry, 2)).toBe(true);
    expect(isFeuding(rivalry, 3)).toBe(false);
  });
});
