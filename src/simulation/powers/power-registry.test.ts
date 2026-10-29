import { describe, expect, it } from "vitest";
import { POWER_ORDER, POWERS } from "../../content/powers.ts";
import { parsePowerParameters } from "./power-registry.ts";

describe("power registry", () => {
  it("accepts the defaults of every power", () => {
    for (const powerId of POWER_ORDER) {
      expect(parsePowerParameters(powerId, {})).toEqual(POWERS[powerId].parameters.parse({}));
    }
  });

  it("rejects parameters outside their range", () => {
    expect(parsePowerParameters("fire", { radius: 9000 })).toBeNull();
  });
});
