import { describe, expect, it } from "vitest";
import { ANIMALS } from "../../content/animals.ts";
import { Biome } from "../../content/biomes.ts";
import { DEFAULT_WORLD_RULES } from "../../content/world-rules.ts";
import { ignore } from "../../shared/ignore.ts";
import { createRandom } from "../../shared/random.ts";
import { placeMover } from "../agents/movement.ts";
import { NavigationGrid, type Waypoint } from "../agents/navigation.ts";
import { IdentifierSource } from "../identifiers.ts";
import { createTestWorld, floodCells, livingCount } from "../testing/test-world.ts";
import type { WorldState } from "../world/world-state.ts";
import type { PeopleSense } from "./beast-instincts.ts";
import { type Animal, FaunaSystem, type FaunaThreats, type FaunaTick } from "./fauna.ts";

const DIMENSIONS = { cellSize: 10, cellsPerSide: 96 };
const NO_PEOPLE: PeopleSense = {
  findQuarry: () => {
    return null;
  },
  locate: () => {
    return null;
  },
  nearest: () => {
    return null;
  },
  wound: ignore,
};
const NO_THREATS: FaunaThreats = {
  dangerNear: () => {
    return null;
  },
  hunterNear: () => {
    return null;
  },
  people: NO_PEOPLE,
};
const SUMMER = 1.6;
const SPRING = 0.5;
const WINTER = 3.5;
const TAME = { ...DEFAULT_WORLD_RULES, nature: { ...DEFAULT_WORLD_RULES.nature, beastBoldness: 0 } };

function createFauna(world: WorldState = createTestWorld({ dimensions: DIMENSIONS })) {
  const navigation = new NavigationGrid(world);

  return { fauna: new FaunaSystem(world, navigation, new IdentifierSource()), navigation, world };
}

function tickOf(overrides: Partial<FaunaTick> = {}): FaunaTick {
  return {
    days: 0.1 / 240,
    hours: 12,
    random: createRandom(4),
    rules: DEFAULT_WORLD_RULES,
    season: SUMMER,
    seconds: 0.1,
    threats: NO_THREATS,
    ...overrides,
  };
}

function runFor(fauna: FaunaSystem, seconds: number, overrides: Partial<FaunaTick> = {}): void {
  const tick = tickOf(overrides);

  for (let elapsed = 0; elapsed < seconds; elapsed += tick.seconds) {
    fauna.update(tick);
  }
}

function spawned<Herd>(herd: Herd | null): Herd {
  if (herd === null) {
    throw new Error("Expected the herd to spawn");
  }

  return herd;
}

function slopedFauna() {
  return createFauna(
    createTestWorld({
      biome: Biome.Alpine,
      dimensions: DIMENSIONS,
      heightAt: (x) => {
        return 100 + x * 0.5;
      },
    })
  );
}

function edgedFauna() {
  const world = createTestWorld({ biome: Biome.Forest, dimensions: DIMENSIONS });

  for (let cell = 0; cell < world.grid.cellCount; cell += 1) {
    if (world.grid.cellCenterX(cell) < 0) {
      world.terrain.biome[cell] = Biome.Meadow;
    }
  }

  return createFauna(world);
}

function chasedPreyIds(fauna: FaunaSystem): number[] {
  return [...fauna.snapshot().instincts.moods.values()].flatMap((mood) => {
    return mood.chase === null ? [] : [mood.chase.preyId];
  });
}

function hares(fauna: FaunaSystem): Animal[] {
  return fauna.animals.filter((animal) => {
    return animal.kind === "hare";
  });
}

describe("herds", () => {
  it("spawn on dry land with the requested size", () => {
    const { fauna } = createFauna();

    const herd = fauna.spawnHerd("deer", 0, 0, 5, createRandom(1));

    expect(herd?.memberIds).toHaveLength(5);
    expect(livingCount(fauna)).toBe(5);
  });

  it("spread over suitable land when the world is populated", () => {
    const { fauna } = createFauna(createTestWorld({ biome: Biome.Forest, dimensions: DIMENSIONS }));

    const created = fauna.populate(4, createRandom(2));

    expect(created).toBe(4);
    expect(
      fauna.herds.every((herd) => {
        return ANIMALS[herd.kind].favoriteBiomes.includes(Biome.Forest);
      })
    ).toBe(true);
  });

  it("wander to new pastures over time", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 3, createRandom(1));

    const startX = fauna.animals.map((animal) => {
      return animal.mover.x;
    });

    runFor(fauna, 200);

    const moved = fauna.animals.some((animal, index) => {
      return Math.abs(animal.mover.x - startX[index]) > 20;
    });

    expect(moved).toBe(true);
  });
});

describe("animals", () => {
  it("run away from danger", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 1, createRandom(1));

    const [deer] = fauna.animals;

    const danger: Waypoint = { x: deer.mover.x - 30, z: deer.mover.z };

    runFor(fauna, 3, {
      threats: {
        dangerNear: () => {
          return danger;
        },
        hunterNear: () => {
          return null;
        },
        people: NO_PEOPLE,
      },
    });

    expect(deer.pose).toBe("run");
    expect(deer.mover.x - danger.x).toBeGreaterThan(40);
  });

  it("die in a blast and are cleared away later", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 3, createRandom(1));
    fauna.damageArea(0, 0, 100, 10, "blast");

    expect(livingCount(fauna)).toBe(0);
    expect(
      fauna.animals.map((animal) => {
        return animal.causeOfDeath;
      })
    ).toEqual(["blast", "blast", "blast"]);

    runFor(fauna, 35);

    expect(fauna.animals).toHaveLength(0);
    expect(fauna.herds).toHaveLength(0);
  });

  it("spare the animal held in the hand from a blast", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 3, createRandom(1));

    const [held] = fauna.animals;

    fauna.hold(held);
    fauna.damageArea(0, 0, 100, 10, "blast");

    expect(held.isAlive).toBe(true);
    expect(livingCount(fauna)).toBe(1);
  });

  it("swim ashore when the water rises around them as they graze", () => {
    const { fauna, navigation, world } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 4, createRandom(1));
    runFor(fauna, 1);
    floodCells(world, world.grid.cellsInRadius(0, 0, 50), 1.6);
    navigation.rebuild();

    expect(
      fauna.animals.every((animal) => {
        return world.isWaterAt(animal.mover.x, animal.mover.z);
      })
    ).toBe(true);

    runFor(fauna, 60);

    expect(
      fauna.animals.filter((animal) => {
        return world.isWaterAt(animal.mover.x, animal.mover.z);
      })
    ).toEqual([]);
  });

  it("burn when standing in flames", () => {
    const { fauna, world } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 1, createRandom(1));
    world.fields.fire.fill(0.8);
    runFor(fauna, 5);

    expect(
      fauna.animals.map((animal) => {
        return animal.causeOfDeath;
      })
    ).toEqual(["fire"]);
  });

  it("are born in spring", () => {
    const { fauna } = createFauna();

    const tick = tickOf({ days: 0.01, season: SPRING });

    fauna.spawnHerd("deer", 0, 0, 3, createRandom(1));

    for (let step = 0; step < 5000 && livingCount(fauna) === 3; step += 1) {
      fauna.update(tick);
    }

    expect(livingCount(fauna)).toBe(4);
    expect(fauna.animals.at(-1)?.youth).toBeGreaterThan(0.9);
  });

  it("are not born out of season", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("deer", 0, 0, 3, createRandom(1));
    runFor(fauna, 240, { days: 0.01, season: SUMMER });

    expect(livingCount(fauna)).toBe(3);
  });
});

describe("kinds of animals", () => {
  it("bring ibex to rocky heights when the world is populated", () => {
    const { fauna } = createFauna(createTestWorld({ biome: Biome.Alpine, dimensions: DIMENSIONS }));

    expect(fauna.populate(3, createRandom(2))).toBe(3);
    expect(
      fauna.herds.every((herd) => {
        return herd.kind === "ibex";
      })
    ).toBe(true);
  });

  it("send a chased ibex bounding uphill while a deer runs straight away", () => {
    const danger: Waypoint = { x: 0, z: 40 };
    const threats: FaunaThreats = {
      dangerNear: () => {
        return danger;
      },
      hunterNear: () => {
        return null;
      },
      people: NO_PEOPLE,
    };

    const climbers = slopedFauna();
    const runners = slopedFauna();

    climbers.fauna.spawnHerd("ibex", 0, 0, 1, createRandom(1));
    runners.fauna.spawnHerd("deer", 0, 0, 1, createRandom(1));

    const [ibex] = climbers.fauna.animals;
    const [deer] = runners.fauna.animals;

    const ibexStart = ibex.mover.x;
    const deerStart = deer.mover.x;

    runFor(climbers.fauna, 4, { threats });
    runFor(runners.fauna, 4, { threats });

    expect(ibex.mover.x - ibexStart).toBeGreaterThan(deer.mover.x - deerStart + 12);
    expect(ibex.mover.z).toBeLessThan(danger.z);
  });

  it("lead ibex herds to higher pastures", () => {
    const { fauna } = slopedFauna();

    const random = createRandom(1);

    const herds = [-160, -80, 0, 80, 160].map((z) => {
      return spawned(fauna.spawnHerd("ibex", -100, z, 2, random));
    });

    runFor(fauna, 1);

    expect(
      herds.every((herd) => {
        return herd.goalX > -60;
      })
    ).toBe(true);
  });

  it("send wolf packs to pastures at least as far as their range", () => {
    const { fauna } = createFauna();

    const pack = spawned(fauna.spawnHerd("wolf", 0, 0, 3, createRandom(1)));

    runFor(fauna, 1);

    expect(Math.hypot(pack.goalX, pack.goalZ)).toBeGreaterThanOrEqual(ANIMALS.wolf.pastureRange[0]);
  });
});

describe("hares", () => {
  it("stay out of the big herds that populate the world", () => {
    const { fauna } = createFauna();

    fauna.populate(6, createRandom(2));

    expect(
      fauna.herds.some((herd) => {
        return herd.kind === "hare";
      })
    ).toBe(false);
  });

  it("settle on meadows and the forest edge but never by the water", () => {
    const { fauna, navigation, world } = edgedFauna();

    floodCells(world, world.grid.cellsInRadius(-200, 0, 60), 1.2);
    navigation.rebuild();

    expect(fauna.populateSmallGame(12)).toBe(12);

    for (const hare of hares(fauna)) {
      const cell = world.grid.cellAt(hare.mover.x, hare.mover.z);

      expect(hare.mover.x).toBeLessThan(40);
      expect(world.touchesWater(cell)).toBe(false);
    }
  });

  it("draw their chances from a stream of their own", () => {
    const { fauna } = createFauna();

    const shared = createRandom(4);

    fauna.populateSmallGame(4);
    runFor(fauna, 60, { random: shared, season: SPRING });

    expect(hares(fauna).length).toBeGreaterThan(0);
    expect(shared.next()).toBe(createRandom(4).next());
  });

  it("refuse to start a group by the water", () => {
    const { fauna, navigation, world } = createFauna();

    floodCells(world, world.grid.cellsInRadius(0, 0, 30), 1.2);
    navigation.rebuild();

    expect(fauna.spawnHerd("hare", 35, 0, 3, createRandom(1))).toBeNull();
    expect(fauna.spawnHerd("hare", 200, 0, 3, createRandom(1))).not.toBeNull();
  });

  it("raise litters through spring and summer and send grown young off to new ground", () => {
    const { fauna } = createFauna(createTestWorld({ dimensions: { cellSize: 10, cellsPerSide: 160 } }));

    fauna.spawnHerd("hare", 0, 0, 2, createRandom(1));
    runFor(fauna, 150, { days: 0.01, season: SUMMER });

    expect(hares(fauna).length).toBeGreaterThan(ANIMALS.hare.maximumHerdSize);
    expect(fauna.herds.length).toBeGreaterThan(1);
  });

  it("die of age within a few years while deer live on", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("hare", 0, 0, 3, createRandom(1));
    fauna.spawnHerd("deer", 100, 0, 2, createRandom(1));
    runFor(fauna, 8, { days: 0.5, season: WINTER });

    expect(
      hares(fauna).map((hare) => {
        return hare.causeOfDeath;
      })
    ).toEqual(["age", "age", "age"]);
    expect(
      fauna.animals.filter((animal) => {
        return animal.kind === "deer" && animal.isAlive;
      })
    ).toHaveLength(2);
  });

  it("bolt from a wolf before it is close", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("hare", 0, 0, 1, createRandom(1));
    fauna.spawnHerd("wolf", -35, 0, 1, createRandom(1));

    const [hare] = hares(fauna);

    runFor(fauna, 3, { rules: TAME });

    expect(hare.pose).toBe("run");
    expect(hare.mover.x).toBeGreaterThan(12);
  });

  it("feed a hungry wolf pack that runs one down", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("wolf", -40, 0, 4, createRandom(1));
    fauna.spawnHerd("hare", 40, 0, 3, createRandom(1));

    const tick = tickOf();

    for (
      let step = 0;
      step < 3000 &&
      !hares(fauna).some((hare) => {
        return !hare.isAlive;
      });
      step += 1
    ) {
      fauna.update(tick);
    }

    expect(
      hares(fauna)
        .filter((hare) => {
          return !hare.isAlive;
        })
        .map((hare) => {
          return hare.causeOfDeath;
        })
    ).toEqual(["prey"]);
  });

  it("are safe from a chasing pack while the hand holds them", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("wolf", -40, 0, 4, createRandom(1));
    fauna.spawnHerd("hare", 40, 0, 1, createRandom(1));

    const tick = tickOf();
    const [hare] = hares(fauna);
    const [wolf] = fauna.animals.filter((animal) => {
      return animal.kind === "wolf";
    });

    for (let step = 0; step < 3000 && chasedPreyIds(fauna).length === 0; step += 1) {
      fauna.update(tick);
    }

    expect(chasedPreyIds(fauna)).toEqual([hare.id]);

    fauna.hold(hare);

    for (let step = 0; step < 600; step += 1) {
      placeMover(hare.mover, wolf.mover.x + 0.5, wolf.mover.z);
      fauna.update(tick);
    }

    expect(hare.isAlive).toBe(true);
  });

  it("are left alone by tame wolves", () => {
    const { fauna } = createFauna();

    fauna.spawnHerd("wolf", -40, 0, 4, createRandom(1));
    fauna.spawnHerd("hare", 40, 0, 3, createRandom(1));
    runFor(fauna, 240, { rules: TAME });

    expect(
      hares(fauna).every((hare) => {
        return hare.isAlive;
      })
    ).toBe(true);
  });
});
