import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dFdx,
  dFdy,
  distance,
  dot,
  Fn,
  float,
  floor,
  fract,
  fwidth,
  If,
  ivec2,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  select,
  smoothstep,
  texture,
  textureLoad,
  time,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  Color,
  Matrix4,
  MeshPhysicalNodeMaterial,
  type MeshStandardNodeMaterial,
  type Node,
  Vector2,
} from "three/webgpu";
import type { WorldGrid } from "../../world/world-grid.ts";
import { cellKey, rotateAroundUp, unitHash, unitNoise3 } from "../node-helpers.ts";
import { mapCoordinatesNode, sampleCellsNode } from "../terrain/height-sampling.ts";
import type { TerrainTextures } from "../terrain/terrain-textures.ts";
import { rainDimples } from "./rain-dimples.ts";
import { BANK_SINK, BANK_STEP, PRESENT_LEVEL } from "./shore-field.ts";
import { perlinWithSteps } from "./wave-noise.ts";

const HIDDEN_DEPTH = 40;
const SHORE_FADE = 0.2;
const SHORE_WOBBLE = 0.32;
const FINE_WOBBLE_NEAR = 500;
const FINE_WOBBLE_FAR = 1500;
const STILL_DEPTH = 9;
const STILL_DEPTH_PER_SLOPE = 3;
const WAVE_SAMPLE_STEP = 1;
const WAVE_FREQUENCY = 0.06;
const WAVE_STRENGTH = 1.5;
const WAVE_MORPH = 0.1;
const WAVE_FAR = 1200;
const WAVE_NEAR = 300;
const FLOW_CYCLE = 0.15;
const FLOW_TRAVEL = 5;
const COARSE_LIFT = 0.4;
const COARSE_REACH_MARGIN = 2;
const STILL_FLOW = 0.01;
const RIVER_LINE_WIDTH = 0.4;
const RAPIDS_LINE_WIDTH = 0.8;
const LINE_PIXELS = 5;
const LINE_FLATTEST = 0.012;
const LINE_FAR = 800;
const LINE_NEAR = 400;
const LINE_SHALLOWEST = 0.35;
const LINE_FRONT_END = 0.6;
const MARK_SPACING = 20;
const MARK_SHARE = 0.5;
const MARK_RADIUS = 5;
const MARK_WIDTH = 0.25;
const MARK_ARC = 0.7;
const MARK_TURN = 0.5;
const MARK_SECONDS = 9;
const MARK_TRAVEL = 1.5;
const MARK_FAR = 450;
const MARK_NEAR = 200;
const MARK_SALT_ACROSS = 0x5b_d1_e9_95;
const MARK_SALT_ALONG = 0x27_d4_eb_2f;
const MARK_SALT_PHASE = 0x16_56_67_b1;
const MARK_SALT_SHOWN = 0x85_eb_ca_6b;
const MARK_SALT_SIZE = 0xc2_b2_ae_35;
const MARK_SALT_TURN = 0x9e_37_79_b9;
const STILL_LINE_TINT = 0.08;
const LINE_TINT = 0.1;
const RAPIDS_LINE_TINT = 0.45;
const RAPIDS_TINT = 0.05;
const FOAM_COLOR = vec3(0.84, 0.9, 0.9);
const RIM_WIDTH = 0.9;
const RIM_SOFTNESS = 0.6;
const RIM_PIXELS = 2;
const RIM_WOBBLE_FREQUENCY = 0.12;
const RIM_WOBBLE_SPEED = 0.08;
const RIM_STRENGTH = 0.75;
const FLATTEST_BANK = 0.01;
const FOAM_OPACITY = 0.6;
const SHORE_FOAM_FAR = 1300;
const SHORE_FOAM_NEAR = 500;
const FORD_FOAM = 0.4;
const SHALLOW_WATER = vec3(0.14, 0.38, 0.4);
const MIDDLE_WATER = vec3(0.05, 0.27, 0.36);
const DEEP_WATER = vec3(0.025, 0.12, 0.23);
const RAPIDS_START = 0.1;
const STEEP_RUN = 0.5;
const FASTEST_FLOW = 1.2;
const RAPIDS_CALMING = 0.6;
const WATER_ROUGHNESS = 0.3;
const FOAM_ROUGHNESS = 0.85;
const ICE_ROUGHNESS = 0.4;
const WATER_SPECULAR = 0.45;
const FRESNEL_WAVE_SHARE = 0.3;
const BRIGHTEST_SKY = 0.6;
const SHALLOW_OPACITY = 0.45;
const DEEP_OPACITY = 0.96;
const SHADOW_EDGE_START = 0.36;
const ICE_COLOR = vec3(0.78, 0.86, 0.9);
const THIN_ICE = 0.15;
const SOLID_ICE = 0.5;
const RAIN_ROUGHNESS = 0.5;
const RAIN_SKY_DAMPING = 0.35;
const RAIN_SUN_DAMPING = 0.88;
const FORD_WATER_DEPTH = 0.45;
const FORD_SHALLOWING = 0.92;
const OUTLET_FLOW = 0.02;
const CAVE_DARKNESS = 0.85;
const NO_LOWER_WATER = 1e6;
const BESIDE_OFFSETS = [vec2(1, 0), vec2(-1, 0), vec2(0, 1), vec2(0, -1)];
const DIAGONAL_OFFSETS = [vec2(1, 1), vec2(-1, -1), vec2(1, -1), vec2(-1, 1)];

interface Waves {
  readonly lines: Node<"float">;
  readonly normal: Node<"vec3">;
}

interface WaterSurface {
  readonly depth: Node<"float">;
  readonly flowSpeed: Node<"float">;
  readonly fordBed: Node<"float">;
  readonly ice: Node<"float">;
  readonly lines: Node<"float">;
  readonly normal: Node<"vec3">;
  readonly shelter: Node<"float">;
  readonly viewDirection: Node<"vec3">;
  readonly viewDistance: Node<"float">;
}

interface WaterShading {
  readonly color: Node<"vec3">;
  readonly emissive: Node<"vec3">;
  readonly opacity: Node<"float">;
  readonly roughness: Node<"float">;
  readonly specularIntensity: Node<"float">;
}

function shoreWobble(depth: Node<"float">, viewDistance: Node<"float">): Node<"float"> {
  const point = positionWorld.xz;
  const fineWobble = smoothstep(FINE_WOBBLE_FAR, FINE_WOBBLE_NEAR, viewDistance).mul(0.35);

  const isStill = depth.greaterThan(fwidth(depth).mul(STILL_DEPTH_PER_SLOPE).add(STILL_DEPTH));

  return Fn(() => {
    const wobble = float(0).toVar();

    If(isStill.not(), () => {
      wobble.assign(mx_noise_float(vec3(point.mul(0.09), 3.7)));

      If(fineWobble.greaterThan(0), () => {
        wobble.addAssign(mx_noise_float(vec3(point.mul(0.37), 8.1)).mul(fineWobble));
      });
    });

    return wobble.mul(SHORE_WOBBLE);
  })();
}

function waveNormal(heights: Node<"vec3">, strength: Node<"float">): Node<"vec3"> {
  return normalize(
    vec3(heights.x.sub(heights.y).mul(strength), WAVE_SAMPLE_STEP, heights.x.sub(heights.z).mul(strength))
  );
}

function rippleLine(
  heights: Node<"vec3">,
  facing: Node<"vec2">,
  width: Node<"float">,
  pixel: Node<"float">
): Node<"float"> {
  const rise = vec2(heights.y.sub(heights.x), heights.z.sub(heights.x)).div(WAVE_SAMPLE_STEP);
  const steepness = max(length(rise), 0.0001);

  const reach = abs(heights.x).div(steepness);
  const front = smoothstep(0, LINE_FRONT_END, dot(rise, facing).div(steepness));
  const taperedWidth = width.mul(front);

  return float(1)
    .sub(smoothstep(taperedWidth, taperedWidth.add(pixel), reach))
    .mul(front)
    .mul(smoothstep(LINE_FLATTEST, LINE_FLATTEST * 2, steepness));
}

function windMark(point: Node<"vec2">, wind: Node<"vec2">, pixel: Node<"float">): Node<"float"> {
  const spot = point.div(MARK_SPACING);
  const cell = floor(spot);

  const key = cellKey(cell);
  const tip = vec2(unitHash(key, MARK_SALT_ACROSS), unitHash(key, MARK_SALT_ALONG)).mul(0.4).add(0.3);
  const age = fract(time.div(MARK_SECONDS).add(unitHash(key, MARK_SALT_PHASE)));
  const isShown = unitHash(key, MARK_SALT_SHOWN).lessThan(MARK_SHARE);
  const radius = unitHash(key, MARK_SALT_SIZE).mul(0.6).add(0.7).mul(MARK_RADIUS);
  const turn = unitHash(key, MARK_SALT_TURN).sub(0.5).mul(MARK_TURN);

  const heading = rotateAroundUp(vec3(wind.x, 0, wind.y), turn.negate()).xz;
  const offset = spot
    .sub(cell)
    .sub(tip)
    .mul(MARK_SPACING)
    .sub(heading.mul(age.mul(MARK_TRAVEL)));
  const fromCenter = offset.add(heading.mul(radius));
  const reach = length(fromCenter);
  const facing = smoothstep(MARK_ARC, 1, dot(fromCenter.div(max(reach, 0.001)), heading));
  const width = min(float(MARK_WIDTH), pixel.mul(LINE_PIXELS)).mul(facing);
  const life = smoothstep(0, 0.3, age).mul(smoothstep(1, 0.6, age));

  return float(1)
    .sub(smoothstep(width, width.add(pixel), abs(reach.sub(radius))))
    .mul(facing)
    .mul(life)
    .mul(select(isShown, float(1), float(0)));
}

function surfaceWaves(flow: Node<"vec2">, slope: Node<"float">, viewDistance: Node<"float">, look: WaterLook): Waves {
  const speed = clamp(slope.mul(55), 0, FASTEST_FLOW);
  const direction = select(slope.greaterThan(0.0001), normalize(flow), vec2(0, 0));

  const cycle = time.mul(FLOW_CYCLE);
  const calming = smoothstep(WAVE_FAR, WAVE_NEAR, viewDistance);
  const rapids = smoothstep(RAPIDS_START, STEEP_RUN, slope);
  const layer = time.mul(WAVE_MORPH);

  const phase = fract(cycle);
  const otherPhase = fract(cycle.add(0.5));

  const drift = look.windTravel;
  const travel = direction.mul(speed).mul(FLOW_TRAVEL);
  const blend = abs(phase.mul(2).sub(1));
  const strength = float(WAVE_STRENGTH)
    .mul(calming)
    .mul(float(1).sub(rapids.mul(RAPIDS_CALMING)));
  const stillness = smoothstep(STILL_FLOW, 0, slope);
  const pixel = max(length(fwidth(positionWorld.xz)), 0.001);
  const lineWidth = min(
    mix(float(RIVER_LINE_WIDTH), float(RAPIDS_LINE_WIDTH), smoothstep(RAPIDS_START, 0.3, slope)),
    pixel.mul(LINE_PIXELS)
  );

  const pointA = positionWorld.xz.sub(drift).sub(travel.mul(phase));
  const pointB = positionWorld.xz.sub(drift).sub(travel.mul(otherPhase)).add(vec2(13.7, 4.1));
  const first = perlinWithSteps(pointA, WAVE_SAMPLE_STEP, WAVE_FREQUENCY, layer);
  const second = perlinWithSteps(pointB, WAVE_SAMPLE_STEP, WAVE_FREQUENCY, layer);

  const waves = normalize(mix(waveNormal(first, strength), waveNormal(second, strength), blend));
  const facing = normalize(direction.add(vec2(0.0001, 0)));
  const riverLines = mix(
    rippleLine(first, facing, lineWidth, pixel),
    rippleLine(second, facing, lineWidth, pixel),
    blend
  ).mul(smoothstep(LINE_FAR, LINE_NEAR, viewDistance));
  const marks = windMark(positionWorld.xz.sub(drift), normalize(look.wind.add(vec2(0.0001, 0))), pixel).mul(
    smoothstep(MARK_FAR, MARK_NEAR, viewDistance)
  );

  return {
    lines: mix(riverLines, marks, stillness),
    normal: normalize(waves.add(vec3(flow.x, 0, flow.y))),
  };
}

function bankSlope(depth: Node<"float">): Node<"float"> {
  const acrossX = dFdx(positionWorld.xz);
  const acrossY = dFdy(positionWorld.xz);
  const riseX = dFdx(depth);
  const riseY = dFdy(depth);

  const determinant = acrossX.x.mul(acrossY.y).sub(acrossX.y.mul(acrossY.x));
  const safeDeterminant = select(abs(determinant).greaterThan(1e-8), determinant, float(1e-8));
  const gradient = vec2(
    acrossY.y.mul(riseX).sub(acrossX.y.mul(riseY)),
    acrossX.x.mul(riseY).sub(acrossY.x.mul(riseX))
  ).div(safeDeterminant);

  return max(length(gradient), FLATTEST_BANK);
}

function foamAt(surface: WaterSurface): Node<"float"> {
  const { depth, fordBed, ice, viewDistance } = surface;
  const point = positionWorld.xz;
  const pixel = max(length(fwidth(point)), 0.001);

  const fromShore = depth.div(bankSlope(depth));
  const wobble = unitNoise3(vec3(point.mul(RIM_WOBBLE_FREQUENCY), time.mul(RIM_WOBBLE_SPEED)));
  const width = max(wobble.mul(0.8).add(0.6).mul(RIM_WIDTH), pixel.mul(RIM_PIXELS));

  const rim = smoothstep(width, width.mul(1 - RIM_SOFTNESS), fromShore).mul(RIM_STRENGTH);
  const ford = fordBed.mul(smoothstep(0.3, 0.6, fordBed)).mul(FORD_FOAM);

  return clamp(rim.add(ford), 0, 1)
    .mul(smoothstep(SHORE_FOAM_FAR, SHORE_FOAM_NEAR, viewDistance))
    .mul(float(1).sub(ice));
}

function shadowFadedAtEdge(look: WaterLook): (shadow?: Node<"float">) => Node<"float"> {
  const coordinate = look.shadowMatrix.mul(vec4(positionWorld, 1)).xy;
  const offCenter = max(abs(coordinate.x.sub(0.5)), abs(coordinate.y.sub(0.5)));
  const inside = smoothstep(0.5, SHADOW_EDGE_START, offCenter);

  return (shadow: Node<"float"> = float(1)) => {
    return mix(float(1), shadow, inside);
  };
}

function shadeWater(look: WaterLook, surface: WaterSurface): WaterShading {
  const { depth, flowSpeed, ice, lines, normal, shelter, viewDirection } = surface;

  const fresnelNormal = normalize(mix(vec3(0, 1, 0), normal, FRESNEL_WAVE_SHARE));
  const fresnel = pow(float(1).sub(max(dot(fresnelNormal, viewDirection), 0)), 5);
  const foam = foamAt(surface);
  const rapids = smoothstep(RAPIDS_START, 0.3, flowSpeed);

  const body = mix(mix(SHALLOW_WATER, MIDDLE_WATER, smoothstep(0.3, 1.8, depth)), DEEP_WATER, smoothstep(2, 8, depth));
  const streaks = lines
    .mul(
      mix(
        mix(float(STILL_LINE_TINT), float(LINE_TINT), smoothstep(0, STILL_FLOW, flowSpeed)),
        float(RAPIDS_LINE_TINT),
        rapids
      )
    )
    .mul(smoothstep(LINE_SHALLOWEST, LINE_SHALLOWEST + 0.25, depth))
    .add(rapids.mul(RAPIDS_TINT));
  const sky = mix(look.horizonColor, look.zenithColor, 0.35);
  const caveShade = float(1).sub(shelter.mul(CAVE_DARKNESS));

  return {
    color: mix(mix(mix(body, FOAM_COLOR, streaks), FOAM_COLOR, foam), ICE_COLOR, ice).mul(caveShade),
    emissive: min(
      sky
        .mul(fresnel)
        .mul(look.daylight.mul(0.5).add(0.08))
        .mul(float(1).sub(foam))
        .mul(float(1).sub(ice.mul(0.7)))
        .mul(float(1).sub(look.precipitation.mul(RAIN_SKY_DAMPING)))
        .mul(caveShade),
      vec3(BRIGHTEST_SKY)
    ),
    opacity: clamp(
      mix(float(SHALLOW_OPACITY), float(DEEP_OPACITY), smoothstep(0, 2.2, depth))
        .add(foam.mul(FOAM_OPACITY))
        .add(streaks.mul(0.6))
        .add(fresnel.mul(0.2))
        .add(ice),
      0,
      1
    ),
    roughness: mix(
      mix(mix(float(WATER_ROUGHNESS), float(RAIN_ROUGHNESS), look.precipitation), float(FOAM_ROUGHNESS), foam),
      float(ICE_ROUGHNESS),
      ice
    ),
    specularIntensity: float(WATER_SPECULAR)
      .mul(float(1).sub(look.precipitation.mul(RAIN_SUN_DAMPING)))
      .mul(float(1).sub(foam))
      .mul(caveShade),
  };
}

function waterPosition(textures: TerrainTextures, grid: WorldGrid): Node<"vec3"> {
  const last = grid.cellsPerSide - 1;
  const cellSize = float(grid.cellSize);
  const halfSize = float(grid.halfSize);

  const step = attribute("patchStep", "float");
  const isCenter = attribute("quadCenter", "float").greaterThan(0.5);
  const cell = clamp(attribute("origin", "vec2").add(attribute("cell", "vec2")), vec2(0, 0), vec2(last, last));

  function levelAt(base: Node<"vec2">, offset: Node<"vec2">): Node<"float"> {
    const level = textureLoad(textures.water, ivec2(clamp(base.add(offset), vec2(0, 0), vec2(last, last)))).x;

    return select(level.greaterThan(PRESENT_LEVEL), level, float(NO_LOWER_WATER));
  }

  function bankAround(base: Node<"vec2">, offsets: readonly Node<"vec2">[]): Node<"float"> {
    const levels = offsets.map((offset) => {
      return levelAt(base, offset);
    });

    const highest = levels.reduce<Node<"float">>((top, level) => {
      return max(top, select(level.lessThan(NO_LOWER_WATER), level, float(-NO_LOWER_WATER)));
    }, float(-NO_LOWER_WATER));
    const lowest = levels.reduce<Node<"float">>((bottom, level) => {
      return min(bottom, level);
    }, float(NO_LOWER_WATER));

    return select(lowest.lessThan(NO_LOWER_WATER), min(highest, lowest.add(BANK_STEP)), float(NO_LOWER_WATER));
  }

  function vertexLevel(vertex: Node<"vec2">): Node<"float"> {
    const ownCell = ivec2(vertex);
    const own = textureLoad(textures.water, ownCell).x;
    const ground = textureLoad(textures.height, ownCell).x;
    const reach = textureLoad(textures.shore, ownCell).w;

    const isCoarse = step.greaterThan(1.5);
    const isCoarseShore = isCoarse.and(reach.lessThanEqual(step.add(COARSE_REACH_MARGIN)));
    const coarseGround = ground.add(COARSE_LIFT);
    const level = ground.sub(HIDDEN_DEPTH).toVar();

    If(own.greaterThan(PRESENT_LEVEL), () => {
      level.assign(select(isCoarse, max(own, coarseGround), own));
    })
      .ElseIf(isCoarseShore, () => {
        level.assign(coarseGround);
      })
      .Else(() => {
        const beside = bankAround(vertex, BESIDE_OFFSETS);
        const nearest = select(beside.lessThan(NO_LOWER_WATER), beside, bankAround(vertex, DIAGONAL_OFFSETS));

        If(nearest.lessThan(NO_LOWER_WATER), () => {
          level.assign(min(nearest, ground.sub(BANK_SINK)));
        });
      });

    return level;
  }

  function cornerOf(column: number, row: number): Node<"vec2"> {
    return clamp(cell.add(vec2(column, row).mul(step)), vec2(0, 0), vec2(last, last));
  }

  return Fn(() => {
    const point = cell.toVar();
    const level = float(0).toVar();

    If(isCenter, () => {
      const [first, right, below, diagonal] = [cornerOf(0, 0), cornerOf(1, 0), cornerOf(0, 1), cornerOf(1, 1)];

      point.assign(first.add(diagonal).mul(0.5));
      level.assign(
        vertexLevel(first).add(vertexLevel(right)).add(vertexLevel(below)).add(vertexLevel(diagonal)).mul(0.25)
      );
    }).Else(() => {
      level.assign(vertexLevel(cell));
    });

    return vec3(point.x.add(0.5).mul(cellSize).sub(halfSize), level, point.y.add(0.5).mul(cellSize).sub(halfSize));
  })();
}

export function createWaterMaterial(
  textures: TerrainTextures,
  grid: WorldGrid,
  look: WaterLook
): MeshStandardNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({ transparent: true });

  material.positionNode = waterPosition(textures, grid);

  const shore = sampleCellsNode(textures.shore, grid, positionWorld.xz);
  const viewDistance = distance(positionWorld, cameraPosition);
  const mapCoordinates = mapCoordinatesNode(grid, positionWorld.xz);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));

  const outlet = textures.caveOutlets.outletAt(positionWorld.xz);
  const flow = mix(shore.yz, outlet.direction.mul(max(length(shore.yz), OUTLET_FLOW)), outlet.share);
  const ice = smoothstep(THIN_ICE, SOLID_ICE, texture(textures.surface, mapCoordinates).r);
  const shoreDepth = mix(shore.x.add(shoreWobble(shore.x, viewDistance)), outlet.depth, outlet.share);

  const isWet = shoreDepth.greaterThan(0);
  const fordBed = textures.fords.marksNode(positionWorld.xz).x;
  const depth = mix(max(shoreDepth, 0), min(max(shoreDepth, 0), FORD_WATER_DEPTH), fordBed.mul(FORD_SHALLOWING));
  const shoreEdge = max(fwidth(shoreDepth), SHORE_FADE);
  const flowSpeed = length(flow);
  const waves = surfaceWaves(flow, flowSpeed, viewDistance, look);

  const normal = normalize(
    mix(waves.normal.add(rainDimples(viewDistance, look.rainfall)), vec3(0, 1, 0), ice.mul(0.85))
  );

  material.maskNode =
    textures.outline.coast === null ? isWet : isWet.and(textures.outline.insideNode(positionWorld.xz));
  material.normalNode = transformNormalToView(normal);

  const shading = shadeWater(look, {
    depth,
    flowSpeed,
    fordBed,
    ice,
    lines: waves.lines,
    normal,
    shelter: outlet.shelter,
    viewDirection,
    viewDistance,
  });

  material.colorNode = shading.color;
  material.emissiveNode = shading.emissive;
  material.opacityNode = shading.opacity.mul(smoothstep(0, shoreEdge, shoreDepth));
  material.roughnessNode = shading.roughness;
  material.specularIntensityNode = shading.specularIntensity;
  material.receivedShadowNode = shadowFadedAtEdge(look);

  return material;
}

export class WaterLook {
  readonly daylight = uniform(1);
  readonly horizonColor = uniform(new Color(0xcf_e2_f0));
  readonly precipitation = uniform(0);
  readonly rainfall = uniform(0);
  readonly shadowMatrix = uniform(new Matrix4());
  readonly wind = uniform(new Vector2(1, 0));
  readonly windTravel = uniform(new Vector2());
  readonly zenithColor = uniform(new Color(0x4c_8c_d6));
}
