import { describe, expect, it } from "vitest";
import {
  isRockSpecies,
  PLANT_SPECIES,
  PlantSpecies,
  type PlantSpeciesIndex,
  plantSpeciesDefinition,
} from "../../../content/plants.ts";
import { placementAt, plantNear, WORK_SPOT_TOLERANCE, workUntilPosed } from "../../testing/test-jobs.ts";
import { firstMemberTick, MORNING, runToCompletion, SocietyHarness, settle } from "../../testing/test-society.ts";
import { findStone } from "./quarry-job.ts";

const ROCKS: readonly PlantSpeciesIndex[] = PLANT_SPECIES.filter((species) => {
  return isRockSpecies(species.index);
}).map((species) => {
  return species.index;
});

describe("quarrying", () => {
  it.each(ROCKS)("breaks stone from rock species %i at its edge and passes monuments by", (species) => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));
    const { vegetation } = tick.context.world;

    for (let plant = 0; plant < vegetation.count; plant += 1) {
      if (isRockSpecies(vegetation.species[plant])) {
        tick.context.world.removePlant(plant);
      }
    }

    tick.context.world.plant({
      bornDay: 0,
      height: 3,
      rotation: 0,
      seed: 0.1,
      species: PlantSpecies.Menhir,
      x: tick.person.mover.x + 4,
      z: tick.person.mover.z,
    });

    const rock = plantNear(tick, species, 1.2 * plantSpeciesDefinition(species).heightRange[0]);

    const job = findStone(tick);

    if (job === null) {
      throw new Error("Expected a rock to quarry");
    }

    expect(job.kind).toBe("quarry");
    expect(job.claimedPlant).toBe(rock);

    workUntilPosed(job, tick, "mine");

    expect(placementAt(tick, rock, 0.6).missedBy).toBeLessThan(WORK_SPOT_TOLERANCE);
  });

  it("gives up on a boulder that is gone before the work is done", () => {
    const harness = new SocietyHarness({ day: MORNING });

    const tick = firstMemberTick(harness, settle(harness, 1));

    const boulder = plantNear(tick, PlantSpecies.Boulder, 3);
    const job = findStone(tick);

    expect(job?.claimedPlant).toBe(boulder);

    if (job === null) {
      return;
    }

    const { stock } = tick.tribe;
    const { stone } = stock;

    tick.context.world.removePlant(boulder);

    expect(runToCompletion(job, tick, 120)).toBe(true);
    expect(stock.stone).toBe(stone);
  });
});
