import { describe, expect, it } from "vitest";
import { sceneFromQuery } from "./scenes.ts";

const NOT_A_NUMBER = /takes a number/u;

describe("scenes from a query", () => {
  it("takes the season, seconds and speed out of the page query", () => {
    expect(sceneFromQuery("fall", "seed=7&season=2.6&seconds=90&speed=16&hours=11")).toEqual({
      name: "fall",
      query: "seed=7&hours=11",
      season: 2.6,
      seconds: 90,
      speed: 16,
    });
  });

  it("keeps a query without scene options as it is", () => {
    expect(sceneFromQuery("plain", "seed=7&paused=1")).toEqual({ name: "plain", query: "seed=7&paused=1" });
  });

  it.each(["season=autumn", "seconds=", "speed=fast"])("rejects %s, which is not a number", (option) => {
    expect(() => {
      return sceneFromQuery("fall", `seed=7&${option}`);
    }).toThrow(NOT_A_NUMBER);
  });
});
