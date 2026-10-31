import { z } from "zod";

export type ParameterUnit =
  | "celsius"
  | "count"
  | "days"
  | "kilometersPerHour"
  | "meters"
  | "multiplier"
  | "percent"
  | "seconds";

export type ParameterValue = boolean | number | string;

export type ParameterValueMap = Readonly<Record<string, ParameterValue>>;

interface RangeParameterSpecification {
  defaultValue: number;
  description: string;
  label: string;
  maximum: number;
  minimum: number;
  step: number;
  unit: ParameterUnit;
}

interface ToggleParameterSpecification {
  defaultValue: boolean;
  description: string;
  label: string;
}

interface ChoiceParameterSpecification<Value extends string> {
  defaultValue: Value;
  description: string;
  label: string;
  options: readonly [{ label: string; value: Value }, ...{ label: string; value: Value }[]];
}

interface RangeParameterMetadata extends RangeParameterSpecification {
  kind: "range";
}

interface ToggleParameterMetadata extends ToggleParameterSpecification {
  kind: "toggle";
}

interface ChoiceParameterMetadata extends ChoiceParameterSpecification<string> {
  kind: "choice";
}

type ParameterMetadata = ChoiceParameterMetadata | RangeParameterMetadata | ToggleParameterMetadata;

interface ParameterGroupMetadata {
  description: string;
  label: string;
}

export interface ParameterField {
  key: string;
  metadata: ParameterMetadata;
}

export interface ParameterGroupField {
  fields: readonly ParameterField[];
  key: string;
  metadata: ParameterGroupMetadata;
}

declare module "zod" {
  interface GlobalMeta {
    parameter?: ParameterMetadata;
    parameterGroup?: ParameterGroupMetadata;
  }
}

export function rangeParameter(specification: RangeParameterSpecification) {
  return z
    .number()
    .min(specification.minimum)
    .max(specification.maximum)
    .default(specification.defaultValue)
    .meta({ parameter: { kind: "range", ...specification } });
}

export function toggleParameter(specification: ToggleParameterSpecification) {
  return z
    .boolean()
    .default(specification.defaultValue)
    .meta({ parameter: { kind: "toggle", ...specification } });
}

export function choiceParameter<const Value extends string>(specification: ChoiceParameterSpecification<Value>) {
  const [firstOption, ...otherOptions] = specification.options;

  const values: [Value, ...Value[]] = [
    firstOption.value,
    ...otherOptions.map((option) => {
      return option.value;
    }),
  ];

  return z
    .enum(values)
    .default(specification.defaultValue)
    .meta({ parameter: { kind: "choice", ...specification } });
}

export function groupMetadata(label: string, description: string): z.GlobalMeta {
  return { parameterGroup: { description, label } };
}

export function describeParameters(schema: z.ZodObject): ParameterField[] {
  const fields: ParameterField[] = [];

  for (const [key, field] of Object.entries(schema.shape)) {
    const metadata = field.meta();

    if (metadata?.parameter === undefined) {
      continue;
    }

    fields.push({ key, metadata: metadata.parameter });
  }

  return fields;
}

export function describeParameterGroups(schema: z.ZodObject): ParameterGroupField[] {
  const groups: ParameterGroupField[] = [];

  for (const [key, field] of Object.entries(schema.shape)) {
    const metadata = field.meta();

    if (metadata?.parameterGroup === undefined || !(field instanceof z.ZodPrefault)) {
      continue;
    }

    const innerSchema = field.unwrap();

    if (!(innerSchema instanceof z.ZodObject)) {
      continue;
    }

    groups.push({ fields: describeParameters(innerSchema), key, metadata: metadata.parameterGroup });
  }

  return groups;
}
