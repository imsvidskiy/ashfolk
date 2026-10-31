import { useSendCommand } from "../../app/use-engine.ts";
import {
  describeParameterGroups,
  type ParameterField,
  type ParameterGroupField,
  type ParameterValue,
} from "../../content/parameters.ts";
import { DEFAULT_WORLD_RULES, readWorldRules, type WorldRules, worldRulesSchema } from "../../content/world-rules.ts";
import { TextButton } from "../../design/buttons.tsx";
import { useHeldDraft } from "../../design/use-held-draft.ts";
import { ParameterControl } from "../parameters/parameter-control.tsx";
import { useWorldStore } from "../world/world-store.ts";
import { FIELD_GRID, GROUP_CLASS, GroupHeading } from "./settings-group.tsx";

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

function RuleGroup({ group, onChange, rules }: RuleGroupProps) {
  return (
    <fieldset className={GROUP_CLASS}>
      <legend className="sr-only">{group.metadata.label}</legend>

      <GroupHeading description={group.metadata.description} title={group.metadata.label} />

      <div className={FIELD_GRID}>
        {group.fields.map((field) => {
          return <RuleControl field={field} group={group} key={field.key} onChange={onChange} rules={rules} />;
        })}
      </div>
    </fieldset>
  );
}

export function WorldRulesSection() {
  const { handleReset, handleRuleChange, rules } = useWorldRules();

  if (rules === undefined) {
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 pb-4">
        <p className="text-ink-soft text-sm">Tune how nature and people behave on this island.</p>

        <TextButton className="-mr-3 h-8 px-3" onClick={handleReset} tone="quiet">
          Reset all
        </TextButton>
      </div>

      {RULE_GROUPS.map((group) => {
        return <RuleGroup group={group} key={group.key} onChange={handleRuleChange} rules={rules} />;
      })}
    </>
  );
}
