import { Slider } from "@base-ui/react/slider";
import { useId } from "react";
import { useHeldDraft } from "./use-held-draft.ts";

interface RangeFieldProps {
  readonly description?: string | undefined;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onChange: (value: number) => void;
  readonly step: number;
  readonly value: number;
  readonly valueText: string;
}

function useHeldRange(value: number, onChange: (value: number) => void) {
  const [shown, hold] = useHeldDraft(value);

  function handleChange(next: number): void {
    hold(next);
    onChange(next);
  }

  return { handleChange, shown };
}

export function RangeField({
  description,
  label,
  maximum,
  minimum,
  onChange,
  step,
  value,
  valueText,
}: RangeFieldProps) {
  const labelId = useId();
  const { handleChange, shown } = useHeldRange(value, onChange);

  return (
    <div className="flex flex-col gap-1" title={description}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink font-medium" id={labelId}>
          {label}
        </span>

        <span className="text-ink-soft shrink-0 tabular-nums">{valueText}</span>
      </div>

      <Slider.Root
        aria-labelledby={labelId}
        max={maximum}
        min={minimum}
        onValueChange={handleChange}
        step={step}
        value={shown}
      >
        <Slider.Control className="flex h-5 touch-none items-center select-none pointer-coarse:h-8">
          <Slider.Track className="bg-ink/10 h-1 w-full rounded-full">
            <Slider.Indicator className="bg-dawn rounded-full" />

            <Slider.Thumb
              aria-label={label}
              className="shadow-thumb has-focus-visible:ring-dawn/35 size-3.5 rounded-full bg-white transition-[scale,box-shadow] duration-100 has-focus-visible:ring-4 data-dragging:scale-115 pointer-coarse:size-5"
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  );
}
