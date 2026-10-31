import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mergeStoredField } from "../../app/preferences.ts";
import {
  defaultPowerParameters,
  isPowerId,
  type ParameterValue,
  type ParameterValueMap,
  type PowerId,
  readPowerParameters,
} from "../../content/powers.ts";

const STORAGE_KEY = "ashfolk.powers";

const storedSchema = z.object({ parameters: z.record(z.string(), z.unknown()).default({}) });

type StoredParameters = Readonly<Partial<Record<PowerId, ParameterValueMap>>>;

export interface PowerStore {
  readonly isHandSelected: boolean;
  readonly parameters: StoredParameters;
  readonly resetParameters: (powerId: PowerId) => void;
  readonly selectedPowerId: PowerId | null;
  readonly selectHand: () => void;
  readonly selectPower: (powerId: PowerId | null) => void;
  readonly setParameter: (powerId: PowerId, key: string, value: ParameterValue) => void;
}

export const usePowerStore = create<PowerStore>()(
  persist(
    (set) => {
      return {
        isHandSelected: false,
        parameters: {},
        resetParameters: (powerId) => {
          set((state) => {
            return { parameters: { ...state.parameters, [powerId]: defaultPowerParameters(powerId) } };
          });
        },
        selectedPowerId: null,
        selectHand: () => {
          set({ isHandSelected: true, selectedPowerId: null });
        },
        selectPower: (powerId) => {
          set({ isHandSelected: false, selectedPowerId: powerId });
        },
        setParameter: (powerId, key, value) => {
          set((state) => {
            const current = parametersOf(state.parameters, powerId);

            return {
              parameters: {
                ...state.parameters,
                [powerId]: readPowerParameters(powerId, { ...current, [key]: value }),
              },
            };
          });
        },
      };
    },
    {
      merge: mergeStoredField("parameters", readStoredParameters),
      name: STORAGE_KEY,
      partialize: (state) => {
        return { parameters: state.parameters };
      },
    }
  )
);

export function readStoredParameters(value: unknown): StoredParameters {
  const result = storedSchema.safeParse(value);

  if (!result.success) {
    console.warn("Ignoring saved power settings", result.error.issues);

    return {};
  }

  const parameters: Partial<Record<PowerId, ParameterValueMap>> = {};

  for (const [powerId, values] of Object.entries(result.data.parameters)) {
    if (isPowerId(powerId)) {
      parameters[powerId] = readPowerParameters(powerId, values);
    }
  }

  return parameters;
}

export function isPowerPicked(state: PowerStore, previous: PowerStore): boolean {
  return state.selectedPowerId !== null && state.selectedPowerId !== previous.selectedPowerId;
}

export function parametersOf(parameters: StoredParameters, powerId: PowerId): ParameterValueMap {
  const stored = parameters[powerId];

  if (stored === undefined) {
    return defaultPowerParameters(powerId);
  }

  return stored;
}
