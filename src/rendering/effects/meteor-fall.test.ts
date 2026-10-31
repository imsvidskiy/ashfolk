import { describe, expect, it, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import type { MeteorEffect } from "../../simulation/effects.ts";
import { CameraAxes, createBillboardBatch } from "./billboards.ts";
import { EffectMeshes } from "./effect-meshes.ts";
import { MeteorFall } from "./meteor-fall.ts";
import { createDustMaterial, createGlowMaterial } from "./sprite-materials.ts";
import type { SpriteSinks } from "./transient-effects.ts";

const METEOR: MeteorEffect = {
  durationSeconds: 2,
  fromX: 2600,
  fromY: 3200,
  fromZ: 0,
  kind: "meteor",
  radius: 140,
  toX: 0,
  toZ: 0,
};

const FRAME_SECONDS = 0.04;

function createMeteor() {
  const axes = new CameraAxes();

  const sinks: SpriteSinks = {
    dust: createBillboardBatch(createDustMaterial(axes), 5),
    glow: createBillboardBatch(createGlowMaterial(axes), 9),
  };

  const meteor = new MeteorFall(
    {
      flash: ignore,
      heightAt: () => {
        return 0;
      },
      light: ignore,
      meshes: new EffectMeshes(),
      releaseRing: ignore,
      shake: ignore,
      takeRing: vi.fn(),
    },
    METEOR
  );

  return { meteor, sinks };
}

function runFor(meteor: MeteorFall, sinks: SpriteSinks, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME_SECONDS) {
    sinks.dust.begin();
    sinks.glow.begin();
    meteor.update(FRAME_SECONDS, sinks);
    sinks.dust.commit();
    sinks.glow.commit();
  }
}

function opacities(sinks: SpriteSinks): number[] {
  const look = sinks.dust.mesh.geometry.getAttribute("billboardLook");

  return Array.from({ length: sinks.dust.count }, (_, index) => {
    return look.getW(index);
  });
}

describe("meteor fall", () => {
  it("leaves a smoke trail behind the falling rock", () => {
    const { meteor, sinks } = createMeteor();

    runFor(meteor, sinks, 1.5);

    expect(sinks.dust.count).toBeGreaterThan(100);
  });

  it("stops drawing smoke puffs once they have cleared", () => {
    const { meteor, sinks } = createMeteor();

    runFor(meteor, sinks, 6);

    expect(sinks.dust.count).toBeGreaterThan(0);
    expect(Math.min(...opacities(sinks))).toBeGreaterThan(0);
  });
});
