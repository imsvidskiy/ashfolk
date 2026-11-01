import { fractionalPart, lerp, smoothstep } from "../shared/math.ts";
import { SEASON_COUNT } from "./seasons.ts";

export const Ground = {
  Ash: 17,
  Basalt: 18,
  Bog: 16,
  Clay: 15,
  CopperOre: 12,
  Dirt: 9,
  Farm: 10,
  Forest: 2,
  IronOre: 14,
  Meadow: 0,
  RedRock: 11,
  Rock: 5,
  Sand: 4,
  Scrub: 3,
  Snow: 6,
  Steppe: 1,
  Swamp: 8,
  TinOre: 13,
  Tundra: 7,
} as const;

export type GroundIndex = (typeof Ground)[keyof typeof Ground];

const SEASON_BLEND_START = 0.55;

export type Color = readonly [number, number, number];

interface GroundDefinition {
  fertility: number;
  flammability: number;
  fuel: number;
  grass: number;
  holdsTrees: boolean;
  index: GroundIndex;
  name: string;
  regrowth: number;
  seasonalColors: readonly [Color, Color, Color, Color];
  walkSpeed: number;
}

export const GROUNDS: readonly GroundDefinition[] = [
  {
    fertility: 0.95,
    flammability: 0.95,
    fuel: 0.8,
    grass: 1,
    holdsTrees: true,
    index: Ground.Meadow,
    name: "Meadow",
    regrowth: 1,
    seasonalColors: [
      [0.4, 0.45, 0.27],
      [0.48, 0.48, 0.3],
      [0.57, 0.51, 0.34],
      [0.47, 0.44, 0.36],
    ],
    walkSpeed: 1,
  },
  {
    fertility: 0.5,
    flammability: 1.3,
    fuel: 1,
    grass: 0.85,
    holdsTrees: true,
    index: Ground.Steppe,
    name: "Dry grass",
    regrowth: 1,
    seasonalColors: [
      [0.56, 0.55, 0.36],
      [0.72, 0.63, 0.45],
      [0.7, 0.6, 0.43],
      [0.55, 0.51, 0.4],
    ],
    walkSpeed: 1,
  },
  {
    fertility: 0.8,
    flammability: 0.85,
    fuel: 0.7,
    grass: 0.35,
    holdsTrees: true,
    index: Ground.Forest,
    name: "Forest floor",
    regrowth: 1,
    seasonalColors: [
      [0.27, 0.33, 0.2],
      [0.27, 0.32, 0.19],
      [0.4, 0.33, 0.21],
      [0.35, 0.32, 0.27],
    ],
    walkSpeed: 0.85,
  },
  {
    fertility: 0.45,
    flammability: 1.1,
    fuel: 1.4,
    grass: 0.6,
    holdsTrees: true,
    index: Ground.Scrub,
    name: "Shrubs",
    regrowth: 1,
    seasonalColors: [
      [0.47, 0.48, 0.33],
      [0.53, 0.52, 0.37],
      [0.57, 0.5, 0.35],
      [0.49, 0.46, 0.37],
    ],
    walkSpeed: 0.8,
  },
  {
    fertility: 0.05,
    flammability: 0,
    fuel: 0,
    grass: 0.05,
    holdsTrees: false,
    index: Ground.Sand,
    name: "Sand",
    regrowth: 1,
    seasonalColors: [
      [0.76, 0.65, 0.48],
      [0.78, 0.66, 0.48],
      [0.76, 0.65, 0.48],
      [0.71, 0.63, 0.49],
    ],
    walkSpeed: 0.85,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: true,
    index: Ground.Rock,
    name: "Rock",
    regrowth: 1,
    seasonalColors: [
      [0.46, 0.43, 0.39],
      [0.47, 0.44, 0.39],
      [0.46, 0.43, 0.39],
      [0.44, 0.42, 0.4],
    ],
    walkSpeed: 0.7,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: true,
    index: Ground.Snow,
    name: "Eternal snow",
    regrowth: 1,
    seasonalColors: [
      [0.86, 0.88, 0.92],
      [0.84, 0.86, 0.9],
      [0.86, 0.88, 0.92],
      [0.9, 0.92, 0.95],
    ],
    walkSpeed: 0.6,
  },
  {
    fertility: 0.25,
    flammability: 0.6,
    fuel: 0.4,
    grass: 0.45,
    holdsTrees: true,
    index: Ground.Tundra,
    name: "Tundra",
    regrowth: 1,
    seasonalColors: [
      [0.46, 0.46, 0.34],
      [0.47, 0.48, 0.33],
      [0.54, 0.42, 0.3],
      [0.52, 0.5, 0.44],
    ],
    walkSpeed: 0.9,
  },
  {
    fertility: 0.4,
    flammability: 0.35,
    fuel: 0.5,
    grass: 0.7,
    holdsTrees: true,
    index: Ground.Swamp,
    name: "Swamp",
    regrowth: 1,
    seasonalColors: [
      [0.27, 0.28, 0.16],
      [0.27, 0.28, 0.15],
      [0.34, 0.3, 0.17],
      [0.3, 0.28, 0.23],
    ],
    walkSpeed: 0.75,
  },
  {
    fertility: 0.4,
    flammability: 0,
    fuel: 0,
    grass: 0.08,
    holdsTrees: true,
    index: Ground.Dirt,
    name: "Trodden earth",
    regrowth: 1,
    seasonalColors: [
      [0.45, 0.38, 0.29],
      [0.47, 0.39, 0.3],
      [0.45, 0.37, 0.28],
      [0.42, 0.37, 0.3],
    ],
    walkSpeed: 1.15,
  },
  {
    fertility: 1,
    flammability: 0.9,
    fuel: 0.6,
    grass: 0,
    holdsTrees: true,
    index: Ground.Farm,
    name: "Field",
    regrowth: 1,
    seasonalColors: [
      [0.38, 0.31, 0.22],
      [0.41, 0.33, 0.23],
      [0.43, 0.35, 0.24],
      [0.39, 0.33, 0.26],
    ],
    walkSpeed: 0.95,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: true,
    index: Ground.RedRock,
    name: "Red stone",
    regrowth: 1,
    seasonalColors: [
      [0.61, 0.38, 0.27],
      [0.63, 0.4, 0.28],
      [0.61, 0.38, 0.27],
      [0.56, 0.37, 0.28],
    ],
    walkSpeed: 0.75,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: false,
    index: Ground.CopperOre,
    name: "Copper vein",
    regrowth: 1,
    seasonalColors: [
      [0.38, 0.45, 0.38],
      [0.38, 0.46, 0.39],
      [0.38, 0.45, 0.38],
      [0.38, 0.43, 0.37],
    ],
    walkSpeed: 0.75,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: false,
    index: Ground.TinOre,
    name: "Tin vein",
    regrowth: 1,
    seasonalColors: [
      [0.36, 0.33, 0.31],
      [0.37, 0.33, 0.32],
      [0.36, 0.33, 0.31],
      [0.37, 0.33, 0.32],
    ],
    walkSpeed: 0.75,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: false,
    index: Ground.IronOre,
    name: "Iron vein",
    regrowth: 1,
    seasonalColors: [
      [0.51, 0.31, 0.21],
      [0.52, 0.32, 0.22],
      [0.51, 0.31, 0.21],
      [0.49, 0.31, 0.22],
    ],
    walkSpeed: 0.75,
  },
  {
    fertility: 0.3,
    flammability: 0,
    fuel: 0,
    grass: 0.1,
    holdsTrees: false,
    index: Ground.Clay,
    name: "Clay bank",
    regrowth: 1,
    seasonalColors: [
      [0.6, 0.53, 0.43],
      [0.63, 0.55, 0.44],
      [0.6, 0.53, 0.43],
      [0.56, 0.52, 0.45],
    ],
    walkSpeed: 0.85,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: false,
    index: Ground.Bog,
    name: "Bog pool",
    regrowth: 1,
    seasonalColors: [
      [0.17, 0.17, 0.11],
      [0.17, 0.17, 0.1],
      [0.19, 0.17, 0.1],
      [0.18, 0.18, 0.15],
    ],
    walkSpeed: 0.55,
  },
  {
    fertility: 1,
    flammability: 0.7,
    fuel: 0.6,
    grass: 0.9,
    holdsTrees: true,
    index: Ground.Ash,
    name: "Ash soil",
    regrowth: 3,
    seasonalColors: [
      [0.3, 0.33, 0.21],
      [0.34, 0.36, 0.22],
      [0.4, 0.34, 0.23],
      [0.33, 0.31, 0.27],
    ],
    walkSpeed: 0.95,
  },
  {
    fertility: 0,
    flammability: 0,
    fuel: 0,
    grass: 0,
    holdsTrees: false,
    index: Ground.Basalt,
    name: "Lava rock",
    regrowth: 1,
    seasonalColors: [
      [0.14, 0.13, 0.13],
      [0.15, 0.14, 0.13],
      [0.14, 0.13, 0.13],
      [0.15, 0.14, 0.14],
    ],
    walkSpeed: 0.7,
  },
];

export function isPoolGround(index: number): boolean {
  return index === Ground.Bog;
}

export function groundDefinition(index: number): GroundDefinition {
  const definition = GROUNDS[index];

  if (definition === undefined) {
    throw new RangeError(`Unknown ground ${index}`);
  }

  return definition;
}

export function seasonalGroundColor(index: number, season: number): Color {
  const { seasonalColors } = groundDefinition(index);

  const seasonIndex = Math.floor(season) % SEASON_COUNT;
  const current = seasonalColors[seasonIndex];
  const following = seasonalColors[(seasonIndex + 1) % SEASON_COUNT];
  const blend = smoothstep(SEASON_BLEND_START, 1, fractionalPart(season));

  return [
    lerp(current[0], following[0], blend),
    lerp(current[1], following[1], blend),
    lerp(current[2], following[2], blend),
  ];
}
