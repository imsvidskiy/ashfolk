import type { z } from "zod";
import { POWERS, type PowerId, type PowerParameters } from "../../content/powers.ts";
import {
  earthquakePower,
  explosionPower,
  firePower,
  lightningPower,
  meteorPower,
  rainPower,
  snowPower,
  tornadoPower,
  volcanoPower,
} from "./element-powers.ts";
import {
  blackHolePower,
  lightningStormPower,
  meteorShowerPower,
  nuclearPower,
  tornadoSwarmPower,
} from "./great-elements.ts";
import { flattenPower, forestPower, lowerPower, paintPower, raisePower, smoothPower } from "./land-powers.ts";
import {
  abundancePower,
  deerPower,
  harePower,
  healingPower,
  ibexPower,
  inspirationPower,
  mammothPower,
  tribePower,
  wolfPower,
} from "./life-powers.ts";
import type { PowerHandler, PowerOutcome, PowerServices, PowerTarget } from "./power-handler.ts";

type PowerHandlers = { readonly [Id in PowerId]: PowerHandler<Id> };

const POWER_HANDLERS: PowerHandlers = {
  abundance: abundancePower,
  "black-hole": blackHolePower,
  deer: deerPower,
  earthquake: earthquakePower,
  explosion: explosionPower,
  fire: firePower,
  flatten: flattenPower,
  forest: forestPower,
  hare: harePower,
  healing: healingPower,
  ibex: ibexPower,
  inspiration: inspirationPower,
  lightning: lightningPower,
  "lightning-storm": lightningStormPower,
  lower: lowerPower,
  mammoth: mammothPower,
  meteor: meteorPower,
  "meteor-shower": meteorShowerPower,
  nuclear: nuclearPower,
  paint: paintPower,
  rain: rainPower,
  raise: raisePower,
  smooth: smoothPower,
  snow: snowPower,
  tornado: tornadoPower,
  "tornado-swarm": tornadoSwarmPower,
  tribe: tribePower,
  volcano: volcanoPower,
  wolf: wolfPower,
};

type PowerDefinitions = { readonly [Id in PowerId]: { readonly parameters: z.ZodType<PowerParameters<Id>> } };

const POWER_DEFINITIONS: PowerDefinitions = POWERS;

export function parsePowerParameters<Id extends PowerId>(powerId: Id, values: unknown): PowerParameters<Id> | null {
  const schema: z.ZodType<PowerParameters<Id>> = POWER_DEFINITIONS[powerId].parameters;

  const result = schema.safeParse(values);

  if (!result.success) {
    console.warn(`Ignoring invalid parameters for ${powerId}`, result.error.issues);

    return null;
  }

  return result.data;
}

export function applyPower<Id extends PowerId>(
  powerId: Id,
  parameters: PowerParameters<Id>,
  target: PowerTarget,
  services: PowerServices
): PowerOutcome {
  const handler: PowerHandler<Id> = POWER_HANDLERS[powerId];

  return handler(target, parameters, services);
}
