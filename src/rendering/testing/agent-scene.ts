import { PerspectiveCamera } from "three/webgpu";
import { WorldMirror } from "../../game/world-mirror.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { AgentMarkers } from "../agents/agent-markers.ts";
import type { AgentViewInput } from "../agents/agent-view-input.ts";
import { CameraAxes } from "../effects/billboards.ts";
import { HandMotion } from "../hand-motion.ts";
import { frustumOf } from "./camera-frustum.ts";

export function createPopulatedMirror(): WorldMirror {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 } }));

  simulation.populate();

  const mirror = new WorldMirror(simulation.initialWorld(), 0);

  mirror.apply(simulation.advance(0.05), 0);

  return mirror;
}

export function agentInputAbove(mirror: WorldMirror, x: number, z: number, height: number): AgentViewInput {
  const camera = new PerspectiveCamera(60, 1.5, 1, 40_000);
  const ground = mirror.heightAt(x, z);

  camera.position.set(x, ground + height, z + 1);
  camera.lookAt(x, ground, z);
  camera.updateMatrixWorld();

  return {
    camera,
    detail: 1,
    frustum: frustumOf(camera),
    gameSeconds: 0,
    hand: new HandMotion(),
    highlighted: null,
    markers: new AgentMarkers(new CameraAxes(), mirror),
    mirror,
    realSeconds: 0,
    secondsSinceTick: 0,
  };
}
