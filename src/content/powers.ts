import { z } from "zod";
import { choiceParameter, rangeParameter, toggleParameter } from "./parameters.ts";

export type PowerCategory = "elements" | "land" | "life";

type PowerUsage = "brush" | "point";

export type ParameterValue = boolean | number | string;

export type ParameterValueMap = Readonly<Record<string, ParameterValue>>;

interface PowerCategoryDefinition {
  id: PowerCategory;
  name: string;
}

export const POWER_CATEGORIES: readonly PowerCategoryDefinition[] = [
  { id: "elements", name: "Elements" },
  { id: "land", name: "Land" },
  { id: "life", name: "Life" },
];

interface PowerDefinition {
  category: PowerCategory;
  description: string;
  name: string;
  parameters: z.ZodObject;
  usage: PowerUsage;
}

export const POWERS = {
  abundance: {
    category: "life",
    description: "Bushes fill with berries and the nearest tribe gains food and faith.",
    name: "Abundance",
    parameters: z.object({
      radius: brushRadius(120, 400),
      strength: strength(60, "How much food appears."),
    }),
    usage: "point",
  },
  deer: {
    category: "life",
    description: "A herd of deer, quick prey for hunters.",
    name: "Deer",
    parameters: z.object({
      herdSize: rangeParameter({
        defaultValue: 5,
        description: "Animals in the herd.",
        label: "Herd size",
        maximum: 12,
        minimum: 2,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
  earthquake: {
    category: "elements",
    description: "Shakes the land: trees fall, huts break, people and animals panic.",
    name: "Earthquake",
    parameters: z.object({
      magnitude: strength(70, "How hard the ground shakes."),
      radius: brushRadius(280, 900),
    }),
    usage: "point",
  },
  explosion: {
    category: "elements",
    description: "A blast that leaves a crater, a shockwave and burning debris.",
    name: "Explosion",
    parameters: z.object({
      burningDebris: toggleParameter({
        defaultValue: true,
        description: "Debris sets the surroundings on fire.",
        label: "Burning debris",
      }),
      power: strength(80, "Depth of the crater and reach of the shockwave."),
      radius: brushRadius(45, 160),
    }),
    usage: "point",
  },
  fire: {
    category: "elements",
    description: "Sets fire to anything that can burn. Dry grass catches at once, wet or snowy ground does not.",
    name: "Fire",
    parameters: z.object({
      intensity: strength(60, "How hot the new fire burns."),
      radius: brushRadius(25, 150),
    }),
    usage: "brush",
  },
  flatten: {
    category: "land",
    description: "Levels the land to the height where the stroke began.",
    name: "Flatten",
    parameters: z.object({
      radius: brushRadius(60, 300),
      strength: strength(60, "How quickly the ground levels out."),
    }),
    usage: "brush",
  },
  forest: {
    category: "land",
    description: "Plants trees. Automatic picks species that suit the local climate.",
    name: "Forest",
    parameters: z.object({
      density: strength(50, "How many trees grow per stroke."),
      radius: brushRadius(60, 300),
      species: choiceParameter({
        defaultValue: "climate",
        description: "Which trees to plant.",
        label: "Species",
        options: [
          { label: "Suits the climate", value: "climate" },
          { label: "Spruce", value: "spruce" },
          { label: "Pine", value: "pine" },
          { label: "Oak", value: "oak" },
          { label: "Birch", value: "birch" },
          { label: "Maple", value: "maple" },
          { label: "Willow", value: "willow" },
          { label: "Alder", value: "alder" },
          { label: "Poplar", value: "poplar" },
          { label: "Acacia", value: "acacia" },
          { label: "Palm", value: "palm" },
          { label: "Berry bushes", value: "bush" },
        ],
      }),
    }),
    usage: "brush",
  },
  hare: {
    category: "life",
    description: "A few hares. They nibble meadows and forest edges, breed fast and dart away at any threat.",
    name: "Hares",
    parameters: z.object({
      herdSize: rangeParameter({
        defaultValue: 3,
        description: "Hares in the group.",
        label: "Group size",
        maximum: 7,
        minimum: 1,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
  healing: {
    category: "life",
    description: "Heals, feeds and warms everyone inside the circle.",
    name: "Healing",
    parameters: z.object({
      radius: brushRadius(60, 200),
    }),
    usage: "point",
  },
  ibex: {
    category: "life",
    description: "A herd of ibex. They keep to rocky heights and bound uphill when chased.",
    name: "Ibex",
    parameters: z.object({
      herdSize: rangeParameter({
        defaultValue: 5,
        description: "Animals in the herd.",
        label: "Herd size",
        maximum: 9,
        minimum: 2,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
  inspiration: {
    category: "life",
    description: "The nearest tribe makes its next discovery sooner.",
    name: "Inspiration",
    parameters: z.object({
      strength: strength(50, "Share of the next discovery granted at once."),
    }),
    usage: "point",
  },
  lightning: {
    category: "elements",
    description: "Lightning from a clear sky. Sets trees alight and teaches nearby tribes about fire.",
    name: "Lightning",
    parameters: z.object({
      ignitionChance: strength(90, "Chance that a strike starts a fire."),
      scatter: rangeParameter({
        defaultValue: 30,
        description: "How far apart the bolts land.",
        label: "Scatter",
        maximum: 400,
        minimum: 0,
        step: 5,
        unit: "meters",
      }),
      strikes: rangeParameter({
        defaultValue: 1,
        description: "Bolts per click.",
        label: "Strikes",
        maximum: 8,
        minimum: 1,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
  lower: {
    category: "land",
    description: "Digs the land down. Dig a basin in a valley and rain fills it with water.",
    name: "Lower land",
    parameters: z.object({
      radius: brushRadius(70, 300),
      strength: strength(60, "How fast the ground sinks."),
    }),
    usage: "brush",
  },
  mammoth: {
    category: "life",
    description: "A herd of mammoths. They love the cold and feed a tribe for days.",
    name: "Mammoths",
    parameters: z.object({
      herdSize: rangeParameter({
        defaultValue: 3,
        description: "Animals in the herd.",
        label: "Herd size",
        maximum: 7,
        minimum: 2,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
  meteor: {
    category: "elements",
    description: "A meteor falls from the sky and leaves a huge burning crater.",
    name: "Meteor",
    parameters: z.object({
      craterRadius: rangeParameter({
        defaultValue: 140,
        description: "Size of the impact crater.",
        label: "Crater",
        maximum: 320,
        minimum: 40,
        step: 10,
        unit: "meters",
      }),
      fallTime: rangeParameter({
        defaultValue: 1,
        description: "Seconds between the click and the impact.",
        label: "Fall time",
        maximum: 6,
        minimum: 0.5,
        step: 0.5,
        unit: "seconds",
      }),
      ignites: toggleParameter({ defaultValue: true, description: "The impact starts fires.", label: "Starts fires" }),
    }),
    usage: "point",
  },
  paint: {
    category: "land",
    description: "Changes the ground: meadow, dry grass, sand, rock, snow, swamp or bare earth.",
    name: "Paint ground",
    parameters: z.object({
      material: choiceParameter({
        defaultValue: "meadow",
        description: "Ground to paint.",
        label: "Ground",
        options: [
          { label: "Meadow", value: "meadow" },
          { label: "Dry grass", value: "steppe" },
          { label: "Forest floor", value: "forest" },
          { label: "Sand", value: "sand" },
          { label: "Rock", value: "rock" },
          { label: "Snow", value: "snow" },
          { label: "Swamp", value: "swamp" },
          { label: "Bare earth", value: "dirt" },
        ],
      }),
      radius: brushRadius(50, 250),
    }),
    usage: "brush",
  },
  rain: {
    category: "elements",
    description: "A local downpour: puts out fires and soaks the ground.",
    name: "Rain",
    parameters: z.object({
      intensity: strength(70, "How heavily it rains."),
      radius: brushRadius(110, 400),
    }),
    usage: "brush",
  },
  raise: {
    category: "land",
    description: "Lifts the land. Rivers and lakes find their new way after the edit.",
    name: "Raise land",
    parameters: z.object({
      radius: brushRadius(70, 300),
      strength: strength(60, "How fast the ground rises."),
    }),
    usage: "brush",
  },
  smooth: {
    category: "land",
    description: "Softens steep slopes and sharp ridges.",
    name: "Smooth",
    parameters: z.object({
      radius: brushRadius(60, 300),
      strength: strength(60, "How strongly the shape relaxes."),
    }),
    usage: "brush",
  },
  snow: {
    category: "elements",
    description: "Covers the ground with snow. It melts again where it is warm.",
    name: "Snow",
    parameters: z.object({
      intensity: strength(60, "How quickly snow piles up."),
      radius: brushRadius(110, 400),
    }),
    usage: "brush",
  },
  tornado: {
    category: "elements",
    description:
      "A twister that walks with the wind, uprooting trees, flinging people and animals and tearing huts apart.",
    name: "Tornado",
    parameters: z.object({
      lifetime: rangeParameter({
        defaultValue: 20,
        description: "Seconds before the funnel dies out.",
        label: "Lifetime",
        maximum: 60,
        minimum: 5,
        step: 5,
        unit: "seconds",
      }),
      radius: brushRadius(45, 140),
      strength: strength(70, "How hard the wind tears at the ground."),
    }),
    usage: "point",
  },
  tribe: {
    category: "life",
    description: "A new tribe arrives and settles near water and food close to the click.",
    name: "Tribe",
    parameters: z.object({
      people: rangeParameter({
        defaultValue: 7,
        description: "How many people arrive.",
        label: "People",
        maximum: 16,
        minimum: 3,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
  volcano: {
    category: "elements",
    description:
      "The ground swells into a fire mountain. Lava runs downhill and burns what it meets, then cools into rock and ash that grows back lush.",
    name: "Volcano",
    parameters: z.object({
      radius: rangeParameter({
        defaultValue: 120,
        description: "Width of the mountain that rises.",
        label: "Radius",
        maximum: 260,
        minimum: 60,
        step: 10,
        unit: "meters",
      }),
      strength: strength(60, "How long it erupts and how far the lava runs."),
    }),
    usage: "point",
  },
  wolf: {
    category: "life",
    description: "A wolf pack that roams far and keeps its distance from people.",
    name: "Wolves",
    parameters: z.object({
      herdSize: rangeParameter({
        defaultValue: 4,
        description: "Wolves in the pack.",
        label: "Pack size",
        maximum: 8,
        minimum: 2,
        step: 1,
        unit: "count",
      }),
    }),
    usage: "point",
  },
} as const satisfies Readonly<Record<string, PowerDefinition>>;

export type PowerId = keyof typeof POWERS;

export type PowerParameters<Id extends PowerId> = z.output<(typeof POWERS)[Id]["parameters"]>;

export const POWER_GROUPS: readonly (readonly PowerId[])[] = [
  ["fire", "lightning", "rain", "snow"],
  ["explosion", "meteor", "earthquake", "volcano", "tornado"],
  ["raise", "lower", "flatten", "smooth"],
  ["forest", "paint"],
  ["tribe"],
  ["deer", "mammoth", "ibex", "hare", "wolf"],
  ["abundance", "inspiration", "healing"],
];

export const POWER_ORDER: readonly PowerId[] = POWER_GROUPS.flat();

function brushRadius(defaultValue: number, maximum: number) {
  return rangeParameter({
    defaultValue,
    description: "How far the power reaches from the cursor.",
    label: "Radius",
    maximum,
    minimum: 5,
    step: 1,
    unit: "meters",
  });
}

function strength(defaultValue: number, description: string) {
  return rangeParameter({
    defaultValue,
    description,
    label: "Strength",
    maximum: 100,
    minimum: 5,
    step: 5,
    unit: "percent",
  });
}

export function isPowerId(value: string): value is PowerId {
  return Object.hasOwn(POWERS, value);
}

export function powerGroupsInCategory(category: PowerCategory): readonly (readonly PowerId[])[] {
  return POWER_GROUPS.filter((group) => {
    return POWERS[group[0]].category === category;
  });
}

export function powersInCategory(category: PowerCategory): readonly PowerId[] {
  return POWER_ORDER.filter((powerId) => {
    return POWERS[powerId].category === category;
  });
}

export function defaultPowerParameters(powerId: PowerId): ParameterValueMap {
  return POWERS[powerId].parameters.parse({});
}

export function readPowerParameters(powerId: PowerId, values: unknown): ParameterValueMap {
  const result = POWERS[powerId].parameters.safeParse(values);

  if (!result.success) {
    console.warn(`Ignoring invalid parameters for ${powerId}`, result.error.issues);

    return defaultPowerParameters(powerId);
  }

  return result.data;
}
