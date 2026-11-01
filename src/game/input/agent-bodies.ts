import { Box3, Ray, Vector3 } from "three/webgpu";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { animalAppearance } from "../../models/animals/animal-appearance.ts";
import { buildAnimalParts } from "../../models/animals/animal-models.ts";
import { type MeshData, vertexCount } from "../../models/mesh/mesh-data.ts";
import { personAppearance, type TribeLook } from "../../models/people/appearance.ts";
import { HUMAN_DETAILS } from "../../models/people/human-detail.ts";
import { appearanceParts, buildHumanParts, humanPartIndex } from "../../models/people/human-model.ts";
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
const UNCOLORED_TRIBE: TribeLook = { accent: 0, fur: 0, id: 0 };
const measured = new Map<AnimalKind, AgentBody>();
const localRay = new Ray();
const localBox = new Box3();
const restPose = new Pose(HUMAN_SKELETON.bones.length);
const poser = new SkeletonPoser(HUMAN_SKELETON);
const restPoint = new Vector3();
const firstPoint = new Vector3();
const secondPoint = new Vector3();

let humanParts: readonly MeshData[] | null = null;

function bodyOf(mesh: MeshData): AgentBody {
  const { maximum, minimum } = mesh.bounds;

  return {
    back: minimum[2],
    front: maximum[2],
    halfWidth: Math.max(-minimum[0], maximum[0]),
    height: maximum[1],
  };
}

function farHumanParts(): readonly MeshData[] {
  if (humanParts === null) {
    humanParts = buildHumanParts(HUMAN_DETAILS.far);
  }

  return humanParts;
}

function posedBody(meshes: readonly MeshData[], scales: Float32Array): AgentBody {
  localBox.makeEmpty();
  poser.pose(restPose, scales);

  for (const mesh of meshes) {
    for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
      restPoint.fromArray(mesh.positions, vertex * 3);
      poser.skinPoint(mesh.channels.boneA[vertex], restPoint, firstPoint);
      poser.skinPoint(mesh.channels.boneB[vertex], restPoint, secondPoint);
      localBox.expandByPoint(firstPoint.lerp(secondPoint, mesh.channels.boneWeight[vertex]));
    }
  }

  return {
    back: localBox.min.z,
    front: localBox.max.z,
    halfWidth: Math.max(-localBox.min.x, localBox.max.x),
    height: localBox.max.y,
  };
}

function measuredBody(kind: AnimalKind): AgentBody {
  const known = measured.get(kind);

  if (known !== undefined) {
    return known;
  }

  const body = bodyOf(buildAnimalParts(kind, "low")[0]);

  measured.set(kind, body);

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
  const appearance = personAppearance({
    age: people[offset + PersonField.Age],
    era: people[offset + PersonField.Era],
    isFemale: people[offset + PersonField.IsFemale] > 0.5,
    seed: people[offset + PersonField.AppearanceSeed],
    tribe: UNCOLORED_TRIBE,
  });
  const parts = farHumanParts();
  const drawn = appearanceParts(appearance).map((part) => {
    return parts[humanPartIndex(part)];
  });

  return posedBody(drawn, humanBoneScales(appearance.body));
}

export function measureAgentBodies(): void {
  farHumanParts();

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
