import { describe, expect, it } from "vitest";
import { createPowerSimulation } from "../testing/test-powers.ts";
import { snapshotOf } from "../testing/test-simulation.ts";
import { TICK_SECONDS } from "../tick.ts";
import { BOMB_FALL_TICKS } from "./falling-bombs.ts";

describe("falling bombs", () => {
  it("leaves the target untouched until impact and resolves each drop exactly once", () => {
    const simulation = createPowerSimulation();
    const before = simulation.world.heightAt(0, 0);

    simulation.execute({ parameters: { radius: 100 }, powerId: "nuclear", type: "usePower", x: 0, z: 0 });
    expect(simulation.advance(0).effects).toEqual([
      expect.objectContaining({ kind: "nuclear-fall", radius: 100, surfaceY: before, x: 0, z: 0 }),
    ]);

    simulation.runTicks(1);
    simulation.usePower("nuclear", 200, 0, { radius: 55 });
    simulation.runTicks(BOMB_FALL_TICKS - 2);
    expect(simulation.advance(0).effects).toEqual([expect.objectContaining({ kind: "nuclear-fall", x: 200 })]);
    expect(simulation.world.heightAt(0, 0)).toBe(before);

    simulation.step();
    expect(simulation.advance(0).effects).toContainEqual({
      dropId: expect.any(Number),
      isInWater: false,
      kind: "nuclear-cloud",
      radius: 100,
      surfaceY: before,
      x: 0,
      z: 0,
    });
    expect(simulation.world.heightAt(0, 0)).toBeLessThan(before - 20);

    simulation.step();
    expect(simulation.advance(0).effects).toContainEqual(expect.objectContaining({ kind: "nuclear-cloud", x: 200 }));
    simulation.runTicks(BOMB_FALL_TICKS);
    expect(
      simulation.advance(0).effects.some((effect) => {
        return effect.kind === "nuclear-cloud";
      })
    ).toBe(false);
  });

  it("resumes a paused midair drop at the same height and impact tick", () => {
    const original = createPowerSimulation();
    const loaded = createPowerSimulation();
    const flownTicks = 11;

    original.usePower("nuclear", 0, 0, { radius: 100 });
    original.runTicks(flownTicks);
    original.setPaused(true);
    loaded.restore(snapshotOf(original));

    expect(loaded.initialWorld().frame.effects).toEqual([
      expect.objectContaining({ elapsedSeconds: flownTicks * TICK_SECONDS, kind: "nuclear-fall" }),
    ]);
    for (let frame = 0; frame < 30; frame += 1) {
      loaded.advance(0.25);
    }
    expect(snapshotOf(loaded).fallingBombs).toEqual(snapshotOf(original).fallingBombs);

    loaded.runTicks(BOMB_FALL_TICKS - flownTicks - 1);
    expect(loaded.advance(0).effects).toEqual([]);
    original.advance(0);
    original.runTicks(BOMB_FALL_TICKS - flownTicks);
    loaded.step();

    expect(loaded.advance(0).effects).toEqual(original.advance(0).effects);
    expect(loaded.world.heightAt(0, 0)).toBe(original.world.heightAt(0, 0));
    expect(loaded.random.state()).toEqual(original.random.state());
  });
});
