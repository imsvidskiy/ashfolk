import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import { FIGURE_SCALE } from "../../models/people/human-proportions.ts";
import type { Selection } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import type { GrabTarget } from "../../simulation/hand/grab-target.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { createVegetationChannels, PlantState, type VegetationBuffers } from "../../world/vegetation-store.ts";
import type { GroundPoint } from "../camera/god-camera.ts";
import { CENTER, cameraLookingAt, VIEWPORT } from "../testing/view-fixtures.ts";
import { EntityPicker } from "./entity-picker.ts";
import { GroundPicker, type HeightField, type ScreenPoint } from "./ground-picker.ts";
import { normalizedToPixels, projectToNormalized } from "./screen-projection.ts";

const WORLD_HALF_SIZE = 2000;
const WIDE_WORLD_HALF_SIZE = 4000;
const MINIMUM_PITCH = 0.08;
const EMPTY_FRAME = new Simulation(
  createVegetatedWorld({ dimensions: { cellSize: 10, cellsPerSide: 32 } })
).initialWorld().frame;

function frameWithPeople(...positions: readonly (readonly [number, number])[]): SimulationFrame {
  return {
    ...EMPTY_FRAME,
    animalCount: 0,
    buildings: [],
    people: peopleAt(...positions),
    personCount: positions.length,
  };
}

function ridgeHeight(x: number, z: number): number {
  const isOnRidge = Math.abs(x) < 500 && Math.abs(z - 120) < 30;

  return isOnRidge ? 200 : 0;
}

function peopleAt(...positions: readonly (readonly [number, number])[]): Float32Array {
  const people = new Float32Array(positions.length * PERSON_STRIDE);

  for (const [index, [x, z]] of positions.entries()) {
    people[index * PERSON_STRIDE + PersonField.Id] = index + 1;
    people[index * PERSON_STRIDE + PersonField.X] = x;
    people[index * PERSON_STRIDE + PersonField.Z] = z;
  }

  return people;
}

function plantAt(species: number, x: number, z: number): VegetationBuffers {
  const vegetation = { ...createVegetationChannels(1), count: 1 };

  vegetation.species[0] = species;
  vegetation.state[0] = PlantState.Alive;
  vegetation.height[0] = 12;
  vegetation.x[0] = x;
  vegetation.z[0] = z;

  return vegetation;
}

function theOnePlant(): readonly number[] {
  return [0];
}

function everyPlant(): readonly number[] {
  return [0, 1];
}

function twoPlants(species: number, first: GroundPoint, second: GroundPoint): VegetationBuffers {
  const vegetation = { ...createVegetationChannels(2), count: 2 };

  for (const [index, spot] of [first, second].entries()) {
    vegetation.species[index] = species;
    vegetation.state[index] = PlantState.Alive;
    vegetation.height[index] = 12;
    vegetation.x[index] = spot.x;
    vegetation.z[index] = spot.z;
  }

  return vegetation;
}

function lowCamera(): PerspectiveCamera {
  return cameraAt(0, 15, 60, { x: 0, y: 6, z: 0 });
}

function screenOf(camera: PerspectiveCamera, x: number, y: number, z: number): ScreenPoint {
  const normalized = projectToNormalized(camera, x, y, z, new Vector3());

  if (normalized === null) {
    throw new Error("The point should be in front of the camera");
  }

  return normalizedToPixels(normalized, VIEWPORT);
}

function grabFromLowCamera(
  vegetation: VegetationBuffers,
  screen: ScreenPoint,
  ...people: readonly (readonly [number, number])[]
): GrabTarget | null {
  const camera = lowCamera();

  const ground = new GroundPicker(camera, flatGround, WORLD_HALF_SIZE).pick(screen, VIEWPORT);
  const scene = { frame: frameWithPeople(...people), plantsNear: everyPlant, vegetation };

  return new EntityPicker(camera, flatGround).pickGrabbable(scene, screen, VIEWPORT, ground);
}

function besidePersonBehindOak(pixels: number): ScreenPoint {
  const person = screenOf(lowCamera(), 0, 0.9 * FIGURE_SCALE, -20);

  return { x: person.x + pixels, y: person.y };
}

function plantsNearSpots(vegetation: VegetationBuffers) {
  return (spots: readonly GroundPoint[], radius: number): readonly number[] => {
    const isNear = spots.some((spot) => {
      return Math.max(Math.abs(spot.x - vegetation.x[0]), Math.abs(spot.z - vegetation.z[0])) <= radius;
    });

    return isNear ? [0] : [];
  };
}

function horizonCamera(): PerspectiveCamera {
  return cameraAt(0, 20, 3000, { x: 0, y: 20 - Math.tan(MINIMUM_PITCH) * 100, z: 2900 });
}

function crestHeight(x: number, z: number): number {
  return Math.abs(x) < 500 && Math.abs(z + 500) < 20 ? 80 : 0;
}

function peakHeight(x: number, z: number): number {
  return Math.max(0, 100 - 1.25 * Math.hypot(x, z));
}

function wallHeight(_x: number, z: number): number {
  return Math.abs(z) < 2 ? 10 : 0;
}

function cameraAt(x: number, y: number, z: number, target: GroundPoint & { readonly y: number }): PerspectiveCamera {
  const camera = new PerspectiveCamera(45, VIEWPORT.width / VIEWPORT.height, 1, 40_000);

  camera.position.set(x, y, z);
  camera.lookAt(target.x, target.y, target.z);
  camera.updateMatrixWorld();

  return camera;
}

function grabOver(
  heightAt: HeightField,
  camera: PerspectiveCamera,
  vegetation: VegetationBuffers,
  screen: ScreenPoint
) {
  const ground = new GroundPicker(camera, heightAt, WIDE_WORLD_HALF_SIZE).pick(screen, VIEWPORT);
  const scene = { frame: frameWithPeople(), plantsNear: plantsNearSpots(vegetation), vegetation };

  return new EntityPicker(camera, heightAt).pickGrabbable(scene, screen, VIEWPORT, ground);
}

function noPlants(): readonly number[] {
  return [];
}

function grabAt(vegetation: VegetationBuffers, ...people: readonly (readonly [number, number])[]) {
  const camera = cameraLookingAt(0, 0);

  const ground = new GroundPicker(camera, flatGround, WORLD_HALF_SIZE).pick(CENTER, VIEWPORT);

  return new EntityPicker(camera, flatGround).pickGrabbable(
    { frame: frameWithPeople(...people), plantsNear: theOnePlant, vegetation },
    CENTER,
    VIEWPORT,
    ground
  );
}

function farCamera(): PerspectiveCamera {
  return cameraAt(0, 4000, 3000, { x: 0, y: 0, z: 0 });
}

function flatGround(): number {
  return 0;
}

function pickAt(heightAt: HeightField, ...positions: readonly (readonly [number, number])[]): Selection | null {
  const camera = cameraLookingAt(0, 0);
  const frame = frameWithPeople(...positions);

  const ground = new GroundPicker(camera, heightAt, WORLD_HALF_SIZE).pick(CENTER, VIEWPORT);

  return new EntityPicker(camera, heightAt).pick(frame, CENTER, VIEWPORT, ground);
}

describe("entity picker", () => {
  it("picks the person under the pointer", () => {
    expect(
      pickAt(() => {
        return 0;
      }, [0, 0])
    ).toEqual({ id: 1, kind: "person" });
  });

  it("falls back to the ground when nobody is near the pointer", () => {
    const selection = pickAt(() => {
      return 0;
    }, [300, 0]);

    expect(selection).toMatchObject({ kind: "cell" });
  });

  it("ignores a person hidden behind a ridge", () => {
    expect(pickAt(ridgeHeight, [0, 0])).toMatchObject({ kind: "cell" });
  });

  it("ignores people behind the camera", () => {
    const camera = cameraLookingAt(0, 0);
    const frame = frameWithPeople([0, 900]);

    const picker = new EntityPicker(camera, () => {
      return 0;
    });

    expect(picker.pick(frame, CENTER, VIEWPORT, new Vector3(0, 0, 0))).toMatchObject({ kind: "cell" });
  });

  it("picks a tree under the pointer to grab", () => {
    expect(grabAt(plantAt(PlantSpecies.Oak, 0, -4))).toEqual({ id: 0, kind: "plant" });
  });

  it("grabs a person before the tree behind them", () => {
    expect(grabAt(plantAt(PlantSpecies.Oak, 0, -4), [0, 0])).toEqual({ id: 1, kind: "person" });
  });

  it("grabs a crown in front of a person beside the pointer", () => {
    expect(grabFromLowCamera(plantAt(PlantSpecies.Oak, 0, 0), besidePersonBehindOak(18), [0, -20])).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("grabs a person right under the pointer before a crown in front of them", () => {
    expect(grabFromLowCamera(plantAt(PlantSpecies.Oak, 0, 0), besidePersonBehindOak(6), [0, -20])).toEqual({
      id: 1,
      kind: "person",
    });
  });

  it("reaches a tree under the pointer near the horizon in a low view", () => {
    const camera = horizonCamera();
    const vegetation = plantAt(PlantSpecies.Oak, 0, 0);
    const screen = screenOf(camera, 0, 1, 0);
    const ground = new GroundPicker(camera, flatGround, WIDE_WORLD_HALF_SIZE).pick(screen, VIEWPORT);
    const scene = { frame: frameWithPeople(), plantsNear: plantsNearSpots(vegetation), vegetation };

    expect(ground?.distanceTo(camera.position)).toBeGreaterThan(2600);
    expect(new EntityPicker(camera, flatGround).pickGrabbable(scene, screen, VIEWPORT, ground)).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("reaches a tree on a crest that stands above both the camera's ground and the pointer's", () => {
    const camera = cameraAt(0, 120, 0, { x: 0, y: 95, z: -500 });
    const vegetation = plantAt(PlantSpecies.Oak, 0, -500);

    vegetation.height[0] = 20;

    expect(grabOver(crestHeight, camera, vegetation, screenOf(camera, 0, 95, -500))).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("reaches a crown against the sky on a peak whose flanks fall away beside the trunk", () => {
    const camera = cameraAt(2, 130, 300, { x: 2, y: 120, z: 0 });
    const vegetation = plantAt(PlantSpecies.Spruce, 0, 0);
    const scene = { frame: frameWithPeople(), plantsNear: plantsNearSpots(vegetation), vegetation };

    vegetation.height[0] = 30;

    expect(new EntityPicker(camera, peakHeight).pickGrabbable(scene, CENTER, VIEWPORT, null)).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("ignores a tree the ray reaches only after passing through the ground", () => {
    const camera = lowCamera();
    const vegetation = plantAt(PlantSpecies.Oak, 0, -8);

    expect(grabOver(wallHeight, camera, vegetation, screenOf(camera, 0, 9, 2))).toBeNull();
  });

  it("leaves stones and faraway trees alone", () => {
    expect(grabAt(plantAt(PlantSpecies.Boulder, 0, 0))).toBeNull();
    expect(grabAt(plantAt(PlantSpecies.Oak, 300, 0))).toBeNull();
  });

  it("looks only at the plants near the pointer", () => {
    const camera = cameraLookingAt(0, 0);

    const ground = new GroundPicker(camera, flatGround, WORLD_HALF_SIZE).pick(CENTER, VIEWPORT);
    const scene = { frame: frameWithPeople(), plantsNear: noPlants, vegetation: plantAt(PlantSpecies.Oak, 0, -4) };

    expect(new EntityPicker(camera, flatGround).pickGrabbable(scene, CENTER, VIEWPORT, ground)).toBeNull();
  });

  it("reaches a tree a few pixels from the pointer in a far view", () => {
    const camera = farCamera();

    const ground = new GroundPicker(camera, flatGround, WORLD_HALF_SIZE).pick(CENTER, VIEWPORT);
    const scene = { frame: frameWithPeople(), plantsNear: theOnePlant, vegetation: plantAt(PlantSpecies.Oak, 80, 0) };

    expect(new EntityPicker(camera, flatGround).pickGrabbable(scene, CENTER, VIEWPORT, ground)).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("picks a tree by the top of its crown, far from where the ground meets the pointer", () => {
    const vegetation = twoPlants(PlantSpecies.Oak, { x: 0, z: 0 }, { x: 400, z: 0 });
    const screen = screenOf(lowCamera(), 0, 10.5, 0);
    const ground = new GroundPicker(lowCamera(), flatGround, WORLD_HALF_SIZE).pick(screen, VIEWPORT);

    expect(ground?.distanceTo(new Vector3(0, 0, 0))).toBeGreaterThan(40);
    expect(grabFromLowCamera(vegetation, screen)).toEqual({ id: 0, kind: "plant" });
  });

  it("picks a crown against the sky, where the pointer finds no ground", () => {
    const camera = lowCamera();
    const vegetation = twoPlants(PlantSpecies.Oak, { x: 0, z: 0 }, { x: 400, z: 0 });
    const scene = { frame: frameWithPeople(), plantsNear: everyPlant, vegetation };

    const screen = screenOf(camera, 0, 11, 0);

    expect(new EntityPicker(camera, flatGround).pickGrabbable(scene, screen, VIEWPORT, null)).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("picks a crown past the coast in a far view, where the pointer finds no ground", () => {
    const camera = farCamera();
    const vegetation = plantAt(PlantSpecies.Oak, 0, -2000);
    const scene = { frame: frameWithPeople(), plantsNear: plantsNearSpots(vegetation), vegetation };

    const screen = screenOf(camera, 0, 6, -2000);

    expect(new EntityPicker(camera, flatGround).pickGrabbable(scene, screen, VIEWPORT, null)).toEqual({
      id: 0,
      kind: "plant",
    });
  });

  it("picks the nearer crown where two overlap", () => {
    const vegetation = twoPlants(PlantSpecies.Oak, { x: 0, z: -15 }, { x: 0, z: 0 });

    expect(grabFromLowCamera(vegetation, screenOf(lowCamera(), 0, 7, -15))).toEqual({ id: 1, kind: "plant" });
  });

  it("picks a conifer by its cone", () => {
    const vegetation = twoPlants(PlantSpecies.Spruce, { x: 0, z: 0 }, { x: 400, z: 0 });

    expect(grabFromLowCamera(vegetation, screenOf(lowCamera(), 0, 9, 0))).toEqual({ id: 0, kind: "plant" });
  });

  it("picks nothing in the sky or on the ground between trees", () => {
    const vegetation = twoPlants(PlantSpecies.Oak, { x: -30, z: 0 }, { x: 30, z: 0 });

    expect(grabFromLowCamera(vegetation, { x: CENTER.x, y: 4 })).toBeNull();
    expect(grabFromLowCamera(vegetation, screenOf(lowCamera(), 0, 0, 10))).toBeNull();
  });
});
