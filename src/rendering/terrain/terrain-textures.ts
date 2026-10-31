import { uniform } from "three/tsl";
import { Color, type DataTexture, RedFormat, RGBAFormat, RGFormat, type WebGPURenderer } from "three/webgpu";
import { Ground, isPoolGround } from "../../content/grounds.ts";
import type { WorldMirror } from "../../game/world-mirror.ts";
import type { CellRegion, RowRun } from "../../world/change-tracking.ts";
import { sampleCells } from "../../world/terrain-sampling.ts";
import { POND_SHORE_SLOPE, pondEdgeReach, pondOutlineExtent } from "../../world/water.ts";
import { byteTexture, floatDataTexture } from "../data-textures.ts";
import { CaveOutlets } from "../water/cave-outlets.ts";
import { FordField } from "../water/ford-field.ts";
import {
  buildShoreField,
  NOT_POND,
  SHORE_CHANNELS,
  ShoreChannel,
  type ShoreSource,
  updateShoreDepths,
  updateShoreField,
} from "../water/shore-field.ts";
import type { WorldChanges } from "../world-changes.ts";
import { FieldPlan } from "./field-plan.ts";
import { bloomFor } from "./fireweed.ts";
import { GroundAlbedo } from "./ground-albedo.ts";
import { IslandOutline } from "./island-outline.ts";
import { LavaField } from "./lava-field.ts";
import { PATCH_CELLS, PATCH_STEPS } from "./terrain-patches.ts";

const SEASON_STEP = 0.01;
const POND_SHORE_CELLS = 2;
const BYTE = 255;
const WETLAND_CHANNELS = 2;

export class TerrainTextures {
  readonly bloom = uniform(0);
  readonly caveOutlets: CaveOutlets;
  readonly daylight = uniform(1);
  readonly fields: FieldPlan;
  readonly fords: FordField;
  readonly groundAlbedo: GroundAlbedo;
  readonly height: DataTexture;
  readonly lava: LavaField;
  readonly outline: IslandOutline;
  readonly patchSteps: DataTexture;
  readonly patchesPerSide: number;
  readonly shore: DataTexture;
  readonly skyColor = uniform(new Color(0x9c_c0_e0));
  readonly surface: DataTexture;
  readonly water: DataTexture;
  readonly wetland: DataTexture;
  readonly #mirror: WorldMirror;
  readonly #patchStepData: Float32Array;
  readonly #pondDepths: Float32Array;
  readonly #shoreData: Float32Array;
  readonly #wetlandData: Uint8Array;
  #albedoSeason = Number.NEGATIVE_INFINITY;

  constructor(mirror: WorldMirror) {
    const size = mirror.grid.cellsPerSide;

    this.#mirror = mirror;
    this.caveOutlets = new CaveOutlets(mirror.grid, mirror.water.springs);
    this.fords = new FordField(mirror.grid, mirror.crossings);
    this.height = floatDataTexture(mirror.terrain.height, size, size, RedFormat);
    this.lava = new LavaField(size);
    this.outline = new IslandOutline(mirror);
    this.patchesPerSide = Math.ceil(size / PATCH_CELLS);
    this.#patchStepData = new Float32Array(this.patchesPerSide * this.patchesPerSide).fill(1);
    this.patchSteps = floatDataTexture(this.#patchStepData, this.patchesPerSide, this.patchesPerSide, RedFormat);
    this.water = floatDataTexture(mirror.terrain.waterSurface, size, size, RedFormat);
    this.#shoreData = new Float32Array(size * size * SHORE_CHANNELS);
    this.#pondDepths = new Float32Array(size * size);
    this.shore = floatDataTexture(this.#shoreData, size, size, RGBAFormat);
    this.#buildShore();
    this.surface = byteTexture(mirror.surface, size, RGBAFormat);
    this.#wetlandData = new Uint8Array(size * size * WETLAND_CHANNELS);
    this.#paintWetland({ firstRow: 0, rowCount: size });
    this.wetland = byteTexture(this.#wetlandData, size, RGFormat);
    this.groundAlbedo = new GroundAlbedo(mirror);
    this.fields = new FieldPlan(mirror);
  }

  shoreDepthAt(x: number, z: number): number {
    return sampleCells(this.#shoreData, this.#mirror.grid, x, z, SHORE_CHANNELS, ShoreChannel.Depth);
  }

  followPatchLevels(levels: Readonly<Int8Array>): void {
    let hasChanged = false;

    for (const [patch, level] of levels.entries()) {
      const step = level < 0 ? 1 : PATCH_STEPS[level];

      if (this.#patchStepData[patch] !== step) {
        this.#patchStepData[patch] = step;
        hasChanged = true;
      }
    }

    if (hasChanged) {
      this.patchSteps.needsUpdate = true;
    }
  }

  update(renderer: WebGPURenderer, season: number, changes: WorldChanges): void {
    this.bloom.value = bloomFor(season);

    if (changes.heightRegion !== null) {
      this.height.needsUpdate = true;
      this.fields.heightsChanged(changes.heightRegion);
    }

    if (changes.hasWaterChanged || changes.waterLevelRegion !== null) {
      this.water.needsUpdate = true;
    }

    if (changes.hasWaterChanged) {
      this.#buildShore();
      this.caveOutlets.rebuild(this.#mirror.water.springs);
      this.fords.rebuild(this.#mirror.crossings);
    } else {
      this.#updateShore(changes.waterLevelRegion, changes.heightRegion);
    }

    if (changes.surfaceRuns.length > 0) {
      this.surface.needsUpdate = true;
    }

    if (changes.groundRuns.length > 0) {
      this.groundAlbedo.groundChanged();
      this.fields.groundChanged(changes.groundRuns);

      for (const run of changes.groundRuns) {
        this.#paintWetland(run);
      }

      this.wetland.needsUpdate = true;
    }

    const hasSeasonChanged = Math.abs(season - this.#albedoSeason) >= SEASON_STEP;

    if (hasSeasonChanged || changes.groundRuns.length > 0) {
      this.groundAlbedo.paint(renderer, season);
      this.#albedoSeason = season;
    }
  }

  dispose(): void {
    this.groundAlbedo.dispose();
    this.caveOutlets.dispose();
    this.fords.dispose();
    this.fields.dispose();
    this.outline.dispose();
    this.height.dispose();
    this.lava.dispose();
    this.patchSteps.dispose();
    this.surface.dispose();
    this.water.dispose();
    this.shore.dispose();
    this.wetland.dispose();
  }

  #paintWetland({ firstRow, rowCount }: RowRun): void {
    const { grid, terrain } = this.#mirror;

    const firstCell = firstRow * grid.cellsPerSide;
    const lastCell = (firstRow + rowCount) * grid.cellsPerSide;

    for (let cell = firstCell; cell < lastCell; cell += 1) {
      const ground = terrain.ground[cell];
      const isPool = isPoolGround(ground);

      this.#wetlandData[cell * WETLAND_CHANNELS] = isPool || ground === Ground.Swamp ? BYTE : 0;
      this.#wetlandData[cell * WETLAND_CHANNELS + 1] = isPool ? BYTE : 0;
    }
  }

  #shoreSource(): ShoreSource {
    const { grid, terrain } = this.#mirror;

    return {
      cellSize: grid.cellSize,
      heights: terrain.height,
      levels: terrain.waterSurface,
      pondDepths: this.#pondDepths,
      size: grid.cellsPerSide,
    };
  }

  #measurePondShores(): void {
    const { grid, water } = this.#mirror;

    this.#pondDepths.fill(NOT_POND);

    for (const spring of water.springs) {
      if (spring.kind !== "pond") {
        continue;
      }

      for (const cell of grid.cellsInRadius(
        spring.x,
        spring.z,
        pondOutlineExtent(spring) + grid.cellSize * POND_SHORE_CELLS
      )) {
        const reach = pondEdgeReach(spring, grid.cellCenterX(cell), grid.cellCenterZ(cell));

        this.#pondDepths[cell] = Math.min(this.#pondDepths[cell], reach * POND_SHORE_SLOPE);
      }
    }
  }

  #buildShore(): void {
    this.#measurePondShores();
    buildShoreField(this.#shoreSource(), this.#shoreData);
    this.shore.needsUpdate = true;
  }

  #updateShore(levelRegion: CellRegion | null, heightRegion: CellRegion | null): void {
    if (levelRegion === null && heightRegion === null) {
      return;
    }

    const source = this.#shoreSource();

    if (levelRegion !== null) {
      updateShoreField(source, levelRegion, this.#shoreData);
      this.shore.needsUpdate = true;
    }

    if (heightRegion !== null) {
      updateShoreDepths(source, heightRegion, this.#shoreData);
      this.shore.needsUpdate = true;
    }
  }
}
