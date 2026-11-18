import { BUILDINGS } from "../../content/buildings.ts";
import { plantSpeciesDefinition } from "../../content/plants.ts";
import { FULL_TURN, hashToUnit } from "../../shared/math.ts";
import { PlantState } from "../../world/vegetation-store.ts";
import type { BlackHoleEffect, BlackHoleInflowEffect, InflowSource } from "../effects.ts";
import type { Building } from "../society/buildings.ts";
import type { WorldState } from "../world/world-state.ts";

const GROUND_SAMPLES = 8;
const PLANT_SAMPLES = 18;
const BUILDING_SAMPLES = 6;

interface Sample {
  readonly rank: number;
  readonly source: Omit<InflowSource, "y">;
}

export class BlackHoleInflow {
  readonly #samples = new Map<number, Sample>();
  readonly #world: WorldState;

  constructor(world: WorldState) {
    this.#world = world;
  }

  ground(cell: number, x: number, z: number): void {
    const { grid } = this.#world;
    const isWater = this.#world.isWater(cell) || this.#world.isPool(cell);

    this.#keep(0, GROUND_SAMPLES, cell, {
      isFallen: false,
      material: isWater ? "water" : "earth",
      rotation: hashToUnit(cell, 6) * FULL_TURN,
      size: grid.cellSize * (0.45 + hashToUnit(cell, 1) * 0.4),
      x,
      z,
    });
  }

  plant(index: number): void {
    const { vegetation } = this.#world;
    const { form } = plantSpeciesDefinition(vegetation.species[index]);
    const isFallen = vegetation.state[index] === PlantState.Fallen;
    let material: InflowSource["material"] = "broadleaf";

    if (form === "monument") {
      return;
    }

    if (vegetation.state[index] === PlantState.Burnt || form === "deadwood") {
      material = "wood";
    } else if (form === "conifer" || form === "broadleaf") {
      material = form;
    } else if (form === "stone") {
      material = "rock";
    }

    this.#keep(GROUND_SAMPLES, PLANT_SAMPLES, index, {
      isFallen,
      material,
      rotation: vegetation.rotation[index],
      size: vegetation.height[index],
      x: vegetation.x[index],
      z: vegetation.z[index],
    });
  }

  building(building: Building): void {
    const {
      cost: { stone = 0, wood = 0 },
      footprint,
      role,
    } = BUILDINGS[building.kind];
    let material: InflowSource["material"] = "roof";

    if (stone > wood) {
      material = "masonry";
    } else if (role === "shrine" || role === "enclosure" || role === "fire") {
      material = "wood";
    }

    this.#keep(GROUND_SAMPLES + PLANT_SAMPLES, BUILDING_SAMPLES, building.id, {
      isFallen: false,
      material,
      rotation: building.rotation,
      size: Math.max(footprint, this.#world.grid.cellSize * 0.4) * 2.5,
      x: building.x,
      z: building.z,
    });
  }

  effect(
    hole: BlackHoleEffect,
    wellId: number,
    startedAt: number,
    durationSeconds: number
  ): BlackHoleInflowEffect | null {
    if (this.#samples.size === 0 || durationSeconds <= 0) {
      return null;
    }

    const sources = Array.from(this.#samples.values(), ({ source }) => {
      const y =
        source.material === "water"
          ? this.#world.surfaceAt(source.x, source.z)
          : this.#world.heightAt(source.x, source.z);

      return { ...source, y };
    });

    return {
      durationSeconds,
      holeDuration: hole.durationSeconds,
      kind: "black-hole-inflow",
      radius: hole.radius,
      sources,
      startedAt,
      surfaceY: hole.surfaceY,
      wellId,
      x: hole.x,
      z: hole.z,
    };
  }

  #keep(offset: number, count: number, key: number, source: Omit<InflowSource, "y">): void {
    const slot = offset + Math.floor(hashToUnit(key, 17) * count);
    const rank = hashToUnit(key, 29);
    const previous = this.#samples.get(slot);

    if (previous === undefined || rank > previous.rank) {
      this.#samples.set(slot, { rank, source });
    }
  }
}
