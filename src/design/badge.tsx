import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { GameIcon } from "./game-icon.tsx";
import type { GameIconName } from "./game-icon-sources.ts";

export type BadgeTone = "dawn" | "ember" | "meadow" | "muted";

const BADGE_TONES: Readonly<Record<BadgeTone, string>> = {
  dawn: "bg-dawn-soft text-dawn-strong",
  ember: "bg-ember-soft text-ember",
  meadow: "bg-meadow-soft text-meadow",
  muted: "bg-ink/8 text-ink-soft",
};

interface BadgeProps {
  readonly children: ReactNode;
  readonly icon?: GameIconName | undefined;
  readonly tone: BadgeTone;
}

export function Badge({ children, icon, tone }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full text-xs font-medium",
        icon === undefined ? "px-2.5" : "px-2",
        BADGE_TONES[tone]
      )}
    >
      {icon === undefined ? null : <GameIcon name={icon} size={18} />}

      {children}
    </span>
  );
}
