import { Frustum, Matrix4, PerspectiveCamera } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { WorldMirror } from "../../game/world-mirror.ts";
import { type AnimalAppearance, animalAppearance } from "../../models/animals/animal-appearance.ts";
import { ANIMAL_SPECIES, animalBoneScales, buildAnimalParts, poseAnimal } from "../../models/animals/animal-models.ts";
import { mergeMeshes, vertexCount } from "../../models/mesh/mesh-data.ts";
import { Pose } from "../../models/rig/pose.ts";
import { SkeletonPoser } from "../../models/rig/skeleton-poser.ts";
import { posedMesh } from "../../models/testing/moved-mesh.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { AnimalField } from "../../world/agent-buffers.ts";
import { ANIMAL_POSES } from "../../world/agent-poses.ts";
import { CameraAxes } from "../effects/billboards.ts";
import { HandMotion } from "../hand-motion.ts";
import { AgentMarkers } from "./agent-markers.ts";
import type { AgentViewInput } from "./agent-view-input.ts";
import { ANIMAL_BOUNDING_LIFT, ANIMAL_BOUNDING_RADIUS, AnimalView } from "./animal-view.ts";

const SAMPLED_SEEDS = 200;
const PHASES = Array.from({ length: 20 }, (_, index) => {
  return index / 20;
});
const VARIATIONS = [0, 0.5, 1];

function largestAdult(kind: AnimalKind): AnimalAppearance {
  let largest = animalAppearance({ kind, seed: 0, youth: 0 });

  for (let index = 1; index < SAMPLED_SEEDS; index += 1) {
    const appearance = animalAppearance({ kind, seed: index / SAMPLED_SEEDS, youth: 0 });

    if (appearance.size > largest.size) {
      largest = appearance;
    }
  }

  return largest;
}

function farthestReach(kind: AnimalKind): number {
  const species = ANIMAL_SPECIES[kind];
  const poser = new SkeletonPoser(species.skeleton);
  const pose = new Pose(species.skeleton.bones.length);
  const scales = animalBoneScales(kind, largestAdult(kind));
  const mesh = mergeMeshes(buildAnimalParts(kind, "high"));

  let farthest = 0;

  for (const clip of ANIMAL_POSES) {
    for (const phase of PHASES) {
      for (const variation of VARIATIONS) {
        poseAnimal(kind, pose, clip, phase, { variation });
        poser.pose(pose, scales);

        const { positions } = posedMesh(mesh, poser);

        for (let vertex = 0; vertex < vertexCount(mesh); vertex += 1) {
          const reach = Math.hypot(
            positions[vertex * 3],
            positions[vertex * 3 + 1] - ANIMAL_BOUNDING_LIFT,
            positions[vertex * 3 + 2]
          );

          farthest = Math.max(farthest, reach);
        }
      }
    }
  }

  return farthest;
}

function inputNearFirstAnimal(): AgentViewInput {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 } }));

  simulation.populate();

  const mirror = new WorldMirror(simulation.initialWorld(), 0);

  mirror.apply(simulation.advance(0.05), 0);

  const camera = new PerspectiveCamera(60, 1.5, 1, 40_000);
  const x = mirror.frame.animals[AnimalField.X];
  const z = mirror.frame.animals[AnimalField.Z];

  camera.position.set(x, mirror.heightAt(x, z) + 30, z + 1);
  camera.lookAt(x, mirror.heightAt(x, z), z);
  camera.updateMatrixWorld();

  return {
    camera,
    detail: 1,
    frustum: new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    ),
    gameSeconds: 0,
    hand: new HandMotion(),
    highlighted: null,
    markers: new AgentMarkers(new CameraAxes(), mirror),
    mirror,
    realSeconds: 0,
    secondsSinceTick: 0,
  };
}

describe("animal view hover", () => {
  it("rings the hovered animal where the hand draws it, and stops once nothing is hovered", () => {
    const input = inputNearFirstAnimal();
    const { animals } = input.mirror.frame;
    const id = animals[AnimalField.Id];
    const held = {
      id,
      isPlaceable: true,
      kind: "animal" as const,
      x: animals[AnimalField.X] + 3,
      z: animals[AnimalField.Z] - 2,
    };
    const view = new AnimalView();

    expect(input.mirror.frame.animalCount).toBeGreaterThan(0);

    input.hand.update(held, 1 / 60);
    view.update({ ...input, highlighted: { id, kind: "animal" } });

    expect(view.hoveredSpot).toEqual({ x: held.x, z: held.z });

    view.update(input);

    expect(view.hoveredSpot).toBeNull();
  });
});

describe("animal view culling", () => {
  it.each(ANIMAL_KINDS)("keeps the largest %s inside its cull sphere through every clip", (kind) => {
    expect(farthestReach(kind)).toBeLessThanOrEqual(ANIMAL_BOUNDING_RADIUS);
  });
});
