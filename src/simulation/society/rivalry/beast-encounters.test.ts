import { describe, expect, it } from "vitest";
import { worldRulesSchema } from "../../../content/world-rules.ts";
import { createRandom } from "../../../shared/random.ts";
import type { Animal } from "../../fauna/fauna.ts";
import { chronicleTexts, foundTribe, runUntil } from "../../testing/test-rivalry.ts";
import { SocietyHarness, tickFor } from "../../testing/test-society.ts";
import type { Person } from "../person.ts";
import type { Tribe } from "../tribe.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { FightJob } from "./defense-jobs.ts";
import { animalFoe } from "./foes.ts";

const NIGHT = 0.9;
const NOON = 0.5;
const BOLD = worldRulesSchema.parse({ nature: { beastBoldness: 3 } });
const SPEAR: CarriedWeapon = { kind: "spear", material: "stone" };
const WOLF_ATTACK_STORY = /^beast: Wolves attacked .+ of the .+ Clan/u;
const TRAMPLE_STORY = /^beast: A mammoth trampled .+ of the .+ Clan/u;
const GORE_STORY = /^beast: A stag gored .+ to death/u;

function beastHarness(day: number): SocietyHarness {
  return new SocietyHarness({
    day,
    isFaunaAwake: true,
    rules: BOLD,
    world: { dimensions: { cellSize: 10, cellsPerSide: 96 } },
  });
}

function spawnPack(harness: SocietyHarness, x: number, z: number, size: number): Animal[] {
  const pack = harness.fauna.spawnHerd("wolf", x, z, size, createRandom(9));

  if (pack === null) {
    throw new Error("Expected the pack to spawn");
  }

  return harness.fauna.animals.filter((animal) => {
    return animal.herdId === pack.id;
  });
}

function packRestDays(harness: SocietyHarness, pack: readonly Animal[]): number | undefined {
  const [leader] = pack;

  return harness.fauna.snapshot().instincts.moods.get(leader.herdId)?.restDays;
}

function tribeOf(harness: SocietyHarness, person: Person): Tribe {
  const tribe = harness.society.findTribe(person.tribeId);

  if (tribe === null) {
    throw new Error("Expected the person to belong to a tribe");
  }

  return tribe;
}

function loneWanderer(harness: SocietyHarness, x: number): Person {
  const tribe = foundTribe(harness, { adults: 4, children: 0, x: 0, z: 0 });
  const [wanderer] = harness.society.membersOf(tribe);

  wanderer.mover.x = x;
  wanderer.mover.z = 0;

  return wanderer;
}

describe("wolves", () => {
  it("hunt a lone person far from camp at night, who fights back", () => {
    const harness = beastHarness(NIGHT);

    const wanderer = loneWanderer(harness, 260);
    const wolves = spawnPack(harness, 330, 40, 4);
    const fought = new Set<string>();

    runUntil(harness, 120, () => {
      fought.add(String(wanderer.job?.kind));

      return wanderer.health < 0.7 || !wanderer.isAlive;
    });

    expect(wanderer.health).toBeLessThan(0.7);
    expect(
      wolves.some((wolf) => {
        return wolf.pose === "attack" || wolf.pose === "charge";
      })
    ).toBe(true);
    expect(fought).toContain("fight");
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(WOLF_ATTACK_STORY));
  });

  it("give up when their prey reaches the camp", () => {
    const harness = beastHarness(NIGHT);

    const wanderer = loneWanderer(harness, 260);
    const wolves = spawnPack(harness, 330, 40, 4);

    runUntil(harness, 120, () => {
      return wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      });
    });

    expect(
      wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      })
    ).toBe(true);

    wanderer.mover.x = 2;
    wanderer.mover.z = 2;
    harness.run(1);

    expect(
      wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      })
    ).toBe(false);
    expect(
      wolves.every((wolf) => {
        return wolf.fear > 0.5;
      })
    ).toBe(true);
    expect(harness.fauna.snapshot().instincts.strikes.size).toBe(0);
    expect(packRestDays(harness, wolves)).toBeGreaterThan(0);
  });

  it("forget their strikes when their prey dies before they reach it", () => {
    const harness = beastHarness(NIGHT);

    const wanderer = loneWanderer(harness, 260);
    const wolves = spawnPack(harness, 330, 40, 4);

    runUntil(harness, 120, () => {
      return wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      });
    });

    expect(harness.fauna.snapshot().instincts.strikes.size).toBeGreaterThan(0);

    harness.society.kill(wanderer, "age");
    harness.run(1);

    expect(
      wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      })
    ).toBe(false);
    expect(harness.fauna.snapshot().instincts.strikes.size).toBe(0);
  });

  it("break off when one of the pack is badly hurt", () => {
    const harness = beastHarness(NIGHT);

    loneWanderer(harness, 260);

    const wolves = spawnPack(harness, 330, 40, 4);

    runUntil(harness, 120, () => {
      return wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      });
    });

    const [bitten] = wolves;

    harness.fauna.wound(bitten, 0.6, { id: 0, x: 260, z: 0 }, BOLD);
    harness.run(1);

    expect(
      wolves.some((wolf) => {
        return harness.fauna.isMenacing(wolf);
      })
    ).toBe(false);
    expect(bitten.fear).toBeGreaterThan(0.5);
    expect(harness.fauna.snapshot().instincts.strikes.size).toBe(0);
    expect(packRestDays(harness, wolves)).toBeGreaterThan(0);
  });

  it("leave people alone at noon when they are not hungry", () => {
    const harness = new SocietyHarness({
      day: NOON,
      isFaunaAwake: true,
      world: { dimensions: { cellSize: 10, cellsPerSide: 96 } },
    });

    const wanderer = loneWanderer(harness, 260);

    spawnPack(harness, 330, 40, 2);
    harness.run(20);

    expect(wanderer.health).toBe(1);
  });
});

describe("big game", () => {
  it("lets a wounded mammoth charge and trample its hunter", () => {
    const harness = beastHarness(NOON);

    const hunter = loneWanderer(harness, 200);
    const herd = harness.fauna.spawnHerd("mammoth", 230, 0, 1, createRandom(3));
    const [mammoth] = harness.fauna.animals.filter((animal) => {
      return animal.herdId === herd?.id;
    });

    hunter.health = 0.3;
    hunter.job = new FightJob(tickFor(harness, hunter, tribeOf(harness, hunter)), animalFoe(mammoth), SPEAR);
    harness.fauna.provoke(mammoth, { id: hunter.id, x: hunter.mover.x, z: hunter.mover.z }, BOLD);

    expect(harness.fauna.isMenacing(mammoth)).toBe(true);

    runUntil(harness, 20, () => {
      return !hunter.isAlive;
    });

    expect(hunter.isAlive).toBe(false);
    expect(hunter.causeOfDeath).toBe("mammoth");
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(TRAMPLE_STORY));
  });

  it("lets a cornered stag lower its head at a person who comes too close", () => {
    const harness = beastHarness(NOON);

    const herder = loneWanderer(harness, 200);
    const herd = harness.fauna.spawnHerd("deer", 202, 0, 1, createRandom(3));
    const [stag] = harness.fauna.animals.filter((animal) => {
      return animal.herdId === herd?.id;
    });

    herder.health = 0.12;
    stag.mover.x = herder.mover.x + 2;
    stag.mover.z = herder.mover.z;
    stag.fear = 1;
    stag.mover.stuckSeconds = 1;
    harness.step();

    expect(stag.pose).toBe("charge");
    expect(harness.fauna.isMenacing(stag)).toBe(true);

    runUntil(harness, 10, () => {
      return !herder.isAlive;
    });

    expect(herder.causeOfDeath).toBe("beast");
    expect(chronicleTexts(harness)).toContainEqual(expect.stringMatching(GORE_STORY));
  });
});

describe("beast determinism", () => {
  function replay(): string[] {
    const harness = beastHarness(NIGHT);

    const wanderer = loneWanderer(harness, 260);

    spawnPack(harness, 330, 40, 4);
    harness.run(60);

    return [
      `${wanderer.health.toFixed(5)} ${wanderer.mover.x.toFixed(4)}`,
      ...harness.fauna.animals.map((wolf) => {
        return `${wolf.id} ${wolf.mover.x.toFixed(4)} ${wolf.health.toFixed(4)}`;
      }),
      ...harness.chronicle.takeEntries().map((entry) => {
        return entry.text;
      }),
    ];
  }

  it("replays the same hunt the same way", () => {
    expect(replay()).toEqual(replay());
  });
});
