import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mergeStoredField } from "../../app/preferences.ts";
import { DEFAULT_SOUND_LEVELS, type SoundLevels } from "../../audio/sound-engine.ts";

const STORAGE_KEY = "dawnfolk.sound";

const volumeSchema = z.number().min(0).max(1);
const storedSchema = z.object({
  levels: z.object({
    ambience: volumeSchema,
    effects: volumeSchema,
    interface: volumeSchema,
    isMuted: z.boolean(),
    master: volumeSchema,
    music: volumeSchema,
  }),
});

export type VolumeKey = Exclude<keyof SoundLevels, "isMuted">;

interface SoundStore {
  readonly levels: SoundLevels;
  readonly setMuted: (isMuted: boolean) => void;
  readonly setVolume: (key: VolumeKey, volume: number) => void;
}

export const useSoundStore = create<SoundStore>()(
  persist(
    (set) => {
      return {
        levels: DEFAULT_SOUND_LEVELS,
        setMuted: (isMuted) => {
          set((state) => {
            return { levels: { ...state.levels, isMuted } };
          });
        },
        setVolume: (key, volume) => {
          set((state) => {
            return { levels: { ...state.levels, [key]: volume } };
          });
        },
      };
    },
    {
      merge: mergeStoredField("levels", readStoredLevels),
      name: STORAGE_KEY,
      partialize: (state) => {
        return { levels: state.levels };
      },
    }
  )
);

export function readStoredLevels(value: unknown): SoundLevels {
  const result = storedSchema.safeParse(value);

  if (!result.success) {
    console.warn("Ignoring the saved sound settings", result.error.issues);

    return DEFAULT_SOUND_LEVELS;
  }

  return result.data.levels;
}
