import { Biome } from "./src/content/biomes.ts";
import { DEFAULT_GENERATION_OPTIONS } from "./src/generation/generation-options.ts";
import { generateWorld } from "./src/generation/world-generator.ts";
import { Simulation } from "./src/simulation/simulation.ts";
import { buffersWithin } from "./src/shared/buffers.ts";

const simulation = new Simulation(generateWorld(7, DEFAULT_GENERATION_OPTIONS));
const { world } = simulation;
const { grid } = world;
const land: number[] = [];
const forest: number[] = [];
for (let cell = 0; cell < grid.cellCount; cell += 7) {
  if (!world.isOnIsland(cell) || world.isWater(cell)) continue;
  land.push(cell);
  if (world.terrain.biome[cell] === Biome.Forest || world.terrain.biome[cell] === Biome.Taiga) forest.push(cell);
}
for (let t = 0; t < 60; t += 1) {
  const cell = land[Math.floor(((t + 0.5) / 60) * land.length)];
  simulation.usePower("tribe", grid.cellCenterX(cell), grid.cellCenterZ(cell), { people: 16 });
}
for (let h = 0; h < 80; h += 1) {
  const cell = land[Math.floor(((h + 0.25) / 80) * land.length)];
  simulation.usePower(["deer", "hare", "ibex"][h % 3] as "deer", grid.cellCenterX(cell), grid.cellCenterZ(cell), { herdSize: 6 });
}
simulation.initialWorld();
simulation.runTicks(300);
simulation.advance(0);

function run(label: string, speed: number, frames: number): void {
  simulation.setSpeed(speed);
  let total = 0;
  let worst = 0;
  let bytes = 0;
  let worstBytes = 0;
  const startTick = simulation.tick;
  for (let f = 0; f < frames; f += 1) {
    const t = performance.now();
    const frame = simulation.advance(1 / 60);
    const ms = performance.now() - t;
    total += ms;
    worst = Math.max(worst, ms);
    let b = 0;
    for (const buffer of buffersWithin(frame)) b += buffer.byteLength;
    bytes += b;
    worstBytes = Math.max(worstBytes, b);
  }
  console.log(
    `${label.padEnd(30)} ${(total / frames).toFixed(2)} ms/advance (worst ${worst.toFixed(1)}), ticks/advance ${((simulation.tick - startTick) / frames).toFixed(2)}, transfer mean ${(bytes / frames / 1024).toFixed(0)} KB worst ${(worstBytes / 1024).toFixed(0)} KB | people ${simulation.society.people.length} animals ${simulation.fauna.animals.length} burning ${simulation.fire.burningCount}`
  );
}

run("speed 1 calm", 1, 600);
run("speed 16 calm", 16, 600);
for (let i = 0; i < 60; i += 1) simulation.fire.ignite(forest[Math.floor((i / 60) * forest.length)], 0.95);
run("speed 1 fire", 1, 300);
run("speed 16 fire", 16, 600);
simulation.usePower("rain", grid.cellCenterX(land[land.length >> 1]), grid.cellCenterZ(land[land.length >> 1]), {});
run("speed 16 after rain", 16, 300);
