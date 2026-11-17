import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { describeParameters, type ParameterValue } from "../../content/parameters.ts";
import { isPowerId, POWERS, type PowerId, powerFamily } from "../../content/powers.ts";
import { IconButton } from "../../design/buttons.tsx";
import { SegmentedChoice } from "../../design/choice-field.tsx";
import { cn } from "../../design/cn.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import { Island } from "../../design/island.tsx";
import { ScrollPanel } from "../../design/scroll-panel.tsx";
import { useIsCompact } from "../../design/use-media-query.ts";
import { ParameterControl } from "../parameters/parameter-control.tsx";
import { POWER_ICONS, POWER_OPTION_ICONS } from "./power-icons.ts";
import { parametersOf, usePowerStore } from "./power-store.ts";

const USAGE_HINTS = {
  brush: "Hold and drag over the land.",
  point: "Tap a spot on the island.",
} as const;

function usePowerParameters(powerId: PowerId) {
  const parameters = usePowerStore((state) => {
    return state.parameters;
  });
  const setParameter = usePowerStore((state) => {
    return state.setParameter;
  });
  const resetParameters = usePowerStore((state) => {
    return state.resetParameters;
  });

  const values = parametersOf(parameters, powerId);

  function handleParameterChange(key: string, value: ParameterValue): void {
    setParameter(powerId, key, value);
  }

  function handleReset(): void {
    resetParameters(powerId);
  }

  return { handleParameterChange, handleReset, values };
}

function useFieldDisclosure() {
  const isCompact = useIsCompact();
  const [isExpanded, setIsExpanded] = useState(false);

  function handleFieldsToggle(): void {
    setIsExpanded((wasExpanded) => {
      return !wasExpanded;
    });
  }

  return { areFieldsShown: !isCompact || isExpanded, handleFieldsToggle, isCompact };
}

function handleVariantChange(value: string): void {
  if (isPowerId(value)) {
    usePowerStore.getState().selectPower(value);
  }
}

function PowerVariants({ powerId }: { readonly powerId: PowerId }) {
  const family = powerFamily(powerId);

  if (family === undefined) {
    return null;
  }

  const options = family.map((id) => {
    return { label: POWERS[id].name, value: id };
  });

  return (
    <div className="order-last basis-full whitespace-nowrap @xl:order-none @xl:basis-auto">
      <SegmentedChoice label="Cast mode" onChange={handleVariantChange} options={options} value={powerId} />
    </div>
  );
}

function PowerSettingsContent({ powerId }: { readonly powerId: PowerId }) {
  const { handleParameterChange, handleReset, values } = usePowerParameters(powerId);
  const { areFieldsShown, handleFieldsToggle, isCompact } = useFieldDisclosure();

  const power = POWERS[powerId];
  const fields = describeParameters(power.parameters);

  return (
    <section aria-label={`${power.name} settings`} className="@container flex min-h-0 flex-1 flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-2.5">
        <span className="bg-ink/6 grid size-9 shrink-0 place-items-center rounded-xl">
          <GameIcon name={POWER_ICONS[powerId]} size={28} />
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-ink truncate text-sm leading-tight font-semibold">{power.name}</h2>

          <p className="text-ink-muted truncate text-xs" title={power.description}>
            {USAGE_HINTS[power.usage]}
          </p>
        </div>

        <PowerVariants powerId={powerId} />

        {isCompact ? (
          <IconButton
            aria-expanded={areFieldsShown}
            icon={<SlidersHorizontal aria-hidden="true" size={16} />}
            label="Adjust settings"
            onClick={handleFieldsToggle}
          />
        ) : null}

        <IconButton icon={<RotateCcw aria-hidden="true" size={16} />} label="Reset to defaults" onClick={handleReset} />
      </header>

      {areFieldsShown ? (
        <ScrollPanel className="-mx-1 px-1">
          <p className="text-ink-soft mb-3 text-sm leading-snug">{power.description}</p>

          <div className={cn("grid gap-3", { "@sm:grid-cols-2": fields.length > 1 })}>
            {fields.map((field) => {
              return (
                <ParameterControl
                  field={field}
                  key={field.key}
                  onChange={handleParameterChange}
                  optionIcons={POWER_OPTION_ICONS[powerId]?.[field.key]}
                  value={values[field.key]}
                />
              );
            })}
          </div>
        </ScrollPanel>
      ) : null}
    </section>
  );
}

export function PowerSettings({ className }: { readonly className?: string | undefined }) {
  const powerId = usePowerStore((state) => {
    return state.selectedPowerId;
  });

  if (powerId === null) {
    return null;
  }

  return (
    <Island className={cn("flex flex-col", className)}>
      <PowerSettingsContent powerId={powerId} />
    </Island>
  );
}
