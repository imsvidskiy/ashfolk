import { Frustum, Matrix4, PerspectiveCamera } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { WorldMirror } from "../../game/world-mirror.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld, floodStrip, fordAcross } from "../../simulation/testing/test-world.ts";
import type { Crossing } from "../../world/crossings.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { drawnInstances } from "../testing/drawn-meshes.ts";
import { CrossingView } from "./crossing-view.ts";

const GROUND = 100;
const RIVER_HALF_WIDTH = 20;
const RIVER_DEPTH = 1.5;

const LOG: Crossing = {
  endDeck: 101.2,
  endX: 25,
  endZ: 10,
  id: 0,
  kind: "log",
  seed: 0.3,
  startDeck: 101.2,
  startX: -25,
  startZ: 10,
};

interface Drawn {
  readonly foam: number;
  readonly pieces: number;
}

function createView(crossing: Crossing): CrossingView {
  const simulation = new Simulation(
    createVegetatedWorld({
      crossings: [crossing],
      dimensions: { cellSize: 10, cellsPerSide: 64 },
      heightAt: () => {
        return GROUND;
      },
    })
  );

  floodStrip(simulation.world, RIVER_HALF_WIDTH, RIVER_DEPTH);

  const mirror = new WorldMirror(simulation.initialWorld(), 0);

  return new CrossingView(mirror, new TerrainTextures(mirror));
}

function drawnFrom(view: CrossingView, height: number): Drawn {
  const camera = new PerspectiveCamera(60, 1.5, 1, 40_000);

  camera.position.set(0, GROUND + height, 1);
  camera.lookAt(0, GROUND, 0);
  camera.updateMatrixWorld();

  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );

  view.update(camera, frustum, 1);

  return { foam: drawnInstances(view.group, "foamPlacement"), pieces: drawnInstances(view.group, "crossingPlacement") };
}

describe("crossing view", () => {
  it("draws a ford with gravel and foam up close and only its stones from afar", () => {
    const view = createView(fordAcross(-24, 24, 0));

    const near = drawnFrom(view, 20);
    const far = drawnFrom(view, 1000);

    expect(near.foam).toBeGreaterThan(0);
    expect(far.foam).toBe(0);
    expect(far.pieces).toBeGreaterThan(0);
    expect(near.pieces).toBeGreaterThan(far.pieces);
  });

  it("draws a log bridge as a single log without foam", () => {
    const view = createView(LOG);

    expect(drawnFrom(view, 20)).toEqual({ foam: 0, pieces: 1 });
  });

  it("draws nothing once the crossing is out of reach", () => {
    const view = createView(fordAcross(-24, 24, 0));

    expect(drawnFrom(view, 5000)).toEqual({ foam: 0, pieces: 0 });
  });
});
