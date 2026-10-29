import type { PowerId } from "../../content/powers.ts";
import type { GameIconName } from "../../design/game-icon-sources.ts";

export const POWER_ICONS: Readonly<Record<PowerId, GameIconName>> = {
  abundance: "grain",
  deer: "deer",
  earthquake: "earthquake",
  explosion: "explosion",
  fire: "fire",
  flatten: "flatten",
  forest: "forest",
  hare: "hare",
  healing: "healing",
  ibex: "ibex",
  inspiration: "inspiration",
  lightning: "lightning",
  lower: "lower",
  mammoth: "mammoth",
  meteor: "meteor",
  paint: "paint",
  rain: "rain",
  raise: "raise",
  smooth: "smooth",
  snow: "snow",
  tornado: "tornado",
  tribe: "tent",
  volcano: "volcano",
  wolf: "wolf",
};

export const POWER_OPTION_ICONS: Readonly<
  Partial<Record<PowerId, Readonly<Record<string, Readonly<Record<string, GameIconName>>>>>>
> = {
  forest: {
    species: {
      acacia: "acacia",
      alder: "alder",
      birch: "birch",
      bush: "berry-bush",
      climate: "mixed-grove",
      maple: "maple",
      oak: "oak",
      palm: "palm",
      pine: "pine",
      poplar: "poplar",
      spruce: "spruce",
      willow: "willow",
    },
  },
  paint: {
    material: {
      dirt: "bare-earth",
      forest: "forest-floor",
      meadow: "meadow",
      rock: "rock",
      sand: "sand",
      snow: "snowfield",
      steppe: "dry-grass",
      swamp: "swamp",
    },
  },
};
