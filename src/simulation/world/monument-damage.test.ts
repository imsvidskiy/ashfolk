import { describe, expect, it } from "vitest";
import { formIndexOf, isMonumentPiece, PIECE_FORMS, pieceSeed } from "../../content/monuments.ts";
import { PlantSpecies } from "../../content/plants.ts";
import type { GeneratedWorld } from "../../generation/world-generator.ts";
import { FULL_TURN } from "../../shared/math.ts";
import { type Monument, MonumentDamage } from "../../world/monuments.ts";
import { NO_PLANT } from "../../world/vegetation-store.ts";
import { WorldGrid } from "../../world/world-grid.ts";
import { Simulation } from "../simulation.ts";
import { valleyHeight } from "../testing/test-simulation.ts";
import { createVegetatedWorld, type TestWorldOptions } from "../testing/test-world.ts";
import type { WorldState } from "./world-state.ts";

const DIMENSIONS = { cellSize: 10, cellsPerSide: 128 };
const STONES = 9;
const CIRCLE_RADIUS = 11;

interface Spot {
  readonly x: number;
  readonly z: number;
}

function raiseStoneCircles(spots: readonly Spot[], options: Partial<TestWorldOptions> = {}): GeneratedWorld {
  const grid = new WorldGrid(DIMENSIONS);

  const monuments = spots.map((spot, id): Monument => {
    return {
      cells: grid.cellsInRadius(spot.x, spot.z, 22),
      id,
      kind: "stoneCircle",
      name: `The Ring ${id + 1}`,
      x: spot.x,
      z: spot.z,
    };
  });

  const generated = createVegetatedWorld({ ...options, dimensions: DIMENSIONS, monuments });

  for (const spot of spots) {
    for (let stone = 0; stone < STONES; stone += 1) {
      const angle = (stone / STONES) * FULL_TURN;

      generated.vegetation.add({
        bornDay: 0,
        height: 4,
        rotation: angle,
        seed: pieceSeed(PlantSpecies.Menhir, "upright", 0.5),
        species: PlantSpecies.Menhir,
        x: spot.x + Math.cos(angle) * CIRCLE_RADIUS,
        z: spot.z + Math.sin(angle) * CIRCLE_RADIUS,
      });
    }
  }

  return generated;
}

function formsOf(world: WorldState, id: number): string[] {
  const { vegetation } = world;

  const forms: string[] = [];

  for (const cell of world.monuments[id].cells) {
    for (let plant = vegetation.firstPlantInCell(cell); plant !== NO_PLANT; plant = vegetation.nextPlantInCell(plant)) {
      const species = vegetation.species[plant];

      if (vegetation.isAlive(plant) && isMonumentPiece(species)) {
        forms.push(PIECE_FORMS[species][formIndexOf(species, vegetation.seed[plant])]);
      }
    }
  }

  return forms;
}

function chronicleOf(simulation: Simulation, seconds: number): string[] {
  const texts: string[] = [];

  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    texts.push(
      ...simulation.advance(0.1).chronicle.map((entry) => {
        return entry.text;
      })
    );
  }

  return texts;
}

describe("monument damage", () => {
  it("cracks, topples and shatters monuments by their distance from a meteor", () => {
    const simulation = new Simulation(
      raiseStoneCircles([
        { x: 100, z: 0 },
        { x: 250, z: 0 },
        { x: 400, z: 0 },
        { x: -560, z: 0 },
      ])
    );

    simulation.usePower("meteor", 0, 0, { craterRadius: 140, fallTime: 0.5 });

    const texts = chronicleOf(simulation, 1);
    const damage = simulation.world.monumentConditions.map((condition) => {
      return condition.damage;
    });

    expect(damage).toEqual([
      MonumentDamage.Rubble,
      MonumentDamage.Fallen,
      MonumentDamage.Leaning,
      MonumentDamage.Standing,
    ]);
    expect(texts).toEqual(
      expect.arrayContaining([
        "The meteor shattered the Ring 1",
        "The meteor toppled the Ring 2",
        "The meteor cracked the Ring 3",
      ])
    );
    expect(
      texts.some((text) => {
        return text.includes("Ring 4");
      })
    ).toBe(false);
  });

  it("lays the stones down and leaves rubble where the blast was strongest", () => {
    const simulation = new Simulation(raiseStoneCircles([{ x: 100, z: 0 }]));

    simulation.usePower("meteor", 0, 0, { craterRadius: 140, fallTime: 0.5 });
    chronicleOf(simulation, 1);

    const forms = formsOf(simulation.world, 0);

    expect(
      forms.filter((form) => {
        return form === "upright";
      })
    ).toEqual([]);
    expect(forms.length).toBeGreaterThan(STONES);
  });

  it("topples the stones away from the blast", () => {
    const simulation = new Simulation(raiseStoneCircles([{ x: 0, z: 60 }]));
    const { vegetation } = simulation.world;

    simulation.usePower("explosion", 0, 0, {});

    const fallen = Array.from({ length: vegetation.count }, (_, plant) => {
      return plant;
    }).filter((plant) => {
      return (
        vegetation.species[plant] === PlantSpecies.Menhir &&
        PIECE_FORMS[PlantSpecies.Menhir][formIndexOf(PlantSpecies.Menhir, vegetation.seed[plant])] === "fallen"
      );
    });

    const turns = fallen.map((plant) => {
      const outward = Math.atan2(vegetation.x[plant], vegetation.z[plant]);

      return Math.abs(
        Math.atan2(Math.sin(vegetation.rotation[plant] - outward), Math.cos(vegetation.rotation[plant] - outward))
      );
    });

    expect(simulation.world.monumentConditions[0].damage).toBe(MonumentDamage.Fallen);
    expect(fallen.length).toBeGreaterThan(2);
    expect(Math.max(...turns)).toBeLessThan(0.3);
  });

  it("only ever adds damage", () => {
    const simulation = new Simulation(raiseStoneCircles([{ x: 0, z: 60 }]));

    simulation.usePower("explosion", 0, 0, {});

    const forms = formsOf(simulation.world, 0);

    simulation.usePower("explosion", 0, -100, { radius: 20 });

    expect(simulation.world.monumentConditions[0].damage).toBe(MonumentDamage.Fallen);
    expect(formsOf(simulation.world, 0)).toEqual(forms);
  });

  it("lets earthquakes topple monuments along their reach", () => {
    const simulation = new Simulation(
      raiseStoneCircles([
        { x: 40, z: 0 },
        { x: 0, z: 200 },
        { x: -400, z: 0 },
      ])
    );

    simulation.usePower("earthquake", 0, 0, { magnitude: 100, radius: 300 });

    const texts = chronicleOf(simulation, 0.2);
    const damage = simulation.world.monumentConditions.map((condition) => {
      return condition.damage;
    });

    expect(damage[0]).toBeGreaterThanOrEqual(MonumentDamage.Fallen);
    expect(damage[1]).toBe(MonumentDamage.Leaning);
    expect(damage[2]).toBe(MonumentDamage.Standing);
    expect(texts).toContain("The earthquake cracked the Ring 2");
  });
});

describe("drowned monuments", () => {
  it("tells when a new lake drowns a monument", () => {
    const simulation = new Simulation(raiseStoneCircles([{ x: 5, z: -200 }], { heightAt: valleyHeight }));

    simulation.waterRecomputation.recompute();
    simulation.usePower("meteor", 0, -200, { craterRadius: 140, fallTime: 0.5 });

    const texts = chronicleOf(simulation, 8);

    expect(simulation.world.monumentConditions[0].isDrowned).toBe(true);
    expect(texts).toContain("Rising water drowned the Ring 1");
  });
});
