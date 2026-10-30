import { describe, expect, it } from "vitest";
import { BIOMES, Biome } from "./biomes.ts";
import { BUILDINGS } from "./buildings.ts";
import { PIECE_FORMS } from "./monuments.ts";
import {
  isMonumentSpecies,
  isShrubSpecies,
  isTreeSpecies,
  PLANT_SPECIES,
  PLANTING_RULES,
  PlantSpecies,
  regrowingSpecies,
  woodlandShare,
} from "./plants.ts";

const STEEPEST_FOOTING = 1.05;

describe("plants", () => {
  it("lists plant species in the order of their indices", () => {
    expect(
      PLANT_SPECIES.map((species) => {
        return species.index;
      })
    ).toEqual(
      PLANT_SPECIES.map((_species, position) => {
        return position;
      })
    );
    expect(PLANT_SPECIES).toHaveLength(Object.keys(PlantSpecies).length);
  });

  it("plants every biome except water", () => {
    for (const biome of BIOMES) {
      const rules = PLANTING_RULES[biome.index];

      expect(rules.length > 0).toBe(biome.index !== Biome.Water);
    }
  });

  it("regrows only living trees", () => {
    expect(regrowingSpecies(Biome.Forest, 10)).not.toContain(PlantSpecies.Bush);
    expect(regrowingSpecies(Biome.Forest, 10)).not.toContain(PlantSpecies.DeadTree);
    expect(regrowingSpecies(Biome.Desert, 20)).toEqual([PlantSpecies.Acacia, PlantSpecies.Palm]);
  });

  it("shapes every monument species as monument pieces", () => {
    const monuments = PLANT_SPECIES.filter((species) => {
      return isMonumentSpecies(species.index);
    }).map((species) => {
      return species.index;
    });

    expect(monuments).toEqual(Object.keys(PIECE_FORMS).map(Number));
  });

  it("asks trees for gentler ground than bushes and keeps everything off cliffs", () => {
    const trees = PLANT_SPECIES.filter((species) => {
      return isTreeSpecies(species.index);
    });
    const undergrowth = PLANT_SPECIES.filter((species) => {
      return isShrubSpecies(species.index);
    });
    const steepestTree = Math.max(
      ...trees.map((species) => {
        return species.steepestSlope;
      })
    );
    const gentlestUndergrowth = Math.min(
      ...undergrowth.map((species) => {
        return species.steepestSlope;
      })
    );

    expect(steepestTree).toBeLessThan(gentlestUndergrowth);

    for (const species of PLANT_SPECIES) {
      expect(species.steepestSlope, species.name).toBeGreaterThan(0.3);
      expect(species.steepestSlope, species.name).toBeLessThanOrEqual(STEEPEST_FOOTING);
    }

    for (const building of Object.values(BUILDINGS)) {
      expect(building.steepestSlope).toBeLessThan(steepestTree);
    }
  });

  it("thins trees with the woodland but keeps some undergrowth in clearings", () => {
    expect(woodlandShare(PlantSpecies.Oak, 0.2)).toBe(0.2);
    expect(woodlandShare(PlantSpecies.Bush, 0)).toBeGreaterThan(0);
    expect(woodlandShare(PlantSpecies.Bush, 0)).toBeLessThan(1);
    expect(woodlandShare(PlantSpecies.Boulder, 0)).toBe(1);
  });

  it("keeps warm-weather trees out of cold places", () => {
    expect(regrowingSpecies(Biome.Beach, 15)).toContain(PlantSpecies.Palm);
    expect(regrowingSpecies(Biome.Beach, 5)).not.toContain(PlantSpecies.Palm);
    expect(regrowingSpecies(Biome.Steppe, 5)).not.toContain(PlantSpecies.Acacia);
  });
});
