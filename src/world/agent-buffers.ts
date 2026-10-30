export const PERSON_STRIDE = 17;

export const PersonField = {
  Age: 9,
  AppearanceSeed: 11,
  Carried: 12,
  Era: 15,
  Gear: 14,
  Heading: 3,
  Id: 0,
  IsFemale: 10,
  IsRaiding: 16,
  Phase: 7,
  Pose: 6,
  TribeId: 8,
  VelocityX: 4,
  VelocityZ: 5,
  Weapon: 13,
  X: 1,
  Z: 2,
} as const;

export const ANIMAL_STRIDE = 12;

export const AnimalField = {
  AppearanceSeed: 10,
  Heading: 3,
  HerdId: 11,
  Id: 0,
  Kind: 8,
  Phase: 7,
  Pose: 6,
  VelocityX: 4,
  VelocityZ: 5,
  X: 1,
  Youth: 9,
  Z: 2,
} as const;

export interface MotionFields {
  readonly VelocityX: number;
  readonly VelocityZ: number;
  readonly X: number;
  readonly Z: number;
}

export function restPositionOf(
  data: Float32Array,
  offset: number,
  fields: MotionFields,
  secondsSinceTick: number
): { readonly x: number; readonly z: number } {
  return {
    x: data[offset + fields.X] + data[offset + fields.VelocityX] * secondsSinceTick,
    z: data[offset + fields.Z] + data[offset + fields.VelocityZ] * secondsSinceTick,
  };
}

export const SURFACE_CHANNELS = 4;

export const SurfaceChannel = {
  Fire: 3,
  Scorch: 2,
  Snow: 0,
  Wetness: 1,
} as const;

export const GROUND_CHANNELS = 4;

export const GroundChannel = {
  Crop: 1,
  CropKind: 3,
  Ground: 0,
  Trodden: 2,
} as const;
