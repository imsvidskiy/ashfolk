import { PerspectiveCamera, PointLight } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { isTreeSpecies } from "../../content/plants.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import type { BuildingView } from "../../simulation/frame.ts";
import { SURFACE_CHANNELS, SurfaceChannel } from "../../world/agent-buffers.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import { createVegetatedMirror } from "../testing/vegetated-mirror.ts";
import { VegetationChunks } from "../vegetation/vegetation-chunks.ts";
import { CameraAxes } from "./billboards.ts";
import { FireView } from "./fire-view.ts";

const BYTE = 255;
const LIGHT_SMOKE_PUFFS = 16;
const SPARKS_PER_CELL = 2;
const CAMPFIRE: BuildingView = {
  extent: 2,
  fuel: 1,
  health: 1,
  id: 1,
  kind: "campfire",
  progress: 1,
  rotation: 0,
  seed: 0,
  style: 0,
  tribeId: 1,
  variant: 0,
  x: 0,
  z: 300,
};

interface Scene {
  readonly camera: PerspectiveCamera;
  readonly fire: FireView;
  readonly mirror: WorldMirror;
}

function createScene(): Scene {
  const camera = new PerspectiveCamera(45, 1.5, 1, 40_000);
  const mirror = createVegetatedMirror();

  const fire = new FireView({ axes: new CameraAxes(), chunks: new VegetationChunks(mirror) });

  camera.position.set(0, 300, 300);

  return { camera, fire, mirror };
}

function setBurning(
  mirror: WorldMirror,
  burning: ReadonlyMap<number, number>,
  buildings: readonly BuildingView[] = []
): void {
  mirror.frame = {
    ...mirror.frame,
    buildings: [...buildings],
    burningCells: Int32Array.from(burning.keys()),
    burningIntensity: Uint8Array.from(
      [...burning.values()].map((intensity) => {
        return Math.round(intensity * BYTE);
      })
    ),
    tick: mirror.frame.tick + 1,
  };
}

function litSpots(fire: FireView): number[][] {
  return fire.group.children
    .filter((child) => {
      return child instanceof PointLight && child.intensity > 0;
    })
    .map((light) => {
      return [light.position.x, light.position.z];
    })
    .toSorted((first, second) => {
      return first[0] - second[0] || first[1] - second[1];
    });
}

function burnTreesIn(mirror: WorldMirror, cell: number): void {
  const { grid, vegetation } = mirror;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (grid.cellAt(vegetation.x[plant], vegetation.z[plant]) === cell && isTreeSpecies(vegetation.species[plant])) {
      vegetation.state[plant] = PlantState.Burnt;
    }
  }
}

function setScorch(mirror: WorldMirror, cell: number, scorch: number): void {
  mirror.surface[cell * SURFACE_CHANNELS + SurfaceChannel.Scorch] = Math.round(scorch * BYTE);
}

function burningRange(firstCell: number, lastCell: number, intensity: number): Map<number, number> {
  const burning = new Map<number, number>();

  for (let cell = firstCell; cell < lastCell; cell += 1) {
    burning.set(cell, intensity);
  }

  return burning;
}

function cellWithLivingTree(mirror: WorldMirror): number {
  const { grid, vegetation } = mirror;

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (vegetation.state[plant] === PlantState.Alive && isTreeSpecies(vegetation.species[plant])) {
      return grid.cellAt(vegetation.x[plant], vegetation.z[plant]);
    }
  }

  throw new Error("The test world should grow trees");
}

function cellWithoutPlants(mirror: WorldMirror): number {
  const { grid, vegetation } = mirror;

  const occupied = new Set<number>();

  for (let plant = 0; plant < vegetation.count; plant += 1) {
    if (vegetation.state[plant] !== PlantState.Removed) {
      occupied.add(grid.cellAt(vegetation.x[plant], vegetation.z[plant]));
    }
  }

  for (let cell = 0; cell < grid.cellCount; cell += 1) {
    if (!occupied.has(cell) && cell % 5 !== 0) {
      return cell;
    }
  }

  throw new Error("The test world should have an empty cell");
}

describe("fire view", () => {
  it("draws nothing while nothing burns", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, new Map());
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBe(0);
    expect(fire.puffCount).toBe(0);
  });

  it("leaves smoldering ground without flames", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, new Map([[cellWithoutPlants(mirror), 0.1]]));
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBe(0);
  });

  it("raises more flames from fiercer ground fires", () => {
    const { camera, fire, mirror } = createScene();

    const cell = cellWithoutPlants(mirror);

    setBurning(mirror, new Map([[cell, 0.4]]));
    fire.update(mirror, camera, 0);

    const weak = fire.flameCount;

    setBurning(mirror, new Map([[cell, 0.9]]));
    fire.update(mirror, camera, 0);

    expect(weak).toBe(1);
    expect(fire.flameCount).toBe(2);
  });

  it("sets the crowns of living trees on fire in fierce cells", () => {
    const { camera, fire, mirror } = createScene();

    const cell = cellWithLivingTree(mirror);

    setBurning(mirror, new Map([[cell, 0.9]]));
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBeGreaterThan(2);
  });

  it("keeps tree crowns calm under a smoldering fire", () => {
    const { camera, fire, mirror } = createScene();

    const cell = cellWithLivingTree(mirror);

    setBurning(mirror, new Map([[cell, 0.05]]));
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBe(0);
  });

  it("raises fewer tongues from crowns as the fire weakens", () => {
    const { camera, fire, mirror } = createScene();

    const cell = cellWithLivingTree(mirror);

    setBurning(mirror, new Map([[cell, 0.9]]));
    fire.update(mirror, camera, 0);

    const fierce = fire.flameCount;

    setBurning(mirror, new Map([[cell, 0.2]]));
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBeGreaterThan(0);
    expect(fire.flameCount).toBeLessThan(fierce);
  });

  it("burns what is left of a burnt crown until the cell is scorched", () => {
    const { camera, fire, mirror } = createScene();

    const cell = cellWithLivingTree(mirror);

    burnTreesIn(mirror, cell);
    setScorch(mirror, cell, 0.65);
    setBurning(mirror, new Map([[cell, 0.25]]));
    fire.update(mirror, camera, 0);

    const smoldering = fire.flameCount;

    setScorch(mirror, cell, 1);
    setBurning(mirror, new Map([[cell, 0.25]]));
    fire.update(mirror, camera, 0);

    expect(smoldering).toBeGreaterThan(0);
    expect(fire.flameCount).toBe(0);
  });

  it("puffs smoke over about one burning cell in five", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, burningRange(0, 200, 0.5));
    fire.update(mirror, camera, 0);

    const columns = fire.puffCount / LIGHT_SMOKE_PUFFS;

    expect(Number.isInteger(columns)).toBe(true);
    expect(columns).toBeGreaterThan(20);
    expect(columns).toBeLessThan(60);
  });

  it("throws sparks from about a third of the fiercely burning cells", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, burningRange(0, 120, 0.8));
    fire.update(mirror, camera, 0);

    const sparkingCells = fire.sparkCount / SPARKS_PER_CELL;

    expect(sparkingCells).toBeGreaterThan(20);
    expect(sparkingCells).toBeLessThan(60);
  });

  it("throws no sparks from weak fires", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, burningRange(0, 120, 0.2));
    fire.update(mirror, camera, 0);

    expect(fire.sparkCount).toBe(0);
  });

  it("keeps the flames until the simulation moves on", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, new Map([[cellWithoutPlants(mirror), 0.9]]));
    fire.update(mirror, camera, 0);
    mirror.frame = { ...mirror.frame, burningCells: new Int32Array(0), burningIntensity: new Uint8Array(0) };
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBe(2);
  });

  it("follows the camera while the simulation is paused", () => {
    const { camera, fire, mirror } = createScene();

    setBurning(mirror, new Map([[cellWithoutPlants(mirror), 0.9]]));
    fire.update(mirror, camera, 0);
    mirror.frame = { ...mirror.frame, burningCells: new Int32Array(0), burningIntensity: new Uint8Array(0) };
    camera.position.x += 400;
    fire.update(mirror, camera, 0);

    expect(fire.flameCount).toBe(0);
  });

  it("burns lit campfires and lights the three nearest once it gets dark", () => {
    const { camera, fire, mirror } = createScene();

    const campfires = [400, 0, -300, 120, 50].map((x, id) => {
      return { ...CAMPFIRE, id, x };
    });

    setBurning(mirror, new Map());
    fire.update(mirror, camera, 0);

    const unlit = fire.flameCount;

    setBurning(mirror, new Map(), campfires);
    fire.update(mirror, camera, 0);

    const lit = fire.flameCount;

    setBurning(mirror, new Map(), [...campfires, { ...CAMPFIRE, fuel: 0, id: 9, x: 10 }]);
    fire.update(mirror, camera, 0);

    expect(lit).toBeGreaterThan(unlit);
    expect(fire.flameCount).toBe(lit);
    expect(litSpots(fire)).toEqual([]);

    fire.update(mirror, camera, 1);

    expect(litSpots(fire)).toEqual([
      [0, 300],
      [50, 300],
      [120, 300],
    ]);
  });
});
