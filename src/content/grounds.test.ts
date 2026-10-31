import { describe, expect, it } from "vitest";
import { GROUNDS, Ground, seasonalGroundColor } from "./grounds.ts";

describe("grounds", () => {
  it("lists grounds in the order of their indices", () => {
    expect(
      GROUNDS.map((ground) => {
        return ground.index;
      })
    ).toEqual(
      GROUNDS.map((_ground, position) => {
        return position;
      })
    );
    expect(GROUNDS).toHaveLength(Object.keys(Ground).length);
  });

  it("blends ground colors at the end of a season", () => {
    const midSummer = seasonalGroundColor(Ground.Meadow, 1.2);
    const lateSummer = seasonalGroundColor(Ground.Meadow, 1.95);

    expect(midSummer).toEqual([0.48, 0.48, 0.3]);
    expect(lateSummer[0]).toBeGreaterThan(midSummer[0]);
  });

  it("blends late winter into the colors of spring", () => {
    const spring = seasonalGroundColor(Ground.Meadow, 0.2);
    const lateWinter = seasonalGroundColor(Ground.Meadow, 3.999);

    for (const [channel, value] of lateWinter.entries()) {
      expect(value).toBeCloseTo(spring[channel]);
    }
  });

  it("grows grass on soft ground and none on bare stone or eternal snow", () => {
    const covers = GROUNDS.map((ground) => {
      return ground.grass;
    });

    expect(
      covers.every((cover) => {
        return cover >= 0 && cover <= 1;
      })
    ).toBe(true);
    expect(GROUNDS[Ground.Meadow].grass).toBe(1);
    expect(GROUNDS[Ground.Forest].grass).toBeLessThan(GROUNDS[Ground.Meadow].grass);
    expect(
      [Ground.Rock, Ground.RedRock, Ground.Snow].map((index) => {
        return GROUNDS[index].grass;
      })
    ).toEqual([0, 0, 0]);
  });
});
