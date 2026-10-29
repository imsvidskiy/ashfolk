import type { RenderQuality } from "./render-quality.ts";

const SHARPEST_SHADOW_MAP_SIZE = 8192;
const FAR_PLANT_DETAIL = 4;

export interface RenderFilming {
  readonly areMarkersHidden: boolean;
  readonly hasFarPlants: boolean;
  readonly hasFarShadows: boolean;
  readonly hasFinestGround: boolean;
  readonly hasSharpestShadows: boolean;
}

export function filmedQuality(quality: RenderQuality, filming: RenderFilming, largestTexture: number): RenderQuality {
  const shadowMapSize = filming.hasSharpestShadows
    ? Math.max(quality.shadowMapSize, Math.min(SHARPEST_SHADOW_MAP_SIZE, largestTexture))
    : quality.shadowMapSize;
  const terrainDetail = filming.hasFinestGround ? Number.POSITIVE_INFINITY : quality.terrainDetail;
  const vegetationDetail = filming.hasFarPlants
    ? Math.max(quality.vegetationDetail, FAR_PLANT_DETAIL)
    : quality.vegetationDetail;

  return { ...quality, shadowMapSize, terrainDetail, vegetationDetail };
}
