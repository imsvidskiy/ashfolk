import { describe, expect, it } from "vitest";
import { ANIMAL_STRIDE, AnimalField, PERSON_STRIDE, PersonField } from "../world/agent-buffers.ts";
import { createCalmSimulation } from "./testing/test-simulation.ts";
import { floodStrip } from "./testing/test-world.ts";
import { TICK_SECONDS } from "./tick.ts";

describe("frames", () => {
  it("pack every person into the people buffer", () => {
    const simulation = createCalmSimulation();

    simulation.populate();

    const frame = simulation.advance(TICK_SECONDS);

    expect(frame.personCount).toBe(simulation.society.people.length);
    expect(frame.people).toHaveLength(frame.personCount * PERSON_STRIDE);
    expect(frame.people[PersonField.Id]).toBe(simulation.society.people[0].id);
    expect(frame.tribes.length).toBeGreaterThan(0);
  });

  it("pack every animal with its herd into the animal buffer", () => {
    const simulation = createCalmSimulation();

    simulation.populate();

    const frame = simulation.advance(TICK_SECONDS);

    const { animals } = simulation.fauna;
    const last = frame.animalCount - 1;

    expect(frame.animalCount).toBeGreaterThan(0);
    expect(frame.animalCount).toBe(animals.length);
    expect(frame.animals).toHaveLength(frame.animalCount * ANIMAL_STRIDE);
    expect(frame.animals[last * ANIMAL_STRIDE + AnimalField.Id]).toBe(animals[last].id);
    expect(frame.animals[last * ANIMAL_STRIDE + AnimalField.HerdId]).toBe(animals[last].herdId);
  });

  it("send changed surface rows and height regions once", () => {
    const simulation = createCalmSimulation();

    simulation.advance(0);
    simulation.execute({ parameters: { radius: 30 }, powerId: "raise", type: "usePower", x: 0, z: 0 });
    simulation.execute({ parameters: { radius: 20 }, powerId: "fire", type: "usePower", x: 200, z: 0 });

    const frame = simulation.advance(0);

    expect(frame.heightPatch).not.toBeNull();
    expect(frame.surfaceRows.length).toBeGreaterThan(0);
    expect(simulation.advance(0).heightPatch).toBeNull();
  });

  it("describe the current selection", () => {
    const simulation = createCalmSimulation();

    simulation.populate();

    const [person] = simulation.society.people;

    simulation.execute({ selection: { id: person.id, kind: "person" }, type: "setSelection" });

    expect(simulation.advance(0).inspection).toMatchObject({ kind: "person", name: person.name });

    simulation.society.kill(person, "age");

    expect(simulation.advance(0).inspection).toMatchObject({ activity: "Has passed away" });
  });

  it("show wind, temperature and hour changes while paused", () => {
    const simulation = createCalmSimulation();

    const { world } = simulation;

    simulation.execute({ isPaused: true, type: "setPaused" });
    simulation.execute({ selection: { kind: "cell", x: 0, z: 0 }, type: "setSelection" });

    const before = simulation.advance(0).weather;

    simulation.execute({ direction: 45, speed: 60, type: "setWind" });
    simulation.execute({ offset: -15, type: "setTemperatureOffset" });
    simulation.execute({ hours: 3, type: "setHours" });

    const after = simulation.advance(0.5);

    expect(after.tick).toBe(0);
    expect(after.weather).toMatchObject({
      windSpeed: 60,
      windX: expect.closeTo(-Math.SQRT1_2),
      windZ: expect.closeTo(Math.SQRT1_2),
    });
    expect(after.weather.airTemperatureOffset).toBeLessThan(before.airTemperatureOffset - 15);
    expect(after.inspection).toMatchObject({
      kind: "cell",
      temperature: world.temperature(world.grid.cellAt(0, 0), after.weather.airTemperatureOffset),
    });
  });

  it("reports recomputed water after the land settles", () => {
    const simulation = createCalmSimulation();

    floodStrip(simulation.world, 20, 1.5);
    simulation.execute({ parameters: { radius: 80, strength: 100 }, powerId: "lower", type: "usePower", x: 0, z: 0 });

    const frames = Array.from({ length: 20 }, () => {
      return simulation.advance(0.1);
    });

    expect(
      frames.some((frame) => {
        return frame.water !== null;
      })
    ).toBe(true);
  });
});
