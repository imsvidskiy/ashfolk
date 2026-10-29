import { ANIMAL_KINDS } from "../content/animals.ts";
import { BUILDING_KINDS, BUILDINGS } from "../content/buildings.ts";
import { CROP_KINDS, CROPS } from "../content/crops.ts";
import { depositCode } from "../content/deposits.ts";
import { currentEra, ERA_COUNT } from "../content/eras.ts";
import { saturate } from "../shared/math.ts";
import {
  ANIMAL_STRIDE,
  AnimalField,
  GROUND_CHANNELS,
  GroundChannel,
  PERSON_STRIDE,
  PersonField,
  SURFACE_CHANNELS,
  SurfaceChannel,
} from "../world/agent-buffers.ts";
import { animalPoseCode, carriedItemCode, personPoseCode } from "../world/agent-poses.ts";
import type { CellRegion, RowRun } from "../world/change-tracking.ts";
import { gearCode, NO_WEAPON_CODE, weaponCode } from "../world/gear.ts";
import type { Animal } from "./fauna/fauna.ts";
import type {
  BuildingCount,
  BuildingView,
  CropCount,
  FarmlandView,
  GoalView,
  LavaView,
  PackedRows,
  RegionPatch,
  TribeSummary,
  WeatherView,
} from "./frame.ts";
import type { Environment } from "./nature/environment.ts";
import type { WeatherSystem } from "./nature/weather.ts";
import type { Building, BuildingSystem } from "./society/buildings.ts";
import { tribeBuildings } from "./society/camp-plan.ts";
import type { JobKind } from "./society/jobs/job.ts";
import { carriedItem, isChild, type Person } from "./society/person.ts";
import { plantedCount } from "./society/plots.ts";
import { nextEraName, technologyNames, tribeGoal } from "./society/progress.ts";
import type { Tribe } from "./society/tribe.ts";
import { SNOW_CAPACITY, type WorldState } from "./world/world-state.ts";

const BYTE = 255;
const NO_ROW = -1;
const ARMED_JOBS: ReadonlySet<JobKind> = new Set(["defend", "fight", "hunt", "raid"]);

interface TribeSources {
  buildings: BuildingSystem;
  world: WorldState;
}

function toByte(value: number): number {
  return Math.round(saturate(value) * BYTE);
}

export function packSurfaceRows(world: WorldState, runs: readonly RowRun[]): PackedRows[] {
  const bytesPerRow = world.grid.cellsPerSide * SURFACE_CHANNELS;

  return runs.map((run) => {
    const data = new Uint8Array(run.rowCount * bytesPerRow);

    for (let row = 0; row < run.rowCount; row += 1) {
      packSurfaceRow(world, run.firstRow + row, data, row * bytesPerRow);
    }

    return { data, firstRow: run.firstRow, rowCount: run.rowCount };
  });
}

export function packChangedSurfaceRows(world: WorldState, runs: readonly RowRun[], sent: Uint8Array): PackedRows[] {
  const bytesPerRow = world.grid.cellsPerSide * SURFACE_CHANNELS;
  const changed: PackedRows[] = [];

  for (const run of runs) {
    const endRow = run.firstRow + run.rowCount;

    let firstChangedRow = NO_ROW;

    for (let row = run.firstRow; row < endRow; row += 1) {
      const isChanged = packSurfaceRow(world, row, sent, row * bytesPerRow);

      if (isChanged && firstChangedRow === NO_ROW) {
        firstChangedRow = row;
      }

      if (!isChanged && firstChangedRow !== NO_ROW) {
        changed.push(sentRows(sent, firstChangedRow, row, bytesPerRow));
        firstChangedRow = NO_ROW;
      }
    }

    if (firstChangedRow !== NO_ROW) {
      changed.push(sentRows(sent, firstChangedRow, endRow, bytesPerRow));
    }
  }

  return changed;
}

function sentRows(sent: Uint8Array, firstRow: number, endRow: number, bytesPerRow: number): PackedRows {
  return {
    data: sent.slice(firstRow * bytesPerRow, endRow * bytesPerRow),
    firstRow,
    rowCount: endRow - firstRow,
  };
}

function packSurfaceRow(world: WorldState, row: number, target: Uint8Array, offset: number): boolean {
  const { cellsPerSide } = world.grid;
  const { fire, scorch, snow, wetness } = world.fields;

  const firstCell = row * cellsPerSide;

  let isChanged = false;

  for (let column = 0; column < cellsPerSide; column += 1) {
    const cell = firstCell + column;
    const position = offset + column * SURFACE_CHANNELS;

    const snowByte = toByte(snow[cell] / SNOW_CAPACITY);
    const wetnessByte = toByte(wetness[cell]);
    const scorchByte = toByte(scorch[cell]);
    const fireByte = toByte(fire[cell]);

    if (
      target[position + SurfaceChannel.Snow] !== snowByte ||
      target[position + SurfaceChannel.Wetness] !== wetnessByte ||
      target[position + SurfaceChannel.Scorch] !== scorchByte ||
      target[position + SurfaceChannel.Fire] !== fireByte
    ) {
      isChanged = true;
    }

    target[position + SurfaceChannel.Snow] = snowByte;
    target[position + SurfaceChannel.Wetness] = wetnessByte;
    target[position + SurfaceChannel.Scorch] = scorchByte;
    target[position + SurfaceChannel.Fire] = fireByte;
  }

  return isChanged;
}

export function packGroundRows(world: WorldState, runs: readonly RowRun[]): PackedRows[] {
  const { cellsPerSide } = world.grid;

  return runs.map((run) => {
    const data = new Uint8Array(run.rowCount * cellsPerSide * GROUND_CHANNELS);
    const firstCell = run.firstRow * cellsPerSide;

    for (let offset = 0; offset < run.rowCount * cellsPerSide; offset += 1) {
      const cell = firstCell + offset;
      const position = offset * GROUND_CHANNELS;

      data[position + GroundChannel.Ground] = world.terrain.ground[cell];
      data[position + GroundChannel.Crop] = toByte(world.fields.crop[cell]);
      data[position + GroundChannel.Trodden] = toByte(world.fields.trodden[cell]);
      data[position + GroundChannel.CropKind] = world.cropCodes[cell];
    }

    return { data, firstRow: run.firstRow, rowCount: run.rowCount };
  });
}

export function allRows(world: WorldState): RowRun[] {
  return [{ firstRow: 0, rowCount: world.grid.cellsPerSide }];
}

export function packRegion(world: WorldState, values: Float32Array, region: CellRegion | null): RegionPatch | null {
  if (region === null) {
    return null;
  }

  const width = region.lastColumn - region.firstColumn + 1;
  const height = region.lastRow - region.firstRow + 1;

  const packed = new Float32Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const start = world.grid.index(region.firstColumn, region.firstRow + row);

    packed.set(values.subarray(start, start + width), row * width);
  }

  return { region, values: packed };
}

function shownWeapon(person: Person): number {
  const { job, weapon } = person;

  if (weapon === null || job === null || !ARMED_JOBS.has(job.kind)) {
    return NO_WEAPON_CODE;
  }

  return weaponCode(weapon.kind);
}

function gearOf(person: Person, tribe: Tribe | null): number {
  if (shownWeapon(person) !== NO_WEAPON_CODE && person.weapon !== null) {
    return gearCode(person.weapon.material);
  }

  if (tribe === null) {
    return gearCode("stone");
  }

  return gearCode(tribe.tools);
}

export function packPeople(people: readonly Person[], findTribe: (id: number) => Tribe | null): Float32Array {
  const buffer = new Float32Array(people.length * PERSON_STRIDE);

  for (const [index, person] of people.entries()) {
    const { mover } = person;

    const offset = index * PERSON_STRIDE;
    const tribe = findTribe(person.tribeId);

    buffer[offset + PersonField.Id] = person.id;
    buffer[offset + PersonField.X] = mover.x;
    buffer[offset + PersonField.Z] = mover.z;
    buffer[offset + PersonField.Heading] = mover.heading;
    buffer[offset + PersonField.VelocityX] = mover.velocityX;
    buffer[offset + PersonField.VelocityZ] = mover.velocityZ;
    buffer[offset + PersonField.Pose] = personPoseCode(person.pose);
    buffer[offset + PersonField.Phase] = person.phase;
    buffer[offset + PersonField.TribeId] = person.tribeId;
    buffer[offset + PersonField.Age] = person.age;
    buffer[offset + PersonField.IsFemale] = person.isFemale ? 1 : 0;
    buffer[offset + PersonField.AppearanceSeed] = person.appearanceSeed;
    buffer[offset + PersonField.Carried] = carriedItemCode(carriedItem(person));
    buffer[offset + PersonField.Weapon] = shownWeapon(person);
    buffer[offset + PersonField.Gear] = gearOf(person, tribe);
    buffer[offset + PersonField.Era] = tribe === null ? 0 : tribe.eraIndex;
    buffer[offset + PersonField.IsRaiding] = person.job?.kind === "raid" ? 1 : 0;
  }

  return buffer;
}

export function packAnimals(animals: readonly Animal[]): Float32Array {
  const buffer = new Float32Array(animals.length * ANIMAL_STRIDE);

  for (const [index, animal] of animals.entries()) {
    const { mover } = animal;

    const offset = index * ANIMAL_STRIDE;

    buffer[offset + AnimalField.Id] = animal.id;
    buffer[offset + AnimalField.X] = mover.x;
    buffer[offset + AnimalField.Z] = mover.z;
    buffer[offset + AnimalField.Heading] = mover.heading;
    buffer[offset + AnimalField.VelocityX] = mover.velocityX;
    buffer[offset + AnimalField.VelocityZ] = mover.velocityZ;
    buffer[offset + AnimalField.Pose] = animalPoseCode(animal.pose);
    buffer[offset + AnimalField.Phase] = animal.phase;
    buffer[offset + AnimalField.Kind] = ANIMAL_KINDS.indexOf(animal.kind);
    buffer[offset + AnimalField.Youth] = animal.youth;
    buffer[offset + AnimalField.AppearanceSeed] = animal.appearanceSeed;
    buffer[offset + AnimalField.HerdId] = animal.herdId;
  }

  return buffer;
}

function buildingVariant(building: Building, world: WorldState): number {
  const deposit = world.depositById(building.depositId);

  if (deposit === null) {
    return 0;
  }

  return depositCode(deposit.kind);
}

export function describeBuilding(building: Building, world: WorldState): BuildingView {
  return {
    extent: building.extent,
    fuel: building.fuel,
    health: building.health / BUILDINGS[building.kind].health,
    id: building.id,
    kind: building.kind,
    progress: building.progress,
    rotation: building.rotation,
    seed: building.seed,
    style: building.style,
    tribeId: building.tribeId,
    variant: buildingVariant(building, world),
    x: building.x,
    z: building.z,
  };
}

function buildingCounts(tribe: Tribe, sources: TribeSources): BuildingCount[] {
  const buildings = tribeBuildings(tribe, { buildings: sources.buildings });

  return BUILDING_KINDS.map((kind) => {
    return {
      count: buildings.filter((building) => {
        return building.kind === kind && building.progress >= 1;
      }).length,
      kind,
      name: BUILDINGS[kind].name,
    };
  }).filter((entry) => {
    return entry.count > 0;
  });
}

function cropCounts(tribe: Tribe): CropCount[] {
  return CROP_KINDS.map((crop) => {
    return {
      count: tribe.fields.filter((field) => {
        return field.isSown && field.crop === crop;
      }).length,
      crop,
      name: CROPS[crop].name,
    };
  }).filter((entry) => {
    return entry.count > 0;
  });
}

function farmland(tribe: Tribe, world: WorldState): FarmlandView {
  return {
    crops: cropCounts(tribe),
    fields: tribe.fields.length,
    orchardTrees: plantedCount(tribe, world, "orchard"),
    woodlotTrees: plantedCount(tribe, world, "woodlot"),
  };
}

function goalView(tribe: Tribe): GoalView | null {
  const goal = tribeGoal(tribe);

  if (goal === null) {
    return null;
  }

  return {
    isBlocked: goal.isBlocked,
    need: goal.need,
    progress: goal.progress,
    technologyName: goal.technology.name,
  };
}

export function describeTribe(tribe: Tribe, members: readonly Person[], sources: TribeSources): TribeSummary {
  const era = currentEra(tribe.technologies);

  return {
    births: tribe.births,
    buildings: buildingCounts(tribe, sources),
    campX: tribe.campX,
    campZ: tribe.campZ,
    children: members.filter((person) => {
      return isChild(person);
    }).length,
    color: tribe.color,
    deaths: tribe.deaths,
    era: { count: ERA_COUNT, index: era.index, nextName: nextEraName(tribe) },
    eraName: era.name,
    faith: tribe.faith,
    farmland: farmland(tribe, sources.world),
    furColor: tribe.furColor,
    goal: goalView(tribe),
    id: tribe.id,
    isMigrating: tribe.isMigrating,
    name: tribe.name,
    population: members.length,
    stock: { ...tribe.stock },
    technologies: technologyNames(tribe),
    tools: tribe.tools,
  };
}

export function describeWeather(weather: WeatherSystem, environment: Environment): WeatherView {
  const { state } = weather;

  return {
    airTemperatureOffset: environment.airTemperatureOffset,
    cloudCover: state.cloudCover,
    fog: state.fog,
    isAutomatic: state.isAutomatic,
    kind: state.kind,
    name: weather.name,
    precipitation: state.precipitation,
    storm: state.storm,
    userTemperatureOffset: state.userTemperatureOffset,
    windBaseSpeed: state.windBaseSpeed,
    windDirection: state.windDirection,
    windSpeed: state.windSpeed,
    windX: environment.windX,
    windZ: environment.windZ,
  };
}

export function packBurningCells(world: WorldState, cells: Int32Array): Uint8Array {
  return Uint8Array.from(cells, (cell) => {
    return toByte(world.fields.fire[cell]);
  });
}

export function packLava(heats: ReadonlyMap<number, number> | null): LavaView | null {
  if (heats === null) {
    return null;
  }

  return { cells: Int32Array.from(heats.keys()), heat: Uint8Array.from(heats.values(), toByte) };
}
