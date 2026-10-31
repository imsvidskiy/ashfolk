import { describe, expect, it, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import type { ArrowEffect, EmberEffect, ExplosionEffect, LightningEffect } from "../../simulation/effects.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { CameraAxes } from "./billboards.ts";
import { EffectView } from "./effect-view.ts";
import { GroundRing } from "./ground-ring.ts";

const LIGHTNING: LightningEffect = { isNatural: true, kind: "lightning", x: 0, z: 0 };
const EXPLOSION: ExplosionEffect = { isInWater: false, kind: "explosion", power: 2, radius: 30, x: 0, z: 0 };
const ARROW: ArrowEffect = { durationSeconds: 1, fromX: 0, fromZ: 0, isHit: true, kind: "arrow", toX: 38, toZ: 0 };
const EMBER: EmberEffect = { durationSeconds: 3, fromX: 0, fromZ: 0, kind: "ember", toX: 40, toZ: 0 };

function createEffects() {
  const mirror = createVegetatedMirror();
  const textures = new TerrainTextures(mirror);

  const createRing = vi.fn(() => {
    return new GroundRing(textures, mirror.grid);
  });

  const view = new EffectView({
    axes: new CameraAxes(),
    createRing,
    heightAt: () => {
      return 0;
    },
    shake: ignore,
  });

  return { createRing, view };
}

function runFor(view: EffectView, seconds: number, speed = 1): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    view.update(0.1, 0.1 * speed);
  }
}

describe("effect view", () => {
  it("shows a lightning bolt until it fades", () => {
    const { view } = createEffects();

    const meshesBefore = view.group.children.length;

    view.add([LIGHTNING]);

    expect(view.group.children.length).toBe(meshesBefore + 1);
    expect(view.flash).toBeGreaterThan(0);

    runFor(view, 1);

    expect(view.group.children.length).toBe(meshesBefore);
  });

  it("reuses the ground ring of a finished explosion", () => {
    const { createRing, view } = createEffects();

    view.add([EXPLOSION]);
    runFor(view, 4);
    view.add([EXPLOSION]);

    expect(createRing).toHaveBeenCalledOnce();
  });

  it("gives overlapping explosions rings of their own", () => {
    const { createRing, view } = createEffects();

    view.add([EXPLOSION, EXPLOSION]);

    expect(createRing).toHaveBeenCalledTimes(2);
  });

  it("lets the flash of a strike fade on the real clock, even while paused", () => {
    const { view } = createEffects();

    view.add([LIGHTNING]);

    const { flash } = view;

    runFor(view, 1, 0);

    expect(view.flash).toBeLessThan(flash * 0.01);
  });

  it("lands an arrow on the game clock", () => {
    const { view } = createEffects();

    const meshesBefore = view.group.children.length;

    view.add([ARROW]);
    runFor(view, 0.2, 16);

    expect(view.group.children.length).toBe(meshesBefore);
  });

  it("holds a paused arrow in the air", () => {
    const { view } = createEffects();

    const meshesBefore = view.group.children.length;

    view.add([ARROW]);
    runFor(view, 5, 0);

    expect(view.group.children.length).toBe(meshesBefore + 1);
  });

  it("lands an ember on the game clock", () => {
    const { view } = createEffects();

    const [, glow] = view.group.children;

    view.add([EMBER]);
    runFor(view, 0.3, 16);

    expect(glow.visible).toBe(false);
  });
});
