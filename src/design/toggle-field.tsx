import { Switch } from "@base-ui/react/switch";
import { useId } from "react";
import { cn } from "./cn.ts";
import { FOCUS_RING_OFFSET } from "./styles.ts";

interface ToggleFieldProps {
  readonly description?: string | undefined;
  readonly isChecked: boolean;
  readonly label: string;
  readonly onChange: (isChecked: boolean) => void;
}

export function ToggleField({ description, isChecked, label, onChange }: ToggleFieldProps) {
  const labelId = useId();

  return (
    <div className="flex min-h-8 items-center justify-between gap-3 text-sm" title={description}>
      <span className="text-ink font-medium" id={labelId}>
        {label}
      </span>

      <Switch.Root
        aria-labelledby={labelId}
        checked={isChecked}
        className={cn(
          FOCUS_RING_OFFSET,
          "bg-ink/14 data-checked:bg-dawn flex h-5.5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-150"
        )}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className="shadow-thumb ease-glide size-4.5 rounded-full bg-white transition-transform duration-150 data-checked:translate-x-3.5" />
      </Switch.Root>
    </div>
  );
}
