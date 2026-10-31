import { Circle, Dices, Square } from "lucide-react";
import type { ChangeEvent } from "react";
import { IconButton } from "../../design/buttons.tsx";
import { ChoiceField, type ChoiceOption } from "../../design/choice-field.tsx";
import { cn } from "../../design/cn.ts";
import { FIELD_SURFACE } from "../../design/styles.ts";
import type { IslandShapeKind } from "../../world/island-shape.ts";
import type { IslandSizeKind } from "../../world/island-size.ts";
import { LONGEST_WORLD_NAME } from "./world-names.ts";

const SHAPE_OPTIONS: readonly ChoiceOption[] = [
  { icon: <Circle aria-hidden="true" size={14} />, label: "Round", value: "round" },
  { icon: <Square aria-hidden="true" size={14} />, label: "Square", value: "square" },
];

const SIZE_OPTIONS: readonly ChoiceOption[] = [
  { label: "Small", value: "small" },
  { label: "Normal", value: "normal" },
  { label: "Large", value: "large" },
];

const FIELD = cn(FIELD_SURFACE, "focus-within:ring-dawn flex min-w-0 flex-1 items-center gap-2 focus-within:ring-2");

interface RolledFieldProps {
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onRoll: () => void;
  readonly value: string;
}

interface SeedFieldProps extends RolledFieldProps {
  readonly className?: string | undefined;
}

interface ShapeChoiceProps {
  readonly onChange: (value: string) => void;
  readonly value: IslandShapeKind;
}

interface SizeChoiceProps {
  readonly onChange: (value: string) => void;
  readonly value: IslandSizeKind;
}

export function NameField({ onChange, onRoll, value }: RolledFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <label className={FIELD}>
        <span className="text-ink-muted">Name</span>

        <input
          autoComplete="off"
          className="text-ink h-9 min-w-0 flex-1 outline-none pointer-coarse:h-11"
          maxLength={LONGEST_WORLD_NAME}
          onChange={onChange}
          spellCheck={false}
          value={value}
        />
      </label>

      <IconButton icon={<Dices aria-hidden="true" size={18} />} label="Random name" onClick={onRoll} />
    </div>
  );
}

export function SeedField({ className, onChange, onRoll, value }: SeedFieldProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label className={FIELD}>
        <span className="text-ink-muted">Seed</span>

        <input
          className="text-ink h-9 min-w-0 flex-1 tabular-nums outline-none pointer-coarse:h-11"
          inputMode="numeric"
          onChange={onChange}
          value={value}
        />
      </label>

      <IconButton icon={<Dices aria-hidden="true" size={18} />} label="Random seed" onClick={onRoll} />
    </div>
  );
}

export function ShapeChoice({ onChange, value }: ShapeChoiceProps) {
  return (
    <ChoiceField
      description="A round island with bays and headlands, or a square one cut straight at the edges."
      label="Shape"
      onChange={onChange}
      options={SHAPE_OPTIONS}
      value={value}
    />
  );
}

export function SizeChoice({ onChange, value }: SizeChoiceProps) {
  return (
    <ChoiceField
      description="A small island grows fast. A large one has more rivers and lakes, but is slower on phones."
      label="Size"
      onChange={onChange}
      options={SIZE_OPTIONS}
      value={value}
    />
  );
}
