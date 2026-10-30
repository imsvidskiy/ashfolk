import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { animalAppearance } from "../../models/animals/animal-appearance.ts";
import { buildAnimalParts } from "../../models/animals/animal-models.ts";
import type { MeshData } from "../../models/mesh/mesh-data.ts";
import { statureAt } from "../../models/people/appearance.ts";
import { HUMAN_DETAILS } from "../../models/people/human-detail.ts";
import { buildHumanParts, humanPartIndex } from "../../models/people/human-model.ts";
import { FIGURE_SCALE } from "../../models/people/human-proportions.ts";
import { AnimalField, PersonField } from "../../world/agent-buffers.ts";

export interface AgentBody {
  readonly height: number;
  readonly radius: number;
}

const measured = new Map<AnimalKind | "person", AgentBody>();

function bodyOf(mesh: MeshData): AgentBody {
  const { maximum, minimum } = mesh.bounds;

  return {
    height: maximum[1],
    radius: Math.max(maximum[0] - minimum[0], maximum[2] - minimum[2]) / 2,
  };
}

function measuredBody(subject: AnimalKind | "person"): AgentBody {
  const known = measured.get(subject);

  if (known !== undefined) {
    return known;
  }

  const body =
    subject === "person"
      ? bodyOf(buildHumanParts(HUMAN_DETAILS.far)[humanPartIndex("bodyMale")])
      : bodyOf(buildAnimalParts(subject, "low")[0]);

  measured.set(subject, body);

  return body;
}

function scaled(body: AgentBody, scale: number): AgentBody {
  return { height: body.height * scale, radius: body.radius * scale };
}

export function animalBody(animals: Float32Array, offset: number): AgentBody {
  const kind = ANIMAL_KINDS[animals[offset + AnimalField.Kind]];
  const appearance = animalAppearance({
    kind,
    seed: animals[offset + AnimalField.AppearanceSeed],
    youth: animals[offset + AnimalField.Youth],
  });

  return scaled(measuredBody(kind), appearance.size);
}

export function personBody(people: Float32Array, offset: number): AgentBody {
  return scaled(measuredBody("person"), FIGURE_SCALE * statureAt(people[offset + PersonField.Age]));
}

export function measureAgentBodies(): void {
  measuredBody("person");

  for (const kind of ANIMAL_KINDS) {
    measuredBody(kind);
  }
}
