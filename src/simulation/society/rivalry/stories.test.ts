import { describe, expect, it } from "vitest";
import { emptyStock } from "../stock.ts";
import { createTribe, type Tribe } from "../tribe.ts";
import type { Raid } from "./raids.ts";
import { mourningText, raidSummary } from "./stories.ts";

const RAIDERS = tribeNamed(1, "Bear Clan");
const VICTIMS = tribeNamed(2, "Wolf Clan");

type RaidOutcome = Partial<Pick<Raid, "burned" | "fallenDefenders" | "fallenRaiders" | "loot">>;

function tribeNamed(id: number, name: string): Tribe {
  return createTribe({ campX: 0, campZ: 0, day: 0, id, identity: { color: "#c8553d", furColor: "#6b4a33", name } });
}

function raidEnding(outcome: RaidOutcome): Raid {
  return {
    aim: "plunder",
    attackerId: RAIDERS.id,
    burned: [],
    defenderId: VICTIMS.id,
    fallenDefenders: [],
    fallenRaiders: [],
    id: 1,
    isAlarmRaised: true,
    loot: emptyStock(),
    phase: "retreat",
    phaseSeconds: 0,
    rally: { x: 0, z: 0 },
    routedIds: new Set(),
    struckIds: new Set(),
    target: { x: 0, z: 0 },
    warriorIds: [],
    ...outcome,
  };
}

describe("raid stories", () => {
  it("tell what a raid did, naming one or two of the fallen and counting more", () => {
    const raid = raidEnding({
      burned: ["hut"],
      fallenDefenders: ["Ama"],
      fallenRaiders: ["Bo", "Cy"],
      loot: { ...emptyStock(), copper: 2, meat: 11.6, wood: 3 },
    });

    expect(raidSummary(raid, RAIDERS, VICTIMS)).toBe(
      "The Bear Clan raided the Wolf Clan: Ama fell, the hut was set ablaze, carried off 12 food, 3 wood and 2 copper, losing Bo and Cy of their own"
    );
    expect(raidSummary(raidEnding({ fallenDefenders: ["Ama", "Bo", "Cy"] }), RAIDERS, VICTIMS)).toBe(
      "The Bear Clan raided the Wolf Clan: three fell"
    );
  });

  it("tell of a raid driven off when it did no harm", () => {
    expect(raidSummary(raidEnding({ fallenRaiders: ["Bo"] }), RAIDERS, VICTIMS)).toBe(
      "The Wolf Clan drove off a raid by the Bear Clan, losing Bo of their own"
    );
  });

  it("list everyone a tribe mourns", () => {
    expect(mourningText(VICTIMS, ["Ama", "Bo", "Cy"])).toBe("The Wolf Clan mourned Ama, Bo and Cy");
  });
});
