import { FRESH_GUIDE, type GuideProgress, INTRO_TIPS } from "../guide/guide-tips.ts";

export const FINISHED_INTRO: GuideProgress = { ...FRESH_GUIDE, done: [...INTRO_TIPS] };
