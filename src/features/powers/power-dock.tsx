import { ScrollArea } from "@base-ui/react/scroll-area";
import { Toolbar } from "@base-ui/react/toolbar";
import { Hand, MousePointer2 } from "lucide-react";
import { Fragment, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  POWER_CATEGORIES,
  POWERS,
  type PowerCategory,
  type PowerId,
  powerGroupsInCategory,
  powersInCategory,
} from "../../content/powers.ts";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import { Island } from "../../design/island.tsx";
import { FOCUS_RING } from "../../design/styles.ts";
import { WithTooltip } from "../../design/tooltip.tsx";
import { isTypingTarget } from "../../game/input/keyboard-controls.ts";
import { useGuideStore } from "../guide/guide-store.ts";
import { suggestedPowerId } from "../guide/guide-tips.ts";
import { POWER_ICONS } from "./power-icons.tsx";
import { usePowerStore } from "./power-store.ts";

const SELECT_HINT = "Tap people, animals, buildings or land to see their details.";

const HAND_HINT = "Pick up people, animals, trees and bushes and set them down elsewhere.";

const DIGIT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"]';

const CELL_CLASS = `grid size-11 shrink-0 snap-start place-items-center rounded-xl transition-[background-color,box-shadow,translate,scale] duration-150 hover:bg-paper-hover active:scale-95 motion-safe:hover:-translate-y-0.5 ${FOCUS_RING}`;

const TOOL_CELL_CLASS = `${CELL_CLASS} text-ink-soft hover:text-ink`;

const CHOSEN_CELL_CLASS = "bg-dawn-soft text-ink ring-1 ring-dawn hover:bg-dawn-soft";

const SUGGESTED_CLASS = "ring-2 ring-dawn/60 motion-safe:animate-pulse";

const TAB_CLASS = `pointer-events-auto relative flex shrink-0 items-center gap-1.5 rounded-t-xl border border-b-0 border-paper-edge px-3 font-medium text-xs transition-[color,background-color] duration-150 after:absolute after:inset-x-0 after:bottom-0 after:h-11 pointer-coarse:text-sm ${FOCUS_RING}`;

const CHOSEN_TAB_CLASS = "h-10 bg-paper text-ink shadow-[inset_0_2px_0_var(--color-dawn)]";

const RESTING_TAB_CLASS = "mb-px h-9 bg-canvas text-ink-soft hover:text-ink";

const KIND_ICONS: Readonly<Record<PowerCategory, GameIconName>> = {
  elements: "sun",
  land: "meadow",
  life: "population",
};

interface KindChoice {
  readonly chosenKind: PowerCategory;
  readonly onKindChange: (kind: PowerCategory) => void;
}

interface KindTabProps extends KindChoice {
  readonly kind: PowerCategory;
  readonly name: string;
}

interface TileHintProps {
  readonly description: string;
  readonly hotkey?: string | undefined;
  readonly name: string;
}

interface PowerTileProps {
  readonly hotkey: string | undefined;
  readonly powerId: PowerId;
}

function initialKind(): PowerCategory {
  const { selectedPowerId } = usePowerStore.getState();

  return selectedPowerId === null ? "elements" : POWERS[selectedPowerId].category;
}

function isInDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(DIALOG_SELECTOR) !== null;
}

function hotkeyOf(index: number): string | undefined {
  return index < DIGIT_KEYS.length ? String(index + 1) : undefined;
}

function useSuggestedPower(): PowerId | null {
  const suggested = useGuideStore((state) => {
    return suggestedPowerId(state.progress);
  });
  const selected = usePowerStore((state) => {
    return state.selectedPowerId;
  });

  return suggested === selected ? null : suggested;
}

function usePowerSelection(powerId: PowerId) {
  const isSelected = usePowerStore((state) => {
    return state.selectedPowerId === powerId;
  });
  const selectPower = usePowerStore((state) => {
    return state.selectPower;
  });
  const isSuggested = useSuggestedPower() === powerId;

  function handleToggle(): void {
    selectPower(isSelected ? null : powerId);
  }

  return { handleToggle, isSelected, isSuggested };
}

function useClearPower() {
  const isSelecting = usePowerStore((state) => {
    return state.selectedPowerId === null && !state.isHandSelected;
  });
  const selectPower = usePowerStore((state) => {
    return state.selectPower;
  });

  function handleClear(): void {
    selectPower(null);
  }

  return { handleClear, isSelecting };
}

function useHand() {
  const isHandSelected = usePowerStore((state) => {
    return state.isHandSelected;
  });
  const selectHand = usePowerStore((state) => {
    return state.selectHand;
  });

  function handleSelect(): void {
    selectHand();
  }

  return { handleSelect, isHandSelected };
}

function useKindTab({ chosenKind, kind, onKindChange }: KindChoice & { readonly kind: PowerCategory }) {
  const suggested = useSuggestedPower();
  const isChosen = kind === chosenKind;
  const isSuggested = !isChosen && suggested !== null && POWERS[suggested].category === kind;

  function handleChoose(): void {
    onKindChange(kind);
  }

  return { handleChoose, isChosen, isSuggested };
}

function useDigitHotkeys(kind: PowerCategory): void {
  useEffect(() => {
    const powers = powersInCategory(kind);

    function handleKeyDown(event: KeyboardEvent): void {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.repeat ||
        isTypingTarget(event.target) ||
        isInDialog(event.target)
      ) {
        return;
      }

      const powerId = powers[DIGIT_KEYS.indexOf(event.code)];

      if (powerId === undefined) {
        return;
      }

      usePowerStore.getState().selectPower(powerId);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [kind]);
}

function useWheelScrollsSideways(rowReference: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const row = rowReference.current;

    if (row === null) {
      return;
    }

    const scroller = row;

    function handleWheel(event: WheelEvent): void {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      if (scroller.scrollWidth <= scroller.clientWidth) {
        return;
      }

      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    }

    row.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      row.removeEventListener("wheel", handleWheel);
    };
  }, [rowReference]);
}

function TileHint({ description, hotkey, name }: TileHintProps) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center justify-between gap-3">
        <span className="font-semibold">{name}</span>

        {hotkey === undefined ? null : (
          <kbd className="text-2xs rounded-md bg-white/15 px-1.5 font-sans text-white/90">{hotkey}</kbd>
        )}
      </span>

      <span className="text-white/75">{description}</span>
    </span>
  );
}

function PowerTile({ hotkey, powerId }: PowerTileProps) {
  const { handleToggle, isSelected, isSuggested } = usePowerSelection(powerId);

  const power = POWERS[powerId];

  return (
    <WithTooltip content={<TileHint description={power.description} hotkey={hotkey} name={power.name} />}>
      <Toolbar.Button
        aria-keyshortcuts={hotkey}
        aria-label={power.name}
        aria-pressed={isSelected}
        className={cn(CELL_CLASS, { [CHOSEN_CELL_CLASS]: isSelected, [SUGGESTED_CLASS]: isSuggested })}
        onClick={handleToggle}
      >
        <GameIcon name={POWER_ICONS[powerId]} size={30} />
      </Toolbar.Button>
    </WithTooltip>
  );
}

function SelectTile() {
  const { handleClear, isSelecting } = useClearPower();

  return (
    <WithTooltip content={<TileHint description={SELECT_HINT} hotkey="Esc" name="Select" />}>
      <Toolbar.Button
        aria-keyshortcuts="Escape"
        aria-label="Select"
        aria-pressed={isSelecting}
        className={cn(TOOL_CELL_CLASS, { [CHOSEN_CELL_CLASS]: isSelecting })}
        onClick={handleClear}
      >
        <MousePointer2 aria-hidden="true" size={22} strokeWidth={1.9} />
      </Toolbar.Button>
    </WithTooltip>
  );
}

function HandTile() {
  const { handleSelect, isHandSelected } = useHand();

  return (
    <WithTooltip content={<TileHint description={HAND_HINT} name="Hand" />}>
      <Toolbar.Button
        aria-label="Hand"
        aria-pressed={isHandSelected}
        className={cn(TOOL_CELL_CLASS, { [CHOSEN_CELL_CLASS]: isHandSelected })}
        onClick={handleSelect}
      >
        <Hand aria-hidden="true" size={22} strokeWidth={1.9} />
      </Toolbar.Button>
    </WithTooltip>
  );
}

function KindTab({ chosenKind, kind, name, onKindChange }: KindTabProps) {
  const { handleChoose, isChosen, isSuggested } = useKindTab({ chosenKind, kind, onKindChange });

  return (
    <Toolbar.Button
      aria-pressed={isChosen}
      className={cn(TAB_CLASS, isChosen ? CHOSEN_TAB_CLASS : RESTING_TAB_CLASS, {
        "text-dawn-strong motion-safe:animate-pulse": isSuggested,
      })}
      onClick={handleChoose}
    >
      <GameIcon name={KIND_ICONS[kind]} size={20} />

      {name}
    </Toolbar.Button>
  );
}

function KindTabs({ chosenKind, onKindChange }: KindChoice) {
  return (
    <Toolbar.Group aria-label="Kinds" className="relative z-1 -mb-px flex items-end gap-1">
      {POWER_CATEGORIES.map((entry) => {
        return (
          <KindTab
            chosenKind={chosenKind}
            key={entry.id}
            kind={entry.id}
            name={entry.name}
            onKindChange={onKindChange}
          />
        );
      })}
    </Toolbar.Group>
  );
}

function DockSeparator() {
  return <Toolbar.Separator className="bg-ink/12 mx-1 h-7 w-px shrink-0" />;
}

function PowerRow({ children }: { readonly children: ReactNode }) {
  const rowReference = useRef<HTMLDivElement>(null);

  useWheelScrollsSideways(rowReference);

  return (
    <ScrollArea.Root className="min-w-0 flex-1">
      <ScrollArea.Viewport
        className="scroll-fade-x flex snap-x snap-mandatory items-center gap-0.5 overscroll-x-contain p-0.5 outline-none"
        ref={rowReference}
      >
        {children}
      </ScrollArea.Viewport>
    </ScrollArea.Root>
  );
}

export function PowerDock({ className }: { readonly className?: string | undefined }) {
  const [kind, setKind] = useState(initialKind);

  const powers = powersInCategory(kind);

  useDigitHotkeys(kind);

  return (
    <Toolbar.Root aria-label="Powers" className={cn("flex min-w-0 flex-col", className)}>
      <KindTabs chosenKind={kind} onKindChange={setKind} />

      <Island className="flex items-center gap-0.5 rounded-tl-none p-1 pl-1.5">
        <SelectTile />

        <HandTile />

        <DockSeparator />

        <PowerRow>
          {powerGroupsInCategory(kind).map((group, groupIndex) => {
            return (
              <Fragment key={group[0]}>
                {groupIndex === 0 ? null : <DockSeparator />}

                {group.map((powerId) => {
                  return <PowerTile hotkey={hotkeyOf(powers.indexOf(powerId))} key={powerId} powerId={powerId} />;
                })}
              </Fragment>
            );
          })}
        </PowerRow>
      </Island>
    </Toolbar.Root>
  );
}
