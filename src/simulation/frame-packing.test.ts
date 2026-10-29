import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS } from "../content/animals.ts";
import { tribeIdentity } from "../content/names.ts";
import { TOOL_MATERIALS, WEAPON_KINDS } from "../content/weapons.ts";
import { createRandom } from "../shared/random.ts";
import {
  ANIMAL_STRIDE,
  AnimalField,
  GROUND_CHANNELS,
  GroundChannel,
  PERSON_STRIDE,
  PersonField,
  SURFACE_CHANNELS,
  SurfaceChannel,
} from "../world/agent-buffers.ts";
import { ANIMAL_POSES, CARRIED_ITEMS, PERSON_POSES } from "../world/agent-poses.ts";
import { createMover } from "./agents/movement.ts";
import type { Animal } from "./fauna/fauna.ts";
import {
  allRows,
  packAnimals,
  packChangedSurfaceRows,
  packGroundRows,
  packPeople,
  packSurfaceRows,
} from "./frame-packing.ts";
import { createPerson, type Person } from "./society/person.ts";
import { createTribe } from "./society/tribe.ts";
import { standStill } from "./testing/test-rivalry.ts";
import { createTestWorld } from "./testing/test-world.ts";

function fieldOffsets(fields: Readonly<Record<string, number>>): number[] {
  return Object.values(fields).toSorted((first, second) => {
    return first - second;
  });
}

function strideOffsets(stride: number): number[] {
  return Array.from({ length: stride }, (_, offset) => {
    return offset;
  });
}

function raidingArcher(): Person {
  const person = createPerson(
    { age: 27.5, id: 41, isFemale: true, name: "Ash", tribeId: 3, x: 12.5, z: -7.25 },
    createRandom(5)
  );

  person.mover.heading = 1.25;
  person.mover.velocityX = 0.5;
  person.mover.velocityZ = -1.5;
  person.pose = "shoot";
  person.phase = 2.75;
  person.carrying = { amount: 2, item: "fish", resource: "fish" };
  person.weapon = { kind: "bow", material: "bronze" };
  person.job = { ...standStill(), kind: "raid" };

  return person;
}

function grazingCalf(): Animal {
  return {
    appearanceSeed: 0.375,
    causeOfDeath: null,
    deathSeconds: 0,
    fear: 0,
    fleeFromX: 0,
    fleeFromZ: 0,
    health: 1,
    herdId: 9,
    id: 77,
    isAlive: true,
    kind: "ibex",
    lifeDays: 10,
    mover: { ...createMover(-3.5, 8.25, 0.5), velocityX: 1.25, velocityZ: 0.75 },
    offsetX: 0,
    offsetZ: 0,
    phase: 4.5,
    pose: "flinch",
    poseSeconds: 0,
    speed: 0,
    threatCheckSeconds: 0,
    youth: 0.625,
  };
}

describe("surface rows", () => {
  it("send only the rows whose bytes changed since they were last sent", () => {
    const world = createTestWorld({ dimensions: { cellSize: 10, cellsPerSide: 32 } });
    const { fields, grid } = world;

    const bytesPerRow = grid.cellsPerSide * SURFACE_CHANNELS;
    const [initial] = packSurfaceRows(world, allRows(world));
    const sent = initial.data.slice();
    const marked = [{ firstRow: 0, rowCount: 16 }];

    fields.wetness[grid.index(4, 3)] = 0.5;
    fields.snow[grid.index(0, 4)] = 0.6;
    fields.fire[grid.index(9, 10)] = 0.3;
    fields.scorch[grid.index(1, 12)] = 0.0001;
    fields.wetness[grid.index(2, 15)] = 1;

    const changed = packChangedSurfaceRows(world, marked, sent);
    const [current] = packSurfaceRows(world, allRows(world));

    expect(
      changed.map(({ firstRow, rowCount }) => {
        return { firstRow, rowCount };
      })
    ).toEqual([
      { firstRow: 3, rowCount: 2 },
      { firstRow: 10, rowCount: 1 },
      { firstRow: 15, rowCount: 1 },
    ]);
    expect(changed[0].data).toEqual(current.data.slice(3 * bytesPerRow, 5 * bytesPerRow));
    expect(sent).toEqual(current.data);
    expect(packChangedSurfaceRows(world, marked, sent)).toEqual([]);
  });
});

describe("agent buffers", () => {
  it("give every field its own slot", () => {
    expect(fieldOffsets(PersonField)).toEqual(strideOffsets(PERSON_STRIDE));
    expect(fieldOffsets(AnimalField)).toEqual(strideOffsets(ANIMAL_STRIDE));
    expect(fieldOffsets(SurfaceChannel)).toEqual(strideOffsets(SURFACE_CHANNELS));
    expect(fieldOffsets(GroundChannel)).toEqual(strideOffsets(GROUND_CHANNELS));
  });

  it("carry each field of a person to the renderer", () => {
    const person = raidingArcher();
    const tribe = createTribe({ campX: 0, campZ: 0, day: 0, id: 3, identity: tribeIdentity(0) });

    tribe.eraIndex = 2;

    const buffer = packPeople([person], () => {
      return tribe;
    });

    expect({
      age: buffer[PersonField.Age],
      appearanceSeed: buffer[PersonField.AppearanceSeed],
      carried: CARRIED_ITEMS[buffer[PersonField.Carried]],
      era: buffer[PersonField.Era],
      gear: TOOL_MATERIALS[buffer[PersonField.Gear]],
      heading: buffer[PersonField.Heading],
      id: buffer[PersonField.Id],
      isFemale: buffer[PersonField.IsFemale],
      isRaiding: buffer[PersonField.IsRaiding],
      phase: buffer[PersonField.Phase],
      pose: PERSON_POSES[buffer[PersonField.Pose]],
      tribeId: buffer[PersonField.TribeId],
      velocityX: buffer[PersonField.VelocityX],
      velocityZ: buffer[PersonField.VelocityZ],
      weapon: WEAPON_KINDS[buffer[PersonField.Weapon] - 1],
      x: buffer[PersonField.X],
      z: buffer[PersonField.Z],
    }).toEqual({
      age: 27.5,
      appearanceSeed: Math.fround(person.appearanceSeed),
      carried: "fish",
      era: 2,
      gear: "bronze",
      heading: 1.25,
      id: 41,
      isFemale: 1,
      isRaiding: 1,
      phase: 2.75,
      pose: "shoot",
      tribeId: 3,
      velocityX: 0.5,
      velocityZ: -1.5,
      weapon: "bow",
      x: 12.5,
      z: -7.25,
    });
  });

  it("carry each field of an animal to the renderer", () => {
    const buffer = packAnimals([grazingCalf()]);

    expect({
      appearanceSeed: buffer[AnimalField.AppearanceSeed],
      heading: buffer[AnimalField.Heading],
      herdId: buffer[AnimalField.HerdId],
      id: buffer[AnimalField.Id],
      kind: ANIMAL_KINDS[buffer[AnimalField.Kind]],
      phase: buffer[AnimalField.Phase],
      pose: ANIMAL_POSES[buffer[AnimalField.Pose]],
      velocityX: buffer[AnimalField.VelocityX],
      velocityZ: buffer[AnimalField.VelocityZ],
      x: buffer[AnimalField.X],
      youth: buffer[AnimalField.Youth],
      z: buffer[AnimalField.Z],
    }).toEqual({
      appearanceSeed: 0.375,
      heading: 0.5,
      herdId: 9,
      id: 77,
      kind: "ibex",
      phase: 4.5,
      pose: "flinch",
      velocityX: 1.25,
      velocityZ: 0.75,
      x: -3.5,
      youth: 0.625,
      z: 8.25,
    });
  });

  it("carry the ground, crop and trodden path of each cell", () => {
    const world = createTestWorld({ dimensions: { cellSize: 10, cellsPerSide: 8 } });
    const cell = world.grid.index(5, 2);

    world.terrain.ground[cell] = 3;
    world.fields.crop[cell] = 0.5;
    world.fields.trodden[cell] = 1;
    world.cropCodes[cell] = 2;

    const [rows] = packGroundRows(world, [{ firstRow: 2, rowCount: 1 }]);
    const position = 5 * GROUND_CHANNELS;

    expect(rows.firstRow).toBe(2);
    expect([...rows.data.subarray(position, position + GROUND_CHANNELS)]).toEqual([3, 128, 255, 2]);
  });
});
