import { describe, expect, it } from "vitest";
import { describeParameters } from "../../content/parameters.ts";
import { POWER_ORDER, POWERS, type PowerId } from "../../content/powers.ts";
import { POWER_OPTION_ICONS } from "./power-icons.tsx";

function choiceOptionsOf(powerId: PowerId) {
  return describeParameters(POWERS[powerId].parameters).flatMap((field) => {
    const { metadata } = field;

    if (metadata.kind !== "choice") {
      return [];
    }

    return metadata.options.map((option) => {
      return { key: field.key, value: option.value };
    });
  });
}

describe("power option icons", () => {
  it("gives every choice of every power an icon", () => {
    for (const powerId of POWER_ORDER) {
      for (const { key, value } of choiceOptionsOf(powerId)) {
        expect(POWER_OPTION_ICONS[powerId]?.[key]?.[value], `${powerId}.${key}.${value}`).toBeDefined();
      }
    }
  });
});
