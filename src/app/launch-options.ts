import { z } from "zod";
import { TOUCH_QUERY } from "../design/use-media-query.ts";
import { randomSeed, readSeed } from "../features/new-world/seeds.ts";
import { readWorldName, worldNameFor } from "../features/new-world/world-names.ts";
import type { CameraState } from "../game/camera/god-camera.ts";
import { QUALITY_LEVELS, type QualityLevel } from "../rendering/render-quality.ts";
import { ISLAND_SHAPES, type IslandShapeKind } from "../world/island-shape.ts";
import { ISLAND_SIZES, type IslandSizeKind } from "../world/island-size.ts";
import { storedQuality } from "./preferences.ts";

const WORLD_PARAMETER = "world";

const cameraSchema = z
  .string()
  .transform((text) => {
    return text.split(",").map(Number);
  })
  .pipe(z.tuple([z.number(), z.number(), z.number().positive(), z.number(), z.number()]))
  .transform(([targetX, targetZ, distance, pitch, yaw]) => {
    return { distance, pitch, targetX, targetZ, yaw };
  });

const launchSchema = z.object({
  camera: cameraSchema.optional(),
  hours: z.coerce.number().min(0).max(24).optional(),
  name: z.string().transform(readWorldName).pipe(z.string()).optional(),
  paused: z.enum(["0", "1"]).optional(),
  quality: z.enum(QUALITY_LEVELS).optional(),
  seed: z.string().transform(readSeed).pipe(z.number()).optional(),
  shape: z.enum(ISLAND_SHAPES).optional(),
  size: z.enum(ISLAND_SIZES).optional(),
});

const worldIdSchema = z.string().regex(/^[\w-]{1,64}$/u);

export interface LaunchOptions {
  readonly camera: Partial<CameraState>;
  readonly hours: number | null;
  readonly isPaused: boolean;
  readonly name: string;
  readonly quality: QualityLevel;
  readonly seed: number;
  readonly shape: IslandShapeKind;
  readonly size: IslandSizeKind;
}

type LaunchParameters = z.output<typeof launchSchema>;

interface ParameterIssue {
  readonly path: readonly PropertyKey[];
}

function defaultQuality(): QualityLevel {
  const stored = storedQuality();

  if (stored !== null) {
    return stored;
  }

  const isTouchDevice = window.matchMedia(TOUCH_QUERY).matches;

  return isTouchDevice ? "low" : "medium";
}

function toLaunchOptions(parameters: LaunchParameters): LaunchOptions {
  const {
    camera = {},
    hours = null,
    paused = "0",
    quality = defaultQuality(),
    seed = randomSeed(),
    shape = "round",
    size = "normal",
  } = parameters;

  const { name = worldNameFor(seed) } = parameters;

  return { camera, hours, isPaused: paused === "1", name, quality, seed, shape, size };
}

function withoutInvalid(parameters: Record<string, string>, issues: readonly ParameterIssue[]): Record<string, string> {
  const invalidNames = new Set(
    issues.map((issue) => {
      return String(issue.path[0]);
    })
  );

  return Object.fromEntries(
    Object.entries(parameters).filter(([name]) => {
      return !invalidNames.has(name);
    })
  );
}

export function createWorldId(): string {
  return crypto.randomUUID();
}

export function readWorldId(search: string): string | null {
  const result = worldIdSchema.safeParse(new URLSearchParams(search).get(WORLD_PARAMETER));

  return result.success ? result.data : null;
}

export function withWorldId(search: string, worldId: string): string {
  const parameters = new URLSearchParams(search);

  parameters.set(WORLD_PARAMETER, worldId);

  return `?${parameters.toString()}`;
}

export function choosesWorld(search: string): boolean {
  const parameters = new URLSearchParams(search);

  return parameters.has("seed") || readWorldId(search) !== null;
}

export function readLaunchOptions(search: string): LaunchOptions {
  const parameters = Object.fromEntries(new URLSearchParams(search));
  const result = launchSchema.safeParse(parameters);

  if (result.success) {
    return toLaunchOptions(result.data);
  }

  console.warn("Ignoring invalid launch parameters", result.error.issues);

  const validOnly = launchSchema.safeParse(withoutInvalid(parameters, result.error.issues));

  return toLaunchOptions(validOnly.success ? validOnly.data : {});
}
