import { Biome } from "./src/content/biomes.ts";
import { DEFAULT_GENERATION_OPTIONS } from "./src/generation/generation-options.ts";
import { generateWorld } from "./src/generation/world-generator.ts";
import { Simulation } from "./src/simulation/simulation.ts";

const seed = Number(process.argv[2] ?? 7);

let start = performance.now();
const generated = generateWorld(seed, DEFAULT_GENERATION_OPTIONS);
console.log(`generate ${generated.terrain.height.length} cells: ${(performance.now() - start).toFixed(0)} ms`);

start = performance.now();
const simulation = new Simulation(generated);
console.log(`new Simulation: ${(performance.now() - start).toFixed(0)} ms`);

const { world } = simulation;
const { grid } = world;
console.log(`plants alive ${world.vegetation.aliveCount} of capacity slots ${world.vegetation.count}`);

const forestCells: number[] = [];
const landCells: number[] = [];
for (let cell = 0; cell < grid.cellCount; cell += 7) {
  if (!world.isOnIsland(cell) || world.isWater(cell)) continue;
  landCells.push(cell);
  if (world.terrain.biome[cell] === Biome.Forest || world.terrain.biome[cell] === Biome.Taiga) forestCells.push(cell);
}

const TRIBES = Number(process.argv[3] ?? 6);
const HERDS = Number(process.argv[4] ?? 0);
for (let tribe = 0; tribe < TRIBES; tribe += 1) {
  const cell = landCells[Math.floor(((tribe + 0.5) / TRIBES) * landCells.length)];
  simulation.usePower("tribe", grid.cellCenterX(cell), grid.cellCenterZ(cell), { people: 16 });
}
const KINDS = ["deer", "hare", "ibex", "wolf", "mammoth"] as const;
for (let herd = 0; herd < HERDS; herd += 1) {
  const cell = landCells[Math.floor(((herd + 0.25) / HERDS) * landCells.length)];
  simulation.usePower(KINDS[herd % KINDS.length], grid.cellCenterX(cell), grid.cellCenterZ(cell), { herdSize: 12 });
}

function measure(label: string, ticks: number): void {
  const times: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const t = performance.now();
    simulation.step();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const max = times[times.length - 1];
  console.log(
    `${label.padEnd(44)} mean ${mean.toFixed(2)} ms  p95 ${p95.toFixed(2)} ms  max ${max.toFixed(2)} ms  | people ${simulation.society.people.length} animals ${simulation.fauna.animals.length} burning ${simulation.fire.burningCount}`
  );
}

function frameCost(label: string): void {
  const t = performance.now();
  const frame = simulation.advance(0);
  const ms = performance.now() - t;
  let bytes = 0;
  const seen = new Set<ArrayBufferLike>();
  const walk = (value: unknown): void => {
    if (ArrayBuffer.isView(value)) {
      if (!seen.has(value.buffer)) {
        seen.add(value.buffer);
        bytes += value.byteLength;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(frame);
  const json = JSON.stringify(frame, (_, v) => (ArrayBuffer.isView(v) ? null : v)).length;
  console.log(`${label.padEnd(44)} build+0 ticks ${ms.toFixed(2)} ms, typed ${(bytes / 1024).toFixed(0)} KB, objects ~${(json / 1024).toFixed(0)} KB json`);
}

measure("warm-up", 300);
measure("calm", 300);
frameCost("frame (calm)");

for (let i = 0; i < 40; i += 1) {
  const cell = forestCells[Math.floor((i / 40) * forestCells.length)];
  simulation.fire.ignite(cell, 0.9);
}
measure("fire starting (40 ignitions in forest)", 300);
measure("fire spreading", 600);
frameCost("frame (fire)");
measure("fire later", 600);

const center = landCells[Math.floor(landCells.length / 2)];
simulation.usePower("tornado", grid.cellCenterX(center), grid.cellCenterZ(center), { radius: 140 });
measure("fire + tornado r=140", 100);

const mem = process.memoryUsage();
console.log(`rss ${(mem.rss / 1e6).toFixed(0)} MB, heapUsed ${(mem.heapUsed / 1e6).toFixed(0)} MB, arrayBuffers ${(mem.arrayBuffers / 1e6).toFixed(0)} MB`);
