import { describe, expect, it } from "vitest";
import { worldRulesSchema } from "../../../content/world-rules.ts";
import {
  armTribe,
  chronicleTexts,
  foundNeighboringTribes,
  foundTribe,
  longFeud,
  runUntil,
  SPRING_HARNESS,
  setFood,
} from "../../testing/test-rivalry.ts";
import { SocietyHarness, tickFor } from "../../testing/test-society.ts";
import { assignJob } from "../decisions.ts";
import { FleeJob } from "../jobs/flee-job.ts";
import { totalFood } from "../stock.ts";
import { rationsFor } from "./raids.ts";
import { sideOf } from "./relations.ts";

const FEUD_STORY = /^feud: The .+ became enemies over/u;
const GIFTS_STORY = /^peace: The .+ brought gifts to the .+, and they made peace/u;
const TRUCE_STORY = /^peace: .+ agreed to a truce/u;

describe("relations between tribes", () => {
  it("sour into a feud when their lands and hunting grounds overlap", () => {
    const quarrelsome = worldRulesSchema.parse({ life: { rivalry: 3 } });
    const harness = new SocietyHarness({ ...SPRING_HARNESS, rules: quarrelsome });

    const [first, second] = foundNeighboringTribes(harness, 480);

    runUntil(harness, 2400, () => {
      return harness.rivalry.relations.find(first.id, second.id)?.stance === "hostile";
    });

    const relation = harness.rivalry.relations.find(first.id, second.id);

    expect(relation?.stance).toBe("hostile");
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(FEUD_STORY));
  });

  it("anger the tribe whose land a stranger hunts on", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const first = foundTribe(harness, { adults: 2, children: 0, x: -420, z: 0 });
    const second = foundTribe(harness, { adults: 2, children: 0, x: 420, z: 0 });
    const [poacher] = harness.society.membersOf(first);

    poacher.mover.x = second.campX + 40;
    poacher.mover.z = second.campZ;
    poacher.job = {
      kind: "hunt",
      update: () => {
        return poacher.job;
      },
    };
    harness.run(4);

    const relation = harness.rivalry.relations.find(first.id, second.id);

    expect(relation?.lastGrudge).toBe("hunting");
    expect(relation === null ? 0 : sideOf(relation, second.id).grievance).toBeGreaterThan(0);
    expect(relation === null ? 0 : sideOf(relation, first.id).grievance).toBe(0);
  });

  it("start friendly with the tribe they split from", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [parent, offshoot] = foundNeighboringTribes(harness, 900);

    offshoot.originId = parent.id;
    harness.run(3);

    const relation = harness.rivalry.relations.find(parent.id, offshoot.id);

    expect(relation?.isKin).toBe(true);
    expect(relation?.stance).toBe("friendly");
  });

  it("forget when a vanished tribe rests and mourns", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [first] = foundNeighboringTribes(harness, 900);
    const vanishedId = first.id + 1000;

    const snapshot = harness.rivalry.snapshot(harness.society.people);

    snapshot.mourningUntil.set(vanishedId, 50);
    snapshot.restingUntil.set(vanishedId, 50);
    snapshot.restingUntil.set(first.id, 50);
    harness.rivalry.restore(snapshot, harness.society);
    harness.run(3);

    const { mourningUntil, restingUntil } = harness.rivalry.snapshot(harness.society.people);

    expect([...mourningUntil.keys()]).toEqual([]);
    expect([...restingUntil.keys()]).toEqual([first.id]);
  });
});

describe("peace", () => {
  it("comes with gifts carried by an envoy after a long and costly feud", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [first, second] = foundNeighboringTribes(harness, 420);

    const relation = longFeud(harness, first, second);

    setFood(first, 120);

    runUntil(harness, 200, () => {
      return relation.envoyId !== null;
    });

    expect(relation.envoyId).not.toBeNull();

    const hostFood = totalFood(second.stock);

    runUntil(harness, 600, () => {
      return relation.stance !== "hostile";
    });

    expect(relation.stance).toBe("neutral");
    expect(relation.truceUntilDay).toBeGreaterThan(harness.calendar.day);
    expect(totalFood(second.stock)).toBeGreaterThan(hostFood);
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(GIFTS_STORY));
  });

  it("keeps the gifts at home until the envoy reaches the other camp", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [first, second] = foundNeighboringTribes(harness, 420);

    const relation = longFeud(harness, first, second);

    setFood(first, 120);

    let seekerFood = totalFood(first.stock);

    runUntil(harness, 200, () => {
      if (relation.envoyId === null) {
        seekerFood = totalFood(first.stock);
      }

      return relation.envoyId !== null;
    });

    const envoy = harness.society.membersOf(first).find((person) => {
      return person.id === relation.envoyId;
    });

    if (envoy === undefined) {
      throw new Error("Expected an envoy on the way");
    }

    const tick = tickFor(harness, envoy, first);
    const rations = rationsFor(420, harness.context.rules.life.hungerRate);

    assignJob(tick, new FleeJob(tick, { x: envoy.mover.x + 5, z: envoy.mover.z }));
    harness.step();

    expect(envoy.job?.kind).toBe("flee");
    expect(totalFood(first.stock)).toBeGreaterThan(seekerFood - rations - 1);
  });

  it("is a bare truce when the weary tribe has nothing to give", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [first, second] = foundNeighboringTribes(harness, 420);

    const relation = longFeud(harness, first, second);

    setFood(first, 0);
    setFood(second, 0);

    runUntil(harness, 400, () => {
      setFood(first, 0);

      return relation.stance !== "hostile";
    });

    expect(relation.stance).toBe("neutral");
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(TRUCE_STORY));
  });
});

describe("determinism", () => {
  function replay(): string[] {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [raiders, victims] = foundNeighboringTribes(harness, 420);

    armTribe(raiders, 200);
    armTribe(victims, 60);
    harness.rivalry.campaigns.launch(raiders, victims, harness.context);
    harness.run(240);

    return [
      ...harness.chronicle.takeEntries().map((entry) => {
        return entry.text;
      }),
      ...harness.society.people.map((person) => {
        return `${person.id} ${person.mover.x.toFixed(4)} ${person.mover.z.toFixed(4)} ${person.health.toFixed(4)}`;
      }),
    ];
  }

  it("fights the same raid the same way for the same seed", () => {
    expect(replay()).toEqual(replay());
  });
});
