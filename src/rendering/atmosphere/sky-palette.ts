import { mixColors } from "../../shared/color.ts";
import { inverseLerp, saturate } from "../../shared/math.ts";

export interface SkyPalette {
  readonly abyss: number;
  readonly ambientGround: number;
  readonly ambientSky: number;
  readonly horizon: number;
  readonly sunlight: number;
  readonly zenith: number;
}

const NIGHT: SkyPalette = {
  abyss: 0x1c_25_39,
  ambientGround: 0x1a_1e_2a,
  ambientSky: 0x3a_4c_74,
  horizon: 0x20_2e_4c,
  sunlight: 0xa8_bc_e8,
  zenith: 0x0a_12_28,
};

const TWILIGHT: SkyPalette = {
  abyss: 0x8f_72_7a,
  ambientGround: 0x3a_32_36,
  ambientSky: 0x6a_70_98,
  horizon: 0xe0_8c_66,
  sunlight: 0xff_8a_4a,
  zenith: 0x27_3c_6c,
};

const GOLDEN_HOUR: SkyPalette = {
  abyss: 0xc7_b9_b8,
  ambientGround: 0x6a_5c_4a,
  ambientSky: 0xa4_b6_d4,
  horizon: 0xf2_c4_94,
  sunlight: 0xff_c0_80,
  zenith: 0x5a_86_c4,
};

const DAY: SkyPalette = {
  abyss: 0xc7_d2_df,
  ambientGround: 0x7a_72_5a,
  ambientSky: 0xb6_d2_ee,
  horizon: 0xcf_e2_f0,
  sunlight: 0xff_f4_e4,
  zenith: 0x4c_8c_d6,
};

const OVERCAST: SkyPalette = {
  abyss: 0xb5_bd_c7,
  ambientGround: 0x6a_6a_66,
  ambientSky: 0xb0_b6_bc,
  horizon: 0xc0_c6_cc,
  sunlight: 0xd8_dc_e0,
  zenith: 0x96_a0_ac,
};

const RAINY: SkyPalette = {
  abyss: 0x76_80_8e,
  ambientGround: 0x4c_4e_4a,
  ambientSky: 0x86_90_9c,
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
