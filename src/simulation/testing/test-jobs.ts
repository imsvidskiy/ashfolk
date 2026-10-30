import { type PlantSpeciesIndex, plantSpeciesDefinition } from "../../content/plants.ts";
import { wrapAngle } from "../../shared/math.ts";
import type { Job } from "../society/jobs/job.ts";
import type { Weapon } from "../society/person.ts";
import type { PersonTick } from "../society/society-context.ts";

export const STONE_SPEAR: Weapon = { kind: "spear", material: "stone" };
export const WORK_SPOT_TOLERANCE = 0.35;
export const FACING_TOLERANCE = 0.05;

interface WorkPlacement {
  readonly missedBy: number;
  readonly turnedAwayBy: number;
}

export function plantNear(tick: PersonTick, species: PlantSpeciesIndex, height: number): number {
  const { mover } = tick.person;

  return tick.context.world.plant({
    bornDay: 0,
    height,
    rotation: 0,
    seed: 0.5,
    species,
    x: mover.x + 14,
    z: mover.z - 6,
  });
}

export function workUntilPosed(job: Job, tick: PersonTick, pose: string): void {
  let current: Job | null = job;

  for (let elapsed = 0; elapsed < 60 && current !== null; elapsed += tick.seconds) {
    current = current.update(tick);

    if (tick.person.pose === pose) {
      return;
    }
  }

  throw new Error(`Expected the person to start the ${pose} pose`);
}

export function placementAt(tick: PersonTick, plant: number, reach: number): WorkPlacement {
  const { vegetation } = tick.context.world;
  const { mover } = tick.person;

  const radius = plantSpeciesDefinition(vegetation.species[plant]).radiusPerMeter * vegetation.height[plant];
  const towardX = vegetation.x[plant] - mover.x;
  const towardZ = vegetation.z[plant] - mover.z;

  return {
    missedBy: Math.abs(Math.hypot(towardX, towardZ) - (radius + reach)),
    turnedAwayBy: Math.abs(wrapAngle(Math.atan2(towardX, towardZ) - mover.heading)),
  };
}
