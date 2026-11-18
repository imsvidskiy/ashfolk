import {
  abs,
  attribute,
  cameraPosition,
  cross,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  smoothstep,
  time,
  uniform,
  vec3,
} from "three/tsl";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  SphereGeometry,
  Uint32BufferAttribute,
  type Vector3,
} from "three/webgpu";
import { blendAsGlow } from "./glow-blending.ts";

const RIBBON_COLOR = new Color(0xcf_e0_ff);

export interface RibbonPoint {
  readonly position: Vector3;
  readonly width: number;
}

function buildRibbonGeometry(strands: readonly (readonly RibbonPoint[])[]): BufferGeometry {
  const points: number[] = [];
  const tangents: number[] = [];
  const sides: number[] = [];
  const widths: number[] = [];
  const indices: number[] = [];

  for (const strand of strands) {
    const first = sides.length;

    for (const [index, point] of strand.entries()) {
      const previous = strand[Math.max(0, index - 1)];
      const next = strand[Math.min(strand.length - 1, index + 1)];

      const tangent = next.position.clone().sub(previous.position).normalize();

      for (const side of [-1, 1]) {
        points.push(point.position.x, point.position.y, point.position.z);
        tangents.push(tangent.x, tangent.y, tangent.z);
        sides.push(side);
        widths.push(point.width);
      }
    }

    for (let segment = 0; segment < strand.length - 1; segment += 1) {
      const corner = first + segment * 2;

      indices.push(corner, corner + 1, corner + 2, corner + 2, corner + 1, corner + 3);
    }
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  geometry.setAttribute("ribbonTangent", new Float32BufferAttribute(tangents, 3));
  geometry.setAttribute("ribbonSide", new Float32BufferAttribute(sides, 1));
  geometry.setAttribute("ribbonWidth", new Float32BufferAttribute(widths, 1));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));

  return geometry;
}

function createRibbonMaterial(brightnesses: PerObjectValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, transparent: true });

  blendAsGlow(material);

  const brightness = uniform(1).onObjectUpdate(({ object }) => {
    return brightnesses.read(object);
  });
  const tangent = attribute("ribbonTangent", "vec3");
  const side = attribute("ribbonSide", "float");
  const width = attribute("ribbonWidth", "float");

  const toCamera = normalize(cameraPosition.sub(positionLocal));
  const across = normalize(cross(tangent, toCamera));

  material.positionNode = positionLocal.add(across.mul(side.mul(width)));
  material.colorNode = uniform(RIBBON_COLOR).mul(brightness.mul(4));
  material.opacityNode = brightness;
  material.fog = false;

  return material;
}

function createFireballMaterial(heats: PerObjectValues): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ depthWrite: false, transparent: true });
  const heat = uniform(1).onObjectUpdate(({ object }) => {
    return heats.read(object);
  });
  const noise = mx_noise_float(positionLocal.mul(2.4).add(vec3(0, time.mul(-1.5), 0)));

  material.positionNode = positionLocal.mul(noise.mul(0.22).add(1));
  material.colorNode = mix(vec3(0.9, 0.22, 0.05), vec3(1, 0.86, 0.5), smoothstep(-0.3, 0.6, noise).mul(heat)).mul(
    heat.mul(3).add(0.4)
  );
  material.opacityNode = heat.mul(0.85).add(0.1);

  return material;
}

function createMeteorMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const shape = mx_noise_float(positionLocal.mul(1.6));
  const veins = mx_noise_float(positionLocal.mul(3.2).add(vec3(0, time.mul(0.6), 0)));

  const glow = smoothstep(0, 0.16, abs(veins)).oneMinus();

  material.positionNode = positionLocal.mul(shape.mul(0.3).add(1));
  material.colorNode = mix(vec3(0.2, 0.12, 0.08), vec3(2.6, 1.05, 0.25), glow.mul(0.85).add(0.15));

  return material;
}

class PerObjectValues {
  readonly #values = new WeakMap<Object3D, number>();

  set(object: Object3D, value: number): void {
    this.#values.set(object, value);
  }

  read(object: Object3D | null): number {
    const value = object === null ? undefined : this.#values.get(object);

    return value === undefined ? 1 : value;
  }
}

export class EffectMeshes {
  readonly #fireballHeats = new PerObjectValues();
  readonly #fireballMaterial = createFireballMaterial(this.#fireballHeats);
  readonly #fireballShape = new SphereGeometry(1, 32, 16);
  readonly #meteorMaterial = createMeteorMaterial();
  readonly #meteorShape = new IcosahedronGeometry(1, 3);
  readonly #ribbonBrightnesses = new PerObjectValues();
  readonly #ribbonMaterial = createRibbonMaterial(this.#ribbonBrightnesses);

  createBolt(strands: readonly (readonly RibbonPoint[])[]): Mesh {
    const bolt = new Mesh(buildRibbonGeometry(strands), this.#ribbonMaterial);

    bolt.frustumCulled = false;
    bolt.renderOrder = 8;

    return bolt;
  }

  createFireball(): Mesh {
    const fireball = new Mesh(this.#fireballShape, this.#fireballMaterial);

    fireball.frustumCulled = false;
    fireball.renderOrder = 7;

    return fireball;
  }

  createMeteor(): Mesh {
    const meteor = new Mesh(this.#meteorShape, this.#meteorMaterial);

    meteor.frustumCulled = false;

    return meteor;
  }

  setBoltBrightness(bolt: Mesh, brightness: number): void {
    this.#ribbonBrightnesses.set(bolt, brightness);
  }

  setFireballHeat(fireball: Mesh, heat: number): void {
    this.#fireballHeats.set(fireball, heat);
  }

  dispose(): void {
    this.#fireballMaterial.dispose();
    this.#fireballShape.dispose();
    this.#meteorMaterial.dispose();
    this.#meteorShape.dispose();
    this.#ribbonMaterial.dispose();
  }
}
