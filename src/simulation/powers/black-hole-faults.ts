import { Ground } from "../../content/grounds.ts";
import { FULL_TURN, hashToUnit, smoothstep } from "../../shared/math.ts";
import { createNoiseSampler } from "../../shared/noise.ts";
import { createRandom } from "../../shared/random.ts";
import type { BlackHoleEffect } from "../effects.ts";
import type { WorldState } from "../world/world-state.ts";

const BEARINGS = 192;
const UNEDITABLE_RIM_CELLS = 2;

const BEDROCK = createNoiseSampler(createRandom(3181));
const BLOCK_DETAIL = { octaves: 2 };

type FaultCell = (cell: number, x: number, z: number, distance: number, faultRadius: number, uplift: number) => void;

export function visitBlackHoleFaults(world: WorldState, hole: BlackHoleEffect, reach: number, visit: FaultCell): void {
  const { grid } = world;
  const bounds = grid.circleBounds(hole.x, hole.z, reach);
  const phase = hashToUnit(hole.x, hole.z) * FULL_TURN;
  const radii = new Float32Array(BEARINGS + 1);
  const uplift = new Float32Array(BEARINGS + 1);

  for (let sample = 0; sample <= BEARINGS; sample += 1) {
    const angle = (sample * FULL_TURN) / BEARINGS - Math.PI;
    const plate = Math.cos(angle * 3 + phase);
    const fault = Math.sin(angle * 5 - phase);

    radii[sample] = hole.radius * (0.81 + 0.11 * plate + 0.08 * Math.sin(2 * angle - phase) + 0.05 * fault);
    uplift[sample] = smoothstep(-0.42, 0.62, plate + 0.45 * fault);
  }

  const squaredReach = reach * reach;

  for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
    const z = grid.centerZ(row);
    const deltaZ = z - hole.z;

    for (let column = bounds.firstColumn; column <= bounds.lastColumn; column += 1) {
      const cell = grid.index(column, row);
      const x = grid.centerX(column);
      const deltaX = x - hole.x;
      const squared = deltaX * deltaX + deltaZ * deltaZ;

      if (squared > squaredReach || !world.isOnIsland(cell)) {
        continue;
      }

      const bearing = ((Math.atan2(deltaZ, deltaX) + Math.PI) / FULL_TURN) * BEARINGS;
      const sample = Math.min(BEARINGS - 1, Math.floor(bearing));
      const blend = bearing - sample;
      const faultRadius = radii[sample] + (radii[sample + 1] - radii[sample]) * blend;
      const ridge = uplift[sample] + (uplift[sample + 1] - uplift[sample]) * blend;

      visit(cell, x, z, Math.sqrt(squared), Math.min(hole.radius, faultRadius), ridge);
    }
  }
}

function exposeSediment(world: WorldState, cell: number, bed: number): void {
  if (world.terrain.ground[cell] !== Ground.Rock || world.isWater(cell)) {
    return;
  }

  const bedding = bed + world.terrain.variation[cell] * 0.2;
  const isSediment = (bedding > 0.29 && bedding < 0.38) || (bedding > 0.48 && bedding < 0.57);

  if (isSediment) {
    world.setGround(cell, world.terrain.dryness[cell] > 0.5 ? Ground.RedRock : Ground.Clay);
  }
}

export function shiftBlackHoleTerrain(world: WorldState, hole: BlackHoleEffect, phase: "fracture" | "collapse"): void {
  const { grid } = world;
  const radius = Math.max(grid.cellSize, hole.radius);
  const depth = (radius * 0.72) / (1 + radius / 900);
  const margin = grid.cellSize * UNEDITABLE_RIM_CELLS;
  const blockSize = Math.max(grid.cellSize * 3, radius * 0.24);

  visitBlackHoleFaults(world, hole, radius, (cell, x, z, distance, faultRadius, ridge) => {
    const position = distance / Math.max(grid.cellSize, faultRadius);

    if (position >= 1 || !grid.isInside(x, z, margin)) {
      return;
    }

    const block = BEDROCK.fractal(x / blockSize, z / blockSize, BLOCK_DETAIL);
    const interior = 1 - smoothstep(0.75, 1, position);
    const bed = position + block * interior * 0.095;
    let displacement: number;

    if (phase === "fracture") {
      const shoulder = smoothstep(0.37, 0.7, bed) * (1 - smoothstep(0.73, 1, position));

      const tiltedSlab = smoothstep(0.24, 0.43, bed) * (1 - smoothstep(0.51, 0.72, bed));

      displacement = shoulder * (ridge * 0.55 - 0.23 + block * 0.13) + tiltedSlab * ridge * 0.47;
    } else {
      const core = 1 - smoothstep(0.19, 0.3, bed);
      const innerShelf = 1 - smoothstep(0.395, 0.46, bed);
      const outerShelf = 1 - smoothstep(0.59, 0.69, bed);
      const flank = 1 - smoothstep(0.74, 1, position);

      displacement = block * interior * 0.07 - (core * 0.38 + innerShelf * 0.29 + outerShelf * 0.21 + flank * 0.12);

      exposeSediment(world, cell, bed);
    }

    if (displacement !== 0) {
      world.setHeight(cell, world.terrain.height[cell] + depth * displacement);
    }
  });

  world.finishHeightEdit(grid.circleBounds(hole.x, hole.z, radius));
}
