import { describe, expect, it } from "vitest";
import { chronicleTexts, foundNeighboringTribes, SPRING_HARNESS } from "../../testing/test-rivalry.ts";
import { SocietyHarness, tickFor } from "../../testing/test-society.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { FightJob } from "./defense-jobs.ts";
import { personFoe } from "./foes.ts";
import { sideOf } from "./relations.ts";
import { strike } from "./strikes.ts";

const SPEAR: CarriedWeapon = { kind: "spear", material: "stone" };
const SLAIN_STORY = /was slain by the/u;

describe("combat", () => {
  it("blocks some blows of a fighter facing the attack and lets others through", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [first, second] = foundNeighboringTribes(harness, 900);
    const [attacker] = harness.society.membersOf(first);
    const [defender] = harness.society.membersOf(second);

    defender.mover.x = attacker.mover.x;
    defender.mover.z = attacker.mover.z + 2;
    defender.mover.heading = Math.PI;
    defender.job = new FightJob(tickFor(harness, defender, second), personFoe(attacker), SPEAR);

    const outcomes = Array.from({ length: 60 }, () => {
      defender.health = 1;
      harness.rivalry.ledger.update(5);

      return strike(attacker, SPEAR, personFoe(defender), harness.context);
    });

    expect(outcomes).toContain("blocked");
    expect(outcomes).toContain("hit");
    expect(outcomes).toContain("missed");
  });

  it("records the fallen and the blood feud they leave behind", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [first, second] = foundNeighboringTribes(harness, 900);
    const [slayer] = harness.society.membersOf(first);
    const [victim] = harness.society.membersOf(second);

    harness.rivalry.relations.meet(first.id, second.id, false);
    victim.health = 0.05;
    victim.mover.x = slayer.mover.x + 1;
    victim.mover.z = slayer.mover.z;

    for (let attempt = 0; attempt < 20 && victim.isAlive; attempt += 1) {
      strike(slayer, SPEAR, personFoe(victim), harness.context);
    }

    const relation = harness.rivalry.relations.find(first.id, second.id);

    expect(victim.isAlive).toBe(false);
    expect(victim.causeOfDeath).toBe("battle");
    expect(victim.pose).toBe("fall");
    expect(relation?.lastGrudge).toBe("blood");
    expect(relation === null ? 0 : sideOf(relation, second.id).deaths).toBe(1);
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(SLAIN_STORY));

    harness.run(2);

    expect(victim.pose).toBe("dead");
  });
});
