import { describe, expect, it, it as test } from "vitest";
import { PLANT_SPECIES, PlantSpecies, type PlantSpeciesIndex, plantSpeciesDefinition } from "../../content/plants.ts";
import { MaterialSlot } from "../materials.ts";
import { type MeshData, triangleCount, vertexCount } from "../mesh/mesh-data.ts";
import { highestExposedOpenEdge, meshProblems } from "../testing/mesh-checks.ts";
import { isInsidePiece, loosePieces, type MeshPiece, meshPieces } from "../testing/mesh-connectivity.ts";
import { windBentMesh } from "../testing/moved-mesh.ts";
import { widestReach } from "../testing/structure-checks.ts";
import { BERRY_PART, BERRY_RADIUS } from "./berries.ts";
import {
  buildPlantVariants,
  canonicalHeight,
  footprintRadius,
  PLANT_DETAIL_LEVELS,
  plantVariantCount,
} from "./plant-models.ts";
import { FOLIAGE_FLUTTER, type NearLevel, type PlantDetailLevel, plantSway } from "./tree-mesher.ts";

const RADIUS_TOLERANCE = 0.2;
const STORM_PUSH = 2;
const GROUND_LEVEL = 0.05;
const SPECIES: readonly PlantSpeciesIndex[] = PLANT_SPECIES.map((definition) => {
  return definition.index;
});
const FOLIAGE_SLOTS: ReadonlySet<number> = new Set([MaterialSlot.Leaf, MaterialSlot.Needle]);
const NEAR_LEVELS: readonly NearLevel[] = ["high", "medium"];
const TIERED_LEVELS: readonly PlantDetailLevel[] = [...NEAR_LEVELS, "low"];

const TREES = [
  PlantSpecies.Acacia,
  PlantSpecies.Birch,
  PlantSpecies.Maple,
  PlantSpecies.Oak,
  PlantSpecies.Palm,
  PlantSpecies.Pine,
  PlantSpecies.Poplar,
  PlantSpecies.Spruce,
  PlantSpecies.Willow,
];

const BUILT_VARIANTS = new Map<string, MeshData[]>();

const MIXED_FORMS: ReadonlySet<PlantSpeciesIndex> = new Set([PlantSpecies.Cactus, PlantSpecies.DeadTree]);

const LYING_FORMS: ReadonlySet<PlantSpeciesIndex> = new Set(
  PLANT_SPECIES.filter((definition) => {
    return definition.form === "monument";
  }).map((definition) => {
    return definition.index;
  })
);

function variantsOf(species: PlantSpeciesIndex, level: PlantDetailLevel): MeshData[] {
  const key = `${species} ${level}`;
  const known = BUILT_VARIANTS.get(key);

  if (known !== undefined) {
    return known;
  }

  const variants = buildPlantVariants(species, level);

  BUILT_VARIANTS.set(key, variants);

  return variants;
}

function shortestVariantShare(species: PlantSpeciesIndex): number {
  if (LYING_FORMS.has(species)) {
    return 0.08;
  }

  return MIXED_FORMS.has(species) ? 0.3 : 0.62;
}

function widestRadius(species: PlantSpeciesIndex): number {
  return variantsOf(species, "high").reduce((widest, mesh) => {
    return Math.max(widest, widestReach(mesh));
  }, 0);
}

function workingRadius(species: PlantSpeciesIndex): number {
  const { form } = plantSpeciesDefinition(species);

  if (form === "shrub" || form === "stone" || form === "monument") {
    return widestRadius(species);
  }

  return footprintRadius(species);
}

function averageTriangles(species: PlantSpeciesIndex, level: PlantDetailLevel): number {
  const variants = variantsOf(species, level);

  return (
    variants.reduce((sum, mesh) => {
      return sum + triangleCount(mesh);
    }, 0) / variants.length
  );
}

function isBerryPart(part: number): boolean {
  return part >= BERRY_PART;
}

function berryPieces(bush: MeshData): MeshPiece[] {
  return meshPieces(bush).filter((piece) => {
    return isBerryPart(bush.channels.part[piece.vertices[0]]);
  });
}

function widestSpan(mesh: MeshData, piece: MeshPiece): number {
  let widest = 0;

  for (const first of piece.vertices) {
    for (const second of piece.vertices) {
      const between = Math.hypot(
        mesh.positions[first * 3] - mesh.positions[second * 3],
        mesh.positions[first * 3 + 1] - mesh.positions[second * 3 + 1],
        mesh.positions[first * 3 + 2] - mesh.positions[second * 3 + 2]
      );

      widest = Math.max(widest, between);
    }
  }

  return widest;
}

function highestVertex(mesh: MeshData, vertices: readonly number[]): number {
  return vertices.reduce((highest, vertex) => {
    return mesh.positions[vertex * 3 + 1] > mesh.positions[highest * 3 + 1] ? vertex : highest;
  });
}

describe.each(SPECIES)("plant species %i", (species) => {
  test("builds clean variants at every level of detail", () => {
    for (const level of PLANT_DETAIL_LEVELS) {
      const variants = variantsOf(species, level);

      expect(variants).toHaveLength(plantVariantCount(species));

      for (const mesh of variants) {
        expect(meshProblems(mesh)).toEqual([]);
      }
    }
  });

  test("stands on the ground at about its canonical height", () => {
    const height = canonicalHeight(species);
    const shortest = shortestVariantShare(species);
    const variants = variantsOf(species, "high");

    for (const mesh of variants) {
      expect(mesh.bounds.minimum[1]).toBeGreaterThan(-0.5);
      expect(mesh.bounds.minimum[1]).toBeLessThan(height * 0.2);
      expect(mesh.bounds.maximum[1]).toBeGreaterThan(height * shortest);
      expect(mesh.bounds.maximum[1]).toBeLessThan(height * 1.25);
    }

    expect(
      Math.max(
        ...variants.map((mesh) => {
          return mesh.bounds.maximum[1];
        })
      )
    ).toBeGreaterThan(height * 0.62);
  });

  test("spends fewer triangles further away", () => {
    expect(averageTriangles(species, "medium")).toBeLessThanOrEqual(averageTriangles(species, "high"));
    expect(averageTriangles(species, "low")).toBeLessThan(averageTriangles(species, "medium"));
    expect(averageTriangles(species, "far")).toBeLessThanOrEqual(averageTriangles(species, "low"));
  });

  test("gives the same model for the same variant", () => {
    const [first] = buildPlantVariants(species, "medium");
    const [again] = buildPlantVariants(species, "medium");

    expect(again.positions).toEqual(first.positions);
  });

  test("tells the simulation how far it reaches where people work on it", () => {
    const measured = workingRadius(species) / canonicalHeight(species);

    expect(Math.abs(plantSpeciesDefinition(species).radiusPerMeter - measured)).toBeLessThan(
      measured * RADIUS_TOLERANCE
    );
  });

  test("closes every variant everywhere above the ground", () => {
    for (const level of PLANT_DETAIL_LEVELS) {
      for (const [variant, mesh] of variantsOf(species, level).entries()) {
        expect(highestExposedOpenEdge(mesh), `${level} variant ${variant}`).toBeLessThan(GROUND_LEVEL);
      }
    }
  });

  test("keeps every part of every variant attached to the ground", () => {
    for (const level of PLANT_DETAIL_LEVELS) {
      for (const [variant, mesh] of variantsOf(species, level).entries()) {
        const detached = loosePieces(mesh);

        expect(detached, `${level} variant ${variant}`).toEqual([]);
      }
    }
  });

  test("keeps every part attached while a storm bends it", () => {
    for (const level of PLANT_DETAIL_LEVELS) {
      for (const [variant, mesh] of variantsOf(species, level).entries()) {
        const bent = windBentMesh(mesh, STORM_PUSH);
        const detached = loosePieces(bent);

        expect(detached, `${level} variant ${variant}`).toEqual([]);
      }
    }
  });
});

describe("tree details", () => {
  it.each(TREES)("flutters only the foliage of species %i and sways it more than the trunk foot", (species) => {
    const [mesh] = variantsOf(species, "high");

    const vertices = Array.from({ length: vertexCount(mesh) }, (_, vertex) => {
      return vertex;
    });

    function isFoliage(vertex: number): boolean {
      return FOLIAGE_SLOTS.has(mesh.channels.slot[vertex]);
    }

    const foliage = vertices.filter(isFoliage);
    const wood = vertices.filter((vertex) => {
      return !isFoliage(vertex);
    });
    const foot = wood.filter((vertex) => {
      return mesh.positions[vertex * 3 + 1] < canonicalHeight(species) / 3;
    });

    function averageSway(group: readonly number[]): number {
      return (
        group.reduce((sum, vertex) => {
          return sum + mesh.channels.sway[vertex];
        }, 0) / group.length
      );
    }

    expect(foliage.length).toBeGreaterThan(0);
    expect(
      foliage.every((vertex) => {
        return mesh.channels.flutter[vertex] === FOLIAGE_FLUTTER;
      })
    ).toBe(true);
    expect(
      wood.every((vertex) => {
        return mesh.channels.flutter[vertex] === 0;
      })
    ).toBe(true);
    expect(averageSway(foliage)).toBeGreaterThan(averageSway(foot));
  });

  it("sways the top of every willow crown with the tree", () => {
    for (const level of NEAR_LEVELS) {
      for (const willow of variantsOf(PlantSpecies.Willow, level)) {
        const foliage = meshPieces(willow).filter((piece) => {
          return willow.channels.flutter[piece.vertices[0]] === FOLIAGE_FLUTTER;
        });

        for (const piece of foliage) {
          const top = highestVertex(willow, piece.vertices);
          const crownSway = plantSway(willow.positions[top * 3 + 1], canonicalHeight(PlantSpecies.Willow));

          expect(willow.channels.sway[top], level).toBeCloseTo(crownSway, 2);
        }
      }
    }
  });

  it("moves each berry as one piece with the leaves it grows on", () => {
    for (const level of NEAR_LEVELS) {
      for (const bush of variantsOf(PlantSpecies.Bush, level)) {
        const berries = berryPieces(bush);

        expect(berries.length).toBeGreaterThan(0);

        for (const piece of berries) {
          const sways = [
            ...new Set(
              piece.vertices.map((vertex) => {
                return bush.channels.sway[vertex];
              })
            ),
          ];
          const middle = (piece.minimum[1] + piece.maximum[1]) / 2;

          expect(sways).toHaveLength(1);
          expect(sways[0]).toBeCloseTo(plantSway(middle, canonicalHeight(PlantSpecies.Bush)), 5);
          expect(
            piece.vertices.every((vertex) => {
              return bush.channels.flutter[vertex] === FOLIAGE_FLUTTER;
            })
          ).toBe(true);
        }
      }
    }
  });

  it("keeps every berry small and whole through a storm", () => {
    for (const level of NEAR_LEVELS) {
      for (const bush of variantsOf(PlantSpecies.Bush, level)) {
        const bent = windBentMesh(bush, STORM_PUSH);

        for (const piece of berryPieces(bush)) {
          const ripening = new Set(
            piece.vertices.map((vertex) => {
              return bush.channels.part[vertex];
            })
          );

          expect(ripening.size).toBe(1);
          expect(widestSpan(bush, piece)).toBeLessThan(BERRY_RADIUS * 2.5);
          expect(widestSpan(bent, piece)).toBeCloseTo(widestSpan(bush, piece), 5);
        }
      }
    }
  });

  it("tucks the tip of every spruce tier inside the tier above it", () => {
    for (const level of TIERED_LEVELS) {
      for (const spruce of variantsOf(PlantSpecies.Spruce, level)) {
        const tiers = meshPieces(spruce)
          .filter((piece) => {
            return spruce.channels.slot[piece.vertices[0]] === MaterialSlot.Needle;
          })
          .sort((first, second) => {
            return first.maximum[1] - second.maximum[1];
          });

        for (const tier of tiers.slice(0, -1)) {
          const tip = highestVertex(spruce, tier.vertices) * 3;

          const isTucked = tiers.some((other) => {
            return (
              other !== tier &&
              isInsidePiece(spruce, other, [
                spruce.positions[tip],
                spruce.positions[tip + 1],
                spruce.positions[tip + 2],
              ])
            );
          });

          expect(isTucked).toBe(true);
        }
      }
    }
  });

  it("hides stubs of branches under near spruce tiers for the burnt snag", () => {
    function woodReach(spruce: MeshData): number {
      let reach = 0;

      for (let vertex = 0; vertex < vertexCount(spruce); vertex += 1) {
        if (spruce.channels.slot[vertex] !== MaterialSlot.Needle) {
          reach = Math.max(reach, Math.hypot(spruce.positions[vertex * 3], spruce.positions[vertex * 3 + 2]));
        }
      }

      return reach;
    }

    for (const spruce of variantsOf(PlantSpecies.Spruce, "high")) {
      expect(woodReach(spruce)).toBeGreaterThan(1);
    }

    for (const spruce of variantsOf(PlantSpecies.Spruce, "low")) {
      expect(woodReach(spruce)).toBeLessThan(1);
    }
  });

  it("grows a different kind of cactus from each variant", () => {
    const [saguaro, organPipe, barrel, pricklyPear] = variantsOf(PlantSpecies.Cactus, "high");

    expect(saguaro.bounds.maximum[1]).toBeGreaterThan(3);
    expect(
      meshPieces(organPipe).filter((piece) => {
        return piece.triangles.length > 60;
      }).length
    ).toBeGreaterThan(3);
    expect(barrel.bounds.maximum[1]).toBeLessThan(1.6);
    expect(pricklyPear.channels.slot).toContain(MaterialSlot.Berry);
    expect(saguaro.channels.slot).toContain(MaterialSlot.Blossom);
  });

  it("leaves dead trees bare in every season", () => {
    for (const level of PLANT_DETAIL_LEVELS) {
      for (const snag of variantsOf(PlantSpecies.DeadTree, level)) {
        expect(
          [...snag.channels.slot].some((slot) => {
            return FOLIAGE_SLOTS.has(slot);
          })
        ).toBe(false);
        expect(snag.channels.slot).toContain(MaterialSlot.Deadwood);
      }
    }
  });

  it("marks birch bark and hangs berries only on near bushes", () => {
    const [birch] = variantsOf(PlantSpecies.Birch, "high");
    const [nearBush] = variantsOf(PlantSpecies.Bush, "high");
    const [farBush] = variantsOf(PlantSpecies.Bush, "low");

    expect(birch.channels.slot).toContain(MaterialSlot.BirchBark);
    expect(birch.channels.slot).toContain(MaterialSlot.Bark);
    expect([...nearBush.channels.part].some(isBerryPart)).toBe(true);
    expect([...farBush.channels.part].some(isBerryPart)).toBe(false);
  });
});
