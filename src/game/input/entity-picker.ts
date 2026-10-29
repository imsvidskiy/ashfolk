import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import { FIGURE_SCALE } from "../../models/people/human-proportions.ts";
import type { Selection } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { type GrabTarget, isGrabbablePlant } from "../../simulation/hand/grab-target.ts";
import { ANIMAL_STRIDE, AnimalField, PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { PlantState, type VegetationBuffers } from "../../world/vegetation-store.ts";
import type { HeightField, ScreenPoint, ViewportSize } from "./ground-picker.ts";
import { normalizedToPixels, projectToNormalized } from "./screen-projection.ts";

const PICK_RADIUS_PIXELS = 26;
const PERSON_CENTER_HEIGHT = 0.9 * FIGURE_SCALE;
const ANIMAL_CENTER_HEIGHT = 1.2;
const BUILDING_PICK_RADIUS_PIXELS = 40;
const BUILDING_CENTER_HEIGHT = 1.5;
const BUILDING_PICK_PENALTY_PIXELS = 8;
const SMALLEST_OCCLUSION_MARGIN = 12;
const OCCLUSION_MARGIN_PER_METER = 0.04;
const PLANT_CENTER_SHARE = 0.45;
const PLANT_PICK_PENALTY_PIXELS = 6;
const PLANT_SEARCH_RADIUS = 60;
const PLANT_SEARCH_SLACK = 2;

interface Candidate<Target> {
  readonly distance: number;
  readonly reach: number;
  readonly target: Target;
}

export interface GrabScene {
  readonly frame: SimulationFrame;
  readonly plantsNear: (x: number, z: number, radius: number) => readonly number[];
  readonly vegetation: Pick<VegetationBuffers, "count" | "height" | "species" | "state" | "x" | "z">;
}

interface PointerPick {
  readonly ground: Vector3 | null;
  readonly screen: ScreenPoint;
  readonly viewport: ViewportSize;
}

interface ScreenHit {
  readonly distance: number;
  readonly reach: number;
}

interface AgentLayout {
  readonly fields: { readonly Id: number; readonly X: number; readonly Z: number };
  readonly kind: "animal" | "person";
  readonly lift: number;
  readonly stride: number;
}

const PEOPLE: AgentLayout = { fields: PersonField, kind: "person", lift: PERSON_CENTER_HEIGHT, stride: PERSON_STRIDE };
const ANIMALS: AgentLayout = { fields: AnimalField, kind: "animal", lift: ANIMAL_CENTER_HEIGHT, stride: ANIMAL_STRIDE };

function* everyPlant(count: number): Generator<number> {
  for (let plant = 0; plant < count; plant += 1) {
    yield plant;
  }
}

function plantsToSearch(scene: GrabScene, ground: Vector3 | null, radius: number): Iterable<number> {
  if (ground !== null) {
    return scene.plantsNear(ground.x, ground.z, radius);
  }

  return everyPlant(scene.vegetation.count);
}

export class EntityPicker {
  readonly #camera: PerspectiveCamera;
  readonly #heightAt: HeightField;
  readonly #point = new Vector3();
  readonly #projected = new Vector3();

  constructor(camera: PerspectiveCamera, heightAt: HeightField) {
    this.#camera = camera;
    this.#heightAt = heightAt;
  }

  pick(frame: SimulationFrame, screen: ScreenPoint, viewport: ViewportSize, ground: Vector3 | null): Selection | null {
    const pointer = { ground, screen, viewport };

    const nearest = this.#nearest(ground, [
      ...this.#agents(frame.people, frame.personCount, PEOPLE, pointer),
      ...this.#agents(frame.animals, frame.animalCount, ANIMALS, pointer),
      ...this.#buildings(frame, pointer),
    ]);

    if (nearest !== null) {
      return nearest;
    }

    if (ground === null) {
      return null;
    }

    return { kind: "cell", x: ground.x, z: ground.z };
  }

  pickGrabbable(
    scene: GrabScene,
    screen: ScreenPoint,
    viewport: ViewportSize,
    ground: Vector3 | null
  ): GrabTarget | null {
    const { frame } = scene;

    const pointer = { ground, screen, viewport };

    return this.#nearest(ground, [
      ...this.#agents(frame.animals, frame.animalCount, ANIMALS, pointer),
      ...this.#agents(frame.people, frame.personCount, PEOPLE, pointer),
      ...this.#grabbablePlants(scene, pointer),
    ]);
  }

  #nearest<Target>(ground: Vector3 | null, candidates: readonly Candidate<Target>[]): Target | null {
    const visibleReach = this.#visibleReach(ground);

    let nearest: Candidate<Target> | null = null;

    for (const candidate of candidates) {
      const isCloser = nearest === null || candidate.distance < nearest.distance;

      if (candidate.reach <= visibleReach && isCloser) {
        nearest = candidate;
      }
    }

    if (nearest === null) {
      return null;
    }

    return nearest.target;
  }

  #agents(
    data: Float32Array,
    count: number,
    layout: AgentLayout,
    pointer: PointerPick
  ): Candidate<{ id: number; kind: AgentLayout["kind"] }>[] {
    const { fields, kind, lift, stride } = layout;

    const candidates: Candidate<{ id: number; kind: AgentLayout["kind"] }>[] = [];

    for (let agent = 0; agent < count; agent += 1) {
      const offset = agent * stride;

      const x = data[offset + fields.X];
      const z = data[offset + fields.Z];

      const hit = this.#screenHit(x, this.#heightAt(x, z) + lift, z, pointer);

      if (hit.distance < PICK_RADIUS_PIXELS) {
        candidates.push({ ...hit, target: { id: data[offset + fields.Id], kind } });
      }
    }

    return candidates;
  }

  #buildings(frame: SimulationFrame, pointer: PointerPick): Candidate<Selection>[] {
    const candidates: Candidate<Selection>[] = [];

    for (const building of frame.buildings) {
      const height = this.#heightAt(building.x, building.z) + BUILDING_CENTER_HEIGHT;
      const hit = this.#screenHit(building.x, height, building.z, pointer);

      if (hit.distance < BUILDING_PICK_RADIUS_PIXELS) {
        candidates.push({
          distance: hit.distance + BUILDING_PICK_PENALTY_PIXELS,
          reach: hit.reach,
          target: { id: building.id, kind: "building" },
        });
      }
    }

    return candidates;
  }

  #grabbablePlants(scene: GrabScene, pointer: PointerPick): Candidate<GrabTarget>[] {
    const { vegetation } = scene;
    const { ground } = pointer;

    const searchRadius = this.#plantSearchRadius(pointer);

    const candidates: Candidate<GrabTarget>[] = [];

    for (const plant of plantsToSearch(scene, ground, searchRadius)) {
      const x = vegetation.x[plant];
      const z = vegetation.z[plant];

      const isFar = ground !== null && Math.max(Math.abs(x - ground.x), Math.abs(z - ground.z)) > searchRadius;

      if (isFar || vegetation.state[plant] !== PlantState.Alive || !isGrabbablePlant(vegetation.species[plant])) {
        continue;
      }

      const height = this.#heightAt(x, z) + vegetation.height[plant] * PLANT_CENTER_SHARE;
      const hit = this.#screenHit(x, height, z, pointer);

      if (hit.distance < PICK_RADIUS_PIXELS) {
        candidates.push({
          distance: hit.distance + PLANT_PICK_PENALTY_PIXELS,
          reach: hit.reach,
          target: { id: plant, kind: "plant" },
        });
      }
    }

    return candidates;
  }

  #plantSearchRadius({ ground, viewport }: PointerPick): number {
    if (ground === null) {
      return PLANT_SEARCH_RADIUS;
    }

    const reach = this.#camera.position.distanceTo(ground);
    const halfView = Math.tan((this.#camera.fov * Math.PI) / 360);
    const metersPerPixel = (2 * reach * halfView) / Math.max(1, viewport.height);

    return Math.max(PLANT_SEARCH_RADIUS, metersPerPixel * PICK_RADIUS_PIXELS * PLANT_SEARCH_SLACK);
  }

  #visibleReach(ground: Vector3 | null): number {
    if (ground === null) {
      return Number.POSITIVE_INFINITY;
    }

    const reach = this.#camera.position.distanceTo(ground);

    return reach + Math.max(SMALLEST_OCCLUSION_MARGIN, reach * OCCLUSION_MARGIN_PER_METER);
  }

  #screenHit(x: number, y: number, z: number, pointer: PointerPick): ScreenHit {
    const { screen, viewport } = pointer;

    const point = this.#point.set(x, y, z);

    const reach = this.#camera.position.distanceTo(point);
    const projected = projectToNormalized(this.#camera, point.x, point.y, point.z, this.#projected);

    if (projected === null) {
      return { distance: Number.POSITIVE_INFINITY, reach };
    }

    const pixels = normalizedToPixels(projected, viewport);

    return { distance: Math.hypot(pixels.x - screen.x, pixels.y - screen.y), reach };
  }
}
