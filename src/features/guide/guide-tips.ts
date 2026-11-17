import type { PowerId } from "../../content/powers.ts";
import type { ChronicleCategory } from "../../simulation/chronicle.ts";

export const INTRO_TIPS = ["follow", "use", "speed", "chronicle"] as const;

const MOMENT_TIPS = ["fire", "winter", "era", "feud"] as const;

type IntroTip = (typeof INTRO_TIPS)[number];

type MomentTip = (typeof MOMENT_TIPS)[number];

export type GuideTipId = IntroTip | MomentTip;

const TIP_IDS: ReadonlySet<string> = new Set([...INTRO_TIPS, ...MOMENT_TIPS]);

export type GuideEvent =
  | { readonly kind: "step"; readonly step: IntroTip }
  | { readonly category: ChronicleCategory; readonly kind: "chronicle" }
  | { readonly kind: "season"; readonly name: string }
  | { readonly kind: "cast"; readonly powerId: PowerId };

export interface GuideProgress {
  readonly done: readonly GuideTipId[];
  readonly isOff: boolean;
  readonly shown: MomentTip | null;
}

export const FRESH_GUIDE: GuideProgress = { done: [], isOff: false, shown: null };

const SUGGESTED_POWERS: Partial<Record<GuideTipId, PowerId>> = {
  era: "inspiration",
  fire: "rain",
  use: "abundance",
  winter: "healing",
};

function momentTip(event: GuideEvent): MomentTip | null {
  if (event.kind === "season") {
    return event.name === "Winter" ? "winter" : null;
  }

  if (
    event.kind === "chronicle" &&
    (event.category === "era" || event.category === "feud" || event.category === "fire")
  ) {
    return event.category;
  }

  return null;
}

export function isGuideTipId(value: string): value is GuideTipId {
  return TIP_IDS.has(value);
}

export function currentTip(progress: GuideProgress): GuideTipId | null {
  if (progress.isOff) {
    return null;
  }

  if (progress.shown !== null) {
    return progress.shown;
  }

  const next = INTRO_TIPS.find((tip) => {
    return !progress.done.includes(tip);
  });

  return next === undefined ? null : next;
}

export function suggestedPowerId(progress: GuideProgress): PowerId | null {
  const tip = currentTip(progress);
  const powerId = tip === null ? undefined : SUGGESTED_POWERS[tip];

  return powerId === undefined ? null : powerId;
}

export function applyGuideEvent(progress: GuideProgress, event: GuideEvent): GuideProgress {
  if (progress.isOff) {
    return progress;
  }

  if (event.kind === "step") {
    return progress.done.includes(event.step) ? progress : { ...progress, done: [...progress.done, event.step] };
  }

  if (progress.shown !== null) {
    if (event.kind === "cast" && SUGGESTED_POWERS[progress.shown] === event.powerId) {
      return { ...progress, shown: null };
    }

    return progress;
  }

  const tip = momentTip(event);

  if (tip === null || progress.done.includes(tip) || currentTip(progress) !== null) {
    return progress;
  }

  return { ...progress, done: [...progress.done, tip], shown: tip };
}
