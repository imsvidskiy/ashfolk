import { CROPS } from "../../../content/crops.ts";
import { fieldTask, sowField } from "../farming.ts";
import { pickUp } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { workSeconds } from "../tools.ts";
import { type Field, learn } from "../tribe.ts";
import { DeliverJob } from "./deliver-job.ts";
import { Errand, headTo, type Job } from "./job.ts";

const FARMING_SECONDS = 9;
const TENDING_PER_VISIT = 0.5;
const FENCED_YIELD = 1.25;
const FIELD_SPREAD = 0.35;
const KNOWLEDGE_PER_VISIT = 0.4;

function harvest(tick: PersonTick, field: Field): Job {
  const crop = CROPS[field.crop];

  const amount = crop.yield * (field.isFenced ? FENCED_YIELD : 1);

  field.growth = 0;
  field.isSown = false;
  tick.context.world.setCrop(field.cell, 0);
  pickUp(tick.person, crop.produce, amount, "crops");
  tick.context.chronicle.record({
    category: "food",
    text: `${tick.tribe.name} brought in the ${crop.name.toLowerCase()}`,
    tribeId: tick.tribe.id,
    x: tick.person.mover.x,
    z: tick.person.mover.z,
  });

  return new DeliverJob(tick);
}

export class FarmJob implements Job {
  readonly kind = "farm";
  readonly #errand: Errand;
  readonly #field: Field;

  constructor(tick: PersonTick, field: Field) {
    const { grid } = tick.context.world;
    const { random } = tick.context;

    const spread = grid.cellSize * FIELD_SPREAD;

    this.#field = field;
    this.#errand = new Errand(workSeconds(tick.tribe, FARMING_SECONDS), "dig");
    headTo(
      tick.person,
      {
        x: grid.cellCenterX(field.cell) + random.signed() * spread,
        z: grid.cellCenterZ(field.cell) + random.signed() * spread,
      },
      tick.context
    );
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress !== "finished") {
      return progress === "abandoned" ? null : this;
    }

    const field = this.#field;
    const { season } = tick.context.environment;

    if (!tick.tribe.fields.includes(field)) {
      return null;
    }

    learn(tick.tribe, KNOWLEDGE_PER_VISIT, tick.context.rules);

    const task = fieldTask(tick.tribe, field, season);

    if (task === "sow") {
      sowField(tick.tribe, field, season);

      return null;
    }

    if (task !== "harvest") {
      field.tending = Math.min(1, field.tending + TENDING_PER_VISIT);

      return null;
    }

    return harvest(tick, field);
  }
}
