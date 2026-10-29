import { Frustum, Matrix4, type PerspectiveCamera, Scene, Vector2, Vector3, type WebGPURenderer } from "three/webgpu";
import type { WorldMirror } from "../game/world-mirror.ts";
import { lerp } from "../shared/math.ts";
import type { SimulationEffect } from "../simulation/effects.ts";
import type { GrabTarget } from "../simulation/hand/grab-target.ts";
import { NO_PLANT } from "../world/vegetation-store.ts";
import { AgentMarkers } from "./agents/agent-markers.ts";
import type { AgentViewInput } from "./agents/agent-view-input.ts";
import { AnimalView } from "./agents/animal-view.ts";
import { PeopleView } from "./agents/people-view.ts";
import { Atmosphere } from "./atmosphere/atmosphere.ts";
import { CameraAxes } from "./effects/billboards.ts";
import { EffectView } from "./effects/effect-view.ts";
import { FireGlow } from "./effects/fire-glow.ts";
import { FireView } from "./effects/fire-view.ts";
import { GroundRing, NO_FLOOR } from "./effects/ground-ring.ts";
import { RainSplashes } from "./effects/rain-splashes.ts";
import {
  type Precipitation,
  precipitationOf,
  precipitationStrength,
  WeatherParticles,
} from "./effects/weather-particles.ts";
import { HandMotion } from "./hand-motion.ts";
import { createRenderOutput, type RenderOutput } from "./render-output.ts";
import type { RenderQuality } from "./render-quality.ts";
import { BuildingView } from "./structures/building-view.ts";
import { CrossingView } from "./structures/crossing-view.ts";
import { IslandBase } from "./terrain/island-base.ts";
import { islandPlinthHeight } from "./terrain/island-base-geometry.ts";
import { TerrainTextures } from "./terrain/terrain-textures.ts";
import { TerrainView } from "./terrain/terrain-view.ts";
import { TribeLooks } from "./tribe-looks.ts";
import { CropField } from "./vegetation/crop-field.ts";
import { GrassField } from "./vegetation/grass-field.ts";
import { UnderstoryField } from "./vegetation/understory-field.ts";
import { VegetationView } from "./vegetation/vegetation-view.ts";
import { LilyPads } from "./water/lily-pads.ts";
import { areSpringsShapedBy, SpringView } from "./water/spring-view.ts";
import { WaterView } from "./water/water-view.ts";
import { WaterfallView } from "./water/waterfall-view.ts";
import { WorldChangeReader } from "./world-changes.ts";

const CLOUD_SEA_DEPTH = 760;
const WATER_DRIFT = 0.08;
const SELECTION_COLOR = 0xff_f2_c8;
const HELD_RING_RADIUS = 2.5;
const PLACEABLE_COLOR = 0xff_ff_ff;
const BLOCKED_COLOR = 0xff_4a_3a;
const HOVER_OPACITY = 0.55;
const RING_SHARE_OF_DISTANCE = 0.02;
const RING_WIDTH_SHARE_OF_DISTANCE = 0.004;
const PLANT_RING_SHARE = 0.3;
const NIGHT_MARKER_BRIGHTNESS = 0.8;

const AGENT_RING_RADIUS = { animal: 2.2, person: 1.4 } as const;

const SELECTION_RADIUS: Readonly<Record<"animal" | "building" | "cell" | "person", number>> = {
  animal: 2.6,
  building: 5.5,
  cell: 5,
  person: 1.3,
};

interface RenderView {
  readonly camera: PerspectiveCamera;
  readonly effects: readonly SimulationEffect[];
  readonly focus: Vector3;
  readonly now: number;
  readonly realSeconds: number;
  readonly viewDistance: number;
}

type ShakeListener = (amount: number, x: number, z: number) => void;

interface WorldRendererOptions {
  readonly camera: PerspectiveCamera;
  readonly mirror: WorldMirror;
  readonly onShake: ShakeListener;
  readonly quality: RenderQuality;
  readonly renderer: WebGPURenderer;
}

export class WorldRenderer {
  readonly cursor: GroundRing;
  readonly scene = new Scene();
  readonly #animals = new AnimalView();
  readonly #atmosphere: Atmosphere;
  readonly #axes = new CameraAxes();
  readonly #buildings: BuildingView;
  readonly #changes: WorldChangeReader;
  readonly #crops: CropField;
  readonly #crossings: CrossingView;
  readonly #effects: EffectView;
  readonly #fire: FireView;
  readonly #fireGlow: FireGlow;
  readonly #frustum = new Frustum();
  readonly #grass: GrassField;
  readonly #hand = new HandMotion();
  readonly #heldRing: GroundRing;
  readonly #islandBase: IslandBase;
  readonly #lilies: LilyPads;
  readonly #markers: AgentMarkers;
  readonly #matrix = new Matrix4();
  readonly #mirror: WorldMirror;
  readonly #output: RenderOutput;
  readonly #people: PeopleView;
  readonly #plinth: number;
  readonly #quality: RenderQuality;
  readonly #renderer: WebGPURenderer;
  readonly #ringCenter = new Vector3();
  readonly #selectionRing: GroundRing;
  readonly #splashes: RainSplashes;
  readonly #springs = new SpringView();
  readonly #terrain: TerrainView;
  readonly #textures: TerrainTextures;
  readonly #tribes = new TribeLooks();
  readonly #understory: UnderstoryField;
  readonly #vegetation: VegetationView;
  readonly #viewport = new Vector2();
  readonly #water: WaterView;
  readonly #waterfalls = new WaterfallView();
  readonly #weather: WeatherParticles;
  #highlighted: GrabTarget | null = null;

  constructor({ camera, mirror, onShake, quality, renderer }: WorldRendererOptions) {
    this.#mirror = mirror;
    this.#quality = quality;
    this.#renderer = renderer;
    this.#changes = new WorldChangeReader(mirror);
    this.#textures = new TerrainTextures(mirror);
    this.#plinth = islandPlinthHeight(mirror, this.#textures.outline);
    this.#fireGlow = new FireGlow(mirror.grid);
    this.#terrain = new TerrainView(mirror, this.#textures, this.#plinth, this.#fireGlow, renderer);
    this.#islandBase = new IslandBase(mirror, this.#textures, this.#plinth);
    this.#water = new WaterView(mirror, this.#textures);
    this.#waterfalls.rebuild(mirror.water.waterfalls, this.#textures, this.#plinth);
    this.#springs.rebuild(mirror);
    this.#lilies = new LilyPads(mirror, this.#textures);
    this.#vegetation = new VegetationView(mirror, this.#textures, this.#fireGlow);
    this.#crops = new CropField(mirror, this.#vegetation.weather, this.#textures.fields);
    this.#crossings = new CrossingView(mirror, this.#textures);
    this.#understory = new UnderstoryField(mirror);
    this.#people = new PeopleView(this.#tribes);
    this.#buildings = new BuildingView(this.#tribes, this.#textures, mirror.grid);

    this.#grass = new GrassField({
      clumpsPerSide: quality.grassClumpsPerSide,
      grid: mirror.grid,
      textures: this.#textures,
      understory: this.#understory.texture,
      weather: this.#vegetation.weather,
    });

    this.cursor = new GroundRing(this.#textures, mirror.grid);
    this.#selectionRing = new GroundRing(this.#textures, mirror.grid);
    this.#heldRing = new GroundRing(this.#textures, mirror.grid);
    this.#fire = new FireView({ axes: this.#axes, chunks: this.#vegetation.chunks });
    this.#markers = new AgentMarkers(this.#axes, mirror);
    this.#weather = new WeatherParticles(this.#axes, this.#textures, mirror.grid);
    this.#splashes = new RainSplashes(this.#axes, this.#textures, mirror.grid);

    this.#effects = new EffectView({
      axes: this.#axes,
      createRing: () => {
        return new GroundRing(this.#textures, mirror.grid);
      },
      heightAt: (x, z) => {
        return mirror.heightAt(x, z);
      },
      shake: onShake,
    });

    this.#atmosphere = new Atmosphere(this.scene, {
      cloudSeaAltitude: this.#plinth - CLOUD_SEA_DEPTH,
      shadowMapSize: quality.shadowMapSize,
    });

    this.scene.add(
      this.#terrain.group,
      this.#islandBase.mesh,
      this.#water.group,
      this.#waterfalls.mesh,
      this.#springs.mesh,
      ...this.#lilies.meshes,
      this.#vegetation.group,
      this.#crops.group,
      this.#crossings.group,
      this.#grass.mesh,
      this.#people.group,
      this.#animals.group,
      this.#markers.group,
      this.#buildings.group,
      this.cursor.mesh,
      this.#selectionRing.mesh,
      this.#heldRing.mesh,
      this.#fire.group,
      this.#effects.group,
      this.#splashes.mesh,
      this.#weather.group
    );

    this.#output = createRenderOutput(renderer, this.scene, camera, quality);
  }

  highlight(target: GrabTarget | null): void {
    this.#highlighted = target;
  }

  plantsNear(x: number, z: number, radius: number): number[] {
    return this.#vegetation.chunks.plantsNear(x, z, radius);
  }

  setOutlinesShown(areShown: boolean): void {
    this.#output.setOutlinesShown(areShown);
  }

  render(view: RenderView): void {
    const { frame } = this.#mirror;

    const changes = this.#changes.take();

    this.#textures.update(this.#renderer, frame.calendar.season, changes);
    this.#fireGlow.update(frame);
    this.#textures.lava.update(frame.lava);

    if (changes.heightRegion !== null) {
      this.#terrain.heightsChanged(changes.heightRegion);
      this.#vegetation.heightsChanged(changes.heightRegion);
      this.#understory.heightsChanged(changes.heightRegion);
      this.#crops.heightsChanged(changes.heightRegion);
    }

    if (changes.groundRuns.length > 0) {
      this.#crops.groundChanged(changes.groundRuns);
    }

    if (changes.heightRegion !== null || changes.hasWaterChanged) {
      this.#crossings.rebuild();
    }

    if (changes.vegetationIndices.length > 0) {
      this.#vegetation.plantsChanged(changes.vegetationIndices);
      this.#understory.plantsChanged(changes.vegetationIndices);
    }

    if (changes.hasWaterChanged) {
      this.#water.waterChanged(null);
    } else if (changes.waterLevelRegion !== null) {
      this.#water.waterChanged(changes.waterLevelRegion);
    }

    if (changes.hasWaterChanged || this.#waterfalls.isShapedBy(changes.heightRegion, this.#mirror.grid)) {
      this.#waterfalls.rebuild(this.#mirror.water.waterfalls, this.#textures, this.#plinth);
    }

    if (changes.hasWaterChanged || areSpringsShapedBy(changes.heightRegion, this.#mirror)) {
      this.#springs.rebuild(this.#mirror);
    }

    if (changes.hasWaterChanged) {
      this.#lilies.rebuild(this.#mirror);
    }

    const gameSeconds = frame.isPaused ? 0 : view.realSeconds * frame.speed;
    const metersPerSecond = (frame.weather.windSpeed * 1000) / 3600;
    const windX = frame.weather.windX * metersPerSecond;
    const windZ = frame.weather.windZ * metersPerSecond;
    const form = this.#precipitationAt(view.focus);
    const strength = precipitationStrength(frame.weather.precipitation);
    const rainfall = form === "rain" ? strength : 0;

    this.#atmosphere.update(
      {
        cloudCover: frame.weather.cloudCover,
        flash: this.#effects.flash,
        fog: frame.weather.fog,
        hours: frame.calendar.hours,
        precipitation: frame.weather.precipitation,
        season: frame.calendar.season,
        snowfall: form === "snow" ? frame.weather.precipitation : 0,
        storm: frame.weather.storm,
        windX,
        windZ,
      },
      view.camera.position,
      view.focus,
      view.viewDistance,
      view.realSeconds
    );

    this.#paintWater(windX, windZ, strength, rainfall, view.realSeconds);
    this.#vegetation.weather.blow(frame.weather.windX, frame.weather.windZ, metersPerSecond, view.realSeconds);
    view.camera.updateMatrixWorld();
    this.#frustum.setFromProjectionMatrix(
      this.#matrix.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse)
    );
    this.#terrain.update(view.camera, this.#frustum, this.#quality.terrainDetail);
    this.#textures.followPatchLevels(this.#terrain.patchLevels);
    this.#water.update(view.camera, this.#frustum, this.#quality.terrainDetail, this.#terrain.patchLevels);
    this.#hand.update(frame.held, view.realSeconds);
    this.#vegetation.hold(this.#hand);
    this.#vegetation.highlightPlant(this.#highlightedPlant());
    this.#vegetation.update(
      view.camera,
      this.#frustum,
      this.#atmosphere.sun,
      this.#quality.vegetationDetail,
      frame.calendar.season
    );
    this.#crops.update(view.camera, this.#frustum, this.#quality.vegetationDetail);
    this.#crossings.update(view.camera, this.#frustum, this.#quality.vegetationDetail);
    this.#grass.update(view.camera, view.viewDistance);
    this.#lilies.update(frame.calendar.season);
    this.#updateAgents(view, gameSeconds);
    this.#markSelection();
    this.#markHeld(view.camera);
    this.#updateEffects(view, gameSeconds, form, rainfall, { metersPerSecond, windX, windZ });
    this.#output.render();
  }

  dispose(): void {
    this.#fire.dispose();
    this.#effects.dispose();
    this.#weather.dispose();
    this.#splashes.dispose();
    this.cursor.dispose();
    this.#selectionRing.dispose();
    this.#heldRing.dispose();
    this.#people.dispose();
    this.#animals.dispose();
    this.#markers.dispose();
    this.#buildings.dispose();
    this.#crossings.dispose();
    this.#vegetation.dispose();
    this.#crops.dispose();
    this.#grass.dispose();
    this.#understory.dispose();
    this.#water.dispose();
    this.#waterfalls.dispose();
    this.#springs.dispose();
    this.#lilies.dispose();
    this.#terrain.dispose();
    this.#islandBase.dispose();
    this.#textures.dispose();
    this.#fireGlow.dispose();
    this.#atmosphere.dispose();
    this.#output.dispose();
  }

  #paintWater(windX: number, windZ: number, precipitation: number, rainfall: number, realSeconds: number): void {
    const { look } = this.#water;
    const { palette } = this.#atmosphere;

    this.#textures.skyColor.value.setHex(palette.horizon);
    this.#textures.daylight.value = this.#atmosphere.daylight;
    look.horizonColor.value.setHex(palette.horizon);
    look.zenithColor.value.setHex(palette.zenith);
    look.daylight.value = this.#atmosphere.daylight;
    look.precipitation.value = precipitation;
    look.rainfall.value = rainfall;
    look.windTravel.value.x += windX * WATER_DRIFT * realSeconds;
    look.windTravel.value.y += windZ * WATER_DRIFT * realSeconds;
  }

  #updateAgents(view: RenderView, gameSeconds: number): void {
    const mirror = this.#mirror;
    const { frame } = mirror;
    const { camera } = view;

    const input: AgentViewInput = {
      camera,
      detail: this.#quality.agentDetail,
      frustum: this.#frustum,
      gameSeconds,
      hand: this.#hand,
      highlighted: this.#hoverTarget(),
      markers: this.#markers,
      mirror,
      realSeconds: view.realSeconds,
      secondsSinceTick: mirror.gameSecondsSinceTick(view.now),
    };

    this.#tribes.remember(frame.tribes);
    this.#markers.brightness.value = lerp(NIGHT_MARKER_BRIGHTNESS, 1, this.#atmosphere.daylight);
    this.#markers.begin(camera, this.#frustum, this.#renderer.getSize(this.#viewport).y);
    this.#people.update(input);
    this.#animals.update(input);
    this.#markers.commit();
    this.#buildings.update(input);
  }

  #updateEffects(
    view: RenderView,
    gameSeconds: number,
    form: Precipitation,
    rainfall: number,
    wind: { metersPerSecond: number; windX: number; windZ: number }
  ): void {
    const { weather } = this.#mirror.frame;

    const darkness = 1 - this.#atmosphere.daylight;
    const brightness = 0.25 + this.#atmosphere.daylight * 0.75;

    this.#axes.update(view.camera);
    this.#fire.smoke.brightness.value = 0.3 + this.#atmosphere.daylight * 0.7;
    this.#fire.smoke.sunlight.value = this.#atmosphere.daylight;
    this.#fire.smoke.sunDirection.value
      .subVectors(this.#atmosphere.sun.position, this.#atmosphere.sun.target.position)
      .normalize();
    this.#fire.smoke.wind.value
      .set(weather.windX, weather.windZ)
      .multiplyScalar(Math.min(1.5, wind.metersPerSecond / 5));
    this.#fire.update(this.#mirror, view.camera, darkness);
    this.#effects.add(view.effects);
    this.#effects.update(view.realSeconds, gameSeconds);
    this.#splashes.update(rainfall, brightness, {
      camera: view.camera,
      focusX: view.focus.x,
      focusZ: view.focus.z,
      realSeconds: view.realSeconds,
      viewDistance: view.viewDistance,
    });
    this.#weather.update(
      {
        brightness,
        form,
        precipitation: weather.precipitation,
        windX: wind.windX,
        windZ: wind.windZ,
      },
      view
    );
  }

  #precipitationAt(focus: Vector3): Precipitation {
    const { frame, grid, terrain } = this.#mirror;

    const cell = grid.cellAt(focus.x, focus.z);
    const ground = cell < 0 ? 0 : terrain.baseTemperature[cell];

    return precipitationOf(frame.weather.kind, ground + frame.weather.airTemperatureOffset);
  }

  #markSelection(): void {
    const { inspection } = this.#mirror.frame;

    if (inspection === null || inspection.kind === "tribe") {
      this.#selectionRing.hide();

      return;
    }

    this.#selectionRing.show(inspection.x, inspection.z, SELECTION_RADIUS[inspection.kind], SELECTION_COLOR, 0.9);
  }

  #hoverTarget(): GrabTarget | null {
    if (this.#mirror.frame.held !== null) {
      return null;
    }

    return this.#highlighted;
  }

  #highlightedPlant(): number {
    const target = this.#hoverTarget();

    if (target === null || target.kind !== "plant") {
      return NO_PLANT;
    }

    return target.id;
  }

  #markHeld(camera: PerspectiveCamera): void {
    const { held } = this.#mirror.frame;

    if (held === null) {
      this.#markHover(camera);

      return;
    }

    const color = held.isPlaceable ? PLACEABLE_COLOR : BLOCKED_COLOR;

    this.#showRing(held.x, held.z, HELD_RING_RADIUS, color, 0.95, camera);
  }

  #markHover(camera: PerspectiveCamera): void {
    const target = this.#hoverTarget();
    const spot = target === null ? null : this.#spotOf(target);

    if (spot === null) {
      this.#heldRing.hide();

      return;
    }

    this.#showRing(spot.x, spot.z, spot.radius, PLACEABLE_COLOR, HOVER_OPACITY, camera);
  }

  #spotOf(target: GrabTarget): { radius: number; x: number; z: number } | null {
    const { vegetation } = this.#mirror;

    if (target.kind === "plant") {
      const radius = Math.max(HELD_RING_RADIUS, vegetation.height[target.id] * PLANT_RING_SHARE);

      return { radius, x: vegetation.x[target.id], z: vegetation.z[target.id] };
    }

    const spot = target.kind === "person" ? this.#people.hoveredSpot : this.#animals.hoveredSpot;

    return spot === null ? null : { radius: AGENT_RING_RADIUS[target.kind], x: spot.x, z: spot.z };
  }

  #showRing(x: number, z: number, radius: number, color: number, opacity: number, camera: PerspectiveCamera): void {
    const mirror = this.#mirror;

    const distance = camera.position.distanceTo(this.#ringCenter.set(x, mirror.heightAt(x, z), z));
    const shownRadius = Math.max(radius, distance * RING_SHARE_OF_DISTANCE);
    const width = distance * RING_WIDTH_SHARE_OF_DISTANCE;

    this.#heldRing.show(x, z, shownRadius, color, opacity, this.#floorAt(x, z), width);
  }

  #floorAt(x: number, z: number): number {
    const mirror = this.#mirror;

    return mirror.isWaterAt(x, z) ? mirror.surfaceAt(x, z) : NO_FLOOR;
  }
}
