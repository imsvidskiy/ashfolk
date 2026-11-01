import { PlantSpecies, type PlantSpeciesIndex } from "../../content/plants.ts";
import { SEASON_COUNT } from "../../content/seasons.ts";
import { mixColors } from "../../shared/color.ts";
import { lerp } from "../../shared/math.ts";

const BARE_BRANCHES = 0x7a_6a_44;
const BUDS = 0x8e_9a_4c;
const FRESH_LEAVES = 0x86_ac_4a;

interface FoliageLook {
  readonly color: number;
  readonly coverage: number;
}

interface FoliageKey extends FoliageLook {
  readonly season: number;
}

const LEAFLESS: readonly FoliageKey[] = [{ color: BARE_BRANCHES, coverage: 0, season: 0 }];

const STONEWORK: readonly FoliageKey[] = evergreen(0x6f_8a_3e, 0x6a_6a_48);

const FOLIAGE_KEYS: Readonly<Record<PlantSpeciesIndex, readonly FoliageKey[]>> = {
  [PlantSpecies.Acacia]: evergreen(0x76_93_42, 0x86_8c_4c),
  [PlantSpecies.Alder]: deciduous(0x3e_6c_2c, 0x6e_6a_2e),
  [PlantSpecies.AppleTree]: fruitTree(0xf2_d2_da, 0x52_88_34, 0xb8_9a_38),
  [PlantSpecies.Arch]: STONEWORK,
  [PlantSpecies.Birch]: deciduous(0x6f_a8_40, 0xe0_b0_36),
  [PlantSpecies.Blueberry]: berryBush(0x4c_7a_44, 0xb4_30_28),
  [PlantSpecies.Boulder]: STONEWORK,
  [PlantSpecies.Bush]: deciduous(0x4f_86_34, 0xa8_52_2a),
  [PlantSpecies.Cactus]: evergreen(0x4f_8a_4a, 0x4a_7c_46),
  [PlantSpecies.Cairn]: STONEWORK,
  [PlantSpecies.Currant]: berryBush(0x66_98_3e, 0xc4_a0_38),
  [PlantSpecies.DeadTree]: LEAFLESS,
  [PlantSpecies.DesertShrub]: evergreen(0x8c_9a_68, 0x80_88_5e),
  [PlantSpecies.Dolmen]: STONEWORK,
  [PlantSpecies.Idol]: STONEWORK,
  [PlantSpecies.Maple]: deciduous(0x4e_8c_32, 0xc4_3e_24),
  [PlantSpecies.Menhir]: STONEWORK,
  [PlantSpecies.Oak]: deciduous(0x4a_7e_2e, 0xb0_6a_28),
  [PlantSpecies.Palm]: evergreen(0x58_94_3a, 0x52_86_3a),
  [PlantSpecies.PearTree]: fruitTree(0xf6_f3_ea, 0x4e_86_36, 0xc0_52_2c),
  [PlantSpecies.Pillar]: STONEWORK,
  [PlantSpecies.Pine]: evergreen(0x40_6e_3a, 0x37_5c_3e),
  [PlantSpecies.PlumTree]: fruitTree(0xf4_e2_e8, 0x55_80_3a, 0xa4_4c_38),
  [PlantSpecies.Poplar]: deciduous(0x5a_92_38, 0xe2_c0_38),
  [PlantSpecies.Raspberry]: berryBush(0x5c_8e_3a, 0xb0_8a_2e),
  [PlantSpecies.Sandstone]: STONEWORK,
  [PlantSpecies.Spruce]: evergreen(0x33_5f_3e, 0x2c_50_40),
  [PlantSpecies.Willow]: deciduous(0x82_a8_44, 0xbc_b0_46),
};

function deciduous(summer: number, autumn: number): readonly FoliageKey[] {
  return [
    { color: BUDS, coverage: 0.4, season: 0 },
    { color: FRESH_LEAVES, coverage: 0.85, season: 0.2 },
    { color: 0x74_a0_42, coverage: 1, season: 0.45 },
    { color: summer, coverage: 1, season: 1.2 },
    { color: summer, coverage: 1, season: 2 },
    { color: autumn, coverage: 1, season: 2.45 },
    { color: autumn, coverage: 0.55, season: 2.8 },
    { color: BARE_BRANCHES, coverage: 0, season: 3.1 },
    { color: BARE_BRANCHES, coverage: 0, season: 3.75 },
  ];
}

function fruitTree(blossom: number, summer: number, autumn: number): readonly FoliageKey[] {
  return [
    { color: BARE_BRANCHES, coverage: 0, season: 0 },
    { color: BUDS, coverage: 0.45, season: 0.07 },
    { color: blossom, coverage: 0.95, season: 0.14 },
    { color: blossom, coverage: 1, season: 0.4 },
    { color: FRESH_LEAVES, coverage: 1, season: 0.56 },
    { color: summer, coverage: 1, season: 1.1 },
    { color: summer, coverage: 1, season: 2.05 },
    { color: autumn, coverage: 1, season: 2.45 },
    { color: autumn, coverage: 0.5, season: 2.8 },
    { color: BARE_BRANCHES, coverage: 0, season: 3.1 },
    { color: BARE_BRANCHES, coverage: 0, season: 3.8 },
  ];
}

function berryBush(summer: number, autumn: number): readonly FoliageKey[] {
  return [
    { color: BUDS, coverage: 0.35, season: 0 },
    { color: FRESH_LEAVES, coverage: 0.9, season: 0.2 },
    { color: summer, coverage: 1, season: 0.6 },
    { color: summer, coverage: 1, season: 2.1 },
    { color: autumn, coverage: 1, season: 2.5 },
    { color: autumn, coverage: 0.5, season: 2.85 },
    { color: BARE_BRANCHES, coverage: 0, season: 3.15 },
    { color: BARE_BRANCHES, coverage: 0, season: 3.8 },
  ];
}

function evergreen(summer: number, winter: number): readonly FoliageKey[] {
  return [
    { color: winter, coverage: 1, season: 0 },
    { color: summer, coverage: 1, season: 0.6 },
    { color: summer, coverage: 1, season: 2.4 },
    { color: winter, coverage: 1, season: 3.2 },
  ];
}

function wrapSeason(season: number): number {
  return ((season % SEASON_COUNT) + SEASON_COUNT) % SEASON_COUNT;
}

function interpolate(from: FoliageKey, to: FoliageKey, offset: number, span: number): FoliageLook {
  const amount = span <= 0 ? 0 : offset / span;

  return { color: mixColors(from.color, to.color, amount), coverage: lerp(from.coverage, to.coverage, amount) };
}

export function foliageLook(species: PlantSpeciesIndex, season: number): FoliageLook {
  const keys = FOLIAGE_KEYS[species];
  const current = wrapSeason(season);

  for (const [index, key] of keys.entries()) {
    const next = keys[(index + 1) % keys.length];
    const span = wrapSeason(next.season - key.season);
    const offset = wrapSeason(current - key.season);

    if (offset <= span) {
      return interpolate(key, next, offset, span);
    }
  }

  return { color: keys[0].color, coverage: keys[0].coverage };
}
