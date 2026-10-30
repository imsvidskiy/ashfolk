import { describe, expect, it } from "vitest";
import {
  armTribe,
  chronicleTexts,
  foundNeighboringTribes,
  foundTribe,
  runUntil,
  SPRING_HARNESS,
  setFood,
} from "../../testing/test-rivalry.ts";
import { SocietyHarness } from "../../testing/test-society.ts";
import { totalFood } from "../stock.ts";
import type { RaidPhase } from "./raids.ts";
import { sideOf } from "./relations.ts";

const RAID_SENT_STORY = /^raid: The .+ sent \d warriors against the .+/u;
const RAID_OUTCOME_STORY = /^raid: The .+ (?:raided|drove off a raid by) the .+/u;
const PLUNDER_STORY = /^raid: The .+ raided the .+: carried off/u;

describe("a raid", () => {
  it("musters, marches, fights at the enemy camp and comes home to tell of it", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [raiders, victims] = foundNeighboringTribes(harness, 420);

    armTribe(raiders, 200);
    armTribe(victims, 60);

    const raid = harness.rivalry.campaigns.launch(raiders, victims, harness.context);

    expect(raid).not.toBeNull();
    expect(raid?.warriorIds.length).toBeGreaterThanOrEqual(3);

    const phases = new Set<RaidPhase>();
    const victimJobs = new Set<string>();

    runUntil(harness, 900, () => {
      for (const current of harness.rivalry.campaigns.raids) {
        phases.add(current.phase);
      }

      for (const person of harness.society.membersOf(victims)) {
        victimJobs.add(String(person.job?.kind));
      }

      return harness.rivalry.campaigns.raids.length === 0;
    });

    const story = chronicleTexts(harness);

    expect([...phases]).toEqual(["muster", "march", "assault", "retreat"]);
    expect(harness.rivalry.campaigns.raids).toHaveLength(0);
    expect(victimJobs).toContain("defend");
    expect(victimJobs).toContain("hide");
    expect(story).toContainEqual(expect.stringMatching(RAID_SENT_STORY));
    expect(story).toContainEqual(expect.stringMatching(RAID_OUTCOME_STORY));
  });

  it("brings plunder home when the camp is left undefended", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const raiders = foundTribe(harness, { adults: 8, children: 0, x: -200, z: 0 });
    const victims = foundTribe(harness, { adults: 0, children: 4, x: 200, z: 0 });

    armTribe(raiders, 200);
    setFood(victims, 80);
    victims.stock.wood = 30;

    harness.rivalry.campaigns.launch(raiders, victims, harness.context);
    runUntil(harness, 900, () => {
      return harness.rivalry.campaigns.raids.length === 0;
    });

    const story = chronicleTexts(harness);

    expect(totalFood(victims.stock)).toBeLessThan(80);
    expect(story).toContainEqual(expect.stringMatching(PLUNDER_STORY));
  });

  it("leaves a grudge over burning when it sets the camp ablaze", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const raiders = foundTribe(harness, { adults: 8, children: 0, x: -200, z: 0 });
    const victims = foundTribe(harness, { adults: 0, children: 4, x: 200, z: 0 });

    armTribe(raiders, 200);
    setFood(victims, 80);

    const raid = harness.rivalry.campaigns.launch(raiders, victims, harness.context);

    raid?.burned.push("hut");
    runUntil(harness, 900, () => {
      return harness.rivalry.campaigns.raids.length === 0;
    });

    expect(harness.rivalry.relations.find(raiders.id, victims.id)?.lastGrudge).toBe("burning");
  });

  it("brings plunder home from a camp too far to reach before the retreat ends", () => {
    const harness = new SocietyHarness({
      ...SPRING_HARNESS,
      world: { dimensions: { cellSize: 10, cellsPerSide: 160 } },
    });

    const raiders = foundTribe(harness, { adults: 8, children: 0, x: -550, z: 0 });
    const victims = foundTribe(harness, { adults: 0, children: 4, x: 550, z: 0 });

    armTribe(raiders, 200);
    setFood(victims, 80);
    victims.stock.copper = 30;

    const raid = harness.rivalry.campaigns.launch(raiders, victims, harness.context);

    runUntil(harness, 1500, () => {
      return harness.rivalry.campaigns.raids.length === 0;
    });
    runUntil(harness, 600, () => {
      return harness.society.membersOf(raiders).every((person) => {
        return person.job?.kind !== "raid";
      });
    });

    expect(raid?.loot.copper).toBeGreaterThan(0);
    expect(raiders.stock.copper).toBe(raid?.loot.copper);
  });

  it("stays home in winter", () => {
    const harness = new SocietyHarness({ ...SPRING_HARNESS, day: 10.4 });

    const [first, second] = foundNeighboringTribes(harness, 420);

    const relation = harness.rivalry.relations.meet(first.id, second.id, false);

    armTribe(first, 300);
    relation.standing = -100;
    relation.stance = "hostile";
    sideOf(relation, first.id).grievance = 200;
    harness.run(60);

    expect(harness.rivalry.campaigns.raids).toHaveLength(0);
  });
});
