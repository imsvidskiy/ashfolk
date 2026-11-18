import type { Mesh, Vector3 } from "three/webgpu";
import type { InstanceBatch } from "../instancing.ts";
import type { EffectMeshes } from "./effect-meshes.ts";
import type { GroundRing } from "./ground-ring.ts";

export interface SpriteSinks {
  readonly dust: InstanceBatch;
  readonly glow: InstanceBatch;
}

export interface EffectSurface {
  readonly heightAt: (x: number, z: number) => number;
  readonly isWaterAt: (x: number, z: number) => boolean;
  readonly surfaceAt: (x: number, z: number) => number;
}

export interface GroundRings {
  readonly releaseRing: (ring: GroundRing) => void;
  readonly takeRing: () => GroundRing;
}

export interface EffectContext extends GroundRings {
  readonly flash: (amount: number) => void;
  readonly light: (position: Vector3, color: number, intensity: number) => void;
  readonly meshes: EffectMeshes;
  readonly shake: (amount: number, x: number, z: number) => void;
  readonly surface: EffectSurface;
}

export interface ActiveEffect {
  readonly finish?: () => void;
  readonly isOnGameClock?: true;
  readonly meshes: readonly Mesh[];
  readonly update: (seconds: number, sinks: SpriteSinks) => boolean;
}
