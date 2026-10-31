import { describe, expect, it } from "vitest";
import { armTribe, foundTribe, runUntil, SPRING_HARNESS, setFood } from "../../testing/test-rivalry.ts";
import { SocietyHarness } from "../../testing/test-society.ts";
import type { Tribe } from "../tribe.ts";
import { MARCH_SPEED, type Raid } from "./raids.ts";

const STORES_REACH = 3;
const STEADY_PACE = 0.9;
const FREEZING = 0.1;

function launchRaid(harness: SocietyHarness, raiders: Tribe, victims: Tribe): Raid {
  const raid = harness.rivalry.campaigns.launch(raiders, victims, harness.context);

  if (raid === null) {
    throw new Error("Expected the raid to set out");
  }

  return raid;
}

describe("a raider", () => {
  it("runs to the stores to plunder once a comrade has set the workshop alight", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const raiders = foundTribe(harness, { adults: 9, children: 0, x: -200, z: 0 });
    const victims = foundTribe(harness, { adults: 0, children: 4, x: 200, z: 0 });
    const workshop = harness.buildings.add(
      { kind: "workshop", rotation: 0, tribeId: victims.id, x: 230, z: 30 },
      harness.random
    );

    armTribe(raiders, 200);
    setFood(victims, 80);
    workshop.progress = 1;
    harness.rivalry.relations.meet(raiders.id, victims.id, false).standing = -80;

    const raid = launchRaid(harness, raiders, victims);
    const struck = new Set<number>();

    let plunderedAtTheStores = 0;

    runUntil(harness, 900, () => {
      for (const id of raid.struckIds) {
        const raider = harness.society.findPerson(id);

        if (raider === null || struck.has(id)) {
          continue;
        }

        struck.add(id);

        if (Math.hypot(raider.mover.x - victims.campX, raider.mover.z - victims.campZ) < STORES_REACH) {
          plunderedAtTheStores += 1;
        }
      }

      return raid.phase === "retreat";
    });

    expect(raid.aim).toBe("burn");
    expect(raid.burned).toEqual(["workshop"]);
    expect(struck.size).toBeGreaterThan(2);
    expect(plunderedAtTheStores).toBe(struck.size - 1);
  });

  it("keeps marching at full pace when a comrade turns back", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const raiders = foundTribe(harness, { adults: 10, children: 0, x: -400, z: 0 });
    const victims = foundTribe(harness, { adults: 8, children: 0, x: 400, z: 0 });

    armTribe(raiders, 400);

    const raid = launchRaid(harness, raiders, victims);
    const [deserter, ...marchers] = harness.society.membersOf(raiders).filter((person) => {
      return raid.warriorIds.includes(person.id);
    });

    runUntil(harness, 120, () => {
      return raid.phase === "march";
    });
    harness.run(20);
    deserter.warmth = FREEZING;
    harness.run(6);

    expect(raid.phase).toBe("march");
    expect(raid.routedIds).toContain(deserter.id);
    expect(deserter.job?.kind).toBe("raid");

    for (const marcher of marchers) {
      expect(marcher.speed).toBeGreaterThan(MARCH_SPEED * STEADY_PACE);
    }
  });
});
