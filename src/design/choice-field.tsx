import { Select } from "@base-ui/react/select";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { FIELD_SURFACE, FOCUS_RING, PAPER_SURFACE, POPUP_MOTION, SEGMENT, SEGMENT_TRACK } from "./styles.ts";

const SEGMENTED_LIMIT = 3;

export interface ChoiceOption {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: string;
}

interface ChoiceFieldProps {
  readonly description?: string | undefined;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly ChoiceOption[];
  readonly value: string;
}

function optionOf(options: readonly ChoiceOption[], value: string): ChoiceOption | undefined {
  return options.find((option) => {
    return option.value === value;
  });
}

function SegmentOption({ option }: { readonly option: ChoiceOption }) {
  return (
    <Toggle className={cn(SEGMENT, "flex-1")} value={option.value}>
      {option.icon}

      {option.label}
    </Toggle>
  );
}

function useSegmentChange(onChange: (value: string) => void) {
  return (values: string[]) => {
    const [selected] = values;

    if (selected !== undefined) {
      onChange(selected);
    }
  };
}

function useListChange(onChange: (value: string) => void) {
  return (selected: string | null) => {
    if (selected !== null) {
      onChange(selected);
    }
  };
}

function SegmentedChoice({ label, onChange, options, value }: ChoiceFieldProps) {
  const handleChange = useSegmentChange(onChange);

  return (
    <ToggleGroup aria-label={label} className={SEGMENT_TRACK} onValueChange={handleChange} value={[value]}>
      {options.map((option) => {
        return <SegmentOption key={option.value} option={option} />;
      })}
    </ToggleGroup>
  );
}

function ListOption({ option }: { readonly option: ChoiceOption }) {
  return (
    <Select.Item
      className="text-ink data-highlighted:bg-dawn-soft grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-lg py-2 pr-4 pl-2.5 text-sm outline-none"
      value={option.value}
    >
      <Select.ItemIndicator className="col-start-1">
        <Check aria-hidden="true" size={14} strokeWidth={2.4} />
      </Select.ItemIndicator>

      <span className="col-start-2 flex min-w-0 items-center gap-2">
        {option.icon}

        <Select.ItemText className="truncate">{option.label}</Select.ItemText>
      </span>
    </Select.Item>
  );
}

function SelectedOption({ option }: { readonly option: ChoiceOption | undefined }) {
  if (option === undefined) {
    return null;
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.icon}

      <span className="truncate">{option.label}</span>
    </span>
  );
}

function ListChoice({ label, onChange, options, value }: ChoiceFieldProps) {
  const handleChange = useListChange(onChange);

  return (
    <Select.Root items={options} onValueChange={handleChange} value={value}>
      <Select.Trigger
        aria-label={label}
        className={cn(
          FIELD_SURFACE,
          FOCUS_RING,
          "text-ink flex h-9 w-full items-center justify-between gap-3 transition-colors hover:bg-white/80 pointer-coarse:h-10"
        )}
      >
        <Select.Value>
          {(selected: string) => {
            return <SelectedOption option={optionOf(options, selected)} />;
          }}
        </Select.Value>

        <Select.Icon className="text-ink-muted">
          <ChevronsUpDown aria-hidden="true" size={14} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner alignItemWithTrigger={false} className="z-50 outline-none select-none" sideOffset={6}>
          <Select.Popup
            className={cn(PAPER_SURFACE, POPUP_MOTION, "w-(--anchor-width) rounded-2xl p-1 duration-100 outline-none")}
          >
            <Select.List className="max-h-[min(var(--available-height),24rem)] overflow-y-auto">
              {options.map((option) => {
                return <ListOption key={option.value} option={option} />;
              })}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function ChoiceControl(props: ChoiceFieldProps) {
  if (props.options.length <= SEGMENTED_LIMIT) {
    return <SegmentedChoice {...props} />;
  }

  return <ListChoice {...props} />;
}

export function ChoiceField(props: ChoiceFieldProps) {
  const { description, label } = props;

  return (
    <div className="flex flex-col gap-2" title={description}>
      <span className="text-ink text-sm font-medium">{label}</span>

      <ChoiceControl {...props} />
    </div>
  );
}
