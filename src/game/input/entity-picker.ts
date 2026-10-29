import { type PerspectiveCamera, type Ray, Raycaster, Vector3 } from "three/webgpu";
import { FIGURE_SCALE } from "../../models/people/human-proportions.ts";
import { distanceToSegment } from "../../shared/math.ts";
import type { Selection } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { type GrabTarget, isGrabbablePlant } from "../../simulation/hand/grab-target.ts";
import { ANIMAL_STRIDE, AnimalField, PERSON_STRIDE, PersonField } from "../../world/agent-buffers.ts";
import { PlantState, type VegetationBuffers } from "../../world/vegetation-store.ts";
import type { GroundPoint } from "../camera/god-camera.ts";
import type { HeightField, ScreenPoint, ViewportSize } from "./ground-picker.ts";
import { measureGrabbablePlants, plantHitDistance } from "./plant-volumes.ts";
import { aimRay, normalizedToPixels, projectToNormalized } from "./screen-projection.ts";

const PICK_RADIUS_PIXELS = 26;
const PERSON_CENTER_HEIGHT = 0.9 * FIGURE_SCALE;
const ANIMAL_CENTER_HEIGHT = 1.2;
const BUILDING_PICK_RADIUS_PIXELS = 40;
const BUILDING_CENTER_HEIGHT = 1.5;
const BUILDING_PICK_PENALTY_PIXELS = 8;
const SMALLEST_OCCLUSION_MARGIN = 12;
const OCCLUSION_MARGIN_PER_METER = 0.04;
const PLANT_SLACK_PIXELS = 12;
const TALLEST_PLANT = 40;
const WIDEST_CROWN = 16;
const SEARCH_SPACING = 80;
const SEARCH_STEP = SEARCH_SPACING / 2;
const CLEARANCE_STEP = 4;
const AGENT_PRIORITY_METERS = 1;
const AGENT_FIRST_PIXELS = 12;

interface Candidate<Target> {
  readonly distance: number;
  readonly reach: number;
  readonly target: Target;
}

export interface GrabScene {
  readonly frame: SimulationFrame;
  readonly plantsNear: (spots: readonly GroundPoint[], radius: number) => Iterable<number>;
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

interface RaySearch {
  readonly farthest: number;
  readonly spots: GroundPoint[];
}

function searchAlong(ray: Ray, end: Vector3, heightAt: HeightField): RaySearch {
  const { origin } = ray;

  const length = origin.distanceTo(end);
  const across = Math.hypot(end.x - origin.x, end.z - origin.z);
  const count = Math.ceil(across / SEARCH_STEP) + 1;
  const point = new Vector3();

  const spots: GroundPoint[] = [];

  let farthest = 0;

  for (let index = 0; index < count; index += 1) {
    const reach = across > 0 ? Math.min(1, (index * SEARCH_STEP) / across) * length : length;

    ray.at(reach, point);

    const clearance = point.y - heightAt(point.x, point.z);

    if (lowestClearance(ray, reach, length / Math.max(across, 1), heightAt) <= TALLEST_PLANT + WIDEST_CROWN) {
      spots.push({ x: point.x, z: point.z });
      farthest = reach;
    }

    if (clearance < 0) {
      break;
    }
  }

  return { farthest, spots };
}

function lowestClearance(ray: Ray, reach: number, reachPerMeter: number, heightAt: HeightField): number {
  const point = new Vector3();

  let lowest = Number.POSITIVE_INFINITY;

  for (let offset = -SEARCH_STEP / 2; offset <= SEARCH_STEP / 2; offset += CLEARANCE_STEP) {
    ray.at(Math.max(0, reach + offset * reachPerMeter), point);
    lowest = Math.min(lowest, point.y - heightAt(point.x, point.z));
  }

  return lowest;
}

export class EntityPicker {
  readonly #camera: PerspectiveCamera;
  readonly #heightAt: HeightField;
  readonly #point = new Vector3();
  readonly #projected = new Vector3();
  readonly #raycaster = new Raycaster();

  constructor(camera: PerspectiveCamera, heightAt: HeightField) {
    this.#camera = camera;
    this.#heightAt = heightAt;
    measureGrabbablePlants();
  }

  pick(frame: SimulationFrame, screen: ScreenPoint, viewport: ViewportSize, ground: Vector3 | null): Selection | null {
    const pointer = { ground, screen, viewport };

    const nearest = this.#nearestCandidate(ground, [
      ...this.#agents(frame.people, frame.personCount, PEOPLE, pointer),
      ...this.#agents(frame.animals, frame.animalCount, ANIMALS, pointer),
      ...this.#buildings(frame, pointer),
    ]);

    if (nearest !== null) {
      return nearest.target;
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

    const agent = this.#nearestCandidate(ground, [
      ...this.#agents(frame.animals, frame.animalCount, ANIMALS, pointer),
      ...this.#agents(frame.people, frame.personCount, PEOPLE, pointer),
    ]);
    const plant = this.#grabbablePlant(scene, pointer);

    if (plant === null) {
      return agent === null ? null : agent.target;
    }

    const isOnAgent = agent !== null && agent.distance <= AGENT_FIRST_PIXELS;

    if (agent === null || (!isOnAgent && plant.reach < agent.reach - AGENT_PRIORITY_METERS)) {
      return plant.target;
    }

    return agent.target;
  }

  #nearestCandidate<Target>(
    ground: Vector3 | null,
    candidates: readonly Candidate<Target>[]
  ): Candidate<Target> | null {
    const visibleReach = this.#visibleReach(ground);

    let nearest: Candidate<Target> | null = null;

    for (const candidate of candidates) {
      const isCloser = nearest === null || candidate.distance < nearest.distance;

      if (candidate.reach <= visibleReach && isCloser) {
        nearest = candidate;
      }
    }

    return nearest;
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

  #grabbablePlant(scene: GrabScene, pointer: PointerPick): Candidate<GrabTarget> | null {
    const { vegetation } = scene;

    const ray = aimRay(this.#raycaster, this.#camera, pointer.screen, pointer.viewport);
    const end = pointer.ground ?? ray.at(this.#camera.far, new Vector3());
    const { origin } = ray;
    const { farthest, spots } = searchAlong(ray, end, this.#heightAt);
    const slackPerMeter =
      (2 * Math.tan((this.#camera.fov * Math.PI) / 360) * PLANT_SLACK_PIXELS) / pointer.viewport.height;
    const groundReach = pointer.ground === null ? Number.POSITIVE_INFINITY : origin.distanceTo(pointer.ground);

    let nearest: Candidate<GrabTarget> | null = null;

    for (const plant of scene.plantsNear(spots, WIDEST_CROWN + farthest * slackPerMeter + SEARCH_SPACING / 2)) {
      const x = vegetation.x[plant];
      const z = vegetation.z[plant];
      const species = vegetation.species[plant];
      const baseY = this.#heightAt(x, z);

      const slack = this.#camera.position.distanceTo(this.#point.set(x, baseY, z)) * slackPerMeter;
      const isOffRay = distanceToSegment(x, z, [origin.x, origin.z], [end.x, end.z]) > WIDEST_CROWN + slack;

      if (isOffRay || vegetation.state[plant] !== PlantState.Alive || !isGrabbablePlant(species)) {
        continue;
      }

      const reach = plantHitDistance(ray, { baseY, height: vegetation.height[plant], species, x, z }, slack);

      const isVisible = reach !== null && reach <= groundReach + slack;

      if (isVisible && (nearest === null || reach < nearest.reach)) {
        nearest = { distance: 0, reach, target: { id: plant, kind: "plant" } };
      }
    }

    return nearest;
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
