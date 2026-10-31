import { uniform } from "three/tsl";
import {
  Color,
  Frustum,
  Group,
  type InstancedBufferGeometry,
  Mesh,
  type MeshBasicNodeMaterial,
  type PerspectiveCamera,
  Sphere,
  Vector3,
} from "three/webgpu";
import { lerp } from "../../shared/math.ts";
import { BILLBOARD_FIELDS, type CameraAxes, createQuadGeometry } from "../effects/billboards.ts";
import { InterleavedInstances } from "../instancing.ts";
import {
  herdGathering,
  herdScale,
  MARKER_HALO_PIXELS,
  MarkerImportance,
  type MarkerStyle,
  markerExtent,
  markerPresence,
} from "./marker-look.ts";
import { createMarkerMaterial, MARKER_STYLE_ATTRIBUTE, MarkerPass } from "./marker-material.ts";
import { type SightGround, terrainSight } from "./terrain-sight.ts";

export const NO_HERD = -1;

const FLOATS_PER_MARKER = 12;
const FIRST_LAYER_MARKERS = 64;
const FIRST_RENDER_ORDER = 9;
const PASS_RENDER_ORDER_STEP = 0.25;
const FADED = 0.002;
const GATHERED = 0.98;

const MARKER_FIELDS = [...BILLBOARD_FIELDS, { name: MARKER_STYLE_ATTRIBUTE, size: 4 }];
const MARKER_PASSES = [MarkerPass.Halo, MarkerPass.Ring, MarkerPass.Fill] as const;

interface StagedMarker {
  readonly anchor: Vector3;
  handover: number;
  herd: number;
  isSelected: boolean;
  style: MarkerStyle;
}

interface MarkerLayer {
  floats: Float32Array;
  length: number;
}

interface GatheredHerd {
  readonly center: Vector3;
  extent: number;
  gathering: number;
  leader: number;
  members: number;
  squares: number;
}

function reserveMarker(layer: MarkerLayer): number {
  const offset = layer.length;

  if (offset + FLOATS_PER_MARKER > layer.floats.length) {
    const grown = new Float32Array(layer.floats.length * 2);

    grown.set(layer.floats);
    layer.floats = grown;
  }

  layer.length = offset + FLOATS_PER_MARKER;

  return offset;
}

function joinHerd(herd: GatheredHerd, staged: StagedMarker, index: number): void {
  const { anchor } = staged;

  if (herd.members === 0) {
    herd.center.set(0, 0, 0);
    herd.extent = staged.style.extent;
    herd.leader = index;
    herd.squares = 0;
  }

  herd.center.add(anchor);
  herd.members += 1;
  herd.squares += anchor.x * anchor.x + anchor.z * anchor.z;
}

export class AgentMarkers {
  readonly brightness = uniform(1);
  readonly group = new Group();
  readonly #colors = new Map<number, Color>();
  readonly #eye = new Vector3();
  readonly #forward = new Vector3();
  readonly #frustum = new Frustum();
  readonly #geometry: InstancedBufferGeometry;
  readonly #ground: SightGround;
  readonly #herds = new Map<number, GatheredHerd>();
  readonly #instances: InterleavedInstances;
  readonly #layers: readonly MarkerLayer[] = Object.values(MarkerImportance).map(() => {
    return { floats: new Float32Array(FIRST_LAYER_MARKERS * FLOATS_PER_MARKER), length: 0 };
  });
  readonly #materials: readonly MeshBasicNodeMaterial[];
  readonly #offset = new Vector3();
  readonly #position = new Vector3();
  readonly #reach = new Sphere();
  readonly #staged: StagedMarker[] = [];
  #count = 0;
  #isHidden = false;
  #pixelScale = 0;
  #stagedCount = 0;

  constructor(axes: CameraAxes, ground: SightGround) {
    this.#ground = ground;
    this.#geometry = createQuadGeometry();
    this.#instances = new InterleavedInstances(this.#geometry, MARKER_FIELDS, 256);
    this.#materials = MARKER_PASSES.map((pass) => {
      return createMarkerMaterial(axes, this.brightness, pass);
    });

    for (const [index, material] of this.#materials.entries()) {
      const mesh = new Mesh(this.#geometry, material);

      mesh.frustumCulled = false;
      mesh.renderOrder = FIRST_RENDER_ORDER + index * PASS_RENDER_ORDER_STEP;
      this.group.add(mesh);
    }

    this.group.visible = false;
  }

  get count(): number {
    return this.#count;
  }

  setHidden(isHidden: boolean): void {
    this.#isHidden = isHidden;
    this.group.visible = this.#count > 0 && !isHidden;
  }

  begin(camera: PerspectiveCamera, frustum: Frustum, viewportHeight: number): void {
    this.#eye.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(this.#forward);
    this.#pixelScale = 2 / (camera.projectionMatrix.elements[5] * Math.max(1, viewportHeight));
    this.#frustum.copy(frustum);
    this.#stagedCount = 0;
  }

  add(anchor: Vector3, style: MarkerStyle, handover: number, isSelected: boolean, herd = NO_HERD): void {
    if (this.#stagedCount === this.#staged.length) {
      this.#staged.push({ anchor: new Vector3(), handover, herd, isSelected, style });
    }

    const staged = this.#staged[this.#stagedCount];

    staged.anchor.copy(anchor);
    staged.handover = handover;
    staged.herd = herd;
    staged.isSelected = isSelected;
    staged.style = style;
    this.#stagedCount += 1;
  }

  commit(): void {
    this.#gatherHerds();

    for (const layer of this.#layers) {
      layer.length = 0;
    }

    for (let index = 0; index < this.#stagedCount; index += 1) {
      this.#place(this.#staged[index], index);
    }

    this.#upload();
  }

  dispose(): void {
    this.#geometry.dispose();

    for (const material of this.#materials) {
      material.dispose();
    }
  }

  #gatherHerds(): void {
    for (const herd of this.#herds.values()) {
      herd.members = 0;
    }

    for (let index = 0; index < this.#stagedCount; index += 1) {
      const staged = this.#staged[index];

      if (staged.herd !== NO_HERD && !staged.isSelected) {
        joinHerd(this.#herdFor(staged.herd), staged, index);
      }
    }

    for (const [id, herd] of this.#herds) {
      if (herd.members === 0) {
        this.#herds.delete(id);
        continue;
      }

      this.#settle(herd);
    }
  }

  #herdFor(id: number): GatheredHerd {
    const known = this.#herds.get(id);

    if (known !== undefined) {
      return known;
    }

    const herd = { center: new Vector3(), extent: 0, gathering: 0, leader: 0, members: 0, squares: 0 };

    this.#herds.set(id, herd);

    return herd;
  }

  #settle(herd: GatheredHerd): void {
    const { center } = herd;

    center.divideScalar(herd.members);

    const variance = herd.squares / herd.members - center.x * center.x - center.z * center.z;
    const ahead = this.#forward.dot(this.#offset.subVectors(center, this.#eye));

    const across = (Math.sqrt(Math.max(0, variance)) * 2) / (ahead * this.#pixelScale);

    herd.gathering = ahead > 0 ? herdGathering(across, herd.extent) : 0;
  }

  #place(staged: StagedMarker, index: number): void {
    const presence = markerPresence(this.#eye.distanceTo(staged.anchor), staged.handover);

    if (presence <= 0) {
      return;
    }

    const herd = this.#herdOf(staged);

    if (herd === null) {
      this.#emit(staged.anchor, staged, presence, 1);

      return;
    }

    const { gathering } = herd;

    const isLeader = herd.leader === index;

    if (!isLeader && gathering > GATHERED) {
      return;
    }

    const position = this.#position.lerpVectors(staged.anchor, herd.center, gathering);
    const growth = isLeader ? lerp(1, herdScale(herd.members), gathering) : 1;

    this.#emit(position, staged, presence, growth);
  }

  #herdOf(staged: StagedMarker): GatheredHerd | null {
    if (staged.isSelected) {
      return null;
    }

    const herd = this.#herds.get(staged.herd);

    if (herd === undefined) {
      return null;
    }

    return herd;
  }

  #emit(position: Vector3, staged: StagedMarker, presence: number, growth: number): void {
    const { isSelected, style } = staged;

    const ahead = this.#forward.dot(this.#offset.subVectors(position, this.#eye));

    if (ahead <= 0) {
      return;
    }

    const pixels = markerExtent(style, presence, isSelected) * growth + MARKER_HALO_PIXELS * 2;
    const size = pixels * ahead * this.#pixelScale;

    this.#reach.set(position, size * Math.SQRT1_2);

    if (!this.#frustum.intersectsSphere(this.#reach)) {
      return;
    }

    const opacity = presence * terrainSight(this.#eye, position, this.#ground);

    if (opacity < FADED) {
      return;
    }

    const { b: blue, g: green, r: red } = this.#colorOf(style.color);
    const layer = this.#layers[isSelected ? MarkerImportance.Selected : style.importance];
    const offset = reserveMarker(layer);
    const { floats } = layer;

    floats[offset] = position.x;
    floats[offset + 1] = position.y;
    floats[offset + 2] = position.z;
    floats[offset + 3] = size;
    floats[offset + 4] = red;
    floats[offset + 5] = green;
    floats[offset + 6] = blue;
    floats[offset + 7] = opacity;
    floats[offset + 8] = style.shape;
    floats[offset + 9] = pixels;
    floats[offset + 10] = isSelected ? 1 : 0;
    floats[offset + 11] = 0;
  }

  #upload(): void {
    const count =
      this.#layers.reduce((sum, layer) => {
        return sum + layer.length;
      }, 0) / FLOATS_PER_MARKER;

    this.#instances.ensureCapacity(count);

    let offset = 0;

    for (const layer of this.#layers) {
      this.#instances.array.set(layer.floats.subarray(0, layer.length), offset);
      offset += layer.length;
    }

    this.#count = count;
    this.#geometry.instanceCount = count;
    this.group.visible = count > 0 && !this.#isHidden;

    if (count > 0) {
      this.#instances.markUpdated(count);
    }
  }

  #colorOf(hex: number): Color {
    const known = this.#colors.get(hex);

    if (known !== undefined) {
      return known;
    }

    const created = new Color(hex);

    this.#colors.set(hex, created);

    return created;
  }
}
