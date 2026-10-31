import { Vector3 } from "three";
import { describe, expect, it, it as test } from "vitest";
import { ANIMAL_KINDS, type AnimalKind } from "../../content/animals.ts";
import { ANIMAL_POSES, type AnimalPose } from "../../world/agent-poses.ts";
import { type MeshData, mergeMeshes } from "../mesh/mesh-data.ts";
import { Pose } from "../rig/pose.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { measureStride } from "../rig/stride.ts";
import { meshProblems, openEdgeCount, thinnestPiece } from "../testing/mesh-checks.ts";
import {
  isInsidePiece,
  isTorso,
  loosePieces,
  type MeshPiece,
  meshPieces,
  TOUCHING,
} from "../testing/mesh-connectivity.ts";
import { posedMesh } from "../testing/moved-mesh.ts";
import { animalAppearance } from "./animal-appearance.ts";
import { ANIMAL_SPECIES, animalBoneScales, buildAnimalParts, poseAnimal } from "./animal-models.ts";
import { leapPerStride } from "./quadruped-clips.ts";
import { QuadrupedBone } from "./quadruped-skeleton.ts";

const ADULT = { seed: 0.31, youth: 0 };
const THINNEST = 0.001;
const PHASES = [0, 0.25, 0.5, 0.75];
const LEVELS = ["high", "low", "far"] as const;

function posedAnimal(kind: AnimalKind, clip: AnimalPose, phase: number): SkeletonPoser {
  const species = ANIMAL_SPECIES[kind];

  const poser = new SkeletonPoser(species.skeleton);
  const pose = new Pose(species.skeleton.bones.length);

  poseAnimal(kind, pose, clip, phase, { variation: 0 });
  poser.pose(pose, animalBoneScales(kind, animalAppearance({ kind, ...ADULT })));

  return poser;
}

function joint(poser: SkeletonPoser, bone: number): Vector3 {
  return poser.jointPosition(bone, new Vector3());
}

describe.each(ANIMAL_KINDS)("%s model", (kind) => {
  const species = ANIMAL_SPECIES[kind];

  test("builds clean geometry bound to real bones", () => {
    for (const [index, mesh] of buildAnimalParts(kind, "high").entries()) {
      expect(meshProblems(mesh)).toEqual([]);
      expect(new Set(mesh.channels.part)).toEqual(new Set([index]));
      expect(
        mesh.channels.boneA.every((bone) => {
          return bone < species.skeleton.bones.length;
        })
      ).toBe(true);
      expect(
        mesh.channels.boneB.every((bone) => {
          return bone < species.skeleton.bones.length;
        })
      ).toBe(true);
    }
  });

  test("stands every part on the body and the body on the ground", () => {
    for (const level of LEVELS) {
      const [body, ...extras] = buildAnimalParts(kind, level);

      for (const [index, extra] of extras.entries()) {
        const mesh = mergeMeshes([body, extra]);

        const detached = loosePieces(mesh);

        expect(detached, `${level} ${species.parts[index + 1].name}`).toEqual([]);
      }
    }
  });

  test("leaves no holes in any part at any level of detail", () => {
    for (const level of LEVELS) {
      for (const [index, mesh] of buildAnimalParts(kind, level).entries()) {
        expect(openEdgeCount(mesh), `${level} ${species.parts[index].name}`).toBe(0);
      }
    }
  });

  test("keeps every part on the body through every clip at every level of detail", () => {
    const scales = animalBoneScales(kind, animalAppearance({ kind, ...ADULT }));
    const poser = new SkeletonPoser(species.skeleton);
    const pose = new Pose(species.skeleton.bones.length);

    for (const level of LEVELS) {
      const mesh = mergeMeshes(buildAnimalParts(kind, level));

      for (const clip of ANIMAL_POSES) {
        for (const phase of PHASES) {
          poseAnimal(kind, pose, clip, phase, { variation: 0.3 });
          poser.pose(pose, scales);

          const posed = posedMesh(mesh, poser);

          const loose = loosePieces(posed, TOUCHING, isTorso);

          expect(loose, `${level} ${clip} ${phase}`).toEqual([]);
        }
      }
    }
  });

  test("builds every part from solid shapes, never paper-thin cards", () => {
    for (const level of LEVELS) {
      for (const [index, mesh] of buildAnimalParts(kind, level).entries()) {
        expect(thinnestPiece(mesh, meshPieces(mesh)), `${level} ${species.parts[index].name}`).toBeGreaterThan(
          THINNEST
        );
      }
    }
  });

  test("uses fewer triangles at every lower level of detail", () => {
    function count(level: (typeof LEVELS)[number]): number {
      return buildAnimalParts(kind, level).reduce((sum, mesh) => {
        return sum + mesh.indices.length;
      }, 0);
    }

    expect(count("low")).toBeLessThan(count("high"));
    expect(count("far")).toBeLessThan(count("low") * 0.6);
  });

  test("keeps every pose finite", () => {
    const pose = new Pose(species.skeleton.bones.length);

    for (const clip of ANIMAL_POSES) {
      for (const phase of [0, 0.3, 0.71]) {
        poseAnimal(kind, pose, clip, phase, { variation: 0.4 });

        expect(
          [...pose.angles].every((angle) => {
            return Number.isFinite(angle);
          })
        ).toBe(true);
      }
    }
  });

  test("swaps the leading front hoof every half stride", () => {
    const start = posedAnimal(kind, "walk", 0.25);
    const later = posedAnimal(kind, "walk", 0.75);

    function leftLeads(poser: SkeletonPoser): boolean {
      return joint(poser, QuadrupedBone.HoofFrontLeft).z > joint(poser, QuadrupedBone.HoofFrontRight).z;
    }

    expect(leftLeads(start)).not.toBe(leftLeads(later));
  });

  test("lowers the head to graze and the body when dead", () => {
    const standing = posedAnimal(kind, "walk", 0);
    const grazing = posedAnimal(kind, "graze", 0.1);
    const dead = posedAnimal(kind, "dead", 0);

    expect(joint(grazing, QuadrupedBone.Head).y).toBeLessThan(joint(standing, QuadrupedBone.Head).y);
    expect(joint(dead, QuadrupedBone.Chest).y).toBeLessThan(joint(standing, QuadrupedBone.Chest).y * 0.6);
  });

  test("keeps antlers, tusks and horns out of the ground when lying dead", () => {
    const parts = buildAnimalParts(kind, "high");

    const lying = posedMesh(mergeMeshes(parts), posedAnimal(kind, "dead", 0));

    expect(lying.bounds.minimum[1]).toBeGreaterThan(-0.1);
  });

  test("covers ground with every stride", () => {
    const appearance = animalAppearance({ kind, ...ADULT });

    const stride = measureStride({
      pose: new Pose(species.skeleton.bones.length),
      poser: new SkeletonPoser(species.skeleton),
      sample: (pose, phase) => {
        poseAnimal(kind, pose, "walk", phase, { variation: 0 });
      },
      scales: animalBoneScales(kind, appearance),
      skeleton: species.skeleton,
    });

    expect(stride + leapPerStride(species.gait, "walk")).toBeGreaterThan(0.5);
  });
});

describe("deer antlers", () => {
  function sinksInto(mesh: MeshData, tine: MeshPiece, beams: readonly MeshPiece[]): boolean {
    return tine.vertices.some((vertex) => {
      const point: readonly [number, number, number] = [
        mesh.positions[vertex * 3],
        mesh.positions[vertex * 3 + 1],
        mesh.positions[vertex * 3 + 2],
      ];

      return beams.some((beam) => {
        return isInsidePiece(mesh, beam, point);
      });
    });
  }

  it.each(["antlersSmall", "antlersLarge"])("grows every tine of %s out of its beam", (name) => {
    const part = ANIMAL_SPECIES.deer.parts.findIndex((candidate) => {
      return candidate.name === name;
    });

    for (const level of LEVELS) {
      const mesh = buildAnimalParts("deer", level)[part];

      const [first, second, ...tines] = meshPieces(mesh).toSorted((left, right) => {
        return right.vertices.length - left.vertices.length;
      });

      expect(tines, level).toHaveLength(6);

      for (const tine of tines) {
        expect(sinksInto(mesh, tine, [first, second]), level).toBe(true);
      }
    }
  });
});
