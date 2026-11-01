import {
  abs,
  cameraPosition,
  clamp,
  cos,
  distance,
  dot,
  float,
  length,
  max,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  textureLoad,
  time,
  uint,
  uniform,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { Color, Group, Mesh, MeshBasicNodeMaterial, type PerspectiveCamera, Vector2, type Vector3 } from "three/webgpu";
import { fallsAsSnow, type WeatherKind } from "../../content/weather.ts";
import { fractionalPart, saturate } from "../../shared/math.ts";
import type { WorldGrid } from "../../world/world-grid.ts";
import { unitHash } from "../node-helpers.ts";
import { cellAtNode, sampleHeightNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { billboardNodes, type CameraAxes, createQuadGeometry, distanceFromBillboardCenter } from "./billboards.ts";
import { CYCLES, cycleOf, type LatticeArea, LatticeCover, latticeElement } from "./precipitation-lattice.ts";

const NEAREST_SPAN = 70;
const SPAN_PER_DISTANCE = 1.6;
const NATURAL_VIEW = 60;
const NATURAL_SPAN = NATURAL_VIEW * SPAN_PER_DISTANCE;
const TILE_SIZE = 12;
const COLUMN_HEIGHT = 43;
const DROPS_PER_TILE = 312;
const RANGE_FADE_START = 0.72;
const LIGHTEST_PRECIPITATION = 0.04;
const FAINTEST_DROP = 0.002;
const SALT_OCTAVE = 0x9e_37_79_b9;
const SALT_VARIETY = 0xa5_4f_f5_3a;
const CYCLE_SALTS = { across: 0x9b_05_68_8c, along: 0x1f_83_d9_ab, cycle: 0x51_0e_52_7f, phase: 0x3c_6e_f3_72 };

export type Precipitation = "rain" | "snow";

interface PrecipitationLook {
  readonly color: number;
  readonly fallSpeed: number;
  readonly longest: number;
  readonly opacity: number;
  readonly shortest: number;
  readonly size: number;
  readonly sway: number;
  readonly thickest: number;
  readonly thinnest: number;
  readonly windShare: number;
}

const LOOKS: Readonly<Record<Precipitation, PrecipitationLook>> = {
  rain: {
    color: 0xc8_d2_de,
    fallSpeed: 26,
    longest: 0.04,
    opacity: 0.5,
    shortest: 0.013,
    size: 0.016,
    sway: 0,
    thickest: 0.0028,
    thinnest: 0.0015,
    windShare: 1.6,
  },
  snow: {
    color: 0xff_ff_ff,
    fallSpeed: 2.6,
    longest: 0.011,
    opacity: 0.9,
    shortest: 0.0042,
    size: 0.09,
    sway: 0.7,
    thickest: 0.011,
    thinnest: 0.0042,
    windShare: 1,
  },
};

interface PrecipitationView {
  readonly camera: PerspectiveCamera;
  readonly focus: Vector3;
  readonly realSeconds: number;
  readonly viewDistance: number;
}

interface Precipitating {
  readonly brightness: number;
  readonly form: Precipitation;
  readonly precipitation: number;
  readonly windX: number;
  readonly windZ: number;
}

interface DropSources {
  readonly axes: CameraAxes;
  readonly grid: WorldGrid;
  readonly textures: TerrainTextures;
  readonly uniforms: DropUniforms;
}

export function precipitationOf(kind: WeatherKind, temperature: number): Precipitation {
  if (fallsAsSnow(kind, temperature)) {
    return "snow";
  }

  return "rain";
}

export function precipitationStrength(precipitation: number): number {
  return saturate((precipitation - LIGHTEST_PRECIPITATION) / (1 - LIGHTEST_PRECIPITATION));
}

class DropUniforms {
  readonly color = uniform(new Color());
  readonly driftShare = uniform(new Vector2());
  readonly fallen = uniform(0);
  readonly focus = uniform(new Vector2());
  readonly isSnow = uniform(0);
  readonly longest = uniform(LOOKS.rain.longest);
  readonly opacity = uniform(LOOKS.rain.opacity);
  readonly reach = uniform(NEAREST_SPAN / 2);
  readonly shortest = uniform(LOOKS.rain.shortest);
  readonly size = uniform(LOOKS.rain.size);
  readonly slant = uniform(new Vector2());
  readonly span = uniform(NEAREST_SPAN);
  readonly sway = uniform(0);
  readonly thickest = uniform(LOOKS.rain.thickest);
  readonly thinnest = uniform(LOOKS.rain.thinnest);
  readonly viewportSpan = uniform(1);
}

class DropOctave {
  readonly mesh: Mesh;
  readonly #cover: LatticeCover;
  readonly #geometry = createQuadGeometry();
  readonly #level = uniform(0);
  readonly #material = new MeshBasicNodeMaterial({ depthWrite: false, fog: false, transparent: true });
  readonly #scale = uniform(1);

  constructor({ axes, grid, textures, uniforms }: DropSources) {
    const material = this.#material;
    const { corner } = billboardNodes();
    const scale = this.#scale;

    this.#cover = new LatticeCover(grid.halfSize);

    const element = latticeElement(this.#cover, uint(this.#level).mul(SALT_OCTAVE));
    const { age: fall, phase, spread } = cycleOf(element, uniforms.fallen, CYCLE_SALTS);
    const variety = unitHash(element.seed, SALT_VARIETY);
    const tileSize = scale.mul(TILE_SIZE);
    const columnHeight = scale.mul(COLUMN_HEIGHT);

    const height = columnHeight.mul(float(1).sub(fall));
    const swirl = vec2(sin(time.mul(0.9).add(phase.mul(40))), cos(time.mul(0.7).add(variety.mul(30))));

    const place = element.tile.add(spread).add(uniforms.driftShare).mul(tileSize);
    const wander = swirl.mul(uniforms.sway).mul(scale);
    const landing = place.add(uniforms.slant.mul(height));

    const cell = cellAtNode(grid, landing);
    const surface = max(sampleHeightNode(textures.height, grid, landing), textureLoad(textures.water, cell).x);
    const center = vec3(place.x.add(wander.x), surface.add(height), place.y.add(wander.y));

    const cameraDistance = distance(center, cameraPosition);
    const viewportMeters = cameraDistance.mul(uniforms.viewportSpan);
    const natural = uniforms.size.mul(scale).mul(variety.mul(0.6).add(0.7));
    const streakAxis = normalize(vec3(uniforms.slant.x.negate(), 1, uniforms.slant.y.negate()));
    const isOnIsland = textures.outline.insideNode(landing);

    const streakLength = clamp(
      natural.mul(mix(float(60), float(1), uniforms.isSnow)),
      viewportMeters.mul(uniforms.shortest),
      viewportMeters.mul(uniforms.longest)
    );
    const width = clamp(natural, viewportMeters.mul(uniforms.thinnest), viewportMeters.mul(uniforms.thickest));
    const axis = normalize(mix(streakAxis, axes.up, uniforms.isSnow));
    const side = normalize(axes.right.sub(axis.mul(dot(axes.right, axis))));

    const slabFade = smoothstep(0, 0.12, fall);
    const rangeFade = smoothstep(
      uniforms.reach,
      uniforms.reach.mul(RANGE_FADE_START),
      length(place.sub(uniforms.focus))
    );
    const lensFade = smoothstep(uniforms.span.mul(0.015), uniforms.span.mul(0.05), cameraDistance);

    const visibility = element.presence
      .mul(slabFade)
      .mul(rangeFade)
      .mul(lensFade)
      .mul(select(isOnIsland, float(1), float(0)));

    const extent = select(visibility.greaterThan(FAINTEST_DROP), float(1), float(0));
    const rise = corner.y.sub(uniforms.isSnow.mul(0.5)).mul(mix(streakLength, width, uniforms.isSnow));

    material.positionNode = center.add(side.mul(corner.x.mul(width).mul(extent))).add(axis.mul(rise.mul(extent)));

    const shape = varying(corner, "dropCorner");
    const fade = varying(visibility, "dropFade");

    const across = smoothstep(0.5, 0.15, abs(shape.x));
    const streak = across.mul(smoothstep(0, 0.15, shape.y)).mul(smoothstep(1, 0.35, shape.y));
    const flake = smoothstep(0.5, 0.2, distanceFromBillboardCenter(shape));

    material.colorNode = uniforms.color;
    material.opacityNode = mix(streak, flake, uniforms.isSnow).mul(fade).mul(uniforms.opacity);

    this.mesh = new Mesh(this.#geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.visible = false;
  }

  cover(level: number, shown: number, area: LatticeArea, drift: Vector2): void {
    const scale = 2 ** level;

    this.#level.value = level;
    this.#scale.value = scale;
    this.#cover.cover(area, TILE_SIZE * scale, shown, drift);
    this.#geometry.instanceCount = this.#cover.count;
    this.mesh.visible = this.#cover.count > 0;
  }

  hide(): void {
    this.#geometry.instanceCount = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#material.dispose();
  }
}

export class WeatherParticles {
  readonly group = new Group();
  readonly #coarse: DropOctave;
  readonly #drift = new Vector2();
  readonly #fine: DropOctave;
  readonly #uniforms = new DropUniforms();

  constructor(axes: CameraAxes, textures: TerrainTextures, grid: WorldGrid) {
    const sources = { axes, grid, textures, uniforms: this.#uniforms };

    this.#fine = new DropOctave(sources);
    this.#coarse = new DropOctave(sources);
    this.group.add(this.#fine.mesh, this.#coarse.mesh);
  }

  update(weather: Precipitating, view: PrecipitationView): void {
    const strength = precipitationStrength(weather.precipitation);

    if (strength <= 0) {
      this.#fine.hide();
      this.#coarse.hide();

      return;
    }

    const look = LOOKS[weather.form];
    const seconds = view.realSeconds;
    const span = Math.max(NEAREST_SPAN, view.viewDistance * SPAN_PER_DISTANCE);
    const octave = Math.log2(Math.max(1, view.viewDistance / NATURAL_VIEW));
    const windX = weather.windX * look.windShare;
    const windZ = weather.windZ * look.windShare;

    const finer = Math.floor(octave);
    const perTile = DROPS_PER_TILE * strength * Math.max(1, (NATURAL_SPAN / span) ** 2);
    const area = { centerX: view.focus.x, centerZ: view.focus.z, radius: span / 2 };
    const blend = octave - finer;

    this.#drift.x += (windX * seconds) / TILE_SIZE;
    this.#drift.y += (windZ * seconds) / TILE_SIZE;
    this.#fine.cover(finer, perTile * (4 ** -blend - blend / 4), area, this.#drift);
    this.#coarse.cover(finer + 1, perTile * blend, area, this.#drift);

    const uniforms = this.#uniforms;

    uniforms.fallen.value = (uniforms.fallen.value + (look.fallSpeed * seconds) / COLUMN_HEIGHT) % CYCLES;
    uniforms.driftShare.value.set(fractionalPart(this.#drift.x), fractionalPart(this.#drift.y));
    uniforms.focus.value.set(view.focus.x, view.focus.z);
    uniforms.span.value = span;
    uniforms.reach.value = span / 2;
    uniforms.slant.value.set(windX / look.fallSpeed, windZ / look.fallSpeed);
    uniforms.viewportSpan.value = 2 * Math.tan((view.camera.fov * Math.PI) / 360);
    uniforms.isSnow.value = weather.form === "snow" ? 1 : 0;
    uniforms.color.value.setHex(look.color).multiplyScalar(weather.brightness);
    uniforms.opacity.value = look.opacity * (0.55 + strength * 0.45);
    uniforms.size.value = look.size;
    uniforms.sway.value = look.sway;
    uniforms.shortest.value = look.shortest;
    uniforms.longest.value = look.longest;
    uniforms.thinnest.value = look.thinnest;
    uniforms.thickest.value = look.thickest;
  }

  dispose(): void {
    this.#fine.dispose();
    this.#coarse.dispose();
  }
}
