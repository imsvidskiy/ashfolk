import { z } from "zod";
import type { SoundLevels } from "../audio/sound-engine.ts";
import { QUALITY_LEVELS, type QualityLevel } from "../rendering/render-quality.ts";

const QUALITY_KEY = "dawnfolk.quality";
const LABELS_KEY = "dawnfolk.labels";
const OUTLINES_KEY = "dawnfolk.outlines";
const SOUND_KEY = "dawnfolk.sound";

const qualitySchema = z.enum(QUALITY_LEVELS);
const visibilitySchema = z.enum(["hidden", "shown"]);
const volumeSchema = z.number().min(0).max(1);
const soundSchema = z.object({
  ambience: volumeSchema,
  effects: volumeSchema,
  interface: volumeSchema,
  isMuted: z.boolean(),
  master: volumeSchema,
  music: volumeSchema,
});

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Saved settings are not available", error);

    return null;
  }
}

function readPreference<Value>(key: string, schema: z.ZodType<Value>, subject: string): Value | null {
  const stored = readStorage(key);

  if (stored === null) {
    return null;
  }

  const result = schema.safeParse(stored);

  if (!result.success) {
    console.warn(`Ignoring a saved ${subject}`, result.error.issues);

    return null;
  }

  return result.data;
}

function writePreference(key: string, value: string, subject: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Could not save the ${subject}`, error);
  }
}

export function mergeStoredField<State, Key extends keyof State>(
  key: Key,
  read: (persisted: unknown) => State[Key]
): (persisted: unknown, current: State) => State {
  return (persisted, current) => {
    if (persisted === undefined) {
      return current;
    }

    return { ...current, [key]: read(persisted) };
  };
}

export function storedQuality(): QualityLevel | null {
  return readPreference(QUALITY_KEY, qualitySchema, "graphics quality");
}

export function storeQuality(quality: QualityLevel): void {
  writePreference(QUALITY_KEY, quality, "graphics quality");
}

export function storedLabelsShown(): boolean {
  return readPreference(LABELS_KEY, visibilitySchema, "label setting") !== "hidden";
}

export function storeLabelsShown(isShown: boolean): void {
  writePreference(LABELS_KEY, isShown ? "shown" : "hidden", "label setting");
}

export function storedOutlinesShown(): boolean {
  return readPreference(OUTLINES_KEY, visibilitySchema, "outline setting") !== "hidden";
}

export function storeOutlinesShown(areShown: boolean): void {
  writePreference(OUTLINES_KEY, areShown ? "shown" : "hidden", "outline setting");
}

export function storedSoundLevels(): SoundLevels | null {
  const stored = readStorage(SOUND_KEY);

  if (stored === null) {
    return null;
  }

  try {
    const result = soundSchema.safeParse(JSON.parse(stored));

    if (result.success) {
      return result.data;
    }

    console.warn("Ignoring the saved sound settings", result.error.issues);
  } catch (error) {
    console.warn("Ignoring the saved sound settings", error);
  }

  return null;
}

export function storeSoundLevels(levels: SoundLevels): void {
  writePreference(SOUND_KEY, JSON.stringify(levels), "sound settings");
}
