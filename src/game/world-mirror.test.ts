import { describe, expect, it } from "vitest";
import { allRows, packGroundRows, packSurfaceRows } from "../simulation/frame-packing.ts";
import { Simulation } from "../simulation/simulation.ts";
import {
  centerCell,
  createVegetatedWorld,
  floodCells,
  floodStrip,
  fordAcross,
} from "../simulation/testing/test-world.ts";
import { createVegetationChannels, VEGETATION_CHANNELS, type VegetationBuffers } from "../world/vegetation-store.ts";
import { mirroredWater } from "../world/water.ts";
import { MirroredVegetation, WorldMirror } from "./world-mirror.ts";

const STEP_SECONDS = 0.05;

interface StrokeCommand {
  parameters: Record<string, unknown>;
  powerId: string;
}

function createSimulation(): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({
      dimensions: { cellSize: 10, cellsPerSide: 64 },
      heightAt: (x, z) => {
        return 100 + x * 0.04 + z * 0.02;
      },
    })
  );

  simulation.weather.setKind("clear");

  return simulation;
}

function createValleySimulation(): Simulation {
  const simulation = new Simulation(
    createVegetatedWorld({
      dimensions: { cellSize: 10, cellsPerSide: 96 },
      heightAt: (x, z) => {
        return 200 + Math.abs(x - 5) * 0.25 + z * 0.02;
      },
    })
  );

  simulation.weather.setKind("clear");
  simulation.waterRecomputation.recompute();

  return simulation;
}

function advanceTogether(simulation: Simulation, mirror: WorldMirror, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP_SECONDS) {
    mirror.apply(simulation.advance(STEP_SECONDS), elapsed);
  }
}

function strokeFor(simulation: Simulation, mirror: WorldMirror, command: StrokeCommand, seconds: number): void {
  simulation.execute({ ...command, type: "beginStroke", x: 0, z: 0 });
  advanceTogether(simulation, mirror, seconds);
  simulation.execute({ type: "endStroke" });
}

function emptyVegetation(count: number): VegetationBuffers {
  const vegetation = { ...createVegetationChannels(count), count };

  vegetation.height.fill(3);

  return vegetation;
}

describe("world mirror", () => {
  it("starts from its own copy of the simulation world", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    expect(mirror.terrain.height).toEqual(simulation.world.terrain.height);
    expect(mirror.terrain.height).not.toBe(simulation.world.terrain.height);
    expect(mirror.vegetation.count).toBe(simulation.world.vegetation.count);
  });

  it("follows terrain edits and the water that settles after them", () => {
    const simulation = createSimulation();

    floodStrip(simulation.world, 20, 1.5);

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    strokeFor(simulation, mirror, { parameters: { radius: 60, strength: 100 }, powerId: "raise" }, 0.5);

    expect(mirror.heightChanges.takeRegion()).not.toBeNull();
    expect(mirror.terrain.height).toEqual(simulation.world.terrain.height);
    expect(mirror.waterVersion).toBe(0);

    advanceTogether(simulation, mirror, 1.5);

    expect(mirror.waterVersion).toBe(1);
    expect(mirror.terrain.waterSurface).toEqual(simulation.world.terrain.waterSurface);
    expect(mirror.terrain.riverStrength).toEqual(simulation.world.terrain.riverStrength);
    expect(mirror.water).toEqual(mirroredWater(simulation.world.water));
  });

  it("keeps its water when the land settles without changing it", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    strokeFor(simulation, mirror, { parameters: { radius: 60, strength: 100 }, powerId: "raise" }, 0.5);
    advanceTogether(simulation, mirror, 1.5);

    expect(simulation.waterRecomputation.isPending).toBe(false);
    expect(mirror.waterVersion).toBe(0);
    expect(mirror.terrain.height).toEqual(simulation.world.terrain.height);
    expect(mirror.terrain.waterSurface).toEqual(simulation.world.terrain.waterSurface);
  });

  it("follows a crater lake as it fills by its water levels alone", () => {
    const simulation = createValleySimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    simulation.usePower("meteor", 0, -200, { craterRadius: 140, fallTime: 0.5 });
    advanceTogether(simulation, mirror, 2);

    const versionWhileFilling = mirror.waterVersion;
    const crossingsWhileFilling = mirror.crossings;

    mirror.waterLevelChanges.takeRegion();
    advanceTogether(simulation, mirror, 1);

    expect(mirror.waterVersion).toBe(versionWhileFilling);
    expect(mirror.crossings).toBe(crossingsWhileFilling);
    expect(mirror.waterLevelChanges.takeRegion()).not.toBeNull();
    expect(mirror.terrain.waterSurface).toEqual(simulation.world.terrain.waterSurface);

    advanceTogether(simulation, mirror, 4);

    expect(simulation.waterRecomputation.isPending).toBe(false);
    expect(mirror.waterVersion).toBe(versionWhileFilling + 1);
    expect(mirror.terrain.waterSurface).toEqual(simulation.world.terrain.waterSurface);
  });

  it("carries the crossings and drops them when the water they spanned is gone", () => {
    const ford = fordAcross(-24, 24, 0);
    const simulation = new Simulation(
      createVegetatedWorld({ crossings: [ford], dimensions: { cellSize: 10, cellsPerSide: 64 } })
    );

    floodStrip(simulation.world, 20, 1.5);

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    expect(mirror.crossings).toEqual([ford]);
    expect(mirror.crossingAt(0, 0.4)).toEqual(ford);

    strokeFor(simulation, mirror, { parameters: { radius: 40, strength: 100 }, powerId: "raise" }, 0.3);
    advanceTogether(simulation, mirror, 1.5);

    expect(mirror.waterVersion).toBe(1);
    expect(mirror.crossings).toEqual([]);
    expect(mirror.crossingAt(0, 0.4)).toBeNull();
  });

  it("follows painted ground and the burning surface", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    mirror.surfaceChanges.takeRuns();
    mirror.groundChanges.takeRuns();
    strokeFor(simulation, mirror, { parameters: { intensity: 100, radius: 30 }, powerId: "fire" }, 0.3);
    strokeFor(simulation, mirror, { parameters: { material: "sand", radius: 40 }, powerId: "paint" }, 0.3);
    advanceTogether(simulation, mirror, 1);

    const [surface] = packSurfaceRows(simulation.world, allRows(simulation.world));
    const [ground] = packGroundRows(simulation.world, allRows(simulation.world));

    expect(mirror.surface).toEqual(surface.data);
    expect(mirror.ground).toEqual(ground.data);
    expect(mirror.terrain.ground).toEqual(simulation.world.terrain.ground);
    expect(mirror.surfaceChanges.takeRuns()).not.toHaveLength(0);
    expect(mirror.groundChanges.takeRuns()).not.toHaveLength(0);
  });

  it("follows planted trees past the initial buffer size", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    const initialCount = mirror.vegetation.count;

    strokeFor(simulation, mirror, { parameters: { density: 100, radius: 120 }, powerId: "forest" }, 1);

    const { vegetation } = simulation.world;

    expect(mirror.vegetation.count).toBeGreaterThan(initialCount);
    expect(mirror.vegetation.count).toBe(vegetation.count);
    expect(mirror.vegetation.x.subarray(0, vegetation.count)).toEqual(vegetation.x.subarray(0, vegetation.count));
    expect(mirror.vegetation.state.subarray(0, vegetation.count)).toEqual(
      vegetation.state.subarray(0, vegetation.count)
    );
    expect(mirror.vegetation.takeChangedIndices()).toContain(initialCount);
    expect(mirror.vegetation.takeChangedIndices()).toHaveLength(0);
  });

  it("answers height and water queries like the simulation", () => {
    const simulation = createSimulation();

    const lakeCell = centerCell(simulation.world);

    floodCells(simulation.world, [lakeCell], 2);

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    const { grid } = simulation.world;

    const lakeX = grid.cellCenterX(lakeCell);
    const lakeZ = grid.cellCenterZ(lakeCell);

    expect(mirror.heightAt(123, -45)).toBeCloseTo(simulation.world.heightAt(123, -45));
    expect(mirror.surfaceAt(lakeX, lakeZ)).toBeCloseTo(simulation.world.surfaceAt(lakeX, lakeZ));
    expect(mirror.isWaterAt(lakeX, lakeZ)).toBe(true);
    expect(mirror.isWaterAt(lakeX + 100, lakeZ)).toBe(false);
    expect(mirror.isWaterAt(grid.halfSize + 10, 0)).toBe(false);
  });

  it("counts the changes to the land", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    mirror.apply(simulation.advance(STEP_SECONDS), 0);

    const quietVersion = mirror.landVersion;

    mirror.apply(simulation.advance(STEP_SECONDS), 0);

    expect(mirror.landVersion).toBe(quietVersion);

    strokeFor(simulation, mirror, { parameters: { radius: 60 }, powerId: "raise" }, 0.5);

    expect(mirror.landVersion).toBeGreaterThan(quietVersion);
  });

  it("names the new summit once the raised land settles", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    const { landmarks } = mirror;

    simulation.execute({
      parameters: { radius: 60, strength: 100 },
      powerId: "raise",
      type: "beginStroke",
      x: 0,
      z: 0,
    });
    advanceTogether(simulation, mirror, 1);

    expect(mirror.landmarks).toBe(landmarks);

    simulation.execute({ type: "endStroke" });
    advanceTogether(simulation, mirror, 1.5);

    const [peak] = mirror.landmarks;

    expect(peak).toMatchObject({ id: "peak", name: landmarks[0].name });
    expect(Math.hypot(peak.x, peak.z)).toBeLessThan(20);
    expect(peak.detail).toBe(`${Math.round(mirror.heightAt(peak.x, peak.z))} m`);
    expect(peak.detail).not.toBe(landmarks[0].detail);
    expect(mirror.landmarks).toBe(mirror.landmarks);
  });

  it("names a crater lake once it has filled", () => {
    const simulation = createValleySimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    expect(
      mirror.landmarks.filter((landmark) => {
        return landmark.kind === "lake";
      })
    ).toEqual([]);

    simulation.usePower("meteor", 0, -200, { craterRadius: 140, fallTime: 0.5 });
    advanceTogether(simulation, mirror, 7);

    const lakes = mirror.landmarks.filter((landmark) => {
      return landmark.kind === "lake";
    });

    expect(simulation.isBusy).toBe(false);
    expect(lakes).toHaveLength(1);
    expect(Math.hypot(lakes[0].x, lakes[0].z + 200)).toBeLessThan(140);
  });

  it("measures the game time since the latest tick for smooth motion", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    simulation.execute({ speed: 2, type: "setSpeed" });
    mirror.apply(simulation.advance(0.08), 1000);

    const { secondsSinceTick } = mirror.frame;

    expect(secondsSinceTick).toBeCloseTo(0.06);
    expect(mirror.gameSecondsSinceTick(1000)).toBeCloseTo(secondsSinceTick);
    expect(mirror.gameSecondsSinceTick(1050)).toBeCloseTo(secondsSinceTick + 0.1);
    expect(mirror.gameSecondsSinceTick(9000)).toBeCloseTo(secondsSinceTick + 0.2);
  });

  it("holds the motion still while paused", () => {
    const simulation = createSimulation();

    const mirror = new WorldMirror(simulation.initialWorld(), 0);

    simulation.execute({ isPaused: true, type: "setPaused" });
    mirror.apply(simulation.advance(STEP_SECONDS), 1000);

    expect(mirror.gameSecondsSinceTick(5000)).toBe(mirror.frame.secondsSinceTick);
  });
});

describe("mirrored vegetation", () => {
  it("keeps existing plants when it grows for a patch beyond its size", () => {
    const vegetation = new MirroredVegetation(emptyVegetation(2));

    const patch = {
      bornDay: Float32Array.of(4),
      count: 1,
      fruit: Float32Array.of(0.5),
      height: Float32Array.of(12),
      indices: Int32Array.of(9),
      rotation: Float32Array.of(1),
      seed: Float32Array.of(0.25),
      species: Uint8Array.of(3),
      state: Uint8Array.of(1),
      x: Float32Array.of(40),
      z: Float32Array.of(-40),
    };

    vegetation.apply(patch);

    expect(vegetation.count).toBe(10);
    expect(vegetation.height[0]).toBe(3);

    for (const channel of VEGETATION_CHANNELS) {
      expect(vegetation[channel][9]).toBe(patch[channel][0]);
    }
  });
});
