import { tribeIdentity } from "../../content/names.ts";
import { FOOD_KINDS } from "../../content/resources.ts";
import type { Building } from "../society/buildings.ts";
import type { Job, JobKind } from "../society/jobs/job.ts";
import { createPerson, type Person } from "../society/person.ts";
import { type Relation, sideOf } from "../society/rivalry/relations.ts";
import { createTribe, type Tribe } from "../society/tribe.ts";
import { TICK_SECONDS } from "../tick.ts";
import { MORNING, type SocietyHarness } from "./test-society.ts";

export const SPRING_HARNESS = { day: MORNING, world: { dimensions: { cellSize: 10, cellsPerSide: 96 } } };

const ROW_LENGTH = 4;
const SPACING = 3;
const ADULT_AGE = 22;
const CHILD_AGE = 6;
const ARMORY_SPEARS = 12;

interface Duel {
  readonly far: Person;
  readonly first: Tribe;
  readonly near: Person;
  readonly second: Tribe;
}

interface TribeFounding {
  readonly adults: number;
  readonly children: number;
  readonly x: number;
  readonly z: number;
}

export function foundTribe(harness: SocietyHarness, founding: TribeFounding): Tribe {
  const tribe = harness.society.createTribe(founding.x, founding.z);

  for (let index = 0; index < founding.adults + founding.children; index += 1) {
    const isChild = index >= founding.adults;

    const person = createPerson(
      {
        age: isChild ? CHILD_AGE : ADULT_AGE + index,
        id: harness.identifiers.next(),
        isFemale: index % 2 === 1,
        name: `${tribe.name.charAt(0)}${index}`,
        tribeId: tribe.id,
        x: founding.x + (index % ROW_LENGTH) * SPACING,
        z: founding.z + Math.floor(index / ROW_LENGTH) * SPACING,
      },
      harness.random
    );

    person.hunger = 0.1;
    harness.society.addPerson(tribe, person);
  }

  return tribe;
}

export function setFood(tribe: Tribe, food: number): void {
  for (const kind of FOOD_KINDS) {
    tribe.stock[kind] = 0;
  }

  tribe.stock.meat = food;
}

export function armTribe(tribe: Tribe, food: number): void {
  tribe.technologies.add("fire");
  tribe.technologies.add("spear");
  tribe.stock.spears = ARMORY_SPEARS;
  setFood(tribe, food);
}

export function runUntil(harness: SocietyHarness, seconds: number, isDone: () => boolean): number {
  let elapsed = 0;

  while (elapsed < seconds && !isDone()) {
    harness.step();
    elapsed += TICK_SECONDS;
  }

  return elapsed;
}

export function foundNeighboringTribes(harness: SocietyHarness, distance: number): readonly [Tribe, Tribe] {
  const first = foundTribe(harness, { adults: 8, children: 2, x: -distance / 2, z: 0 });
  const second = foundTribe(harness, { adults: 6, children: 2, x: distance / 2, z: 0 });

  return [first, second];
}

export function longFeud(harness: SocietyHarness, first: Tribe, second: Tribe): Relation {
  const relation = harness.rivalry.relations.meet(first.id, second.id, false);

  relation.standing = -90;
  relation.stance = "hostile";
  relation.feudStartDay = -12;
  sideOf(relation, first.id).weariness = 120;
  sideOf(relation, second.id).weariness = 40;

  return relation;
}

export function bareTribe(id: number): Tribe {
  return createTribe({ campX: 0, campZ: 0, day: 0, id, identity: tribeIdentity(id - 1) });
}

export function steadyJob(kind: JobKind): Job {
  const job: Job = {
    kind,
    update: () => {
      return job;
    },
  };

  return job;
}

export function standOff(harness: SocietyHarness, gap: number): Duel {
  const [first, second] = foundNeighboringTribes(harness, 900);
  const [near] = harness.society.membersOf(first);
  const [far] = harness.society.membersOf(second);

  for (const person of harness.society.people) {
    person.job = steadyJob("idle");
  }

  far.mover.x = near.mover.x + gap;
  far.mover.z = near.mover.z;

  return { far, first, near, second };
}

export function enclosure(kind: "palisade" | "stoneWall", tribe: Tribe, extent: number): Building {
  return {
    burningSeconds: 0,
    cell: 0,
    cells: [],
    depositId: -1,
    extent,
    fuel: 1,
    health: 200,
    id: tribe.id * 100,
    isRetiring: false,
    kind,
    progress: 1,
    replacesId: null,
    rotation: 0,
    seed: 0.5,
    style: 0,
    tribeId: tribe.id,
    x: tribe.campX,
    z: tribe.campZ,
  };
}

export function chronicleTexts(harness: SocietyHarness): string[] {
  return harness.chronicle.takeEntries().map((entry) => {
    return `${entry.category}: ${entry.text}`;
  });
}
