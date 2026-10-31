import { type PerspectiveCamera, type Ray, Raycaster, Vector3 } from "three/webgpu";
import { distanceToSegment } from "../../shared/math.ts";
import type { Selection } from "../../simulation/commands.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { type GrabTarget, isGrabbablePlant } from "../../simulation/hand/grab-target.ts";
import {
  ANIMAL_STRIDE,
  AnimalField,
  type MotionFields,
  PERSON_STRIDE,
  PersonField,
  restPositionOf,
} from "../../world/agent-buffers.ts";
import { PlantState, type VegetationBuffers } from "../../world/vegetation-store.ts";
import type { GroundPoint } from "../camera/god-camera.ts";
import {
  type AgentBody,
  animalBody,
  measureAgentBodies,
  personBody,
  rayHitsBody,
  type StandingBody,
} from "./agent-bodies.ts";
import type { HeightField, ScreenPoint, ViewportSize } from "./ground-picker.ts";
import { measureGrabbablePlants, plantHitDistance } from "./plant-volumes.ts";
import { aimRay, normalizedToPixels, projectToNormalized } from "./screen-projection.ts";

const PICK_RADIUS_PIXELS = 26;
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
const LARGEST_BODY_REACH = 6;

interface Candidate<Target> {
  readonly distance: number;
  readonly reach: number;
  readonly target: Target;
}

export interface AgentScene {
  readonly frame: SimulationFrame;
  readonly secondsSinceTick: number;
}

export interface GrabScene extends AgentScene {
  readonly plantsNear: (spots: readonly GroundPoint[], radius: number) => Iterable<number>;
  readonly vegetation: Pick<VegetationBuffers, "count" | "height" | "species" | "state" | "x" | "z">;
}

type AgentKind = "animal" | "person";

export type AgentFooting = (kind: AgentKind, x: number, z: number) => number;

export type DrawnHeading = (kind: AgentKind, id: number) => number | null;

interface AgentTarget {
  readonly id: number;
  readonly kind: AgentKind;
}

interface PointerPick {
  readonly ground: Vector3 | null;
  readonly ray: Ray;
  readonly screen: ScreenPoint;
  readonly viewport: ViewportSize;
}

interface ScreenHit {
  readonly distance: number;
  readonly reach: number;
}

interface AgentLayout {
  readonly body: (data: Float32Array, offset: number) => AgentBody;
  readonly fields: MotionFields & { readonly Heading: number; readonly Id: number };
  readonly kind: AgentKind;
  readonly stride: number;
}

const PEOPLE: AgentLayout = { body: personBody, fields: PersonField, kind: "person", stride: PERSON_STRIDE };
const ANIMALS: AgentLayout = { body: animalBody, fields: AnimalField, kind: "animal", stride: ANIMAL_STRIDE };

type PixelPoint = readonly [number, number];

interface RaySearch {
  readonly farthest: number;
  readonly spots: GroundPoint[];
}

function searchAlong(ray: Ray, end: Vector3, heightAt: HeightField): RaySearch {
  const { origin } = ray;

  const length = origin.distanceTo(end);
  const across = Math.hypot(end.x - origin.x, end.z - origin.z);
  const count = Math.ceil(across / SEARCH_STEP) + 1;
  const reachPerMeter = length / Math.max(across, 1);
  const point = new Vector3();

  const spots: GroundPoint[] = [];

  let farthest = 0;

  for (let index = 0; index < count; index += 1) {
    const reach = across > 0 ? Math.min(1, (index * SEARCH_STEP) / across) * length : length;

    ray.at(reach, point);

    const clearance = point.y - heightAt(point.x, point.z);

    if (lowestClearance(ray, reach, reachPerMeter, heightAt) <= TALLEST_PLANT + WIDEST_CROWN) {
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

function screenAxis(feet: PixelPoint | null, top: PixelPoint | null): readonly [PixelPoint, PixelPoint] | null {
  if (feet !== null && top !== null) {
    return [feet, top];
  }

  if (feet !== null) {
    return [feet, feet];
  }

  return top === null ? null : [top, top];
}

export class EntityPicker {
  readonly #camera: PerspectiveCamera;
  readonly #drawnHeading: DrawnHeading;
  readonly #heightAt: HeightField;
  readonly #standingAt: AgentFooting;
  readonly #point = new Vector3();
  readonly #projected = new Vector3();
  readonly #raycaster = new Raycaster();

  constructor(camera: PerspectiveCamera, heightAt: HeightField, standingAt: AgentFooting, drawnHeading: DrawnHeading) {
    this.#camera = camera;
    this.#drawnHeading = drawnHeading;
    this.#heightAt = heightAt;
    this.#standingAt = standingAt;
    measureGrabbablePlants();
    measureAgentBodies();
  }

  pick(scene: AgentScene, screen: ScreenPoint, viewport: ViewportSize, ground: Vector3 | null): Selection | null {
    const pointer = { ground, ray: aimRay(this.#raycaster, this.#camera, screen, viewport), screen, viewport };

    const nearest = this.#nearestCandidate(ground, [
      ...this.#agents(scene, PEOPLE, pointer),
      ...this.#agents(scene, ANIMALS, pointer),
      ...this.#buildings(scene.frame, pointer),
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
    const pointer = { ground, ray: aimRay(this.#raycaster, this.#camera, screen, viewport), screen, viewport };

    const agent = this.#nearestCandidate(ground, [
      ...this.#agents(scene, ANIMALS, pointer),
      ...this.#agents(scene, PEOPLE, pointer),
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
      const isCloser =
        nearest === null ||
        candidate.distance < nearest.distance ||
        (candidate.distance === nearest.distance && candidate.reach < nearest.reach);

      if (candidate.reach <= visibleReach && isCloser) {
        nearest = candidate;
      }
    }

    return nearest;
  }

  #agents(scene: AgentScene, layout: AgentLayout, pointer: PointerPick): Candidate<AgentTarget>[] {
    const { frame, secondsSinceTick } = scene;
    const { body, fields, kind, stride } = layout;

    const data = kind === "person" ? frame.people : frame.animals;
    const count = kind === "person" ? frame.personCount : frame.animalCount;

    const candidates: Candidate<AgentTarget>[] = [];

    for (let agent = 0; agent < count; agent += 1) {
      const offset = agent * stride;

      const { x, z } = restPositionOf(data, offset, fields, secondsSinceTick);
      const baseY = this.#standingAt(kind, x, z);

      if (!this.#isNearRay(x, baseY, z, pointer)) {
        continue;
      }

      const id = data[offset + fields.Id];
      const drawnHeading = this.#drawnHeading(kind, id);
      const heading = drawnHeading === null ? data[offset + fields.Heading] : drawnHeading;
      const hit = this.#bodyHit({ ...body(data, offset), baseY, heading, x, z }, pointer);

      if (hit.distance < PICK_RADIUS_PIXELS) {
        candidates.push({ ...hit, target: { id, kind } });
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

    const { ray } = pointer;
    const end = pointer.ground === null ? ray.at(this.#camera.far, new Vector3()) : pointer.ground;
    const { origin } = ray;
    const { farthest, spots } = searchAlong(ray, end, this.#heightAt);
    const slackPerMeter = this.#metersPerPixel(pointer.viewport) * PLANT_SLACK_PIXELS;
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

  #isNearRay(x: number, y: number, z: number, pointer: PointerPick): boolean {
    const point = this.#point.set(x, y, z);

    const slack = this.#camera.position.distanceTo(point) * this.#metersPerPixel(pointer.viewport) * PICK_RADIUS_PIXELS;

    return pointer.ray.distanceToPoint(point) <= LARGEST_BODY_REACH + slack;
  }

  #metersPerPixel(viewport: ViewportSize): number {
    return (2 * Math.tan((this.#camera.fov * Math.PI) / 360)) / viewport.height;
  }

  #bodyHit(body: StandingBody, pointer: PointerPick): ScreenHit {
    const { baseY, height, x, z } = body;
    const { screen, viewport } = pointer;

    const reach = this.#camera.position.distanceTo(this.#point.set(x, baseY + height / 2, z));

    if (rayHitsBody(pointer.ray, body)) {
      return { distance: 0, reach };
    }

    const axis = screenAxis(
      this.#screenPoint(x, baseY, z, viewport),
      this.#screenPoint(x, baseY + height, z, viewport)
    );

    if (axis === null) {
      return { distance: Number.POSITIVE_INFINITY, reach };
    }

    return { distance: distanceToSegment(screen.x, screen.y, axis[0], axis[1]), reach };
  }

  #screenPoint(x: number, y: number, z: number, viewport: ViewportSize): PixelPoint | null {
    const projected = projectToNormalized(this.#camera, x, y, z, this.#projected);

    if (projected === null) {
      return null;
    }

    const pixels = normalizedToPixels(projected, viewport);

    return [pixels.x, pixels.y];
  }

  #screenHit(x: number, y: number, z: number, pointer: PointerPick): ScreenHit {
    const { screen, viewport } = pointer;

    const reach = this.#camera.position.distanceTo(this.#point.set(x, y, z));
    const pixels = this.#screenPoint(x, y, z, viewport);

    if (pixels === null) {
      return { distance: Number.POSITIVE_INFINITY, reach };
    }

    return { distance: Math.hypot(pixels[0] - screen.x, pixels[1] - screen.y), reach };
  }
}
