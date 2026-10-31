export const FULL_TURN = Math.PI * 2;
export const HALF_TURN = Math.PI;
export const MILLISECONDS_PER_SECOND = 1000;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function inverseLerp(from: number, to: number, value: number): number {
  if (from === to) {
    return 0;
  }

  return (value - from) / (to - from);
}

export function smoothstep(edgeStart: number, edgeEnd: number, value: number): number {
  const amount = saturate(inverseLerp(edgeStart, edgeEnd, value));

  return amount * amount * (3 - 2 * amount);
}

export function wrapAngle(angle: number): number {
  const wrapped = (((angle + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN;

  return wrapped - HALF_TURN;
}

export function fractionalPart(value: number): number {
  return value - Math.floor(value);
}

export function distanceSquared(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const deltaX = toX - fromX;
  const deltaZ = toZ - fromZ;

  return deltaX * deltaX + deltaZ * deltaZ;
}

function distance(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.sqrt(distanceSquared(fromX, fromZ, toX, toZ));
}

export function hashToUnit(first: number, second = 0, third = 0): number {
  const mixed = Math.sin(first * 127.1 + second * 311.7 + third * 74.7) * 43_758.545_312_3;

  return fractionalPart(mixed);
}

export function gaussian(x: number, z: number, centerX: number, centerZ: number, spread: number): number {
  return Math.exp(-distanceSquared(x, z, centerX, centerZ) / (2 * spread * spread));
}

export function distanceToSegment(
  x: number,
  z: number,
  start: readonly [number, number],
  end: readonly [number, number]
): number {
  const [startX, startZ] = start;
  const [endX, endZ] = end;

  const segmentX = endX - startX;
  const segmentZ = endZ - startZ;

  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;

  if (lengthSquared === 0) {
    return distance(x, z, startX, startZ);
  }

  const projection = saturate(((x - startX) * segmentX + (z - startZ) * segmentZ) / lengthSquared);

  return distance(x, z, startX + segmentX * projection, startZ + segmentZ * projection);
}
