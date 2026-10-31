import { WorldMirror } from "../../game/world-mirror.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { AgentMarkers } from "../agents/agent-markers.ts";
import type { AgentViewInput } from "../agents/agent-view-input.ts";
import { CameraAxes } from "../effects/billboards.ts";
import { HandMotion } from "../hand-motion.ts";
import { cameraAbove } from "./camera-above.ts";

export function createPopulatedMirror(): WorldMirror {
  const simulation = new Simulation(createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 96 } }));

  simulation.populate();

  const mirror = new WorldMirror(simulation.initialWorld(), 0);

  mirror.apply(simulation.advance(0.05), 0);

  return mirror;
}

export function agentInputAbove(mirror: WorldMirror, x: number, z: number, height: number): AgentViewInput {
  const { camera, frustum } = cameraAbove(mirror, x, z, height);

  return {
    camera,
    detail: 1,
    frustum,
    gameSeconds: 0,
    hand: new HandMotion(),
    highlighted: null,
    markers: new AgentMarkers(new CameraAxes(), mirror),
    mirror,
    realSeconds: 0,
    secondsSinceTick: 0,
  };
}
