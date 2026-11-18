import { ChevronDown } from "lucide-react";
import type { ToggleEvent } from "react";
import { useSendCommand } from "../../app/use-engine.ts";
import {
  describeParameterGroups,
  type ParameterField,
  type ParameterGroupField,
  type ParameterValue,
} from "../../content/parameters.ts";
import { DEFAULT_WORLD_RULES, readWorldRules, type WorldRules, worldRulesSchema } from "../../content/world-rules.ts";
import { TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { FOCUS_RING } from "../../design/styles.ts";
import { useHeldDraft } from "../../design/use-held-draft.ts";
import { ParameterControl } from "../parameters/parameter-control.tsx";
import { useWorldStore } from "../world/world-store.ts";
import { FIELD_GRID } from "./settings-group.tsx";

const RULE_GROUPS = describeParameterGroups(worldRulesSchema);

type RuleValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

type RuleChange = (groupKey: string, fieldKey: string, value: ParameterValue) => void;

interface RuleControlProps {
  readonly field: ParameterField;
  readonly group: ParameterGroupField;
  readonly onChange: RuleChange;
  readonly rules: WorldRules;
}

interface RuleGroupProps {
  readonly group: ParameterGroupField;
  readonly onChange: RuleChange;
  readonly rules: WorldRules;
}

function ruleValue(rules: RuleValues, groupKey: string, fieldKey: string): ParameterValue | undefined {
  const value = rules[groupKey]?.[fieldKey];

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }

  return undefined;
}

function useWorldRules() {
  const send = useSendCommand();
  const confirmedRules = useWorldStore((state) => {
    return state.snapshot?.rules;
  });
  const [rules, holdRules] = useHeldDraft(confirmedRules);

  function applyRules(next: WorldRules): void {
    holdRules(next);
    send({ rules: next, type: "setWorldRules" });
  }

  function handleRuleChange(groupKey: string, fieldKey: string, value: ParameterValue): void {
    if (rules === undefined) {
      return;
    }

    const groups: RuleValues = rules;

    applyRules(readWorldRules({ ...groups, [groupKey]: { ...groups[groupKey], [fieldKey]: value } }));
  }

  function handleReset(): void {
    applyRules(DEFAULT_WORLD_RULES);
  }

  return { handleReset, handleRuleChange, rules };
}

function useRuleChange(groupKey: string, onChange: RuleChange) {
  return (key: string, value: ParameterValue) => {
    onChange(groupKey, key, value);
  };
}

function RuleControl({ field, group, onChange, rules }: RuleControlProps) {
  const handleChange = useRuleChange(group.key, onChange);

  return <ParameterControl field={field} onChange={handleChange} value={ruleValue(rules, group.key, field.key)} />;
}

function handleGroupToggle(event: ToggleEvent<HTMLDetailsElement>): void {
  const group = event.currentTarget;

  if (group.open) {
    group.querySelector("summary")?.scrollIntoView({ block: "nearest" });
  }
}

function RuleGroup({ group, onChange, rules }: RuleGroupProps) {
  return (
    <details
      aria-label={group.metadata.label}
      className="group border-line border-b last:border-b-0"
      name="world-rules"
      onToggle={handleGroupToggle}
    >
      <summary
        className={cn(
          FOCUS_RING,
          "hover:bg-paper-hover flex cursor-pointer scroll-my-1 list-none items-center justify-between gap-3 rounded-lg px-3 py-3 sm:px-4 [&::-webkit-details-marker]:hidden"
        )}
      >
        <span>
          <span className="block text-sm font-bold">{group.metadata.label}</span>

          <span className="text-ink-soft block text-sm">{group.metadata.description}</span>
        </span>

        <ChevronDown aria-hidden="true" className="text-ink-muted shrink-0 group-open:rotate-180" size={16} />
      </summary>

      <div className={cn(FIELD_GRID, "px-3 pt-2 pb-4 sm:px-4")}>
        {group.fields.map((field) => {
          return <RuleControl field={field} group={group} key={field.key} onChange={onChange} rules={rules} />;
        })}
      </div>
    </details>
  );
}

export function WorldRulesSection() {
  const { handleReset, handleRuleChange, rules } = useWorldRules();

  if (rules === undefined) {
    return null;
  }

  return (
    <>
      {RULE_GROUPS.map((group) => {
        return <RuleGroup group={group} key={group.key} onChange={handleRuleChange} rules={rules} />;
      })}

      <div className="flex justify-end pt-3">
        <TextButton onClick={handleReset} tone="quiet">
          Reset all rules
        </TextButton>
      </div>
    </>
  );
}
