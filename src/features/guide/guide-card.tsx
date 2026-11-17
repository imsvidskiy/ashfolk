import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useEngine } from "../../app/use-engine.ts";
import { POWERS, type PowerId } from "../../content/powers.ts";
import { TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import { Island } from "../../design/island.tsx";
import { FOCUS_RING } from "../../design/styles.ts";
import { useIsTouch } from "../../design/use-media-query.ts";
import { focusOnCamp, showTribe } from "../inspector/use-focus-camera.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { useSidePanel } from "../journal/use-side-panel.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { useWorldStore } from "../world/world-store.ts";
import { useGuideStore } from "./guide-store.ts";
import { currentTip, type GuideTipId, INTRO_TIPS } from "./guide-tips.ts";

interface GuideAction {
  readonly label: string;
  readonly onClick: () => void;
}

interface Lesson {
  readonly action?: GuideAction;
  readonly description: string;
  readonly icon: GameIconName;
  readonly title: string;
}

function initiallyExpanded(): boolean {
  return !window.matchMedia("(max-height: 32rem)").matches;
}

function useLesson(tip: GuideTipId): Lesson {
  const engine = useEngine();
  const isTouch = useIsTouch();
  const { close, openJournal } = useSidePanel();
  const selectedPower = usePowerStore((state) => {
    return state.selectedPowerId;
  });
  const tribeName = useWorldStore((state) => {
    return state.snapshot?.tribes[0]?.name;
  });

  function equip(powerId: PowerId): GuideAction {
    return {
      label: `Choose ${POWERS[powerId].name}`,
      onClick: () => {
        if (powerId === "abundance") {
          const { snapshot } = useWorldStore.getState();
          const tribe = snapshot?.inspection?.kind === "tribe" ? snapshot.inspection.summary : snapshot?.tribes[0];

          if (engine !== null && tribe !== undefined) {
            focusOnCamp(engine, tribe);
          }
        }

        close();
        usePowerStore.getState().selectPower(powerId);
      },
    };
  }

  function handleVisitCamp(): void {
    const tribe = useWorldStore.getState().snapshot?.tribes[0];

    if (engine === null || tribe === undefined) {
      return;
    }

    showTribe(engine, tribe);
  }

  function handleWatch(): void {
    if (engine === null) {
      return;
    }

    engine.session.send({ speed: 2, type: "setSpeed" });

    if (engine.session.frame.isPaused) {
      engine.session.send({ isPaused: false, type: "setPaused" });
    }
  }

  function handleChronicle(): void {
    openJournal("chronicle");
    useGuideStore.getState().record({ kind: "step", step: "chronicle" });
  }

  function handleRelations(): void {
    openJournal("relations");
    useGuideStore.getState().dismiss();
  }

  if ((tip === "follow" || tip === "use") && tribeName === undefined) {
    return {
      ...(selectedPower === "tribe" ? {} : { action: equip("tribe") }),
      description: "Choose Tribe from Life, then tap flat, dry land to settle a camp.",
      icon: "tent",
      title: "Settle your first camp",
    };
  }

  switch (tip) {
    case "follow":
      return {
        action: { label: "Visit camp", onClick: handleVisitCamp },
        description: `Visit ${tribeName} to check their food stores. Drag to explore and ${isTouch ? "pinch" : "scroll"} to zoom.`,
        icon: "tent",
        title: "Meet your first tribe",
      };
    case "use":
      return {
        ...(selectedPower === "abundance" ? {} : { action: equip("abundance") }),
        description:
          selectedPower === "abundance"
            ? "Tap the ground beside a camp. The nearest tribe receives berries and nearby bushes ripen."
            : "Choose Abundance from Life to fill berry bushes and give a nearby tribe food.",
        icon: "grain",
        title: "Give the tribe a gift",
      };
    case "speed":
      return {
        action: { label: "Run at 2×", onClick: handleWatch },
        description: "Speed up the island and watch people gather and build. Use the clock to slow down or pause.",
        icon: "sunrise",
        title: "Watch a day unfold",
      };
    case "chronicle":
      return {
        action: { label: "Open chronicle", onClick: handleChronicle },
        description:
          "The journal remembers gifts, births and discoveries. Choose an entry to visit the place it happened.",
        icon: "gift",
        title: "Follow the island’s story",
      };
    case "fire":
      return {
        action: equip("rain"),
        description: "Brush Rain over the flames to keep the fire from spreading.",
        icon: "fire",
        title: "A fire has broken out",
      };
    case "winter":
      return {
        action: equip("healing"),
        description: "Cast Healing over a camp to feed and warm the people in its circle.",
        icon: "snow",
        title: "Help the tribe through winter",
      };
    case "era":
      return {
        action: equip("inspiration"),
        description: "Cast Inspiration beside a camp to bring its next discovery closer.",
        icon: "inspiration",
        title: "A new era has begun",
      };
    case "feud":
      return {
        action: { label: "Open relations", onClick: handleRelations },
        description: "See which tribes are feuding and where their camps lie.",
        icon: "raid",
        title: "Two tribes are feuding",
      };
    default:
      return tip satisfies never;
  }
}

function useLessonCard(tip: GuideTipId) {
  const [isExpanded, setExpanded] = useState(initiallyExpanded);
  const contentId = useId();
  const lesson = useLesson(tip);
  const steps: readonly GuideTipId[] = INTRO_TIPS;
  const index = steps.indexOf(tip);
  const isIntro = index !== -1;

  function handleToggle(): void {
    setExpanded(!isExpanded);
  }

  function handleDismiss(): void {
    if (isIntro) {
      useGuideStore.getState().setTipsShown(false);
    } else {
      useGuideStore.getState().dismiss();
    }
  }

  return { contentId, handleDismiss, handleToggle, index, isExpanded, isIntro, lesson };
}

function LessonCard({ className, tip }: { readonly className?: string | undefined; readonly tip: GuideTipId }) {
  const { contentId, handleDismiss, handleToggle, index, isExpanded, isIntro, lesson } = useLessonCard(tip);

  return (
    <Island className={cn("motion-safe:animate-notice-in shrink-0", className)}>
      <section aria-label="Island guide">
        <button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          className={cn(
            "hover:bg-paper-hover rounded-island flex w-full items-center gap-3 px-3 py-2.5 text-left",
            FOCUS_RING
          )}
          onClick={handleToggle}
          type="button"
        >
          <span className="bg-dawn-soft grid size-10 shrink-0 place-items-center rounded-xl">
            <GameIcon name={lesson.icon} size={32} />
          </span>

          <span aria-live="polite" className="flex min-w-0 flex-1 flex-col">
            <span className="text-ink-muted text-2xs font-bold tracking-wider uppercase">
              {isIntro ? `First island · ${index + 1} of ${INTRO_TIPS.length}` : "Island guide"}
            </span>

            <span className="text-base leading-tight font-bold">{lesson.title}</span>
          </span>

          <ChevronDown
            aria-hidden="true"
            className={cn("text-ink-muted shrink-0", { "rotate-180": isExpanded })}
            size={16}
          />
        </button>

        <div className="px-3.5 pb-3" hidden={!isExpanded} id={contentId}>
          <p aria-live="polite" className="text-ink-soft text-sm leading-snug">
            {lesson.description}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            {lesson.action === undefined ? null : (
              <TextButton className="px-3" onClick={lesson.action.onClick} tone="accent">
                {lesson.action.label}
              </TextButton>
            )}

            <TextButton className="px-3" onClick={handleDismiss} tone="quiet">
              {isIntro ? "Skip guide" : "Dismiss"}
            </TextButton>
          </div>
        </div>
      </section>
    </Island>
  );
}

export function GuideCard({ className }: { readonly className?: string | undefined }) {
  const tip = useGuideStore((state) => {
    return currentTip(state.progress);
  });

  const isSettingsOpen = useInterfaceStore((state) => {
    return state.isSettingsOpen;
  });

  return tip === null ? null : <LessonCard className={cn(className, { invisible: isSettingsOpen })} tip={tip} />;
}
