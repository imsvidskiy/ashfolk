import {
  abs,
  cameraPosition,
  Fn,
  float,
  If,
  max,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  time,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { smoothstep as smoothstepNumber } from "../../shared/math.ts";
import { unitNoise3 } from "../node-helpers.ts";

const CROWN_FIRE_START = 0.04;
const CROWN_FIRE_FULL = 0.3;
const CROWN_SCORCH_START = 0.6;
const CROWN_SCORCH_END = 0.97;
const LIVING_CHAR_START = 0.03;
const LIVING_CHAR_END = 0.5;
const IGNITION_CHAR = 0.35;
const FLAMING_START = 0.03;
const FLAMING_FULL = 0.45;
const AFTERGLOW_SCORCH = 0.78;
const AFTERGLOW_HEIGHT = 14;
const AFTERGLOW_CROWN = 0.35;
const SMOLDER_GLOW = 0.22;
const CHARCOAL = vec3(0.035, 0.03, 0.028);
const EMBER_COLOR = vec3(2.2, 0.48, 0.07);
const FLAME_COLOR = vec3(3.2, 1.1, 0.2);
const FAR_FLAME_COLOR = vec3(1.9, 0.62, 0.12);
const CRACK_SCALE = 1.6;
const PATCH_SCALE = 0.45;
const TONGUE_SCALE = 0.42;
const TONGUE_STRETCH = 0.24;
const TONGUE_RISE = 2.6;
const GLOW_FLOOR = 0.004;

export const BURN_DETAIL_FADE = { end: 1300, start: 500 } as const;

interface BurnInput {
  readonly alive: Node<"float">;
  readonly burnt: Node<"float">;
  readonly fallen: Node<"float">;
  readonly fire: Node<"float">;
  readonly foliage: Node<"float">;
  readonly height: Node<"float">;
  readonly scorch: Node<"float">;
}

interface PlantBurn {
  readonly charring: Node<"float">;
  readonly crownLeft: Node<"float">;
  readonly embers: Node<"float">;
  readonly flames: Node<"float">;
  readonly smolder: Node<"float">;
}

interface BurnGlowInput {
  readonly detailFade: Node<"vec2">;
  readonly embers: Node<"float">;
  readonly flames: Node<"float">;
  readonly phase: Node<"float">;
  readonly smolder: Node<"float">;
}

export function remainingCrown(fire: number, scorch: number): number {
  const burning = smoothstepNumber(CROWN_FIRE_START, CROWN_FIRE_FULL, fire);

  return burning * (1 - smoothstepNumber(CROWN_SCORCH_START, CROWN_SCORCH_END, scorch));
}

function remainingCrownNode(fire: Node<"float">, scorch: Node<"float">): Node<"float"> {
  const burning = smoothstep(CROWN_FIRE_START, CROWN_FIRE_FULL, fire);

  return burning.mul(float(1).sub(smoothstep(CROWN_SCORCH_START, CROWN_SCORCH_END, scorch)));
}

export function plantBurn({ alive, burnt, fallen, fire, foliage, height, scorch }: BurnInput): PlantBurn {
  const flaming = smoothstep(FLAMING_START, FLAMING_FULL, fire);
  const crownLeft = alive.add(burnt.mul(remainingCrownNode(fire, scorch)));

  const scorching = smoothstep(LIVING_CHAR_START, LIVING_CHAR_END, scorch).mul(smoothstep(0, 0.05, fire));
  const livingCharring = max(scorching, flaming.mul(IGNITION_CHAR));
  const charring = alive.mul(livingCharring).add(burnt.mul(mix(float(0.92), float(1), foliage)));

  const isOut = float(1).sub(smoothstep(0.008, 0.04, fire));
  const afterglow = smoothstep(AFTERGLOW_SCORCH, 1, scorch).mul(isOut);
  const trunkGlow = mix(float(AFTERGLOW_CROWN), float(1), smoothstep(AFTERGLOW_HEIGHT, 0, height));
  const smolder = afterglow.mul(burnt.mul(trunkGlow).add(fallen));

  const burningWood = mix(float(1), smoothstep(0.15, 0.7, livingCharring), foliage);
  const embers = alive.mul(flaming).mul(burningWood).add(burnt.mul(flaming)).add(smolder);

  const flameSurface = mix(crownLeft.mul(0.5).add(0.25), crownLeft, foliage);
  const flames = alive.add(burnt).mul(flaming).mul(flameSurface);

  return { charring, crownLeft, embers, flames, smolder };
}

export function charredColor(color: Node<"vec3">, charring: Node<"float">): Node<"vec3"> {
  const scorched = vec3(0.13, 0.075, 0.04);
  const browned = mix(color, scorched, smoothstep(0, 0.45, charring));

  return mix(browned, CHARCOAL, smoothstep(0.35, 0.95, charring));
}

export function burnGlow({ detailFade, embers, flames, phase, smolder }: BurnGlowInput): Node<"vec3"> {
  return Fn(() => {
    const glow = vec3(0).toVar();

    If(embers.add(flames).greaterThan(GLOW_FLOOR), () => {
      const detail = float(1).sub(smoothstep(detailFade.x, detailFade.y, positionWorld.distance(cameraPosition)));

      glow.assign(
        FAR_FLAME_COLOR.mul(flames.mul(0.45).add(embers.mul(0.25)).add(smolder.mul(0.1))).mul(float(1).sub(detail))
      );

      If(detail.greaterThan(0), () => {
        const crackNoise = mx_noise_float(positionWorld.mul(CRACK_SCALE));
        const patches = smoothstep(0.05, 0.45, mx_noise_float(positionWorld.mul(PATCH_SCALE)));
        const cracks = smoothstep(0.86, 0.97, float(1).sub(abs(crackNoise))).mul(patches);
        const flicker = sin(time.mul(4.3).add(crackNoise.mul(19)).add(phase))
          .mul(0.35)
          .add(0.65);

        const rising = vec3(
          positionWorld.x.mul(TONGUE_SCALE),
          positionWorld.y.mul(TONGUE_STRETCH).sub(time.mul(TONGUE_RISE)).add(phase),
          positionWorld.z.mul(TONGUE_SCALE)
        );
        const tongueNoise = unitNoise3(rising);
        const tongues = smoothstep(float(0.82).sub(flames.mul(0.14)), 1, tongueNoise).mul(flames);

        const breathing = sin(time.mul(1.3).add(patches.mul(5)).add(phase))
          .mul(0.35)
          .add(0.65);
        const smoldering = smolder.mul(breathing).mul(patches.mul(0.7).add(0.3)).mul(SMOLDER_GLOW);

        const near = EMBER_COLOR.mul(cracks.mul(flicker).mul(embers).add(smoldering)).add(FLAME_COLOR.mul(tongues));

        glow.addAssign(near.mul(detail));
      });
    });

    return glow;
  })();
}
