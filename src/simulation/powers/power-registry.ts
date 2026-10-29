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
  lower: lowerPower,
  mammoth: mammothPower,
  meteor: meteorPower,
  paint: paintPower,
  rain: rainPower,
  raise: raisePower,
  smooth: smoothPower,
  snow: snowPower,
  tornado: tornadoPower,
  tribe: tribePower,
  volcano: volcanoPower,
  wolf: wolfPower,
};

type PowerSchemas = { readonly [Id in PowerId]: z.ZodType<PowerParameters<Id>> };

const POWER_SCHEMAS: PowerSchemas = {
  abundance: POWERS.abundance.parameters,
  deer: POWERS.deer.parameters,
  earthquake: POWERS.earthquake.parameters,
  explosion: POWERS.explosion.parameters,
  fire: POWERS.fire.parameters,
  flatten: POWERS.flatten.parameters,
  forest: POWERS.forest.parameters,
  hare: POWERS.hare.parameters,
  healing: POWERS.healing.parameters,
  ibex: POWERS.ibex.parameters,
  inspiration: POWERS.inspiration.parameters,
  lightning: POWERS.lightning.parameters,
  lower: POWERS.lower.parameters,
  mammoth: POWERS.mammoth.parameters,
  meteor: POWERS.meteor.parameters,
  paint: POWERS.paint.parameters,
  rain: POWERS.rain.parameters,
  raise: POWERS.raise.parameters,
  smooth: POWERS.smooth.parameters,
  snow: POWERS.snow.parameters,
  tornado: POWERS.tornado.parameters,
  tribe: POWERS.tribe.parameters,
  volcano: POWERS.volcano.parameters,
  wolf: POWERS.wolf.parameters,
};

export function parsePowerParameters<Id extends PowerId>(powerId: Id, values: unknown): PowerParameters<Id> | null {
  const schema: z.ZodType<PowerParameters<Id>> = POWER_SCHEMAS[powerId];

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
