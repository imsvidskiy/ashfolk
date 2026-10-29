import { fog, uniform } from "three/tsl";
import { Color, DirectionalLight, Group, HemisphereLight, type Scene, Vector3 } from "three/webgpu";
import { type Direction, moonDirection, sunDirection } from "../../shared/astronomy.ts";
import { clamp, lerp, saturate, smoothstep } from "../../shared/math.ts";
import { SHADOW_ONLY_LAYER } from "../shadow-only-layer.ts";
import { CloudSea } from "./cloud-sea.ts";
import { fogShapeFor, HeightFog } from "./height-fog.ts";
import { SkyDome } from "./sky-dome.ts";
import { type SkyPalette, skyPaletteAt } from "./sky-palette.ts";

const CELESTIAL_DISTANCE = 6000;
const SHADOW_DEPTH_SPAN = 3000;
const SHADOW_DEPTH_BIAS = 0.05;
const SHADOW_REACH_STEPS_PER_OCTAVE = 4;
const NEAREST_SHADOW_REACH = 120;
const FARTHEST_SHADOW_REACH = 2600;
const FARTHEST_FILMED_SHADOW_REACH = 8000;
const SHADOW_REACH_SHARE_OF_DISTANCE = 0.9;
const FILMED_DEPTH_SHARE_OF_REACH = 1.5;
const WORLD_UP = new Vector3(0, 1, 0);
const SKY_CLOUD_DRIFT = 0.000_02;
const SEA_CLOUD_DRIFT = 0.000_004;
const LEAST_NORMAL_BIAS = 0.4;
const TEXELS_OF_NORMAL_BIAS = 1.2;

interface AtmosphereState {
  readonly cloudCover: number;
  readonly flash: number;
  readonly fog: number;
  readonly hours: number;
  readonly precipitation: number;
  readonly season: number;
  readonly snowfall: number;
  readonly storm: number;
  readonly windX: number;
  readonly windZ: number;
}

interface AtmosphereOptions {
  readonly cloudSeaAltitude: number;
  readonly islandHalfSize: number;
  readonly shadowMapSize: number;
}

function gloomOf(state: AtmosphereState): number {
  const rainfall = Math.max(0, state.precipitation - state.snowfall);

  return saturate(rainfall * 0.75 + state.snowfall * 0.25 + state.storm * 0.35);
}

function quantizedReach(reach: number): number {
  const octaves = Math.round(Math.log2(reach) * SHADOW_REACH_STEPS_PER_OCTAVE) / SHADOW_REACH_STEPS_PER_OCTAVE;

  return 2 ** octaves;
}

export class Atmosphere {
  readonly sun: DirectionalLight;
  readonly #cloudSea: CloudSea;
  readonly #group = new Group();
  readonly #hemisphere: HemisphereLight;
  readonly #fogColor = uniform(new Color(0xcf_e2_f0));
  readonly #heightFog = new HeightFog();
  readonly #islandReach: number;
  readonly #lightDirection = new Vector3(0, 1, 0);
  readonly #shadowFocus = new Vector3();
  readonly #shadowRight = new Vector3();
  readonly #shadowUp = new Vector3();
  readonly #sky = new SkyDome();
  #daylight = 1;
  #hasFarShadows: boolean;
  #palette: SkyPalette = skyPaletteAt(1, 0, 0);

  constructor(scene: Scene, options: AtmosphereOptions) {
    this.#cloudSea = new CloudSea(options.cloudSeaAltitude);
    this.#islandReach = options.islandHalfSize * Math.SQRT2;
    this.#hasFarShadows = false;

    this.sun = new DirectionalLight(0xff_ff_ff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(options.shadowMapSize, options.shadowMapSize);
    this.sun.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);

    this.#hemisphere = new HemisphereLight(0xb6_d2_ee, 0x7a_72_5a, 1.2);

    this.#group.add(this.#sky.mesh, this.#cloudSea.mesh, this.sun, this.sun.target, this.#hemisphere);
    scene.add(this.#group);
    scene.fogNode = fog(this.#fogColor, this.#heightFog.factor);
  }

  get daylight(): number {
    return this.#daylight;
  }

  get palette(): SkyPalette {
    return this.#palette;
  }

  setShadows(mapSize: number, hasFarShadows: boolean): void {
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.#hasFarShadows = hasFarShadows;
  }

  update(state: AtmosphereState, eye: Vector3, focus: Vector3, viewDistance: number, realSeconds: number): void {
    const sun = sunDirection(state.hours, state.season);
    const moon = moonDirection(state.hours);
    const overcast = saturate(state.cloudCover * 0.75 + state.storm * 0.5);
    const gloom = gloomOf(state);
    const palette = skyPaletteAt(sun.y, overcast, gloom);

    this.#daylight = smoothstep(-0.1, 0.16, sun.y);
    this.#palette = palette;
    this.#paintSky(palette, sun, moon, state, overcast);
    this.#driftClouds(state, realSeconds);
    this.#light(palette, sun, moon, overcast, gloom);
    this.#hemisphere.intensity += state.flash * 4;
    this.#placeSun(focus, viewDistance);
    this.#applyFog(palette, state, sun.y);
    this.#sky.mesh.position.copy(eye);
    this.#cloudSea.update(focus);
  }

  dispose(): void {
    this.#sky.dispose();
    this.#cloudSea.dispose();
    this.sun.shadow.dispose();
  }

  #paintSky(palette: SkyPalette, sun: Direction, moon: Direction, state: AtmosphereState, overcast: number): void {
    const sky = this.#sky;
    const clearness = 1 - overcast * 0.9;

    sky.zenithColor.value.setHex(palette.zenith);
    sky.horizonColor.value.setHex(palette.horizon);
    sky.abyssColor.value.setHex(palette.abyss);
    sky.cloudLitColor.value.setHex(palette.cloudLit);
    sky.cloudShadeColor.value.setHex(palette.cloudShade);
    sky.sunColor.value.setHex(palette.sunlight);
    sky.sunDirection.value.set(sun.x, sun.y, sun.z);
    sky.moonDirection.value.set(moon.x, moon.y, moon.z);
    sky.sunVisibility.value = smoothstep(-0.06, 0.02, sun.y) * clearness;
    sky.moonVisibility.value = (1 - this.#daylight) * smoothstep(-0.05, 0.05, moon.y) * clearness;
    sky.starVisibility.value = (1 - smoothstep(-0.16, 0.02, sun.y)) * clearness;
    sky.cloudCover.value = saturate(0.2 + state.cloudCover * 0.8);

    const sea = this.#cloudSea;

    sea.litColor.value.setHex(palette.cloudLit);
    sea.shadeColor.value.setHex(palette.cloudShade);
    sea.sunDirection.value.set(sun.x, Math.max(sun.y, 0.05), sun.z).normalize();
  }

  #driftClouds(state: AtmosphereState, realSeconds: number): void {
    this.#sky.cloudOffset.value.x += state.windX * SKY_CLOUD_DRIFT * realSeconds * 60;
    this.#sky.cloudOffset.value.y += state.windZ * SKY_CLOUD_DRIFT * realSeconds * 60;
    this.#cloudSea.drift.value.x += (state.windX + 1) * SEA_CLOUD_DRIFT * realSeconds * 60;
    this.#cloudSea.drift.value.y += (state.windZ + 0.4) * SEA_CLOUD_DRIFT * realSeconds * 60;
  }

  #light(palette: SkyPalette, sun: Direction, moon: Direction, overcast: number, gloom: number): void {
    this.sun.color.setHex(palette.sunlight);

    if (sun.y < -0.04) {
      this.#lightDirection.set(moon.x, Math.max(moon.y, 0.2), moon.z).normalize();
      this.sun.intensity =
        0.7 * smoothstep(-0.05, 0.3, moon.y) * smoothstep(-0.04, -0.14, sun.y) * (1 - overcast * 0.6);
    } else {
      this.#lightDirection.set(sun.x, Math.max(sun.y, 0.04), sun.z).normalize();
      this.sun.intensity = lerp(3.2, 0.9, overcast) * (1 - gloom * 0.4) * smoothstep(-0.04, 0.12, sun.y);
    }

    this.#hemisphere.color.setHex(palette.ambientSky);
    this.#hemisphere.groundColor.setHex(palette.ambientGround);
    this.#hemisphere.intensity = lerp(0.95, 1.8, this.#daylight) * lerp(1, 1.25, overcast) * (1 - gloom * 0.3);
  }

  #placeSun(focus: Vector3, viewDistance: number): void {
    const reach = quantizedReach(this.#shadowReach(focus, viewDistance));
    const depthSpan = this.#hasFarShadows
      ? Math.max(SHADOW_DEPTH_SPAN, reach * FILMED_DEPTH_SHARE_OF_REACH)
      : SHADOW_DEPTH_SPAN;
    const lightDistance = Math.max(CELESTIAL_DISTANCE, depthSpan * 2);
    const texelSize = (reach * 2) / this.sun.shadow.mapSize.x;
    const shadow = this.sun.shadow.camera;
    const anchor = this.#shadowAnchor(focus, texelSize);

    this.sun.position.copy(anchor).addScaledVector(this.#lightDirection, lightDistance);
    this.sun.target.position.copy(anchor);
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.near = lightDistance - depthSpan;
    shadow.far = lightDistance + depthSpan;
    shadow.updateProjectionMatrix();
    this.sun.shadow.bias = -SHADOW_DEPTH_BIAS / (depthSpan * 2);
    this.sun.shadow.normalBias = Math.max(LEAST_NORMAL_BIAS, texelSize * TEXELS_OF_NORMAL_BIAS);
  }

  #shadowReach(focus: Vector3, viewDistance: number): number {
    const reach = viewDistance * SHADOW_REACH_SHARE_OF_DISTANCE;

    if (!this.#hasFarShadows) {
      return clamp(reach, NEAREST_SHADOW_REACH, FARTHEST_SHADOW_REACH);
    }

    const islandReach = this.#islandReach + Math.hypot(focus.x, focus.z);

    return clamp(Math.max(reach, islandReach), NEAREST_SHADOW_REACH, FARTHEST_FILMED_SHADOW_REACH);
  }

  #shadowAnchor(focus: Vector3, texelSize: number): Vector3 {
    const right = this.#shadowRight.crossVectors(WORLD_UP, this.#lightDirection).normalize();
    const up = this.#shadowUp.crossVectors(this.#lightDirection, right);

    const across = Math.round(focus.dot(right) / texelSize) * texelSize;
    const along = Math.round(focus.dot(up) / texelSize) * texelSize;
    const depth = focus.dot(this.#lightDirection);

    return this.#shadowFocus
      .copy(right)
      .multiplyScalar(across)
      .addScaledVector(up, along)
      .addScaledVector(this.#lightDirection, depth);
  }

  #applyFog(palette: SkyPalette, state: AtmosphereState, sunHeight: number): void {
    this.#fogColor.value.setHex(palette.horizon);
    this.#heightFog.apply(
      fogShapeFor({ mist: state.fog, precipitation: state.precipitation, snowfall: state.snowfall, sunHeight })
    );
  }
}
