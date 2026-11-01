import { exp, Fn, float, floor, fract, If, length, max, positionWorld, smoothstep, time, vec2, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import { cellKey, unitHash } from "../node-helpers.ts";

const DIMPLES_PER_METER = 2;
const DIMPLE_NEAR = 25;
const DIMPLE_FAR = 70;
const DIMPLE_STRENGTH = 0.9;
const DIMPLES_PER_SECOND = 1.1;
const DIMPLE_REACH = 0.42;
const CREST_WIDTH = 0.11;
const SALT_FIRST_LAYER = 0x2f_6b_1c_93;
const SALT_SECOND_LAYER = 0xc4_19_e8_57;
const SALT_ACROSS = 0x71_d3_0a_5f;
const SALT_ALONG = 0x0e_8a_b4_c1;
const SALT_PHASE = 0x93_5c_27_e6;

function dimple(point: Node<"vec2">, salt: number): Node<"vec2"> {
  const cell = floor(point);

  const key = cellKey(cell).bitXor(salt);

  const center = vec2(unitHash(key, SALT_ACROSS), unitHash(key, SALT_ALONG)).mul(0.16).add(0.42);
  const age = fract(time.mul(DIMPLES_PER_SECOND).add(unitHash(key, SALT_PHASE)));

  const offset = fract(point).sub(center);
  const reach = length(offset);
  const front = reach.sub(age.mul(DIMPLE_REACH)).div(CREST_WIDTH);
  const crest = front.mul(exp(front.mul(front).negate())).mul(float(1).sub(age));

  return offset.div(max(reach, 0.001)).mul(crest);
}

export function rainDimples(viewDistance: Node<"float">, rainfall: Node<"float">): Node<"vec3"> {
  return Fn(() => {
    const slope = vec2(0, 0).toVar();

    If(rainfall.greaterThan(0).and(viewDistance.lessThan(DIMPLE_FAR)), () => {
      const point = positionWorld.xz.mul(DIMPLES_PER_METER);
      const strength = smoothstep(DIMPLE_FAR, DIMPLE_NEAR, viewDistance).mul(rainfall).mul(DIMPLE_STRENGTH);

      slope.assign(
        dimple(point, SALT_FIRST_LAYER)
          .add(dimple(point.add(0.5), SALT_SECOND_LAYER))
          .mul(strength)
      );
    });

    return vec3(slope.x, 0, slope.y);
  })();
}
