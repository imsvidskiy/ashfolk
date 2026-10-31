import { z } from "zod";
import { QUALITY_LEVELS, type QualityLevel } from "../rendering/render-quality.ts";

const QUALITY_KEY = "ashfolk.quality";

export type ShownSetting = "labels" | "outlines";

const SHOWN_SETTINGS: Readonly<Record<ShownSetting, { readonly key: string; readonly subject: string }>> = {
  labels: { key: "ashfolk.labels", subject: "label setting" },
  outlines: { key: "ashfolk.outlines", subject: "outline setting" },
};

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

export function storedShown(setting: ShownSetting): boolean {
  const { key, subject } = SHOWN_SETTINGS[setting];

  return readPreference(key, visibilitySchema, subject) !== "hidden";
}

export function storeShown(setting: ShownSetting, isShown: boolean): void {
  const { key, subject } = SHOWN_SETTINGS[setting];

  writePreference(key, isShown ? "shown" : "hidden", subject);
}
