import { describe, expect, it } from "vitest";
import type { LightningEffect } from "../effects.ts";
import { brush, createPowerSimulation } from "../testing/test-powers.ts";
import { centerCell, livingCount } from "../testing/test-world.ts";

describe("elements", () => {
  it("rain puts out fire and soaks the ground", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("fire", 0, 0, { radius: 30 });
    brush(simulation, "rain", 4);

    expect(simulation.fire.burningCount).toBe(0);
    expect(simulation.world.fields.wetness[centerCell(simulation.world)]).toBeGreaterThan(0.5);
  });

  it("snow covers the ground", () => {
    const simulation = createPowerSimulation();

    brush(simulation, "snow", 1);

    expect(simulation.world.fields.snow[centerCell(simulation.world)]).toBeGreaterThan(0.3);
  });

  it("snow douses fire less toward the rim of the brush", () => {
    const simulation = createPowerSimulation();

    const { fields, grid } = simulation.world;

    const center = centerCell(simulation.world);
    const rim = grid.cellAt(90, 0);

    fields.fire[center] = 1;
    fields.fire[rim] = 1;
    simulation.beginStroke("snow", 0, 0, { radius: 100 });
    simulation.endStroke();

    expect(fields.fire[center]).toBeLessThan(1);
    expect(fields.fire[rim]).toBeGreaterThan(fields.fire[center]);
  });

  it("lightning strikes, scorches and starts a fire", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("lightning", 0, 0, { ignitionChance: 100 });

    expect(simulation.advance(0).effects).toEqual([expect.objectContaining({ isNatural: false, kind: "lightning" })]);
    expect(simulation.fire.burningCount).toBeGreaterThan(0);
  });

  it("lightning scatters several strikes around the target", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("lightning", 0, 0, { scatter: 120, strikes: 4 });

    const strikes = simulation.advance(0).effects.filter((effect): effect is LightningEffect => {
      return effect.kind === "lightning";
    });

    expect(strikes).toHaveLength(4);
    expect(strikes[0]).toMatchObject({ x: 0, z: 0 });
    expect(
      strikes.every((strike) => {
        return Math.hypot(strike.x, strike.z) <= 120;
      })
    ).toBe(true);
  });

  it("an explosion leaves a crater and kills animals around it", () => {
    const simulation = createPowerSimulation();

    simulation.fauna.spawnHerd("deer", 20, 0, 3, simulation.random);
    simulation.usePower("explosion", 0, 0, {});

    expect(simulation.world.terrain.height[centerCell(simulation.world)]).toBeLessThan(95);
    expect(livingCount(simulation.fauna)).toBe(0);
  });

  it("an earthquake shakes the land and breaks buildings", () => {
    const simulation = createPowerSimulation();

    const hut = simulation.buildings.add({ kind: "tent", rotation: 0, tribeId: 0, x: 30, z: 0 }, simulation.random);

    hut.progress = 1;
    simulation.usePower("earthquake", 0, 0, { magnitude: 100 });

    expect(simulation.buildings.all).toHaveLength(0);
    expect(simulation.advance(0).effects).toEqual([expect.objectContaining({ kind: "earthquake" })]);
  });

  it("names the earthquake when it kills someone", () => {
    const simulation = createPowerSimulation();

    simulation.usePower("tribe", 0, 0, {});

    const [tribe] = simulation.society.tribes();

    for (const person of simulation.society.membersOf(tribe)) {
      person.health = 0.05;
    }

    simulation.usePower("earthquake", tribe.campX, tribe.campZ, { magnitude: 100 });

    expect(simulation.chronicle.takeEntries()).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("crushed in an earthquake") })
    );
  });
});
