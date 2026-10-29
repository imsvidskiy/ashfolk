import { Meter } from "@base-ui/react/meter";
import { cn } from "./cn.ts";
import { formatPercent } from "./format.ts";

type MeterTone = "dawn" | "ember" | "gold" | "lake" | "meadow";

const INDICATOR_TONES: Readonly<Record<MeterTone, string>> = {
  dawn: "bg-dawn",
  ember: "bg-ember",
  gold: "bg-gold",
  lake: "bg-lake",
  meadow: "bg-meadow",
};

interface MeterBarProps {
  readonly label: string;
  readonly tone: MeterTone;
  readonly value: number;
  readonly valueText?: string | undefined;
}

export function MeterBar({ label, tone, value, valueText }: MeterBarProps) {
  const text = valueText === undefined ? formatPercent(value) : valueText;

  return (
    <Meter.Root className="grid grid-cols-2 gap-y-1" max={1} value={value}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Meter.Label renders a span that names the meter through aria-labelledby */}
      <Meter.Label className="text-ink-soft text-xs">{label}</Meter.Label>

      <span className="text-ink text-right text-xs font-medium tabular-nums">{text}</span>

      <Meter.Track className="bg-ink/10 col-span-2 h-1.5 overflow-hidden rounded-full">
        <Meter.Indicator className={cn("rounded-full transition-[width] duration-500", INDICATOR_TONES[tone])} />
      </Meter.Track>
    </Meter.Root>
  );
}
