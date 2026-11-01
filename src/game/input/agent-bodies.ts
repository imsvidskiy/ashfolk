import { Box3, Ray, Vector3 } from "three/webgpu";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { animalAppearance } from "../../models/animals/animal-appearance.ts";
import { buildAnimalParts } from "../../models/animals/animal-models.ts";
import { boundsOf, type MeshData, vertexCount } from "../../models/mesh/mesh-data.ts";
import { type BodyShape, statureAt } from "../../models/people/appearance.ts";
import { HUMAN_DETAILS } from "../../models/people/human-detail.ts";
import { buildHumanParts, humanPartIndex } from "../../models/people/human-model.ts";
import { humanBoneScales } from "../../models/people/human-proportions.ts";
import { HUMAN_SKELETON } from "../../models/people/human-skeleton.ts";
import { Pose } from "../../models/rig/pose.ts";
import { SkeletonPoser } from "../../models/rig/skeleton-poser.ts";
import { AnimalField, PersonField } from "../../world/agent-buffers.ts";

export interface AgentBody {
  readonly back: number;
  readonly front: number;
  readonly halfWidth: number;
  readonly height: number;
}

export interface StandingBody extends AgentBody {
  readonly baseY: number;
  readonly heading: number;
  readonly x: number;
  readonly z: number;
}

const UP = new Vector3(0, 1, 0);
const AVERAGE_BODY: BodyShape = { build: 1, headSize: 1, height: 1, hipWidth: 1, legLength: 1, shoulderWidth: 1 };
const measured = new Map<AnimalKind | "person", AgentBody>();
const localRay = new Ray();
const localBox = new Box3();

function bodyOf(mesh: MeshData): AgentBody {
  const { maximum, minimum } = mesh.bounds;

  return {
    back: minimum[2],
    front: maximum[2],
    halfWidth: Math.max(-minimum[0], maximum[0]),
    height: maximum[1],
  };
}

function posedPerson(): MeshData {
  const mesh = buildHumanParts(HUMAN_DETAILS.far)[humanPartIndex("bodyMale")];
  const poser = new SkeletonPoser(HUMAN_SKELETON);
  const positions = new Float32Array(mesh.positions.length);
  const rest = new Vector3();
  const first = new Vector3();
  const second = new Vector3();

  poser.pose(new Pose(HUMAN_SKELETON.bones.length), humanBoneScales(AVERAGE_BODY));

  for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
    rest.fromArray(mesh.positions, vertex * 3);
    poser.skinPoint(mesh.channels.boneA[vertex], rest, first);
    poser.skinPoint(mesh.channels.boneB[vertex], rest, second);
    first.lerp(second, mesh.channels.boneWeight[vertex]).toArray(positions, vertex * 3);
  }

  return { ...mesh, bounds: boundsOf(positions), positions };
}

function measuredBody(subject: AnimalKind | "person"): AgentBody {
  const known = measured.get(subject);

  if (known !== undefined) {
    return known;
  }

  const body = subject === "person" ? bodyOf(posedPerson()) : bodyOf(buildAnimalParts(subject, "low")[0]);

  measured.set(subject, body);

  return body;
}

function scaled(body: AgentBody, scale: number): AgentBody {
  return {
    back: body.back * scale,
    front: body.front * scale,
    halfWidth: body.halfWidth * scale,
    height: body.height * scale,
  };
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
  return scaled(measuredBody("person"), statureAt(people[offset + PersonField.Age]));
}

export function measureAgentBodies(): void {
  measuredBody("person");

  for (const kind of ANIMAL_KINDS) {
    measuredBody(kind);
  }
}

export function rayHitsBody(ray: Ray, body: StandingBody): boolean {
  const { back, baseY, front, halfWidth, heading, height, x, z } = body;

  localRay.origin.set(ray.origin.x - x, ray.origin.y - baseY, ray.origin.z - z).applyAxisAngle(UP, -heading);
  localRay.direction.copy(ray.direction).applyAxisAngle(UP, -heading);
  localBox.min.set(-halfWidth, 0, back);
  localBox.max.set(halfWidth, height, front);

  return localRay.intersectsBox(localBox);
}
