import { z } from "zod";
import { QUALITY_LEVELS, type QualityLevel } from "../rendering/render-quality.ts";

const QUALITY_KEY = "ashfolk.quality";
const LABELS_KEY = "ashfolk.labels";
const OUTLINES_KEY = "ashfolk.outlines";

const qualitySchema = z.enum(QUALITY_LEVELS);
const visibilitySchema = z.enum(["hidden", "shown"]);

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
