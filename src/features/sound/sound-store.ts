import { create } from "zustand";
import { storedSoundLevels, storeSoundLevels } from "../../app/preferences.ts";
import { DEFAULT_SOUND_LEVELS, type SoundLevels } from "../../audio/sound-engine.ts";

export type VolumeKey = Exclude<keyof SoundLevels, "isMuted">;

interface SoundStore {
  readonly levels: SoundLevels;
  readonly setMuted: (isMuted: boolean) => void;
  readonly setVolume: (key: VolumeKey, volume: number) => void;
}

export const useSoundStore = create<SoundStore>()((set, get) => {
  function apply(levels: SoundLevels): void {
    storeSoundLevels(levels);
    set({ levels });
  }

  const stored = storedSoundLevels();

  return {
    levels: stored === null ? DEFAULT_SOUND_LEVELS : stored,
    setMuted: (isMuted) => {
      apply({ ...get().levels, isMuted });
    },
    setVolume: (key, volume) => {
      apply({ ...get().levels, [key]: volume });
    },
  };
});
