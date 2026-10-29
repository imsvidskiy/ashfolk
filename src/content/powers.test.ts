import { describe, expect, it } from "vitest";
import { describeParameters } from "./parameters.ts";
import {
  defaultPowerParameters,
  POWER_GROUPS,
  POWER_ORDER,
  POWERS,
  powerGroupsInCategory,
  powersInCategory,
  readPowerParameters,
} from "./powers.ts";

describe("powers", () => {
  it("orders every power exactly once", () => {
    expect([...POWER_ORDER].sort()).toEqual(Object.keys(POWERS).sort());
  });

  it("gives every parameter a label and a sane range", () => {
    for (const powerId of POWER_ORDER) {
      const metadata = describeParameters(POWERS[powerId].parameters).map((field) => {
        return field.metadata;
      });

      for (const field of metadata) {
        expect(field.label.length).toBeGreaterThan(0);
      }

      for (const range of metadata.filter((field) => {
        return field.kind === "range";
      })) {
        expect(range.minimum).toBeLessThan(range.maximum);
        expect(range.defaultValue).toBeGreaterThanOrEqual(range.minimum);
        expect(range.defaultValue).toBeLessThanOrEqual(range.maximum);
      }
    }
  });

  it("groups powers by category", () => {
    expect(powersInCategory("elements")).toEqual([
      "fire",
      "lightning",
      "rain",
      "snow",
      "explosion",
      "meteor",
      "earthquake",
      "volcano",
      "tornado",
    ]);
  });

  it("keeps each group of powers within one category", () => {
    for (const group of POWER_GROUPS) {
      const categories = new Set(
        group.map((powerId) => {
          return POWERS[powerId].category;
        })
      );

      expect(categories.size).toBe(1);
    }
  });

  it("splits the life powers into the tribe, the animals and the blessings", () => {
    expect(powerGroupsInCategory("life")).toEqual([
      ["tribe"],
      ["deer", "mammoth", "ibex", "hare", "wolf"],
      ["abundance", "inspiration", "healing"],
    ]);
  });

  it("falls back to defaults for invalid parameters", () => {
    expect(defaultPowerParameters("fire")).toEqual({ intensity: 60, radius: 25 });
    expect(readPowerParameters("fire", { intensity: 400, radius: 30 })).toEqual({ intensity: 60, radius: 25 });
    expect(readPowerParameters("fire", { intensity: 40, radius: 30 })).toEqual({ intensity: 40, radius: 30 });
  });
});
