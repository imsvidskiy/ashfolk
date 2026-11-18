export const BLACK_HOLE_CORE_SHARE = 0.25;
export const SKY_ENTRY_HEIGHT = 3200;

type BlessingStyle = "abundance" | "healing" | "inspiration";

export interface ArrowEffect {
  durationSeconds: number;
  fromX: number;
  fromZ: number;
  isHit: boolean;
  kind: "arrow";
  toX: number;
  toZ: number;
}

export interface BlackHoleEffect {
  durationSeconds: number;
  elapsedSeconds?: number;
  kind: "black-hole";
  radius: number;
  surfaceY: number;
  wellId?: number;
  x: number;
  z: number;
}

export const INFLOW_MATERIALS = ["conifer", "broadleaf", "wood", "roof", "masonry", "rock", "earth", "water"] as const;

export interface InflowSource {
  isFallen: boolean;
  material: (typeof INFLOW_MATERIALS)[number];
  rotation: number;
  size: number;
  x: number;
  y: number;
  z: number;
}

export interface BlackHoleInflowEffect {
  durationSeconds: number;
  elapsedSeconds?: number;
  holeDuration: number;
  kind: "black-hole-inflow";
  radius: number;
  sources: readonly InflowSource[];
  startedAt: number;
  surfaceY: number;
  wellId: number;
  x: number;
  z: number;
}

export interface NuclearFallEffect {
  dropId: number;
  durationSeconds: number;
  elapsedSeconds?: number;
  kind: "nuclear-fall";
  radius: number;
  surfaceY: number;
  x: number;
  z: number;
}

export interface NuclearCloudEffect {
  dropId: number;
  isInWater: boolean;
  kind: "nuclear-cloud";
  radius: number;
  surfaceY: number;
  x: number;
  z: number;
}

export interface BlessingEffect {
  kind: "blessing";
  radius: number;
  style: BlessingStyle;
  x: number;
  z: number;
}

export interface EarthquakeEffect {
  kind: "earthquake";
  magnitude: number;
  radius: number;
  x: number;
  z: number;
}

export interface EmberEffect {
  durationSeconds: number;
  fromX: number;
  fromZ: number;
  kind: "ember";
  toX: number;
  toZ: number;
}

export interface ExplosionEffect {
  isInWater: boolean;
  kind: "explosion";
  power: number;
  radius: number;
  surfaceY: number;
  x: number;
  z: number;
}

export interface LightningEffect {
  isNatural: boolean;
  kind: "lightning";
  x: number;
  z: number;
}

export interface MeteorEffect {
  durationSeconds: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  kind: "meteor";
  radius: number;
  toX: number;
  toZ: number;
}

export interface SplashEffect {
  kind: "splash";
  level: number;
  x: number;
  z: number;
}

export interface TornadoEffect {
  elapsedSeconds?: number;
  kind: "tornado";
  path: readonly number[];
  radius: number;
}

export type SimulationEffect =
  | ArrowEffect
  | { kind: "black-hole-collapse"; wellId: number }
  | BlackHoleEffect
  | BlackHoleInflowEffect
  | BlessingEffect
  | NuclearFallEffect
  | NuclearCloudEffect
  | EarthquakeEffect
  | EmberEffect
  | ExplosionEffect
  | LightningEffect
  | MeteorEffect
  | SplashEffect
  | TornadoEffect;

export class EffectLog {
  #effects: SimulationEffect[] = [];

  add(effect: SimulationEffect): void {
    this.#effects.push(effect);
  }

  takeEffects(): SimulationEffect[] {
    const effects = this.#effects;

    this.#effects = [];

    return effects;
  }
}
