import { describe, expect, it } from "vitest";
import { enclosure, foundNeighboringTribes, foundTribe, SPRING_HARNESS } from "../../testing/test-rivalry.ts";
import { SocietyHarness } from "../../testing/test-society.ts";
import { burnableBuilding, chooseWarriors } from "./raids.ts";

describe("a raid", () => {
  it("sets fire only to what can burn", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const [victims] = foundNeighboringTribes(harness, 900);

    const wall = enclosure("stoneWall", victims, 40);
    const palisade = enclosure("palisade", victims, 40);

    expect(burnableBuilding([wall], victims)).toBeNull();
    expect(burnableBuilding([wall, palisade], victims)).toBe(palisade);
  });

  it("sends the fittest half of the fighters, three to six of them", () => {
    const harness = new SocietyHarness(SPRING_HARNESS);

    const large = foundTribe(harness, { adults: 14, children: 2, x: -300, z: 0 });
    const small = foundTribe(harness, { adults: 4, children: 2, x: 300, z: 0 });
    const tiny = foundTribe(harness, { adults: 2, children: 4, x: 0, z: 300 });
    const [wounded, hungry, bruised] = harness.society.membersOf(large);

    wounded.health = 0.5;
    hungry.hunger = 0.6;
    bruised.health = 0.9;

    const warriors = chooseWarriors(harness.society.membersOf(large));

    expect(warriors).toHaveLength(6);
    expect(warriors).not.toContain(wounded);
    expect(warriors).not.toContain(hungry);
    expect(warriors).not.toContain(bruised);
    expect(chooseWarriors(harness.society.membersOf(small))).toHaveLength(3);
    expect(chooseWarriors(harness.society.membersOf(tiny))).toEqual([]);
  });
});
