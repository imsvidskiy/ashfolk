import { abs, cameraPosition, exp, float, length, max, positionWorld, select, uniform } from "three/tsl";
import type { Node } from "three/webgpu";
import { lerp, smoothstep } from "../../shared/math.ts";

const BASE_ALTITUDE = 250;
const CLEAR_DENSITY = 0.000_05;
const LOW_SUN_HAZE = 0.000_06;
const MIST_DENSITY = 0.0021;
const RAIN_DENSITY = 0.000_45;
const CLEAR_LAYER_DEPTH = 700;
const MIST_LAYER_DEPTH = 420;
const LEVEL_RAY = 0.0001;
const RAIN_VEIL = 0.000_09;
const SNOW_VEIL = 0.000_04;

interface FogConditions {
  readonly mist: number;
  readonly precipitation: number;
  readonly snowfall: number;
  readonly sunHeight: number;
}

interface FogShape {
  readonly density: number;
  readonly falloff: number;
  readonly veil: number;
}

export function fogShapeFor(conditions: FogConditions): FogShape {
  const daylight = smoothstep(-0.12, 0.12, conditions.sunHeight);
  const lowSun = 1 - smoothstep(0.04, 0.42, conditions.sunHeight);

  return {
    density:
      CLEAR_DENSITY +
      LOW_SUN_HAZE * lowSun * daylight +
      MIST_DENSITY * conditions.mist +
      RAIN_DENSITY * conditions.precipitation,
    falloff: 1 / lerp(CLEAR_LAYER_DEPTH, MIST_LAYER_DEPTH, conditions.mist),
    veil: RAIN_VEIL * conditions.precipitation + SNOW_VEIL * conditions.snowfall,
  };
}

export class HeightFog {
  readonly factor: Node<"float">;
  readonly #density = uniform(CLEAR_DENSITY);
  readonly #falloff = uniform(1 / CLEAR_LAYER_DEPTH);
  readonly #veil = uniform(0);

  constructor() {
    const ray = positionWorld.sub(cameraPosition);
    const thickness = this.#density.mul(exp(cameraPosition.y.sub(BASE_ALTITUDE).mul(this.#falloff).negate()));

    const climb = ray.y.mul(this.#falloff);
    const spread = select(abs(climb).greaterThan(LEVEL_RAY), float(1).sub(exp(climb.negate())).div(climb), float(1));
    const layered = thickness.mul(spread);

    this.factor = float(1).sub(exp(max(layered.add(this.#veil).mul(length(ray)), 0).negate()));
  }

  apply(shape: FogShape): void {
    this.#density.value = shape.density;
    this.#falloff.value = shape.falloff;
    this.#veil.value = shape.veil;
  }
}
