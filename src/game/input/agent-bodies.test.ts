import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { applyHumanClip } from "../../models/people/human-clips.ts";
import { HUMAN_DETAILS } from "../../models/people/human-detail.ts";
import { buildHumanParts, humanPartIndex } from "../../models/people/human-model.ts";
import { humanBoneScales } from "../../models/people/human-proportions.ts";
import { HUMAN_SKELETON } from "../../models/people/human-skeleton.ts";
import { Pose } from "../../models/rig/pose.ts";
import { SkeletonPoser } from "../../models/rig/skeleton-poser.ts";
import { posedMesh } from "../../models/testing/moved-mesh.ts";
import { ADULT } from "../../models/testing/posed-human.ts";
import { ANIMAL_STRIDE, AnimalField, PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { animalBody, personBody } from "./agent-bodies.ts";

const AVERAGE_BODY = { build: 1, headSize: 1, height: 1, hipWidth: 1, legLength: 1, shoulderWidth: 1 } as const;
const HEAD_ROOM = 0.03;

function animal(kind: AnimalKind, youth: number): Float32Array {
  const animals = new Float32Array(ANIMAL_STRIDE);

  animals[AnimalField.Kind] = ANIMAL_KINDS.indexOf(kind);
  animals[AnimalField.AppearanceSeed] = 0.5;
  animals[AnimalField.Youth] = youth;

  return animals;
}

function person(age: number): Float32Array {
  const people = new Float32Array(PERSON_STRIDE);

  people[PersonField.Age] = age;

  return people;
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

  it("reaches the head of a grown person as it is drawn", () => {
    const box = personBody(person(30), 0);
    const body = buildHumanParts(HUMAN_DETAILS.far)[humanPartIndex("bodyMale")];
    const poser = new SkeletonPoser(HUMAN_SKELETON);

    for (const clip of ["idle", "walk"] as const) {
      for (const phase of [0.15, 0.4, 0.7]) {
        const pose = new Pose(HUMAN_SKELETON.bones.length);

        applyHumanClip(pose, clip, phase, ADULT);
        poser.pose(pose, humanBoneScales(AVERAGE_BODY));

        expect(posedMesh(body, poser).bounds.maximum[1], `${clip} ${phase}`).toBeLessThan(box.height + HEAD_ROOM);
      }
    }
  });
});
