import { type RandomSource, shuffle } from "../shared/random.ts";

const SQUARE_ROOT_OF_THREE = Math.sqrt(3);
const SKEW = 0.5 * (SQUARE_ROOT_OF_THREE - 1);
const UNSKEW = (3 - SQUARE_ROOT_OF_THREE) / 6;
const OUTPUT_SCALE = 70;
const TABLE_SIZE = 256;
const LACUNARITY = 2.03;
const RIDGE_WEIGHTING = 1.6;
const GRADIENTS_X = Float64Array.of(1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0);
const GRADIENTS_Z = Float64Array.of(1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1);

export interface NoiseGradient {
  gradientX: number;
  gradientZ: number;
  value: number;
}

export interface ErodedRidgedOptions {
  readonly damping: number;
  readonly gain: number;
  readonly octaves: number;
  readonly rounding: number;
  readonly slopeScale: number;
}

function shuffledTable(random: RandomSource): Uint8Array {
  const table = new Uint8Array(TABLE_SIZE * 2);

  for (let index = 0; index < TABLE_SIZE; index += 1) {
    table[index] = index;
  }

  shuffle(random, table.subarray(0, TABLE_SIZE));

  for (let index = 0; index < TABLE_SIZE; index += 1) {
    table[index + TABLE_SIZE] = table[index];
  }

  return table;
}

function wrapToTable(value: number): number {
  return ((value % TABLE_SIZE) + TABLE_SIZE) % TABLE_SIZE;
}

function totalAmplitude(octaves: number, gain: number): number {
  let total = 0;
  let amplitude = 0.5;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude;
    amplitude *= gain;
  }

  return total;
}

export class GradientNoise {
  readonly #gradientIndices: Uint8Array;
  readonly #octave: NoiseGradient = { gradientX: 0, gradientZ: 0, value: 0 };
  readonly #permutation: Uint8Array;

  constructor(random: RandomSource) {
    this.#permutation = shuffledTable(random);
    this.#gradientIndices = this.#permutation.map((entry) => {
      return entry % GRADIENTS_X.length;
    });
  }

  sample(x: number, z: number, result: NoiseGradient): NoiseGradient {
    const skew = (x + z) * SKEW;
    const cellX = Math.floor(x + skew);
    const cellZ = Math.floor(z + skew);

    const unskew = (cellX + cellZ) * UNSKEW;
    const firstX = x - cellX + unskew;
    const firstZ = z - cellZ + unskew;

    const stepX = firstX > firstZ ? 1 : 0;
    const stepZ = 1 - stepX;
    const wrappedX = wrapToTable(cellX);
    const wrappedZ = wrapToTable(cellZ);
    const permutation = this.#permutation;

    result.value = 0;
    result.gradientX = 0;
    result.gradientZ = 0;

    this.#addCorner(firstX, firstZ, wrappedX + permutation[wrappedZ], result);
    this.#addCorner(
      firstX - stepX + UNSKEW,
      firstZ - stepZ + UNSKEW,
      wrappedX + stepX + permutation[wrappedZ + stepZ],
      result
    );
    this.#addCorner(firstX - 1 + 2 * UNSKEW, firstZ - 1 + 2 * UNSKEW, wrappedX + 1 + permutation[wrappedZ + 1], result);

    result.value *= OUTPUT_SCALE;
    result.gradientX *= OUTPUT_SCALE;
    result.gradientZ *= OUTPUT_SCALE;

    return result;
  }

  fractal(x: number, z: number, octaves: number, gain: number, result: NoiseGradient): NoiseGradient {
    const octave = this.#octave;
    const normalization = totalAmplitude(octaves, gain);

    let value = 0;
    let gradientX = 0;
    let gradientZ = 0;
    let amplitude = 0.5;
    let frequency = 1;

    for (let index = 0; index < octaves; index += 1) {
      this.sample(x * frequency, z * frequency, octave);

      value += amplitude * octave.value;
      gradientX += amplitude * frequency * octave.gradientX;
      gradientZ += amplitude * frequency * octave.gradientZ;
      amplitude *= gain;
      frequency *= LACUNARITY;
    }

    result.value = value / normalization;
    result.gradientX = gradientX / normalization;
    result.gradientZ = gradientZ / normalization;

    return result;
  }

  erodedRidged(x: number, z: number, options: ErodedRidgedOptions): number {
    const octave = this.#octave;
    const normalization = totalAmplitude(options.octaves, options.gain);
    const slopeScale = options.slopeScale / normalization;
    const crest = 1 - Math.sqrt(options.rounding);

    let sum = 0;
    let gradientX = 0;
    let gradientZ = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let weight = 1;

    for (let index = 0; index < options.octaves; index += 1) {
      this.sample(x * frequency, z * frequency, octave);

      const softAbsolute = Math.sqrt(octave.value * octave.value + options.rounding);
      const ridge = Math.max(0, 1 - softAbsolute) / crest;
      const ridgeChange = ridge > 0 ? (-2 * ridge * weight * octave.value) / (softAbsolute * crest) : 0;

      const slopeX = gradientX * slopeScale;
      const slopeZ = gradientZ * slopeScale;
      const value = ridge * ridge * weight;

      const damping = 1 / (1 + options.damping * (slopeX * slopeX + slopeZ * slopeZ));

      sum += amplitude * damping * value;
      gradientX += amplitude * damping * frequency * ridgeChange * octave.gradientX;
      gradientZ += amplitude * damping * frequency * ridgeChange * octave.gradientZ;
      weight = Math.min(1, value * RIDGE_WEIGHTING);
      amplitude *= options.gain;
      frequency *= LACUNARITY;
    }

    return sum / normalization;
  }

  #addCorner(offsetX: number, offsetZ: number, tableIndex: number, result: NoiseGradient): void {
    const falloff = 0.5 - offsetX * offsetX - offsetZ * offsetZ;

    if (falloff <= 0) {
      return;
    }

    const gradient = this.#gradientIndices[tableIndex];

    const directionX = GRADIENTS_X[gradient];
    const directionZ = GRADIENTS_Z[gradient];

    const squared = falloff * falloff;
    const projection = directionX * offsetX + directionZ * offsetZ;

    const fourth = squared * squared;
    const change = -8 * squared * falloff * projection;

    result.value += fourth * projection;
    result.gradientX += change * offsetX + fourth * directionX;
    result.gradientZ += change * offsetZ + fourth * directionZ;
  }
}
