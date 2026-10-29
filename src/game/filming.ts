import { z } from "zod";
import type { RenderFilming } from "../rendering/render-filming.ts";

export interface FilmingSettings extends RenderFilming {
  readonly isInterfaceHidden: boolean;
  readonly isResolutionHeld: boolean;
}

export const FILMING_OFF: FilmingSettings = {
  areMarkersHidden: false,
  hasFarPlants: false,
  hasFarShadows: false,
  hasFinestGround: false,
  hasSharpestShadows: false,
  isInterfaceHidden: false,
  isResolutionHeld: false,
};

export const FILMING_ON: FilmingSettings = {
  areMarkersHidden: true,
  hasFarPlants: true,
  hasFarShadows: true,
  hasFinestGround: true,
  hasSharpestShadows: true,
  isInterfaceHidden: true,
  isResolutionHeld: true,
};

const FILMING_PARAMETER = "filming";
const EVERYTHING = new Set(["1", "all"]);

const FILMING_PARAMETER_NAMES: Readonly<Record<keyof FilmingSettings, string>> = {
  areMarkersHidden: "noMarkers",
  hasFarPlants: "farPlants",
  hasFarShadows: "farShadows",
  hasFinestGround: "fineGround",
  hasSharpestShadows: "sharpShadows",
  isInterfaceHidden: "noInterface",
  isResolutionHeld: "fullResolution",
};

const FILMING_KEYS: readonly (keyof FilmingSettings)[] = [
  "areMarkersHidden",
  "hasFarPlants",
  "hasFarShadows",
  "hasFinestGround",
  "hasSharpestShadows",
  "isInterfaceHidden",
  "isResolutionHeld",
];

const changesSchema = z.strictObject({
  areMarkersHidden: z.boolean().optional(),
  hasFarPlants: z.boolean().optional(),
  hasFarShadows: z.boolean().optional(),
  hasFinestGround: z.boolean().optional(),
  hasSharpestShadows: z.boolean().optional(),
  isInterfaceHidden: z.boolean().optional(),
  isResolutionHeld: z.boolean().optional(),
});

type FilmingDraft = { -readonly [Key in keyof FilmingSettings]: boolean };

type FilmingListener = (settings: FilmingSettings) => void;

function keyNamed(name: string): keyof FilmingSettings | undefined {
  return FILMING_KEYS.find((key) => {
    return FILMING_PARAMETER_NAMES[key] === name;
  });
}

export function readFilming(search: string): Partial<FilmingSettings> {
  const value = new URLSearchParams(search).get(FILMING_PARAMETER);

  if (value === null || value === "0") {
    return {};
  }

  if (EVERYTHING.has(value)) {
    return FILMING_ON;
  }

  const changes: Partial<FilmingDraft> = {};

  for (const name of value.split(",")) {
    const key = keyNamed(name.trim());

    if (key === undefined) {
      console.warn(`Ignoring an unknown filming setting "${name}"`);

      continue;
    }

    changes[key] = true;
  }

  return changes;
}

export class Filming {
  readonly #listeners = new Set<FilmingListener>();
  #settings: FilmingSettings = FILMING_OFF;

  get settings(): FilmingSettings {
    return this.#settings;
  }

  set(changes: Partial<FilmingSettings>): void {
    const result = changesSchema.safeParse(changes);

    if (!result.success) {
      console.warn("Ignoring invalid filming settings", result.error.issues);

      return;
    }

    const next: FilmingDraft = { ...this.#settings };

    for (const key of FILMING_KEYS) {
      const value = result.data[key];

      if (value !== undefined) {
        next[key] = value;
      }
    }

    this.#settings = next;

    for (const listener of this.#listeners) {
      listener(next);
    }
  }

  setAll(isOn: boolean): void {
    this.set(isOn ? FILMING_ON : FILMING_OFF);
  }

  subscribe(listener: FilmingListener): () => void {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  }
}
