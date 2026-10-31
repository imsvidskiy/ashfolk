import type { AnimalKind } from "../../content/animals.ts";
import { colorFromPalette, mixColors, scaleColor } from "../../shared/color.ts";
import { lerp } from "../../shared/math.ts";
import { type RandomSource, randomFromUnitSeed } from "../../shared/random.ts";

const DEER_COATS: readonly number[] = [0x6e_4a_2e, 0x7a_4e_30, 0x8a_5a_36, 0x9a_6a_40, 0xa8_7a_4c];
const DEER_BELLY = 0xe0_cc_aa;
const MAMMOTH_COATS: readonly number[] = [0x3e_2a_1e, 0x4a_34_24, 0x5c_3e_28, 0x6a_4a_30, 0x7a_58_3a];
const IBEX_COATS: readonly number[] = [0x6e_5c_48, 0x7e_68_50, 0x8e_76_5a, 0x9c_86_66];
const IBEX_BELLY = 0xdc_d0_b8;
const HARE_COATS: readonly number[] = [0x6e_5a_44, 0x7e_66_4c, 0x8c_74_58, 0x96_80_64, 0x84_78_68];
const HARE_WHITE = 0xf2_ee_e6;
const HARE_STATURE = 1.3;
const WOLF_COATS: readonly number[] = [0x5a_56_52, 0x7a_74_6c, 0x8c_84_78, 0x96_86_6c, 0xb8_b2_a8];
const WOLF_BLACK = 0x2e_2a_28;
const WOLF_BELLY = 0xd8_d0_c2;
const FULL_GROWN = 0.3;
const SPOTTED_FAWN = 0.35;

const APPEARANCES: Readonly<Record<AnimalKind, (random: RandomSource, youth: number) => AnimalAppearance>> = {
  deer: deerAppearance,
  hare: hareAppearance,
  ibex: ibexAppearance,
  mammoth: mammothAppearance,
  wolf: wolfAppearance,
};

export interface AnimalAppearance {
  readonly antlerSize: number;
  readonly coat: number;
  readonly coatLight: number;
  readonly hasAntlers: boolean;
  readonly hasRuff: boolean;
  readonly hasSpots: boolean;
  readonly headScale: number;
  readonly hornLength: number;
  readonly legScale: number;
  readonly size: number;
  readonly tuskLength: number;
}

const PLAIN_FEATURES: Pick<
  AnimalAppearance,
  "antlerSize" | "hasAntlers" | "hasRuff" | "hasSpots" | "hornLength" | "tuskLength"
> = {
  antlerSize: 0,
  hasAntlers: false,
  hasRuff: false,
  hasSpots: false,
  hornLength: 0,
  tuskLength: 0,
};

interface AnimalAppearanceInput {
  readonly kind: AnimalKind;
  readonly seed: number;
  readonly youth: number;
}

function coatColor(random: RandomSource, palette: readonly number[], darkest: number, brightest: number): number {
  return scaleColor(colorFromPalette(palette, random.next()), random.between(darkest, brightest));
}

function youthScale(youth: number): number {
  return lerp(1, 0.42, youth);
}

function antlerChoice(random: RandomSource, youth: number): Pick<AnimalAppearance, "antlerSize" | "hasAntlers"> {
  const isStag = random.chance(0.45);
  const antlerSize = random.between(0.7, 1.2);

  return { antlerSize, hasAntlers: isStag && youth < FULL_GROWN };
}

function deerAppearance(random: RandomSource, youth: number): AnimalAppearance {
  const coat = coatColor(random, DEER_COATS, 0.92, 1.08);
  const size = random.between(0.9, 1.12) * youthScale(youth);

  return {
    ...PLAIN_FEATURES,
    ...antlerChoice(random, youth),
    coat,
    coatLight: mixColors(DEER_BELLY, coat, random.between(0.05, 0.25)),
    hasSpots: youth > SPOTTED_FAWN,
    headScale: lerp(1, 1.32, youth),
    legScale: lerp(1, 1.14, youth),
    size,
  };
}

function mammothAppearance(random: RandomSource, youth: number): AnimalAppearance {
  const coat = coatColor(random, MAMMOTH_COATS, 0.9, 1.1);
  const size = random.between(0.9, 1.1) * youthScale(youth);

  return {
    ...PLAIN_FEATURES,
    coat,
    coatLight: scaleColor(coat, 1.35),
    headScale: lerp(1, 1.25, youth),
    legScale: lerp(1, 1.08, youth),
    size,
    tuskLength: random.between(0.65, 1.15) * (1 - youth * 0.8),
  };
}

function ibexAppearance(random: RandomSource, youth: number): AnimalAppearance {
  const coat = coatColor(random, IBEX_COATS, 0.92, 1.08);
  const isBuck = random.chance(0.45);
  const size = random.between(0.9, 1.1) * youthScale(youth);

  return {
    ...PLAIN_FEATURES,
    coat,
    coatLight: mixColors(IBEX_BELLY, coat, random.between(0.05, 0.2)),
    headScale: lerp(1, 1.3, youth),
    hornLength: (isBuck ? random.between(0.85, 1.2) : random.between(0.3, 0.55)) * (1 - youth),
    legScale: lerp(1, 1.12, youth),
    size,
  };
}

function hareAppearance(random: RandomSource, youth: number): AnimalAppearance {
  const coat = coatColor(random, HARE_COATS, 0.92, 1.08);
  const size = HARE_STATURE * random.between(0.92, 1.08) * youthScale(youth);

  return {
    ...PLAIN_FEATURES,
    coat,
    coatLight: mixColors(HARE_WHITE, coat, random.between(0.02, 0.14)),
    headScale: lerp(1, 1.3, youth),
    legScale: lerp(1, 1.1, youth),
    size,
  };
}

function wolfCoat(random: RandomSource): number {
  if (random.chance(0.08)) {
    return WOLF_BLACK;
  }

  return coatColor(random, WOLF_COATS, 0.9, 1.1);
}

function wolfAppearance(random: RandomSource, youth: number): AnimalAppearance {
  const coat = wolfCoat(random);
  const size = random.between(0.9, 1.12) * youthScale(youth);

  return {
    ...PLAIN_FEATURES,
    coat,
    coatLight: mixColors(WOLF_BELLY, coat, random.between(0.1, 0.35)),
    hasRuff: youth < FULL_GROWN && random.chance(0.7),
    headScale: lerp(1, 1.35, youth),
    legScale: lerp(1, 1.1, youth),
    size,
  };
}

export function animalAppearance(input: AnimalAppearanceInput): AnimalAppearance {
  const random = randomFromUnitSeed(input.seed, 7);

  return APPEARANCES[input.kind](random, input.youth);
}
