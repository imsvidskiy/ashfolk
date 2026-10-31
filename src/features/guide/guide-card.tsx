import { Lightbulb } from "lucide-react";
import { TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import { Island } from "../../design/island.tsx";
import { POWER_ICONS } from "../powers/power-icons.ts";
import { useGuideStore } from "./guide-store.ts";
import { currentTip, GUIDE_TIPS, type GuideTip } from "./guide-tips.ts";

function useGuideCard() {
  const tipId = useGuideStore((state) => {
    return currentTip(state.progress);
  });
  const dismiss = useGuideStore((state) => {
    return state.dismiss;
  });
  const setTipsShown = useGuideStore((state) => {
    return state.setTipsShown;
  });

  function handleHide(): void {
    setTipsShown(false);
  }

  return { handleDismiss: dismiss, handleHide, tip: tipId === null ? null : GUIDE_TIPS[tipId] };
}

function TipIcon({ tip }: { readonly tip: GuideTip }) {
  if (tip.powerId === null) {
    return <Lightbulb aria-hidden="true" className="text-ink-soft shrink-0" size={22} />;
  }

  return <GameIcon name={POWER_ICONS[tip.powerId]} size={28} />;
}

export function GuideCard({ className }: { readonly className?: string | undefined }) {
  const { handleDismiss, handleHide, tip } = useGuideCard();

  if (tip === null) {
    return null;
  }

  return (
    <Island
      className={cn(
        "motion-safe:animate-notice-in pointer-events-auto flex items-center gap-3 py-2 pr-2 pl-4",
        className
      )}
    >
      <TipIcon tip={tip} />

      <p aria-live="polite" className="min-w-0 flex-1 text-sm leading-snug">
        {tip.text}
      </p>

      <div className="flex shrink-0 flex-col items-stretch gap-0.5 sm:flex-row sm:items-center">
        <TextButton className="h-8 px-3" onClick={handleDismiss} tone="outline">
          Got it
        </TextButton>

        <TextButton className="h-8 px-3" onClick={handleHide} tone="quiet">
          Hide tips
        </TextButton>
      </div>
    </Island>
  );
}
