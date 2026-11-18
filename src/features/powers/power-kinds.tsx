import { Toolbar } from "@base-ui/react/toolbar";
import { useCallback } from "react";
import { POWER_CATEGORIES, type PowerCategory } from "../../content/powers.ts";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import { FOCUS_RING } from "../../design/styles.ts";

const KIND_ICONS: Readonly<Record<PowerCategory, GameIconName>> = {
  elements: "sun",
  land: "meadow",
  life: "population",
};

const COMPACT_TAB =
  "flex h-11 min-w-11 items-center justify-center gap-1 rounded-xl px-1.5 text-xs font-semibold text-ink-soft @max-[19rem]:px-1 hover:bg-paper-hover aria-pressed:bg-dawn-soft aria-pressed:text-dawn-strong";

const WIDE_TAB =
  "pointer-events-auto relative mb-px flex h-9 shrink-0 items-center gap-1.5 rounded-t-xl border border-b-0 border-paper-edge bg-canvas px-3 font-medium text-xs text-ink-soft hover:text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-11 aria-pressed:mb-0 aria-pressed:h-10 aria-pressed:bg-paper aria-pressed:text-ink aria-pressed:shadow-[inset_0_2px_0_var(--color-dawn)] pointer-coarse:text-sm";

interface KindTabsProps {
  readonly chosenKind: PowerCategory;
  readonly isCompact?: boolean;
  readonly onKindChange: (kind: PowerCategory) => void;
  readonly suggestedKind: PowerCategory | null;
}

interface KindTabProps extends KindTabsProps {
  readonly kind: PowerCategory;
  readonly name: string;
}

function KindTab({ chosenKind, isCompact, kind, name, onKindChange, suggestedKind }: KindTabProps) {
  const isChosen = kind === chosenKind;
  const handleChoose = useCallback(() => {
    onKindChange(kind);
  }, [kind, onKindChange]);

  return (
    <Toolbar.Button
      aria-pressed={isChosen}
      className={cn(isCompact ? COMPACT_TAB : WIDE_TAB, FOCUS_RING, {
        "text-dawn-strong motion-safe:animate-pulse": !isChosen && kind === suggestedKind,
      })}
      onClick={handleChoose}
    >
      <GameIcon className={isCompact ? "size-4 @min-[20rem]:size-5" : undefined} name={KIND_ICONS[kind]} size={20} />

      {name}
    </Toolbar.Button>
  );
}

export function KindTabs(props: KindTabsProps) {
  return (
    <Toolbar.Group
      aria-label="Kinds"
      className={props.isCompact ? "flex items-center" : "relative z-1 -mb-px flex items-end gap-1"}
    >
      {POWER_CATEGORIES.map(({ id, name }) => {
        return <KindTab {...props} key={id} kind={id} name={name} />;
      })}
    </Toolbar.Group>
  );
}
