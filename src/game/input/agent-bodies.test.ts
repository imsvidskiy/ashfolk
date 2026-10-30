import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { ANIMAL_STRIDE, AnimalField } from "../../world/agent-buffers.ts";
import { animalBody } from "./agent-bodies.ts";

function animal(kind: AnimalKind, youth: number): Float32Array {
  const animals = new Float32Array(ANIMAL_STRIDE);

  animals[AnimalField.Kind] = ANIMAL_KINDS.indexOf(kind);
  animals[AnimalField.AppearanceSeed] = 0.5;
  animals[AnimalField.Youth] = youth;

  return animals;
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
});
