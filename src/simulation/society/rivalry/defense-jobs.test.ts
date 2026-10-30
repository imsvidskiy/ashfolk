import { describe, expect, it } from "vitest";
import { runUntil, SPRING_HARNESS, standOff } from "../../testing/test-rivalry.ts";
import { SocietyHarness, tickFor } from "../../testing/test-society.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { BARE_HANDS } from "./combat-stats.ts";
import { FightJob } from "./defense-jobs.ts";
import { personFoe } from "./foes.ts";

const QUIVER = 10;
const SPEAR: CarriedWeapon = { kind: "spear", material: "stone" };
const BOW: CarriedWeapon = { kind: "bow", material: "stone" };

describe("combat", () => {
  it("lets a spearman get the better of a bare-handed fighter", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const { far: brawler, first, near: spearman, second } = standOff(harness, 6);

    spearman.job = new FightJob(tickFor(harness, spearman, first), personFoe(brawler), SPEAR);
    brawler.job = new FightJob(tickFor(harness, brawler, second), personFoe(spearman), BARE_HANDS);
    runUntil(harness, 40, () => {
      return !(spearman.isAlive && brawler.isAlive) || brawler.health < 0.25;
    });

    expect(brawler.health).toBeLessThan(spearman.health);
    expect(brawler.health).toBeLessThan(0.3);
  });

  it("looses arrows that fly before they wound", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const { far: target, first, near: archer } = standOff(harness, 15);

    first.stock.arrows = QUIVER;
    archer.job = new FightJob(tickFor(harness, archer, first), personFoe(target), BOW);
    runUntil(harness, 30, () => {
      return target.health < 1;
    });

    const arrows = harness.effects.takeEffects().filter((effect) => {
      return effect.kind === "arrow";
    });

    expect(arrows.length).toBeGreaterThan(0);
    expect(first.stock.arrows).toBe(QUIVER - arrows.length);
    expect(target.health).toBeLessThan(1);
    expect(archer.pose === "shoot" || archer.pose === "flinch").toBe(true);
  });

  it("closes in bare-handed when the tribe has no arrows left", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const { far: target, first, near: archer } = standOff(harness, 15);

    first.stock.arrows = 0;
    archer.job = new FightJob(tickFor(harness, archer, first), personFoe(target), BOW);
    runUntil(harness, 20, () => {
      return archer.pose === "brawl";
    });

    expect(
      harness.effects.takeEffects().some((effect) => {
        return effect.kind === "arrow";
      })
    ).toBe(false);
    expect(archer.pose).toBe("brawl");
  });
});
