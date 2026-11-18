import { describe, expect, it } from "vitest";
import type { PowerId } from "../../content/powers.ts";
import type { SimulationEffect } from "../effects.ts";
import { createPowerSimulation } from "../testing/test-powers.ts";
import { snapshotOf } from "../testing/test-simulation.ts";
import { SPRING_GROUND } from "../world/world-state.ts";

function cast(powerId: PowerId, count: number): SimulationEffect[] {
  const simulation = createPowerSimulation();

  simulation.execute({ parameters: { count }, powerId, type: "usePower", x: 0, z: 0 });

  const effects = simulation.advance(0).effects.slice();

  for (let step = 0; step < 45; step += 1) {
    effects.push(...simulation.advance(0.1).effects);
  }

  return effects;
}

describe("greater elements", () => {
  it("stages a meteor shower and lands every rock at its own target", () => {
    const effects = cast("meteor-shower", 4);
    const meteors = effects.filter((effect) => {
      return effect.kind === "meteor";
    });
    const impacts = effects.filter((effect) => {
      return effect.kind === "explosion";
    });

    expect(meteors).toHaveLength(4);
    expect(
      new Set(
        meteors.map((meteor) => {
          return meteor.toX;
        })
      ).size
    ).toBe(4);
    expect(
      impacts.map((impact) => {
        return [impact.x, impact.z];
      })
    ).toEqual(
      meteors.map((meteor) => {
        return [meteor.toX, meteor.toZ];
      })
    );
  });

  it("replays a storm in the same places, one strike after another", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("lightning-storm", 0, 0, { count: 4 });

    expect(simulation.advance(0).effects).toEqual([expect.objectContaining({ kind: "lightning", x: 0, z: 0 })]);

    const first = cast("lightning-storm", 4);
    const second = cast("lightning-storm", 4);

    expect(first).toEqual(second);
    expect(
      first.filter((effect) => {
        return effect.kind === "lightning";
      })
    ).toHaveLength(4);
  });

  it("charts separate paths for all of a swarm's funnels", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tornado-swarm", 0, 0, { count: 3 });

    const effects = simulation.advance(0).effects.filter((effect) => {
      return effect.kind === "tornado";
    });

    expect(effects).toHaveLength(3);
    expect(
      new Set(
        effects.map((effect) => {
          return effect.path[0];
        })
      ).size
    ).toBe(3);
  });

  it("draws nearby people inward on the game clock and releases the world afterwards", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 3 });

    const [person] = simulation.society.people;
    const { x: startX, z } = person.mover;
    const x = startX + 48;

    simulation.execute({ isPaused: true, type: "setPaused" });
    simulation.usePower("black-hole", x, z, { duration: 5, radius: 100 });

    expect(simulation.advance(1).effects).toContainEqual({
      durationSeconds: 5,
      kind: "black-hole",
      radius: 100,
      surfaceY: simulation.world.surfaceAt(x, z),
      x,
      z,
    });
    expect(person.mover.x).toBe(startX);
    expect(simulation.snapshot()?.isPaused).toBe(true);

    simulation.runTicks(5);

    expect(Math.hypot(person.mover.x - x, person.mover.z - z)).toBeLessThan(45);

    simulation.runTicks(50);

    expect(simulation.isBusy).toBe(false);
  });

  it("draws people across blocked ground and leaves a held person alone", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, { people: 3 });

    const [free, held] = simulation.society.people;
    const { world } = simulation;

    free.mover.x = 1;
    free.mover.z = 5;
    world.occupancy[world.grid.cellAt(15, 5)] = SPRING_GROUND;
    simulation.grab({ id: held.id, kind: "person" });
    simulation.carry(48, 5);

    const { x, z } = held.mover;
    const { health } = held;

    simulation.usePower("black-hole", 48, 5, { radius: 100 });
    simulation.runTicks(15);

    expect(free.causeOfDeath).toBe("gravity");
    expect(simulation.society.people).not.toContain(free);
    expect(held.mover.x).toBe(x);
    expect(held.mover.z).toBe(z);
    expect(held.health).toBe(health);
  });

  it("saves a paused sky and resumes each well and funnel at its original age", () => {
    const original = createPowerSimulation();
    const loaded = createPowerSimulation();

    original.usePower("tornado-swarm", 0, 0, { count: 3, duration: 5 });
    original.usePower("black-hole", 0, 0, { duration: 5 });
    original.runTicks(10);
    original.execute({ isPaused: true, type: "setPaused" });

    loaded.restore(snapshotOf(original));

    const restored = loaded.initialWorld().frame;

    expect(restored.isPaused).toBe(true);
    expect(restored.effects).toHaveLength(4);

    for (const effect of restored.effects) {
      expect(effect).toMatchObject({ elapsedSeconds: expect.closeTo(1, 6) });
    }

    original.runTicks(43);
    loaded.runTicks(43);

    expect(loaded.isBusy).toBe(false);
    expect(loaded.random.state()).toEqual(original.random.state());
    expect(loaded.world.vegetation.exportBuffers()).toEqual(original.world.vegetation.exportBuffers());
  });

  it("refuses to open a storm or a black hole off the island", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("meteor-shower", 2000, 2000, {});
    simulation.usePower("black-hole", 2000, 2000, {});

    expect(simulation.advance(0).effects).toEqual([]);
    expect(simulation.isBusy).toBe(false);
  });
});
