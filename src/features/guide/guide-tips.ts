import type { PowerId } from "../../content/powers.ts";
import type { ChronicleCategory } from "../../simulation/chronicle.ts";

export const INTRO_TIPS = ["look", "pick", "use", "speed", "follow"] as const;

const MOMENT_TIPS = ["fire", "winter", "era", "feud"] as const;

const TIP_IDS: ReadonlySet<string> = new Set([...INTRO_TIPS, ...MOMENT_TIPS]);

const WINTER = "Winter";

export type GuideTipId = (typeof INTRO_TIPS)[number] | (typeof MOMENT_TIPS)[number];

export type GuideEvent =
  | { readonly kind: "cameraMoved" }
  | { readonly category: ChronicleCategory; readonly kind: "chronicle" }
  | { readonly kind: "powerPicked" }
  | { readonly kind: "powerUsed" }
  | { readonly kind: "season"; readonly name: string }
  | { readonly kind: "selected" }
  | { readonly kind: "speedChanged"; readonly speed: number };

export interface GuideTip {
  readonly powerId: PowerId | null;
  readonly text: string;
}

export const GUIDE_TIPS: Readonly<Record<GuideTipId, GuideTip>> = {
  era: { powerId: "inspiration", text: "A tribe reached a new era. Inspiration brings its next discovery sooner." },
  feud: { powerId: null, text: "Tribes are feuding. The Relations tab of the journal follows their quarrels." },
  fire: { powerId: "rain", text: "Fire spreads with the wind. Rain puts it out." },
  follow: { powerId: null, text: "Tap a tribe's banner to see its people, then follow them with the camera." },
  look: { powerId: null, text: "You are the god of this island. Drag to look around, and scroll or pinch to zoom." },
  pick: { powerId: "lightning", text: "Your powers are in the dock below. Pick Lightning and strike a tree." },
  speed: { powerId: null, text: "Time runs on its own. Pick a faster speed to watch the tribes grow." },
  use: { powerId: null, text: "Click or tap the land to use the power. Pick Select to put it away." },
  winter: { powerId: "healing", text: "Winter is here. Healing feeds and warms everyone inside its circle." },
};

export interface GuideProgress {
  readonly done: readonly GuideTipId[];
  readonly isOff: boolean;
  readonly shown: GuideTipId | null;
}

export const FRESH_GUIDE: GuideProgress = { done: [], isOff: false, shown: null };

function completedIntroTip(event: GuideEvent): GuideTipId | null {
  switch (event.kind) {
    case "cameraMoved":
      return "look";
    case "powerPicked":
      return "pick";
    case "powerUsed":
      return "use";
    case "selected":
      return "follow";
    case "speedChanged":
      return event.speed > 1 ? "speed" : null;
    default:
      return null;
  }
}

function momentTip(event: GuideEvent): GuideTipId | null {
  if (event.kind === "season") {
    return event.name === WINTER ? "winter" : null;
  }

  if (event.kind !== "chronicle") {
    return null;
  }

  switch (event.category) {
    case "era":
      return "era";
    case "feud":
      return "feud";
    case "fire":
      return "fire";
    default:
      return null;
  }
}

function withDone(done: readonly GuideTipId[], tip: GuideTipId | null): readonly GuideTipId[] {
  if (tip === null || done.includes(tip)) {
    return done;
  }

  return [...done, tip];
}

function hasFinishedIntro(progress: GuideProgress): boolean {
  return INTRO_TIPS.every((tip) => {
    return progress.done.includes(tip);
  });
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

  return tip === null ? null : GUIDE_TIPS[tip].powerId;
}

export function applyGuideEvent(progress: GuideProgress, event: GuideEvent): GuideProgress {
  const done = withDone(progress.done, completedIntroTip(event));
  const hasActed = event.kind === "powerUsed" && progress.shown !== null;
  const shown = hasActed ? null : progress.shown;
  const isUnchanged = done === progress.done && shown === progress.shown;
  const advanced = isUnchanged ? progress : { ...progress, done, shown };

  if (shown !== null || !hasFinishedIntro(advanced)) {
    return advanced;
  }

  const tip = momentTip(event);

  if (tip === null || done.includes(tip)) {
    return advanced;
  }

  return { ...advanced, done: [...done, tip], shown: tip };
}

export function dismissTip(progress: GuideProgress): GuideProgress {
  if (progress.shown !== null) {
    return { ...progress, shown: null };
  }

  return { ...progress, done: withDone(progress.done, currentTip(progress)) };
}
