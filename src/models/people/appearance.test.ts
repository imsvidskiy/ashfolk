import { describe, expect, it } from "vitest";
import { type AppearanceInput, type PersonAppearance, personAppearance } from "./appearance.ts";

const TRIBE = { accent: 0xc8_55_3d, fur: 0x6b_4a_33, id: 3 };

function appearanceFor(overrides: Partial<AppearanceInput>): PersonAppearance {
  return personAppearance({ age: 30, isFemale: false, seed: 0.42, tribe: TRIBE, ...overrides });
}

function seeds(count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    return (index * 0.618_033_988_7) % 1;
  });
}

describe("person appearance", () => {
  it("gives the same person the same look every time", () => {
    expect(appearanceFor({})).toEqual(appearanceFor({}));
  });

  it("varies looks between people of one tribe", () => {
    const crowd = seeds(200).map((seed) => {
      return appearanceFor({ isFemale: seed > 0.5, seed });
    });

    expect(
      new Set(
        crowd.map((person) => {
          return person.hair;
        })
      ).size
    ).toBeGreaterThanOrEqual(6);
    expect(
      new Set(
        crowd.map((person) => {
          return person.outfit;
        })
      ).size
    ).toBe(4);
    expect(
      new Set(
        crowd.map((person) => {
          return person.colors.skin;
        })
      ).size
    ).toBeGreaterThan(60);
    expect(
      new Set(
        crowd.map((person) => {
          return person.colors.accent;
        })
      )
    ).toEqual(new Set([TRIBE.accent]));
  });

  it("makes children small with large heads", () => {
    const child = appearanceFor({ age: 5 });
    const adult = appearanceFor({ age: 30 });

    expect(child.ageGroup).toBe("child");
    expect(child.body.height).toBeLessThan(adult.body.height * 0.8);
    expect(child.body.headSize).toBeGreaterThan(adult.body.headSize);
  });

  it("grays and stoops most elders", () => {
    const elders = seeds(60).map((seed) => {
      return appearanceFor({ age: 70, seed });
    });
    const adults = seeds(60).map((seed) => {
      return appearanceFor({ age: 30, seed });
    });

    function averagePosture(people: readonly PersonAppearance[]): number {
      return (
        people.reduce((sum, person) => {
          return sum + person.motion.posture;
        }, 0) / people.length
      );
    }

    expect(averagePosture(elders)).toBeGreaterThan(averagePosture(adults) * 3);
    expect(
      elders.filter((person) => {
        return person.colors.hair > 0x80_80_80;
      }).length
    ).toBeGreaterThan(30);
  });

  it("gives beards only to grown men", () => {
    for (const seed of seeds(80)) {
      expect(appearanceFor({ isFemale: true, seed }).beard).toBe("none");
      expect(appearanceFor({ age: 6, seed }).beard).toBe("none");
    }
  });

  it("keeps clothes, gait and hair as a person grows up and grows old", () => {
    for (const seed of seeds(100)) {
      for (const isFemale of [false, true]) {
        const child = appearanceFor({ age: 11.5, isFemale, seed });
        const adult = appearanceFor({ age: 12.5, isFemale, seed });
        const aging = appearanceFor({ age: 49.5, isFemale, seed });
        const elder = appearanceFor({ age: 50.5, isFemale, seed });

        for (const [before, after] of [
          [child, adult],
          [aging, elder],
        ]) {
          expect(after.colors.fur).toBe(before.colors.fur);
          expect(after.colors.hide).toBe(before.colors.hide);
          expect(after.hasBoots).toBe(before.hasBoots);
          expect(after.motion.armSwing).toBe(before.motion.armSwing);
        }

        expect(elder.outfit).toBe(aging.outfit);
        expect([aging.hair, "fringe", "bald"]).toContain(elder.hair);
        expect([aging.beard, "full"]).toContain(elder.beard);
      }
    }
  });
});

describe("era details", () => {
  function crowd(era: number): PersonAppearance[] {
    return seeds(200).map((seed) => {
      return appearanceFor({ age: 20 + seed * 30, era, isFemale: seed > 0.5, seed });
    });
  }

  it("leaves the first eras looking as they always did", () => {
    for (const seed of seeds(60)) {
      const before = appearanceFor({ seed });

      expect(appearanceFor({ era: 0, seed })).toEqual(before);
      expect(appearanceFor({ era: 1, seed })).toEqual(before);
    }
  });

  it("dresses many people in linen from the Neolithic on", () => {
    const wanderers = crowd(0);
    const farmers = crowd(2);

    const changed = farmers.filter((person, index) => {
      return person.colors.hide !== wanderers[index].colors.hide;
    });

    expect(changed.length).toBeGreaterThan(60);
    expect(changed.length).toBeLessThan(140);
  });

  it("gives helmets only to Iron Age men", () => {
    const bronze = crowd(4);
    const iron = crowd(5);

    const helmeted = iron.filter((person) => {
      return person.hasHelmet;
    });

    expect(
      bronze.some((person) => {
        return person.hasHelmet;
      })
    ).toBe(false);
    expect(helmeted.length).toBeGreaterThan(15);
    expect(
      helmeted.every((person) => {
        return !person.isFemale && person.ageGroup !== "child";
      })
    ).toBe(true);
  });
});
