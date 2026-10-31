import { WorldMirror } from "../../game/world-mirror.ts";
import { ignore } from "../../shared/ignore.ts";
import { Simulation } from "../../simulation/simulation.ts";

export function createRoundMirror(): WorldMirror {
  const simulation = Simulation.generate(
    5,
    { dimensions: { cellSize: 20, cellsPerSide: 96 }, erosionStrength: 0.4, shape: "round" },
    ignore
  );

  return new WorldMirror(simulation.initialWorld(), 0);
}
