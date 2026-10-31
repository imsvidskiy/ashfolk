import { describe, expect, it } from "vitest";
import { WorldMirror } from "../../game/world-mirror.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld, floodStrip, fordAcross } from "../../simulation/testing/test-world.ts";
import type { Crossing } from "../../world/crossings.ts";
import { TerrainTextures } from "../terrain/terrain-textures.ts";
import { cameraAbove } from "../testing/camera-above.ts";
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

interface CrossingScene {
  readonly mirror: WorldMirror;
  readonly view: CrossingView;
}

interface Drawn {
  readonly foam: number;
  readonly pieces: number;
}

function createView(crossing: Crossing): CrossingScene {
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

  return { mirror, view: new CrossingView(mirror, new TerrainTextures(mirror)) };
}

function drawnFrom({ mirror, view }: CrossingScene, height: number): Drawn {
  const { camera, frustum } = cameraAbove(mirror, 0, 0, height);

  view.update(camera, frustum, 1);

  return { foam: drawnInstances(view.group, "foamPlacement"), pieces: drawnInstances(view.group, "crossingPlacement") };
}

describe("crossing view", () => {
  it("draws a ford with gravel and foam up close and only its stones from afar", () => {
    const ford = createView(fordAcross(-24, 24, 0));

    const near = drawnFrom(ford, 20);
    const far = drawnFrom(ford, 1000);

    expect(near.foam).toBeGreaterThan(0);
    expect(near.foam).toBeLessThanOrEqual(far.pieces);
    expect(far.foam).toBe(0);
    expect(far.pieces).toBeGreaterThan(0);
    expect(near.pieces).toBeGreaterThan(far.pieces);
  });

  it("draws a log bridge as a single log without foam", () => {
    expect(drawnFrom(createView(LOG), 20)).toEqual({ foam: 0, pieces: 1 });
  });

  it("draws nothing once the crossing is out of reach", () => {
    expect(drawnFrom(createView(fordAcross(-24, 24, 0)), 5000)).toEqual({ foam: 0, pieces: 0 });
  });
});
