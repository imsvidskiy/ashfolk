import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mergeStoredField } from "../../app/preferences.ts";
import {
  applyGuideEvent,
  dismissTip,
  FRESH_GUIDE,
  type GuideEvent,
  type GuideProgress,
  isGuideTipId,
} from "./guide-tips.ts";

const STORAGE_KEY = "ashfolk.guide";

const storedSchema = z.object({
  done: z.array(z.string()).default([]),
  isOff: z.boolean().default(false),
});

interface GuideStore {
  readonly dismiss: () => void;
  readonly progress: GuideProgress;
  readonly record: (event: GuideEvent) => void;
  readonly setTipsShown: (areShown: boolean) => void;
}

export const useGuideStore = create<GuideStore>()(
  persist(
    (set, get) => {
      return {
        dismiss: () => {
          set((state) => {
            return { progress: dismissTip(state.progress) };
          });
        },
        progress: FRESH_GUIDE,
        record: (event) => {
          const { progress } = get();
          const next = applyGuideEvent(progress, event);

          if (next !== progress) {
            set({ progress: next });
          }
        },
        setTipsShown: (areShown) => {
          set({ progress: areShown ? FRESH_GUIDE : { ...FRESH_GUIDE, isOff: true } });
        },
      };
    },
    {
      merge: mergeStoredField("progress", readStoredGuide),
      name: STORAGE_KEY,
      partialize: (state) => {
        return { done: state.progress.done, isOff: state.progress.isOff };
      },
    }
  )
);

export function readStoredGuide(value: unknown): GuideProgress {
  const result = storedSchema.safeParse(value);

  if (!result.success) {
    console.warn("Ignoring saved tips progress", result.error.issues);

    return FRESH_GUIDE;
  }

  return { ...FRESH_GUIDE, done: result.data.done.filter(isGuideTipId), isOff: result.data.isOff };
}
