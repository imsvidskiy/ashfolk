import { type AgeGroup, ageGroupOf, ELDER_AGE } from "../../content/life-stages.ts";
import { colorFromPalette, mixColors, scaleColor } from "../../shared/color.ts";
import { clamp, hashToUnit, lerp, smoothstep } from "../../shared/math.ts";
import { type RandomSource, randomFromUnitSeed } from "../../shared/random.ts";

const CHILD_GROWTH_YEARS = 12;

const SKIN_TONES: readonly number[] = [
  0xf1_cf_b5, 0xe3_b5_94, 0xd3_9f_7c, 0xc0_88_65, 0xa8_71_4f, 0x8d_5a_3d, 0x6e_43_2c, 0x57_33_22,
];
const HAIR_COLORS: readonly number[] = [0x1c_17_14, 0x2e_21_19, 0x4a_33_22, 0x6a_3f_24, 0x7f_3b_20, 0x9a_7a_4a];
const ELDER_HAIR: readonly number[] = [0x8f_8a_84, 0xb3_ae_a6, 0xd8_d4_cc];
const HIDE_TONES: readonly number[] = [0x7a_55_36, 0x8e_64_40, 0xa5_77_4f, 0xb4_8a_5a];
const LINEN_TONES: readonly number[] = [0xdc_d3_bc, 0xcf_c5_a8, 0xe6_df_ce, 0xc2_b8_9e];
const DYES: readonly number[] = [0xa8_46_3a, 0x4a_6a_9a, 0xc8_a8_4a, 0x5e_7a_48];
const ERA_SALT = 7919;
const NEOLITHIC = 2;
const BRONZE_AGE = 4;
const IRON_AGE = 5;
const RETIRED_ACCESSORY_DRAWS = 5;
const RETIRED_ERA_DRAWS = 2;

export type HairStyle = "bald" | "braids" | "bun" | "fringe" | "long" | "ponytail" | "short" | "wild";

type BeardStyle = "full" | "none" | "short";

type Outfit = "dress" | "loincloth" | "tunic" | "wrap";

export interface BodyShape {
  readonly build: number;
  readonly headSize: number;
  readonly height: number;
  readonly hipWidth: number;
  readonly legLength: number;
  readonly shoulderWidth: number;
}

interface AppearanceColors {
  readonly accent: number;
  readonly fur: number;
  readonly hair: number;
  readonly hide: number;
  readonly skin: number;
}

export interface MotionStyle {
  readonly armSwing: number;
  readonly posture: number;
  readonly stride: number;
}

export interface PersonAppearance {
  readonly ageGroup: AgeGroup;
  readonly beard: BeardStyle;
  readonly body: BodyShape;
  readonly colors: AppearanceColors;
  readonly hair: HairStyle;
  readonly hasBoots: boolean;
  readonly hasCape: boolean;
  readonly hasCloak: boolean;
  readonly hasHelmet: boolean;
  readonly isFemale: boolean;
  readonly motion: MotionStyle;
  readonly outfit: Outfit;
}

export interface TribeLook {
  readonly accent: number;
  readonly fur: number;
  readonly id: number;
}

export interface AppearanceInput {
  readonly age: number;
  readonly era?: number;
  readonly isFemale: boolean;
  readonly seed: number;
  readonly tribe: TribeLook;
}

interface WeightedChoice<Value> {
  readonly value: Value;
  readonly weight: number;
}

interface EraRolls {
  readonly boots: number;
  readonly cape: number;
  readonly dye: number;
  readonly dyeChoice: number;
  readonly helmet: number;
  readonly linen: number;
  readonly linenTone: number;
}

function choose<Value>(random: RandomSource, choices: readonly WeightedChoice<Value>[]): Value {
  const total = choices.reduce((sum, choice) => {
    return sum + choice.weight;
  }, 0);

  let remaining = random.next() * total;

  for (const choice of choices) {
    remaining -= choice.weight;

    if (remaining <= 0) {
      return choice.value;
    }
  }

  return random.pick(choices).value;
}

function adultBody(random: RandomSource, isFemale: boolean): BodyShape {
  if (isFemale) {
    return {
      build: random.between(0.86, 1.12),
      headSize: random.between(0.95, 1.01),
      height: random.between(0.91, 0.99),
      hipWidth: random.between(1.03, 1.1),
      legLength: random.between(0.97, 1.04),
      shoulderWidth: random.between(0.9, 0.97),
    };
  }

  return {
    build: random.between(0.9, 1.22),
    headSize: random.between(0.97, 1.03),
    height: random.between(0.97, 1.06),
    hipWidth: random.between(0.95, 1.01),
    legLength: random.between(0.96, 1.04),
    shoulderWidth: random.between(1.01, 1.12),
  };
}

function childBody(random: RandomSource, age: number): BodyShape {
  const growth = clamp(age / CHILD_GROWTH_YEARS, 0, 1);

  return {
    build: random.between(0.86, 1.02),
    headSize: lerp(1.42, 1.1, growth),
    height: lerp(0.5, 0.86, growth) * random.between(0.96, 1.04),
    hipWidth: random.between(0.9, 0.97),
    legLength: lerp(0.86, 0.97, growth),
    shoulderWidth: random.between(0.86, 0.94),
  };
}

function bodyShape(random: RandomSource, ageGroup: AgeGroup, age: number, isFemale: boolean): BodyShape {
  if (ageGroup === "child") {
    return childBody(random, age);
  }

  const adult = adultBody(random, isFemale);

  if (ageGroup === "adult") {
    return adult;
  }

  return { ...adult, build: adult.build * random.between(0.86, 1.08), height: adult.height * 0.97 };
}

function skinTonePosition(random: RandomSource, tribeId: number): number {
  const tribeCenter = 0.15 + hashToUnit(tribeId, 3.7) * 0.7;

  return clamp(tribeCenter + random.signed() * 0.16, 0, 1);
}

function naturalHairColor(random: RandomSource, skinDarkness: number): number {
  const lightHairChance = clamp(0.35 - skinDarkness, 0.05, 0.35);

  if (random.chance(lightHairChance)) {
    return colorFromPalette(HAIR_COLORS, random.between(0.6, 1));
  }

  return colorFromPalette(HAIR_COLORS, random.between(0, 0.55));
}

function hairColor(random: RandomSource, ageGroup: AgeGroup, skinDarkness: number): number {
  const isGray = random.chance(0.8);

  if (ageGroup === "elder" && isGray) {
    return random.pick(ELDER_HAIR);
  }

  return naturalHairColor(random, skinDarkness);
}

function hairStyle(random: RandomSource, ageGroup: AgeGroup, isFemale: boolean): HairStyle {
  if (isFemale) {
    return choose<HairStyle>(random, [
      { value: "long", weight: 0.32 },
      { value: "braids", weight: 0.26 },
      { value: "bun", weight: 0.16 },
      { value: "ponytail", weight: 0.14 },
      { value: "wild", weight: 0.12 },
    ]);
  }

  if (ageGroup === "child") {
    return choose<HairStyle>(random, [
      { value: "short", weight: 0.45 },
      { value: "wild", weight: 0.35 },
      { value: "ponytail", weight: 0.2 },
    ]);
  }

  const style = choose<HairStyle>(random, [
    { value: "short", weight: 0.32 },
    { value: "long", weight: 0.14 },
    { value: "ponytail", weight: 0.14 },
    { value: "wild", weight: 0.18 },
    { value: "bun", weight: 0.06 },
    { value: "fringe", weight: 0.06 },
    { value: "bald", weight: 0.02 },
  ]);
  const isBalding = random.chance(0.3);

  if (ageGroup === "elder" && isBalding) {
    return random.chance(0.25) ? "bald" : "fringe";
  }

  return style;
}

function beardStyle(random: RandomSource, ageGroup: AgeGroup, isFemale: boolean): BeardStyle {
  if (isFemale || ageGroup === "child") {
    return "none";
  }

  const beard = choose<BeardStyle>(random, [
    { value: "none", weight: 0.36 },
    { value: "short", weight: 0.4 },
    { value: "full", weight: 0.24 },
  ]);
  const isBeardFull = random.chance(0.4);

  if (ageGroup === "elder" && beard === "short" && isBeardFull) {
    return "full";
  }

  return beard;
}

function outfit(random: RandomSource, ageGroup: AgeGroup, isFemale: boolean): Outfit {
  if (ageGroup === "child") {
    return choose<Outfit>(random, [
      { value: "tunic", weight: 0.6 },
      { value: "loincloth", weight: 0.4 },
    ]);
  }

  if (isFemale) {
    return choose<Outfit>(random, [
      { value: "dress", weight: 0.45 },
      { value: "tunic", weight: 0.35 },
      { value: "wrap", weight: 0.2 },
    ]);
  }

  return choose<Outfit>(random, [
    { value: "tunic", weight: 0.45 },
    { value: "loincloth", weight: 0.3 },
    { value: "wrap", weight: 0.25 },
  ]);
}

function stoop(random: RandomSource, ageGroup: AgeGroup): number {
  if (ageGroup === "elder") {
    return random.between(0.12, 0.26);
  }

  return random.between(0, 0.05);
}

function motionStyle(random: RandomSource, ageGroup: AgeGroup): MotionStyle {
  return {
    armSwing: random.between(0.78, 1.18),
    posture: stoop(random, ageGroup),
    stride: random.between(0.92, 1.08),
  };
}

function clothingColors(random: RandomSource, tribe: TribeLook): Pick<AppearanceColors, "fur" | "hide"> {
  const fur = scaleColor(
    mixColors(tribe.fur, random.pick(HIDE_TONES), random.between(0, 0.3)),
    random.between(0.85, 1.15)
  );
  const hide = scaleColor(colorFromPalette(HIDE_TONES, random.next()), random.between(0.9, 1.08));

  return { fur, hide };
}

function eraRolls(seed: number): EraRolls {
  const random = randomFromUnitSeed(seed, ERA_SALT);
  const boots = random.next();

  for (let draw = 0; draw < RETIRED_ERA_DRAWS; draw += 1) {
    random.next();
  }

  return {
    boots,
    cape: random.next(),
    dye: random.next(),
    dyeChoice: random.next(),
    helmet: random.next(),
    linen: random.next(),
    linenTone: random.next(),
  };
}

function clothColor(rolls: EraRolls, era: number): number {
  const linen = colorFromPalette(LINEN_TONES, rolls.linenTone);

  if (era < BRONZE_AGE || rolls.dye > 0.35) {
    return linen;
  }

  return mixColors(linen, colorFromPalette(DYES, rolls.dyeChoice), 0.55);
}

function eraColors(appearance: PersonAppearance, rolls: EraRolls, era: number): AppearanceColors {
  const { colors } = appearance;

  if (rolls.linen > 0.5) {
    return colors;
  }

  const cloth = clothColor(rolls, era);

  return { ...colors, fur: appearance.outfit === "tunic" ? cloth : colors.fur, hide: cloth };
}

function withEraDetails(appearance: PersonAppearance, era: number, seed: number): PersonAppearance {
  if (era < NEOLITHIC) {
    return appearance;
  }

  const rolls = eraRolls(seed);
  const isAdult = appearance.ageGroup !== "child";
  const hasEraCape = era >= BRONZE_AGE && isAdult && rolls.cape < 0.3;

  return {
    ...appearance,
    colors: eraColors(appearance, rolls, era),
    hasBoots: appearance.hasBoots || (era >= IRON_AGE && rolls.boots < 0.6),
    hasCape: appearance.hasCape || hasEraCape,
    hasHelmet: era >= IRON_AGE && isAdult && !appearance.isFemale && rolls.helmet < 0.4,
  };
}

export function personAppearance(input: AppearanceInput): PersonAppearance {
  const random = randomFromUnitSeed(input.seed, 1);
  const ageGroup = ageGroupOf(input.age);
  const elderGray = smoothstep(ELDER_AGE, ELDER_AGE + 15, input.age);
  const skinDarkness = skinTonePosition(random, input.tribe.id);
  const isCapeRolled = random.chance(0.3);
  const isCloakRolled = random.chance(0.45);
  const skin = colorFromPalette(SKIN_TONES, skinDarkness);
  const hair = mixColors(hairColor(random.derive(1), ageGroup, skinDarkness), ELDER_HAIR[1], elderGray * 0.3);

  for (let draw = 0; draw < RETIRED_ACCESSORY_DRAWS; draw += 1) {
    random.next();
  }

  const appearance: PersonAppearance = {
    ageGroup,
    beard: beardStyle(random.derive(2), ageGroup, input.isFemale),
    body: bodyShape(random.derive(3), ageGroup, input.age, input.isFemale),
    colors: { accent: input.tribe.accent, hair, skin, ...clothingColors(random, input.tribe) },
    hair: hairStyle(random.derive(4), ageGroup, input.isFemale),
    hasBoots: random.chance(0.5),
    hasCape: ageGroup !== "child" && isCapeRolled,
    hasCloak: ageGroup === "elder" && isCloakRolled,
    hasHelmet: false,
    isFemale: input.isFemale,
    motion: motionStyle(random, ageGroup),
    outfit: outfit(random, ageGroup, input.isFemale),
  };

  return withEraDetails(appearance, input.era === undefined ? 0 : input.era, input.seed);
}
