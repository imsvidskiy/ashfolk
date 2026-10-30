import { mixColors } from "../../shared/color.ts";
import { inverseLerp, saturate } from "../../shared/math.ts";

export interface SkyPalette {
  readonly abyss: number;
  readonly ambientGround: number;
  readonly ambientSky: number;
  readonly cloudLit: number;
  readonly cloudShade: number;
  readonly horizon: number;
  readonly sunlight: number;
  readonly zenith: number;
}

const NIGHT: SkyPalette = {
  abyss: 0x0e_16_28,
  ambientGround: 0x1a_1e_2a,
  ambientSky: 0x3a_4c_74,
  cloudLit: 0x2e_38_50,
  cloudShade: 0x18_1e_2e,
  horizon: 0x20_2e_4c,
  sunlight: 0xa8_bc_e8,
  zenith: 0x0a_12_28,
};

const TWILIGHT: SkyPalette = {
  abyss: 0x3e_44_62,
  ambientGround: 0x3a_32_36,
  ambientSky: 0x6a_70_98,
  cloudLit: 0xe8_8f_70,
  cloudShade: 0x5a_4e_6a,
  horizon: 0xe0_8c_66,
  sunlight: 0xff_8a_4a,
  zenith: 0x27_3c_6c,
};

const GOLDEN_HOUR: SkyPalette = {
  abyss: 0x86_8c_a8,
  ambientGround: 0x6a_5c_4a,
  ambientSky: 0xa4_b6_d4,
  cloudLit: 0xff_e0_b8,
  cloudShade: 0xa8_9c_a8,
  horizon: 0xf2_c4_94,
  sunlight: 0xff_c0_80,
  zenith: 0x5a_86_c4,
};

const DAY: SkyPalette = {
  abyss: 0x8c_a4_c0,
  ambientGround: 0x7a_72_5a,
  ambientSky: 0xb6_d2_ee,
  cloudLit: 0xff_ff_ff,
  cloudShade: 0xc2_cc_d8,
  horizon: 0xcf_e2_f0,
  sunlight: 0xff_f4_e4,
  zenith: 0x4c_8c_d6,
};

const OVERCAST: SkyPalette = {
  abyss: 0x8a_92_9c,
  ambientGround: 0x6a_6a_66,
  ambientSky: 0xb0_b6_bc,
  cloudLit: 0xd4_d8_dc,
  cloudShade: 0x8e_96_a0,
  horizon: 0xc0_c6_cc,
  sunlight: 0xd8_dc_e0,
  zenith: 0x96_a0_ac,
};

const RAINY: SkyPalette = {
  abyss: 0x5c_64_70,
  ambientGround: 0x4c_4e_4a,
  ambientSky: 0x86_90_9c,
  cloudLit: 0x9e_a6_b0,
  cloudShade: 0x5c_64_70,
  horizon: 0x84_8e_99,
  sunlight: 0xa8_b0_ba,
  zenith: 0x68_72_7e,
};

interface PaletteKey {
  readonly palette: SkyPalette;
  readonly sunHeight: number;
}

const NIGHT_KEY: PaletteKey = { palette: NIGHT, sunHeight: -0.22 };

const PALETTE_KEYS: readonly PaletteKey[] = [
  NIGHT_KEY,
  { palette: TWILIGHT, sunHeight: -0.04 },
  { palette: GOLDEN_HOUR, sunHeight: 0.1 },
  { palette: DAY, sunHeight: 0.38 },
];

function mixPalettes(from: SkyPalette, to: SkyPalette, amount: number): SkyPalette {
  return {
    abyss: mixColors(from.abyss, to.abyss, amount),
    ambientGround: mixColors(from.ambientGround, to.ambientGround, amount),
    ambientSky: mixColors(from.ambientSky, to.ambientSky, amount),
    cloudLit: mixColors(from.cloudLit, to.cloudLit, amount),
    cloudShade: mixColors(from.cloudShade, to.cloudShade, amount),
    horizon: mixColors(from.horizon, to.horizon, amount),
    sunlight: mixColors(from.sunlight, to.sunlight, amount),
    zenith: mixColors(from.zenith, to.zenith, amount),
  };
}

function clearSkyPalette(sunHeight: number): SkyPalette {
  let lower = NIGHT_KEY;

  for (const upper of PALETTE_KEYS) {
    if (sunHeight < upper.sunHeight) {
      const amount = inverseLerp(lower.sunHeight, upper.sunHeight, sunHeight);

      return mixPalettes(lower.palette, upper.palette, amount);
    }

    lower = upper;
  }

  return lower.palette;
}

export function skyPaletteAt(sunHeight: number, overcast: number, gloom: number): SkyPalette {
  const clear = clearSkyPalette(sunHeight);
  const daylight = saturate(inverseLerp(-0.2, 0.25, sunHeight));

  const gloomy = mixPalettes(NIGHT, mixPalettes(OVERCAST, RAINY, gloom), daylight);

  return mixPalettes(clear, gloomy, Math.max(overcast, gloom) * 0.85 + gloom * 0.1);
}
