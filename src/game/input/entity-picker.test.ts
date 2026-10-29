import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { PlantSpecies } from "../../content/plants.ts";
import type { Selection } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { Simulation } from "../../simulation/simulation.ts";
import { createVegetatedWorld } from "../../simulation/testing/test-world.ts";
import { PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { createVegetationChannels, PlantState, type VegetationBuffers } from "../../world/vegetation-store.ts";
import { CENTER, cameraLookingAt, VIEWPORT } from "../testing/view-fixtures.ts";
import { EntityPicker } from "./entity-picker.ts";
import { GroundPicker, type HeightField } from "./ground-picker.ts";

const WORLD_HALF_SIZE = 2000;
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
  const camera = new PerspectiveCamera(45, VIEWPORT.width / VIEWPORT.height, 1, 40_000);

  camera.position.set(0, 4000, 3000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  return camera;
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
});
