import { InstancedBufferGeometry, Mesh, type Object3D, Texture } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import { ignore } from "../../shared/ignore.ts";
import type {
  ArrowEffect,
  BlackHoleEffect,
  BlackHoleInflowEffect,
  EmberEffect,
  ExplosionEffect,
  LightningEffect,
  NuclearFallEffect,
} from "../../simulation/effects.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { CameraAxes } from "./billboards.ts";
import { EffectView } from "./effect-view.ts";
import { GroundRing } from "./ground-ring.ts";

const LIGHTNING: LightningEffect = { isNatural: true, kind: "lightning", x: 0, z: 0 };
const EXPLOSION: ExplosionEffect = {
  isInWater: false,
  kind: "explosion",
  power: 2,
  radius: 30,
  surfaceY: 20,
  x: 0,
  z: 0,
};
const ARROW: ArrowEffect = { durationSeconds: 1, fromX: 0, fromZ: 0, isHit: true, kind: "arrow", toX: 38, toZ: 0 };
const EMBER: EmberEffect = { durationSeconds: 3, fromX: 0, fromZ: 0, kind: "ember", toX: 40, toZ: 0 };

const BOMB: NuclearFallEffect = {
  dropId: 1,
  durationSeconds: 2.8,
  kind: "nuclear-fall",
  radius: 160,
  surfaceY: 25,
  x: 14,
  z: 57,
};

function createEffects() {
  const mirror = createVegetatedMirror();
  const textures = new TerrainTextures(mirror);

  const createRing = vi.fn(() => {
    return new GroundRing(textures, mirror.grid);
  });

  const view = new EffectView({
    axes: new CameraAxes(),
    createRing,
    sceneColor: new Texture(),
    shake: ignore,
    surface: mirror,
  });

  return { createRing, view };
}

function cloudTop(cloud: Object3D): number {
  if (!(cloud instanceof Mesh && cloud.geometry instanceof InstancedBufferGeometry)) {
    throw new Error("Expected an instanced cloud");
  }

  const centers = cloud.geometry.getAttribute("billboardPlacement");
  let highest = cloud.position.y;

  for (let index = 0; index < cloud.geometry.instanceCount; index += 1) {
    highest = Math.max(highest, cloud.position.y + centers.getY(index));
  }

  return highest;
}

function runFor(view: EffectView, seconds: number, speed = 1): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) {
    view.update(0.1, 0.1 * speed);
  }
}

describe("effect view", () => {
  it("collapses only its own lens and material even when two holes occupy the same ground", () => {
    const { view } = createEffects();
    const before = view.group.children.length;
    const hole: BlackHoleEffect = { durationSeconds: 6, kind: "black-hole", radius: 100, surfaceY: 20, x: 5, z: 5 };
    const inflow: BlackHoleInflowEffect = {
      durationSeconds: 1.2,
      holeDuration: 6,
      kind: "black-hole-inflow",
      radius: 100,
      sources: [{ isFallen: false, material: "rock", rotation: 1, size: 7, x: 15, y: 20, z: 5 }],
      startedAt: 4.8,
      surfaceY: 20,
      wellId: 1,
      x: 5,
      z: 5,
    };

    view.add([
      { ...hole, wellId: 1 },
      { ...hole, wellId: 2 },
    ]);
    view.update(9, 9);
    view.add([inflow, { ...inflow, wellId: 2 }]);
    const secondLens = view.group.children[before + 1];
    const secondDebris = view.group.children[before + 3];

    expect(view.group.children).toHaveLength(before + 4);
    view.add([{ kind: "black-hole-collapse", wellId: 1 }]);
    expect(view.group.children.slice(before)).toEqual([secondLens, secondDebris]);
    view.add([{ kind: "black-hole-collapse", wellId: 2 }]);
    expect(view.group.children).toHaveLength(before);

    view.dispose();
  });

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

  it("keeps water impacts and their expanding rings above the lakebed", () => {
    const { createRing, view } = createEffects();

    view.add([{ ...EXPLOSION, isInWater: true, surfaceY: 87 }]);

    const [result] = createRing.mock.results;

    if (result.type !== "return") {
      throw new Error("The blast did not create its ring");
    }

    const show = vi.spyOn(result.value, "show");

    view.update(0.2, 0.2);

    expect(show).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number), expect.any(Number), 87);
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

  it("restores a descending bomb at its saved height and holds it there when paused", () => {
    const { view } = createEffects();
    const initialMeshes = view.group.children.length;

    view.add([BOMB]);

    const body = view.group.children[initialMeshes];
    const start = body.position.clone();

    expect(start.y - BOMB.surfaceY).toBeGreaterThanOrEqual(3200);

    view.update(0.1, 1.5);

    expect(body.position.y).toBeLessThan(start.y);
    expect(Math.abs(body.position.x - BOMB.x)).toBeLessThan(Math.abs(start.x - BOMB.x));

    const inFlight = body.position.clone();

    view.update(10, 0);
    expect(body.position.equals(inFlight)).toBe(true);

    const saved = createEffects();

    saved.view.add([{ ...BOMB, elapsedSeconds: 1.5 }]);
    expect(saved.view.group.children[initialMeshes].position.equals(inFlight)).toBe(true);

    saved.view.update(0.1, 1.31);
    expect(saved.view.group.children.length).toBe(initialMeshes);
    expect(saved.view.flash).toBe(0);
    saved.view.dispose();
    view.dispose();
  });

  it("retires only the arriving bomb when two share an impact point", () => {
    const { view } = createEffects();
    const initialMeshes = view.group.children.length;

    view.add([BOMB, { ...BOMB, dropId: 2 }]);

    const first = view.group.children[initialMeshes];
    const second = view.group.children[initialMeshes + 2];

    view.add([{ ...BOMB, dropId: 2, isInWater: false, kind: "nuclear-cloud" }]);

    expect(first.parent).toBe(view.group);
    expect(second.parent).toBeNull();

    view.add([{ ...BOMB, isInWater: false, kind: "nuclear-cloud" }]);
    expect(first.parent).toBeNull();
    view.dispose();
  });

  it("expands a shock front across the water and raises a cloud above the impact", () => {
    const { createRing, view } = createEffects();
    const initialMeshes = view.group.children.length;

    view.add([{ dropId: 1, isInWater: true, kind: "nuclear-cloud", radius: 100, surfaceY: 20, x: 0, z: 0 }]);

    const cloud = view.group.children[initialMeshes + 1];
    const [result] = createRing.mock.results;

    if (result.type !== "return") {
      throw new Error("The shock front needs a ground ring");
    }

    const ring = result.value;
    const show = vi.spyOn(ring, "show");

    view.update(0.2, 0);
    const initialHeight = cloudTop(cloud);

    view.update(1, 0);

    expect(cloud.position.y).toBe(20);
    expect(cloudTop(cloud)).toBeGreaterThan(initialHeight);
    expect(show.mock.calls[1][2]).toBeGreaterThan(show.mock.calls[0][2]);
    expect(show.mock.calls[1][5]).toBe(20);

    view.update(1.1, 0);
    expect(ring.mesh.visible).toBe(false);
    expect(cloud.visible).toBe(true);

    view.update(8, 0);
    expect(view.group.children.length).toBe(initialMeshes);
    view.dispose();
  });

  it("lands an ember on the game clock", () => {
    const { view } = createEffects();

    const [, glow] = view.group.children;

    view.add([EMBER]);
    runFor(view, 0.3, 16);

    expect(glow.visible).toBe(false);
  });
});
