import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { WEAPON_KINDS } from "../../content/weapons.ts";
import { CARRIED_ITEMS, type CarriedItem, PERSON_POSES, type PersonPose } from "../../world/agent-poses.ts";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, mergeMeshes, triangleCount, VERTEX_CHANNELS } from "../mesh/mesh-data.ts";
import { Pose } from "../rig/pose.ts";
import { SkeletonPoser } from "../rig/skeleton-poser.ts";
import { meshProblems, openEdgeCount, thinnestPiece, verticesWhere } from "../testing/mesh-checks.ts";
import {
  isTorso,
  loosePieces,
  type MeshPiece,
  meshPieces,
  piecesTouch,
  TOUCHING,
} from "../testing/mesh-connectivity.ts";
import { posedMesh } from "../testing/moved-mesh.ts";
import { humanPartsMesh, TRIBE } from "../testing/posed-human.ts";
import { type PersonAppearance, personAppearance } from "./appearance.ts";
import { applyHumanClip } from "./human-clips.ts";
import { HUMAN_DETAILS } from "./human-detail.ts";
import {
  activityParts,
  appearanceParts,
  buildHumanParts,
  HUMAN_PARTS,
  type HumanPart,
  humanPartIndex,
} from "./human-model.ts";
import { humanBoneScales } from "./human-proportions.ts";
import { HUMAN_BONE_COUNT, HUMAN_SKELETON, HumanBone } from "./human-skeleton.ts";

const highParts = buildHumanParts(HUMAN_DETAILS.high);
const lowParts = buildHumanParts(HUMAN_DETAILS.low);
const farParts = buildHumanParts(HUMAN_DETAILS.far);
const BODIES = ["bodyChild", "bodyFemale", "bodyMale"] as const satisfies readonly HumanPart[];

const ARM_BONES: ReadonlySet<number> = new Set([
  HumanBone.ForearmLeft,
  HumanBone.ForearmRight,
  HumanBone.HandLeft,
  HumanBone.HandRight,
  HumanBone.UpperArmLeft,
  HumanBone.UpperArmRight,
]);

const TOOLS: ReadonlySet<HumanPart> = new Set(
  PERSON_POSES.flatMap((clip) => {
    return CARRIED_ITEMS.flatMap((carried) => {
      return [null, ...WEAPON_KINDS].flatMap((weapon) => {
        return activityParts(clip, carried, weapon);
      });
    });
  })
);
const GARMENTS = HUMAN_PARTS.filter((part) => {
  return isWorn(part) && !TOOLS.has(part);
});

function isWorn(part: HumanPart): boolean {
  return !(part.startsWith("body") || part.startsWith("carried"));
}

function wornWith(part: HumanPart): HumanPart[] {
  return part === "feather" ? ["headband", part] : [part];
}

function isArm(mesh: MeshData, piece: MeshPiece): boolean {
  const bound = piece.vertices.filter((vertex) => {
    return ARM_BONES.has(mesh.channels.boneA[vertex]) || ARM_BONES.has(mesh.channels.boneB[vertex]);
  });

  return bound.length * 2 > piece.vertices.length;
}

function bodyPartsOf(appearance: PersonAppearance): HumanPart[] {
  return appearanceParts(appearance).filter((part) => {
    return part.startsWith("body");
  });
}

function posedPartsOf(parts: readonly MeshData[], names: readonly HumanPart[], poser: SkeletonPoser): MeshData {
  return posedMesh(humanPartsMesh(parts, names), poser);
}

function poseAs(
  poser: SkeletonPoser,
  appearance: PersonAppearance,
  clip: PersonPose,
  phase: number,
  carried: CarriedItem
): void {
  const pose = new Pose(HUMAN_SKELETON.bones.length);

  applyHumanClip(pose, clip, phase, { ageGroup: appearance.ageGroup, carried, motion: appearance.motion });
  poser.pose(pose, humanBoneScales(appearance.body));
}

function holdsBodyPart(mesh: MeshData, body: readonly HumanPart[]): (piece: MeshPiece) => boolean {
  const bodyParts = new Set(
    body.map((name) => {
      return humanPartIndex(name);
    })
  );

  return (piece) => {
    return piece.vertices.some((vertex) => {
      return bodyParts.has(mesh.channels.part[vertex]);
    });
  };
}

function carriedTo(clip: PersonPose): CarriedItem {
  return clip === "carry" ? "wood" : "nothing";
}

describe("human model", () => {
  it("builds clean geometry for every part", () => {
    for (const [index, mesh] of highParts.entries()) {
      expect(meshProblems(mesh), HUMAN_PARTS[index]).toEqual([]);
      expect(triangleCount(mesh), HUMAN_PARTS[index]).toBeGreaterThan(0);
      expect(new Set(mesh.channels.part)).toEqual(new Set([index]));
    }
  });

  it("binds every vertex to real bones with a valid weight", () => {
    const atlas = mergeMeshes(highParts);

    for (const channel of ["boneA", "boneB"] as const) {
      expect(
        atlas.channels[channel].every((bone) => {
          return Number.isInteger(bone) && bone >= 0 && bone < HUMAN_BONE_COUNT;
        })
      ).toBe(true);
    }

    expect(
      atlas.channels.boneWeight.every((weight) => {
        return weight >= 0 && weight <= 1;
      })
    ).toBe(true);
    expect(
      VERTEX_CHANNELS.every((channel) => {
        return atlas.channels[channel].length === atlas.positions.length / 3;
      })
    ).toBe(true);
  });

  it("stands a body about as tall as a person", () => {
    const [body] = highParts;

    expect(body.bounds.minimum[1]).toBeCloseTo(0, 1);
    expect(body.bounds.maximum[1]).toBeGreaterThan(1.7);
    expect(body.bounds.maximum[1]).toBeLessThan(1.8);
  });

  it("closes the body so no hole opens at a shoulder or a joint", () => {
    for (const body of BODIES) {
      expect(openEdgeCount(highParts[humanPartIndex(body)]), body).toBe(0);
      expect(openEdgeCount(lowParts[humanPartIndex(body)]), body).toBe(0);
      expect(openEdgeCount(farParts[humanPartIndex(body)]), body).toBe(0);
    }
  });

  it("saves triangles at every lower level of detail", () => {
    const highTriangles = highParts.reduce((sum, mesh) => {
      return sum + triangleCount(mesh);
    }, 0);
    const lowTriangles = lowParts.reduce((sum, mesh) => {
      return sum + triangleCount(mesh);
    }, 0);
    const farTriangles = farParts.reduce((sum, mesh) => {
      return sum + triangleCount(mesh);
    }, 0);

    expect(lowTriangles).toBeLessThan(highTriangles * 0.75);
    expect(farTriangles).toBeLessThan(lowTriangles * 0.5);
  });
});

describe("attached parts", () => {
  it.each([
    ["high", highParts],
    ["low", lowParts],
    ["far", farParts],
  ] as const)("keeps every worn part and tool on the %s body standing on the ground", (_level, parts) => {
    for (const body of BODIES) {
      for (const part of HUMAN_PARTS.filter(isWorn)) {
        expect(loosePieces(humanPartsMesh(parts, [body, ...wornWith(part)])), `${body} ${part}`).toEqual([]);
      }
    }
  });

  it("holds every carried load in the arms that carry it", () => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);
    const people = [
      personAppearance({ age: 30, isFemale: false, seed: 0.37, tribe: TRIBE }),
      personAppearance({ age: 34, isFemale: true, seed: 0.6, tribe: TRIBE }),
      personAppearance({ age: 11, isFemale: false, seed: 0.4, tribe: TRIBE }),
    ];

    for (const appearance of people) {
      const body = bodyPartsOf(appearance);

      for (const carried of CARRIED_ITEMS.filter((item) => {
        return item !== "nothing";
      })) {
        poseAs(poser, appearance, "carry", 0.3, carried);

        const load = activityParts("carry", carried);
        const mesh = posedPartsOf(highParts, [...body, ...load], poser);
        const loadParts = new Set(
          load.map((name) => {
            return humanPartIndex(name);
          })
        );
        const pieces = meshPieces(mesh);
        const loose = loosePieces(mesh, TOUCHING, isTorso);
        const arms = pieces.filter((piece) => {
          return isArm(mesh, piece);
        });
        const loads = pieces.filter((piece) => {
          return loadParts.has(mesh.channels.part[piece.vertices[0]]);
        });
        const isHeld = loads.some((piece) => {
          return arms.some((arm) => {
            return piecesTouch(mesh, piece, arm, TOUCHING);
          });
        });

        expect(loose, `${appearance.ageGroup} carrying ${carried}`).toEqual([]);
        expect(isHeld, `${appearance.ageGroup} carrying ${carried}`).toBe(true);
      }
    }
  });
});

describe("moving parts", () => {
  const people = (
    [
      [30, false],
      [28, true],
      [9, false],
    ] as const
  ).map(([age, isFemale]) => {
    return personAppearance({ age, isFemale, seed: 0.42, tribe: TRIBE });
  });

  describe.each([
    ["high", highParts, [0.15, 0.4, 0.7]],
    ["low", lowParts, [0.4]],
    ["far", farParts, [0.4]],
  ] as const)("on the %s body", (_level, parts, garmentPhases) => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);

    function posedPerson(
      appearance: PersonAppearance,
      clip: PersonPose,
      phase: number,
      names: readonly HumanPart[]
    ): MeshData {
      poseAs(poser, appearance, clip, phase, carriedTo(clip));

      return posedPartsOf(parts, [...bodyPartsOf(appearance), ...names], poser);
    }

    it.each(PERSON_POSES)("keeps every limb and tool on the body to %s", (clip) => {
      const tools = activityParts(clip, carriedTo(clip));

      for (const appearance of people) {
        for (const phase of [0.15, 0.4, 0.7]) {
          const mesh = posedPerson(appearance, clip, phase, tools);

          expect(loosePieces(mesh, TOUCHING, isTorso), `${appearance.ageGroup} ${phase}`).toEqual([]);
        }
      }
    });

    it.each(PERSON_POSES)("keeps every garment on the body to %s", (clip) => {
      for (const appearance of people) {
        for (const phase of garmentPhases) {
          for (const garment of GARMENTS) {
            const mesh = posedPerson(appearance, clip, phase, wornWith(garment));
            const body = holdsBodyPart(mesh, bodyPartsOf(appearance));

            expect(loosePieces(mesh, TOUCHING, body), `${appearance.ageGroup} ${phase} ${garment}`).toEqual([]);
          }
        }
      }
    });
  });

  it("builds every part from solid shapes, never paper-thin cards", () => {
    for (const parts of [highParts, lowParts, farParts]) {
      for (const [index, mesh] of parts.entries()) {
        expect(thinnestPiece(mesh, meshPieces(mesh)), HUMAN_PARTS[index]).toBeGreaterThan(0.001);
      }
    }
  });
});

describe("resting poses", () => {
  it.each(["sit", "eat"] as const)("seats a person on the ground, not in the air, to %s", (clip) => {
    const poser = new SkeletonPoser(HUMAN_SKELETON);

    for (const age of [9, 30, 70]) {
      const appearance = personAppearance({ age, isFemale: age > 20, seed: 0.42, tribe: TRIBE });

      poseAs(poser, appearance, clip, 0.3, "nothing");

      const mesh = posedPartsOf(highParts, bodyPartsOf(appearance), poser);
      const seat = verticesWhere(mesh, (vertex) => {
        return mesh.channels.boneA[vertex] === HumanBone.Pelvis && mesh.channels.boneWeight[vertex] === 0;
      });
      const lowestSeat = Math.min(
        ...seat.map((vertex) => {
          return mesh.positions[vertex * 3 + 1];
        })
      );

      expect(lowestSeat, `${appearance.ageGroup}`).toBeLessThan(0.08);
      expect(lowestSeat, `${appearance.ageGroup}`).toBeGreaterThan(-0.08);
    }
  });
});

describe("visible parts", () => {
  it("dresses everyone with one body and an outfit", () => {
    for (let index = 0; index < 40; index += 1) {
      const appearance = personAppearance({
        age: 8 + index,
        isFemale: index % 2 === 0,
        seed: index / 40,
        tribe: TRIBE,
      });
      const parts = appearanceParts(appearance);

      expect(
        parts.filter((part) => {
          return part.startsWith("body");
        })
      ).toHaveLength(1);
      expect(
        parts.some((part) => {
          return ["dress", "loincloth", "tunic", "wrap"].includes(part);
        })
      ).toBe(true);
    }
  });

  it("shows the tool of the task and the load only while carrying", () => {
    expect(activityParts("chop", "nothing")).toEqual(["axe"]);
    expect(activityParts("carry", "wood")).toEqual(["carriedWood"]);
    expect(activityParts("walk", "wood")).toEqual([]);
    expect(activityParts("fish", "fish")).toEqual(["spear"]);
    expect(activityParts("mine", "nothing")).toEqual(["pickaxe"]);
    expect(activityParts("carry", "ore")).toEqual(["carriedOre"]);
  });

  it("arms hunters with the weapon they carry", () => {
    expect(activityParts("walk", "nothing", "bow")).toEqual(["bow", "quiver"]);
    expect(activityParts("run", "nothing", "spear")).toEqual(["spear"]);
    expect(activityParts("leap", "nothing", "bow")).toEqual(["bow", "quiver"]);
    expect(activityParts("shoot", "nothing", "bow")).toEqual(["drawnBow", "quiver"]);
    expect(activityParts("throw", "nothing", "spear")).toEqual(["spear"]);
    expect(activityParts("eat", "nothing", "bow")).toEqual([]);
  });
});

describe("weapons in hand", () => {
  const hunter = personAppearance({ age: 30, era: 5, isFemale: false, seed: 0.37, tribe: TRIBE });
  const poser = new SkeletonPoser(HUMAN_SKELETON);

  function posedParts(clip: PersonPose, phase: number, names: readonly HumanPart[]): MeshData {
    poseAs(poser, hunter, clip, phase, "nothing");

    return posedPartsOf(highParts, names, poser);
  }

  it.each(["walk", "run", "idle", "leap"] as const)("keeps the bow, the quiver and the spear in hand to %s", (clip) => {
    const body = bodyPartsOf(hunter);

    for (const weapon of WEAPON_KINDS) {
      for (const phase of [0.1, 0.45, 0.8]) {
        const names = [...body, ...activityParts(clip, "nothing", weapon)];
        const mesh = posedParts(clip, phase, names);
        const loose = loosePieces(mesh, TOUCHING, isTorso);

        expect(loose, `${weapon} ${phase}`).toEqual([]);
      }
    }
  });

  it("points the nocked arrow past the bow towards the target at full draw", () => {
    const mesh = posedParts("shoot", 0.5, ["drawnBow"]);
    const bowHand = poser.jointPosition(HumanBone.HandLeft, new Vector3());
    const arrowhead = verticesWhere(mesh, (vertex) => {
      return mesh.channels.slot[vertex] === MaterialSlot.Metal;
    });
    const farthest = Math.max(
      ...arrowhead.map((vertex) => {
        return mesh.positions[vertex * 3 + 2];
      })
    );

    expect(arrowhead.length).toBeGreaterThan(0);
    expect(farthest).toBeGreaterThan(bowHand.z + 0.05);
  });

  it("stretches the bow string from the bow tips to the drawing hand", () => {
    const mesh = posedParts("shoot", 0.5, ["drawnBow"]);
    const drawHand = poser.jointPosition(HumanBone.HandRight, new Vector3());
    const string = verticesWhere(mesh, (vertex) => {
      return mesh.channels.slot[vertex] === MaterialSlot.Rope && mesh.channels.boneWeight[vertex] === 1;
    });
    const nearest = Math.min(
      ...string.map((vertex) => {
        return new Vector3().fromArray(mesh.positions, vertex * 3).distanceTo(drawHand);
      })
    );

    expect(string.length).toBeGreaterThan(0);
    expect(nearest).toBeLessThan(0.15);
  });
});
