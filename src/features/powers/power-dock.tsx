import { Toolbar } from "@base-ui/react/toolbar";
import { MousePointer2 } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { POWER_CATEGORIES, POWERS, type PowerCategory, type PowerId, powersInCategory } from "../../content/powers.ts";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import { Island } from "../../design/island.tsx";
import { FOCUS_RING, SEGMENT, SEGMENT_TRACK } from "../../design/styles.ts";
import { WithTooltip } from "../../design/tooltip.tsx";
import { POWER_ICONS } from "./power-icons.tsx";
import { usePowerStore } from "./power-store.ts";

const SELECT_HINT = "Tap people, animals, buildings or land to see their details.";

const TILE_CLASS = `grid size-10.5 shrink-0 snap-start place-items-center rounded-xl transition-[background-color,box-shadow,scale] duration-150 hover:bg-paper-hover active:scale-95 pointer-coarse:size-12 ${FOCUS_RING}`;

const CHOSEN_TILE_CLASS = "bg-white shadow-segment hover:bg-white";

const KIND_ICONS: Readonly<Record<PowerCategory, GameIconName>> = {
  elements: POWER_ICONS.fire,
  land: POWER_ICONS.raise,
  life: POWER_ICONS.tribe,
};

function initialKind(): PowerCategory {
  const { selectedPowerId } = usePowerStore.getState();

  return selectedPowerId === null ? "elements" : POWERS[selectedPowerId].category;
}

function TileHint({ description, name }: { readonly description: string; readonly name: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold">{name}</span>

      <span className="text-white/75">{description}</span>
    </span>
  );
}

function usePowerSelection(powerId: PowerId) {
  const isSelected = usePowerStore((state) => state.selectedPowerId === powerId);
  const selectPower = usePowerStore((state) => state.selectPower);

  function handleToggle(): void {
    selectPower(isSelected ? null : powerId);
  }

  return { handleToggle, isSelected };
}

function PowerTile({ powerId }: { readonly powerId: PowerId }) {
  const { handleToggle, isSelected } = usePowerSelection(powerId);

  const power = POWERS[powerId];

  return (
    <WithTooltip content={<TileHint description={power.description} name={power.name} />}>
      <Toolbar.Button
        aria-label={power.name}
        aria-pressed={isSelected}
        className={cn(TILE_CLASS, { [`${CHOSEN_TILE_CLASS} ring-dawn ring-2`]: isSelected })}
        onClick={handleToggle}
      >
        <GameIcon name={POWER_ICONS[powerId]} size={34} />
      </Toolbar.Button>
    </WithTooltip>
  );
}

function useClearPower() {
  const isSelecting = usePowerStore((state) => state.selectedPowerId === null);
  const selectPower = usePowerStore((state) => state.selectPower);

  function handleClear(): void {
    selectPower(null);
  }

  return { handleClear, isSelecting };
}

function SelectTile() {
  const { handleClear, isSelecting } = useClearPower();

  return (
    <WithTooltip content={<TileHint description={SELECT_HINT} name="Select" />}>
      <Toolbar.Button
        aria-label="Select"
        aria-pressed={isSelecting}
        className={cn(TILE_CLASS, "text-ink-soft hover:text-ink", { [`${CHOSEN_TILE_CLASS} text-ink`]: isSelecting })}
        onClick={handleClear}
      >
        <MousePointer2 aria-hidden="true" size={22} strokeWidth={1.9} />
      </Toolbar.Button>
    </WithTooltip>
  );
}

interface KindChoice {
  readonly chosenKind: PowerCategory;
  readonly onKindChange: (kind: PowerCategory) => void;
}

function useKindTab({ chosenKind, kind, onKindChange }: KindChoice & { readonly kind: PowerCategory }) {
  function handleChoose(): void {
    onKindChange(kind);
  }

  return { handleChoose, isChosen: kind === chosenKind };
}

interface KindTabProps extends KindChoice {
  readonly kind: PowerCategory;
  readonly name: string;
}

function KindTab({ chosenKind, kind, name, onKindChange }: KindTabProps) {
  const { handleChoose, isChosen } = useKindTab({ chosenKind, kind, onKindChange });

  return (
    <Toolbar.Button
      aria-pressed={isChosen}
      className={cn(SEGMENT, "text-sm max-lg:aspect-square max-lg:px-0 lg:px-2.5 pointer-coarse:h-10", {
        "text-ink shadow-segment bg-white": isChosen,
      })}
      onClick={handleChoose}
    >
      <GameIcon name={KIND_ICONS[kind]} size={22} />

      <span className="max-lg:sr-only">{name}</span>
    </Toolbar.Button>
  );
}

function KindTabs({ chosenKind, onKindChange }: KindChoice) {
  return (
    <Toolbar.Group aria-label="Kinds" className={cn(SEGMENT_TRACK, "mr-1 shrink-0 p-1")}>
      {POWER_CATEGORIES.map((entry) => (
        <KindTab chosenKind={chosenKind} key={entry.id} kind={entry.id} name={entry.name} onKindChange={onKindChange} />
      ))}
    </Toolbar.Group>
  );
}

function useWheelScrollsSideways(rowReference: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const row = rowReference.current;

    if (row === null) {
      return;
    }

    const scroller = row;

    function scrollSideways(event: WheelEvent): void {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      if (scroller.scrollWidth <= scroller.clientWidth) {
        return;
      }

      event.preventDefault();
      scroller.scrollLeft += event.deltaY;
    }

    row.addEventListener("wheel", scrollSideways, { passive: false });

    return () => row.removeEventListener("wheel", scrollSideways);
  }, [rowReference]);
}

export function PowerDock({ className }: { readonly className?: string | undefined }) {
  const [kind, setKind] = useState(initialKind);
  const rowReference = useRef<HTMLDivElement>(null);

  useWheelScrollsSideways(rowReference);

  return (
    <Island className={className}>
      <Toolbar.Root
        aria-label="Powers"
        className="flex snap-x snap-mandatory scroll-px-1.5 scrollbar-none items-center gap-0.5 overflow-x-auto overscroll-x-contain p-1.5"
        ref={rowReference}
      >
        <SelectTile />

        <Toolbar.Separator className="bg-ink/15 mx-1 h-7 w-px shrink-0" />

        <KindTabs chosenKind={kind} onKindChange={setKind} />

        {powersInCategory(kind).map((powerId) => (
          <PowerTile key={powerId} powerId={powerId} />
        ))}
      </Toolbar.Root>
    </Island>
  );
}
