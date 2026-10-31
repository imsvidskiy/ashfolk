import { groundDefinition } from "../../content/grounds.ts";
import type { WorldRules } from "../../content/world-rules.ts";
import { clamp, smoothstep } from "../../shared/math.ts";
import type { RandomSource } from "../../shared/random.ts";
import { CellSet } from "../../world/cell-set.ts";
import { NEIGHBOR_OFFSETS } from "../../world/world-grid.ts";
import type { WorldState } from "../world/world-state.ts";

const IGNITION_INTENSITY = 0.14;
const EXTINGUISHED_INTENSITY = 0.02;
const BURNT_OUT_FUEL = 0.01;
const HEAT_FLOOR = 0.002;
const HEAT_RETENTION = 0.99;
const CROWN_BURN_FRACTION = 0.55;
const DIAGONAL_WIND_DAMPING = 0.72;
const FULL_WIND_SPEED = 45;
const MAXIMUM_WIND_STRENGTH = 1.4;
const BURNABLE_GROUND_FUEL = 0.02;
const BURNABLE_CANOPY_FUEL = 0.05;
const SNOW_BLOCKING_IGNITION = 0.3;
const SOAKING_DAMPNESS = 1.1;
const GROUND_FIRE_EMISSION = 0.75;
const CROWN_FIRE_EMISSION = 0.1;
const CANOPY_IGNITION_BONUS = -0.2;
const GROUND_FUEL_BURN_RATE = 0.085;
const CANOPY_FUEL_BURN_RATE = 0.08;

interface FireConditions {
  airTemperatureOffset: number;
  day: number;
  drought: number;
}

interface FireTick {
  burnMultiplier: number;
  conditions: FireConditions;
  emberCells: number[];
  ignitionMultiplier: number;
  random: RandomSource;
  rules: WorldRules;
  seconds: number;
}

export interface FireSnapshot {
  burning: Int32Array;
  heated: Int32Array;
}

export class FireSystem {
  readonly #burning: CellSet;
  readonly #heated: CellSet;
  readonly #windFactors = new Float32Array(NEIGHBOR_OFFSETS.length);
  readonly #world: WorldState;
  #downwindColumn = 0;
  #downwindRow = 0;
  #downwindWeight = 0;
  #windStrength = 0;

  constructor(world: WorldState) {
    this.#world = world;
    this.#burning = new CellSet(world.grid.cellCount);
    this.#heated = new CellSet(world.grid.cellCount);
    this.#windFactors.fill(1);
  }

  get burningCount(): number {
    return this.#burning.size;
  }

  get windStrength(): number {
    return this.#windStrength;
  }

  snapshot(): FireSnapshot {
    return { burning: this.#burning.snapshot(), heated: this.#heated.snapshot() };
  }

  restore(snapshot: FireSnapshot): void {
    this.#burning.restore(snapshot.burning);
    this.#heated.restore(snapshot.heated);
  }

  burningCells(): Int32Array {
    return this.#burning.values();
  }

  setWind(windX: number, windZ: number, windSpeed: number, rules: WorldRules): void {
    const strength = Math.min(MAXIMUM_WIND_STRENGTH, windSpeed / FULL_WIND_SPEED);
    const influence = rules.fire.windInfluence;

    for (let index = 0; index < NEIGHBOR_OFFSETS.length; index += 1) {
      const offset = NEIGHBOR_OFFSETS[index];
      const alignment = (offset.column * windX + offset.row * windZ) / offset.distance;
      const diagonalDamping = offset.distance > 1 ? DIAGONAL_WIND_DAMPING : 1;

      const push = Math.exp(strength * 1.6 * influence * alignment);

      this.#windFactors[index] = (push * diagonalDamping) / (1 + 0.3 * strength);
    }

    this.#downwindColumn = Math.round(windX * 2);
    this.#downwindRow = Math.round(windZ * 2);
    this.#downwindWeight = 0.35 * strength * influence;
    this.#windStrength = strength;
  }

  ignite(cell: number, intensity: number): boolean {
    const { fields } = this.#world;

    if (cell < 0 || !this.#canBurn(cell) || fields.snow[cell] > SNOW_BLOCKING_IGNITION) {
      return false;
    }

    fields.fire[cell] = Math.max(fields.fire[cell], intensity);
    this.#burning.add(cell);
    this.#world.markSurfaceCell(cell);

    return true;
  }

  addHeat(cell: number, amount: number): void {
    if (cell < 0) {
      return;
    }

    this.#world.fields.heat[cell] += amount;
    this.#heated.add(cell);
  }

  douse(cell: number, amount: number): void {
    const { fire, heat } = this.#world.fields;

    const remaining = Math.max(0, 1 - amount);

    heat[cell] *= remaining;

    if (fire[cell] <= 0) {
      return;
    }

    fire[cell] *= remaining;

    if (fire[cell] < EXTINGUISHED_INTENSITY) {
      fire[cell] = 0;
    }

    this.#world.markSurfaceCell(cell);
  }

  update(seconds: number, conditions: FireConditions, rules: WorldRules, random: RandomSource): number[] {
    const tick: FireTick = {
      burnMultiplier: (0.75 + 0.5 * conditions.drought) / rules.fire.burnDuration,
      conditions,
      emberCells: [],
      ignitionMultiplier: 1.5 - 0.8 * conditions.drought,
      random,
      rules,
      seconds,
    };

    this.#burning.retain((cell) => {
      return this.#burnCell(cell, tick);
    });
    this.#heated.retain((cell) => {
      return this.#heatCell(cell, tick);
    });

    return tick.emberCells;
  }

  #canBurn(cell: number): boolean {
    const { canopyFuel, fields } = this.#world;

    if (this.#world.isWater(cell)) {
      return false;
    }

    return fields.fuel[cell] > BURNABLE_GROUND_FUEL || canopyFuel[cell] > BURNABLE_CANOPY_FUEL;
  }

  #burnCell(cell: number, tick: FireTick): boolean {
    const { canopyFuel, fields } = this.#world;

    const intensity = fields.fire[cell];

    if (intensity <= 0 || this.#world.isWater(cell)) {
      fields.fire[cell] = 0;
      this.#world.markSurfaceCell(cell);

      return false;
    }

    const nextIntensity = this.#nextIntensity(cell, intensity);

    this.#consumeFuel(cell, nextIntensity, tick);
    this.#world.markSurfaceCell(cell);

    const fuelLeft = fields.fuel[cell] + canopyFuel[cell];

    if (fuelLeft <= BURNT_OUT_FUEL || nextIntensity < EXTINGUISHED_INTENSITY) {
      this.#burnOut(cell, fuelLeft, tick.conditions.day);

      return false;
    }

    fields.fire[cell] = nextIntensity;
    this.#spreadHeat(cell, nextIntensity, tick);
    this.#throwEmbers(cell, nextIntensity, tick);

    return true;
  }

  #nextIntensity(cell: number, intensity: number): number {
    const { canopyFuel, fields, initialCanopyFuel, terrain } = this.#world;

    const ground = groundDefinition(terrain.ground[cell]);
    const groundFuel = fields.fuel[cell];
    const canopy = canopyFuel[cell];

    const availableFuel = Math.min(1, groundFuel * 0.75 + canopy * 0.3);
    const dampness =
      Math.max(0, 1 - fields.wetness[cell] * SOAKING_DAMPNESS) * (1 - Math.min(1, fields.snow[cell] * 4));
    const fuelFraction = (groundFuel + canopy) / Math.max(0.01, ground.fuel + initialCanopyFuel[cell]);

    const flamingPhase = 0.18 + 0.82 * smoothstep(0, 1, (fuelFraction - 0.12) / 0.5);
    const target = Math.min(1, (0.25 + availableFuel) * (0.6 + 0.4 * ground.flammability)) * dampness;

    return intensity + (target * flamingPhase - intensity) * 0.3;
  }

  #consumeFuel(cell: number, intensity: number, tick: FireTick): void {
    const { canopyFuel, fields, initialCanopyFuel, vegetation } = this.#world;

    const consumption = tick.burnMultiplier * Math.max(intensity, 0.15) * tick.seconds;

    const canopyBefore = canopyFuel[cell];
    const crownThreshold = initialCanopyFuel[cell] * CROWN_BURN_FRACTION;

    fields.fuel[cell] = Math.max(0, fields.fuel[cell] - consumption * GROUND_FUEL_BURN_RATE);

    if (canopyBefore > 0) {
      canopyFuel[cell] = Math.max(0, canopyBefore - consumption * CANOPY_FUEL_BURN_RATE);
    }

    if (canopyFuel[cell] < crownThreshold && canopyBefore >= crownThreshold) {
      vegetation.burnTreesInCell(cell, tick.conditions.day);
      this.#world.markDisturbed(cell, tick.conditions.day);
    }

    this.#raiseScorch(cell);
  }

  #raiseScorch(cell: number): void {
    const { canopyFuel, fields, initialCanopyFuel, terrain } = this.#world;

    const ground = groundDefinition(terrain.ground[cell]);
    const fuelLeft = fields.fuel[cell] + canopyFuel[cell];

    const totalFuel = Math.max(0.01, ground.fuel + initialCanopyFuel[cell]);

    fields.scorch[cell] = Math.max(fields.scorch[cell], 1 - fuelLeft / totalFuel);
  }

  #burnOut(cell: number, fuelLeft: number, day: number): void {
    const { canopyFuel, fields, initialCanopyFuel, vegetation } = this.#world;

    fields.fire[cell] = 0;
    this.#world.markDisturbed(cell, day);

    if (fuelLeft <= BURNT_OUT_FUEL) {
      fields.scorch[cell] = 1;
      canopyFuel[cell] = 0;
      vegetation.burnTreesInCell(cell, day);
    }

    initialCanopyFuel[cell] = canopyFuel[cell];
  }

  #spreadHeat(cell: number, intensity: number, tick: FireTick): void {
    const { canopyFuel, fields, grid, terrain } = this.#world;

    const slopeInfluence = 1.5 * tick.rules.fire.slopeInfluence;

    const column = grid.columnOf(cell);
    const row = grid.rowOf(cell);
    const crownBoost = GROUND_FIRE_EMISSION + CROWN_FIRE_EMISSION * Math.min(1.5, canopyFuel[cell] * 0.35);

    const emittedHeat = intensity * crownBoost * 0.05 * tick.seconds * tick.rules.fire.spreadSpeed;

    for (let index = 0; index < NEIGHBOR_OFFSETS.length; index += 1) {
      const offset = NEIGHBOR_OFFSETS[index];
      const neighborColumn = column + offset.column;
      const neighborRow = row + offset.row;

      if (!grid.contains(neighborColumn, neighborRow)) {
        continue;
      }

      const neighbor = grid.index(neighborColumn, neighborRow);

      if (fields.fire[neighbor] > 0) {
        continue;
      }

      const rise = (terrain.height[neighbor] - terrain.height[cell]) / (grid.cellSize * offset.distance);

      const slopeFactor = clamp(Math.exp(slopeInfluence * rise), 0.4, 3);

      this.addHeat(neighbor, emittedHeat * this.#windFactors[index] * slopeFactor);
    }

    this.#heatDownwind(column + this.#downwindColumn, row + this.#downwindRow, emittedHeat);
  }

  #heatDownwind(column: number, row: number, emittedHeat: number): void {
    const { grid } = this.#world;

    if (this.#downwindWeight <= 0.05 || !grid.contains(column, row)) {
      return;
    }

    this.addHeat(grid.index(column, row), emittedHeat * this.#downwindWeight);
  }

  #throwEmbers(cell: number, intensity: number, tick: FireTick): void {
    if (this.#world.canopyFuel[cell] <= 0.8 || intensity <= 0.55) {
      return;
    }

    const chance = 0.04 * intensity * (0.3 + this.#windStrength) * tick.seconds * tick.rules.fire.embers;

    if (tick.random.chance(chance)) {
      tick.emberCells.push(cell);
    }
  }

  #heatCell(cell: number, tick: FireTick): boolean {
    const { fields } = this.#world;

    const heat = fields.heat[cell];

    if (heat < HEAT_FLOOR) {
      fields.heat[cell] = 0;

      return false;
    }

    this.#igniteFromHeat(cell, heat, tick);
    fields.heat[cell] = heat * HEAT_RETENTION;

    return true;
  }

  #igniteFromHeat(cell: number, heat: number, tick: FireTick): void {
    const { fields } = this.#world;

    if (fields.fire[cell] > 0 || !this.#canBurn(cell)) {
      return;
    }

    if (heat <= this.#ignitionThreshold(cell, tick)) {
      return;
    }

    fields.fire[cell] = IGNITION_INTENSITY;
    this.#burning.add(cell);
    this.#world.markSurfaceCell(cell);
  }

  #ignitionThreshold(cell: number, tick: FireTick): number {
    const { canopyFuel, fields, terrain } = this.#world;

    const temperature = this.#world.temperature(cell, tick.conditions.airTemperatureOffset);

    const ground = groundDefinition(terrain.ground[cell]);
    const canopyBonus = canopyFuel[cell] > 0 ? CANOPY_IGNITION_BONUS : 0;
    const coldResistance = temperature < 0 ? 1.6 : 1;
    const moistureResistance = (1 + 3 * fields.wetness[cell]) * (1 + 10 * fields.snow[cell]);

    const flammability = (Math.max(0.25, ground.flammability) + canopyBonus) * tick.rules.fire.flammability;

    return (0.3 * tick.ignitionMultiplier * coldResistance * moistureResistance) / flammability;
  }
}
