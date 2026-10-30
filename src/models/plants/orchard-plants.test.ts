import { describe, expect, it, it as test } from "vitest";
import { CultivatedSpecies } from "../../content/cultivated-plants.ts";
import { MaterialSlot } from "../materials.ts";
import type { MeshData } from "../mesh/mesh-data.ts";
import { verticesWhere } from "../testing/mesh-checks.ts";
import { BERRY_PART } from "./berries.ts";
import { buildPlantVariants, canonicalHeight } from "./plant-models.ts";
import { FOLIAGE_FLUTTER, plantSway } from "./tree-mesher.ts";

const FRUIT_SLOTS = [
  [CultivatedSpecies.AppleTree, MaterialSlot.Apple],
  [CultivatedSpecies.PearTree, MaterialSlot.Pear],
  [CultivatedSpecies.PlumTree, MaterialSlot.Plum],
  [CultivatedSpecies.Raspberry, MaterialSlot.Raspberry],
  [CultivatedSpecies.Blueberry, MaterialSlot.Blueberry],
  [CultivatedSpecies.Currant, MaterialSlot.Currant],
] as const;

function fruitOf(mesh: MeshData): number[] {
  return verticesWhere(mesh, (vertex) => {
    return mesh.channels.part[vertex] === BERRY_PART;
  });
}

function widthOf(mesh: MeshData): number {
  const [minimumX, , minimumZ] = mesh.bounds.minimum;
  const [maximumX, , maximumZ] = mesh.bounds.maximum;

  return Math.max(maximumX - minimumX, maximumZ - minimumZ);
}

describe.each(FRUIT_SLOTS)("orchard species %i", (species, slot) => {
  test("hangs its fruit as a separate part in its own color, near and middle distance only", () => {
    for (const level of ["high", "medium"] as const) {
      for (const mesh of buildPlantVariants(species, level)) {
        const fruit = fruitOf(mesh);

        expect(fruit.length).toBeGreaterThan(0);
        expect(
          fruit.every((vertex) => {
            return mesh.channels.slot[vertex] === slot;
          })
        ).toBe(true);
      }
    }

    for (const mesh of buildPlantVariants(species, "low")) {
      expect(fruitOf(mesh)).toEqual([]);
    }
  });

  test("moves the fruit with the leaves it grows on", () => {
    const [mesh] = buildPlantVariants(species, "high");

    for (const vertex of fruitOf(mesh)) {
      const crownSway = plantSway(mesh.positions[vertex * 3 + 1], canonicalHeight(species));

      expect(mesh.channels.sway[vertex]).toBeCloseTo(crownSway, 5);
      expect(mesh.channels.flutter[vertex]).toBe(FOLIAGE_FLUTTER);
    }
  });

  test("dresses the crown in seasonal leaves", () => {
    const [mesh] = buildPlantVariants(species, "high");

    const leaves = verticesWhere(mesh, (vertex) => {
      return mesh.channels.slot[vertex] === MaterialSlot.Leaf;
    });

    expect(leaves.length).toBeGreaterThan(0);
    expect(
      leaves.every((vertex) => {
        return mesh.channels.flutter[vertex] === FOLIAGE_FLUTTER;
      })
    ).toBe(true);
  });
});

describe("orchard shapes", () => {
  it("grows a wide apple crown, a narrow pear and a small plum", () => {
    const [apple] = buildPlantVariants(CultivatedSpecies.AppleTree, "high");
    const [pear] = buildPlantVariants(CultivatedSpecies.PearTree, "high");
    const [plum] = buildPlantVariants(CultivatedSpecies.PlumTree, "high");

    expect(widthOf(apple)).toBeGreaterThan(widthOf(pear));
    expect(pear.bounds.maximum[1]).toBeGreaterThan(widthOf(pear));
    expect(plum.bounds.maximum[1]).toBeLessThan(pear.bounds.maximum[1]);
  });

  it("keeps blueberries low, raspberry canes tall and currants in between", () => {
    const [blueberry] = buildPlantVariants(CultivatedSpecies.Blueberry, "high");
    const [raspberry] = buildPlantVariants(CultivatedSpecies.Raspberry, "high");
    const [currant] = buildPlantVariants(CultivatedSpecies.Currant, "high");

    expect(blueberry.bounds.maximum[1]).toBeLessThan(currant.bounds.maximum[1]);
    expect(currant.bounds.maximum[1]).toBeLessThan(raspberry.bounds.maximum[1]);
    expect(widthOf(blueberry)).toBeGreaterThan(blueberry.bounds.maximum[1]);
  });

  it("hangs currants in strings below the leaves", () => {
    const [currant] = buildPlantVariants(CultivatedSpecies.Currant, "high");
    const [blueberry] = buildPlantVariants(CultivatedSpecies.Blueberry, "high");

    expect(fruitOf(currant).length).toBeGreaterThan(fruitOf(blueberry).length);
  });
});
