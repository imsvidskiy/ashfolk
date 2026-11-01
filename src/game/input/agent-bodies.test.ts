import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { type PersonAppearance, personAppearance } from "../../models/people/appearance.ts";
import { applyHumanClip, type HumanClipContext } from "../../models/people/human-clips.ts";
import { HUMAN_DETAILS } from "../../models/people/human-detail.ts";
import { appearanceParts, buildHumanParts, humanPartIndex } from "../../models/people/human-model.ts";
import { humanBoneScales } from "../../models/people/human-proportions.ts";
import { HUMAN_SKELETON } from "../../models/people/human-skeleton.ts";
import { Pose } from "../../models/rig/pose.ts";
import { SkeletonPoser } from "../../models/rig/skeleton-poser.ts";
import { posedMesh } from "../../models/testing/moved-mesh.ts";
import { TRIBE } from "../../models/testing/posed-human.ts";
import { ANIMAL_STRIDE, AnimalField, PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { animalBody, personBody } from "./agent-bodies.ts";

const HEAD_ROOM = 0.03;
const WORN_ROOM = 0.05;
const SAMPLED_AGES = [2, 6, 10, 30, 70];
const SAMPLED_SEEDS = 24;
const ERA_COUNT = 6;

function animal(kind: AnimalKind, youth: number): Float32Array {
  const animals = new Float32Array(ANIMAL_STRIDE);

  animals[AnimalField.Kind] = ANIMAL_KINDS.indexOf(kind);
  animals[AnimalField.AppearanceSeed] = 0.5;
  animals[AnimalField.Youth] = youth;

  return animals;
}

function person(age: number, seed: number, isFemale: boolean): Float32Array {
  const people = new Float32Array(PERSON_STRIDE);

  people[PersonField.Age] = age;
  people[PersonField.AppearanceSeed] = seed;
  people[PersonField.Era] = Math.floor(seed * ERA_COUNT);
  people[PersonField.IsFemale] = isFemale ? 1 : 0;

  return people;
}

function sampledPeople(): Float32Array[] {
  const sampled: Float32Array[] = [];

  for (const age of SAMPLED_AGES) {
    for (let index = 0; index < SAMPLED_SEEDS; index += 1) {
      sampled.push(person(age, (index + 0.5) / SAMPLED_SEEDS, false), person(age, (index + 0.5) / SAMPLED_SEEDS, true));
    }
  }

  return sampled;
}

function appearanceOf(people: Float32Array): PersonAppearance {
  return personAppearance({
    age: people[PersonField.Age],
    era: people[PersonField.Era],
    isFemale: people[PersonField.IsFemale] > 0.5,
    seed: people[PersonField.AppearanceSeed],
    tribe: TRIBE,
  });
}

describe("agent bodies", () => {
  it("measures each kind by its own model", () => {
    expect(animalBody(animal("mammoth", 0), 0).height).toBeGreaterThan(animalBody(animal("hare", 0), 0).height * 4);
  });

  it("shrinks a young animal to about 0.42 of an adult", () => {
    const adult = animalBody(animal("deer", 0), 0);
    const young = animalBody(animal("deer", 1), 0);

    expect(young.height / adult.height).toBeCloseTo(0.42, 2);
    expect((young.front - young.back) / (adult.front - adult.back)).toBeCloseTo(0.42, 2);
  });

  it("reaches the head of each person as they are drawn", () => {
    const parts = buildHumanParts(HUMAN_DETAILS.far);
    const poser = new SkeletonPoser(HUMAN_SKELETON);

    for (const people of sampledPeople()) {
      const box = personBody(people, 0);
      const appearance = appearanceOf(people);
      const [body, ...worn] = appearanceParts(appearance);
      const context: HumanClipContext = {
        ageGroup: appearance.ageGroup,
        carried: "nothing",
        motion: appearance.motion,
      };

      for (const clip of ["idle", "walk"] as const) {
        for (const phase of [0.15, 0.4, 0.7]) {
          const pose = new Pose(HUMAN_SKELETON.bones.length);
          const label = `${people[PersonField.Age]} ${people[PersonField.AppearanceSeed]} ${clip} ${phase}`;

          applyHumanClip(pose, clip, phase, context);
          poser.pose(pose, humanBoneScales(appearance.body));

          expect(posedMesh(parts[humanPartIndex(body)], poser).bounds.maximum[1], label).toBeLessThan(
            box.height + HEAD_ROOM
          );

          for (const part of worn) {
            expect(posedMesh(parts[humanPartIndex(part)], poser).bounds.maximum[1], `${label} ${part}`).toBeLessThan(
              box.height + WORN_ROOM
            );
          }
        }
      }
    }
  });
});
