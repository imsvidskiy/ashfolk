import type { Ray } from "three/webgpu";
import { PLANT_SPECIES, type PlantSpeciesIndex } from "../../content/plants.ts";
import { buildPlantVariants, canonicalHeight } from "../../models/plants/plant-models.ts";
import { clamp } from "../../shared/math.ts";
import { isGrabbablePlant } from "../../simulation/hand/grab-target.ts";

const BANDS = 20;
const CROWN_SHARE_OF_WIDEST = 0.45;
const CROWN_FILL = 0.9;
const THINNEST_TRUNK = 0.03;
const THICKEST_TRUNK = 0.08;
const PARALLEL = 1e-9;

export interface PlantVolume {
  readonly crownBottom: number;
  readonly crownRadius: number;
  readonly crownTop: number;
  readonly isCone: boolean;
  readonly trunkRadius: number;
}

export interface StandingPlant {
  readonly baseY: number;
  readonly height: number;
  readonly species: number;
  readonly x: number;
  readonly z: number;
}

const measured = new Map<number, PlantVolume>();

function bandWidths(species: PlantSpeciesIndex): { readonly top: number; readonly widths: number[] } {
  const height = canonicalHeight(species);
  const widths = new Array<number>(BANDS).fill(0);

  let top = 0;

  for (const mesh of buildPlantVariants(species, "medium")) {
    for (let offset = 0; offset < mesh.positions.length; offset += 3) {
      const y = mesh.positions[offset + 1] / height;
      const band = clamp(Math.floor(y * BANDS), 0, BANDS - 1);

      top = Math.max(top, y);
      widths[band] = Math.max(widths[band], Math.hypot(mesh.positions[offset], mesh.positions[offset + 2]) / height);
    }
  }

  return { top, widths };
}

function measure(species: PlantSpeciesIndex): PlantVolume {
  const { top, widths } = bandWidths(species);

  const widest = Math.max(...widths);
  const firstCrownBand = Math.max(
    0,
    widths.findIndex((width) => {
      return width >= widest * CROWN_SHARE_OF_WIDEST;
    })
  );

  return {
    crownBottom: firstCrownBand / BANDS,
    crownRadius: widest * CROWN_FILL,
    crownTop: top,
    isCone: PLANT_SPECIES[species].form === "conifer",
    trunkRadius: clamp(widths[0], THINNEST_TRUNK, THICKEST_TRUNK),
  };
}

export function plantVolume(species: number): PlantVolume {
  const known = measured.get(species);

  if (known !== undefined) {
    return known;
  }

  const volume = measure(PLANT_SPECIES[species].index);

  measured.set(species, volume);

  return volume;
}

export function measureGrabbablePlants(): void {
  for (const { index } of PLANT_SPECIES) {
    if (isGrabbablePlant(index)) {
      plantVolume(index);
    }
  }
}

function nearestAhead(first: number, second: number): number | null {
  if (first >= 0) {
    return first;
  }

  return second >= 0 ? 0 : null;
}

function ellipsoidHit(ray: Ray, center: readonly [number, number, number], across: number, up: number): number | null {
  const { direction, origin } = ray;

  const fromX = (origin.x - center[0]) / across;
  const fromY = (origin.y - center[1]) / up;
  const fromZ = (origin.z - center[2]) / across;
  const alongX = direction.x / across;
  const alongY = direction.y / up;
  const alongZ = direction.z / across;

  const a = alongX * alongX + alongY * alongY + alongZ * alongZ;
  const b = 2 * (fromX * alongX + fromY * alongY + fromZ * alongZ);
  const c = fromX * fromX + fromY * fromY + fromZ * fromZ - 1;
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) {
    return null;
  }

  const root = Math.sqrt(discriminant);

  return nearestAhead((-b - root) / (2 * a), (-b + root) / (2 * a));
}

function closer(first: number | null, second: number | null): number | null {
  if (first === null) {
    return second;
  }

  if (second === null) {
    return first;
  }

  return Math.min(first, second);
}

function capsuleHit(ray: Ray, plant: StandingPlant, topY: number, radius: number): number | null {
  const { direction, origin } = ray;

  const fromX = origin.x - plant.x;
  const fromZ = origin.z - plant.z;

  const a = direction.x * direction.x + direction.z * direction.z;
  const b = 2 * (fromX * direction.x + fromZ * direction.z);
  const c = fromX * fromX + fromZ * fromZ - radius * radius;
  const discriminant = b * b - 4 * a * c;

  let side: number | null = null;

  if (a > PARALLEL && discriminant >= 0) {
    const distance = (-b - Math.sqrt(discriminant)) / (2 * a);
    const y = origin.y + direction.y * distance;

    side = distance >= 0 && y >= plant.baseY && y <= topY ? distance : null;
  }

  const foot = ellipsoidHit(ray, [plant.x, plant.baseY, plant.z], radius, radius);
  const head = ellipsoidHit(ray, [plant.x, topY, plant.z], radius, radius);

  return closer(side, closer(foot, head));
}

function coneHit(ray: Ray, plant: StandingPlant, bottomY: number, apexY: number, radius: number): number | null {
  const { direction, origin } = ray;

  const slope = radius / Math.max(apexY - bottomY, PARALLEL);
  const slopeSquared = slope * slope;
  const fromX = origin.x - plant.x;
  const fromY = origin.y - apexY;
  const fromZ = origin.z - plant.z;

  const a = direction.x * direction.x + direction.z * direction.z - slopeSquared * direction.y * direction.y;
  const b = 2 * (fromX * direction.x + fromZ * direction.z - slopeSquared * fromY * direction.y);
  const c = fromX * fromX + fromZ * fromZ - slopeSquared * fromY * fromY;
  const discriminant = b * b - 4 * a * c;

  let nearest: number | null = null;

  if (Math.abs(a) > PARALLEL && discriminant >= 0) {
    const root = Math.sqrt(discriminant);

    for (const distance of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      const y = origin.y + direction.y * distance;

      if (distance >= 0 && y >= bottomY && y <= apexY) {
        nearest = closer(nearest, distance);
      }
    }
  }

  if (Math.abs(direction.y) > PARALLEL) {
    const distance = (bottomY - origin.y) / direction.y;
    const across = Math.hypot(fromX + direction.x * distance, fromZ + direction.z * distance);

    nearest = distance >= 0 && across <= radius ? closer(nearest, distance) : nearest;
  }

  return nearest;
}

export function plantHitDistance(ray: Ray, plant: StandingPlant, slack: number): number | null {
  const volume = plantVolume(plant.species);

  const bottomY = plant.baseY + volume.crownBottom * plant.height;
  const topY = plant.baseY + volume.crownTop * plant.height;
  const radius = volume.crownRadius * plant.height + slack;

  const crown = volume.isCone
    ? coneHit(ray, plant, bottomY, topY + slack, radius)
    : ellipsoidHit(ray, [plant.x, (bottomY + topY) / 2, plant.z], radius, (topY - bottomY) / 2 + slack);

  const trunk = capsuleHit(ray, plant, Math.max(bottomY, plant.baseY), volume.trunkRadius * plant.height + slack);

  return closer(crown, trunk);
}
