import { HOP_REACH } from "../../../world/brooks.ts";
import { setDestination } from "../../agents/movement.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import type { WorldState } from "../../world/world-state.ts";
import { dropCarrying, runSpeed } from "../person.ts";
import { HOT_GROUND } from "../resources.ts";
import type { PersonTick } from "../society-context.ts";
import { type Job, walk } from "./job.ts";

export const DANGER_AWARENESS = 70;

const FLEE_OFFSETS: readonly number[] = [0, 0.5, -0.5, 1, -1, 1.6, -1.6];
const FLEE_DISTANCE = 150;
const RUN_STEP = 5;
const OPEN_RUN_WEIGHT = 2;
const CORNERED_RUN = 90;
const LOOKAHEAD_STEP = 38;
const LOOKAHEAD_STEPS = 4;
const BURNT_OUT = 0.8;
const STEEP = 1;
const NOT_WET = -1;
const TURN_PENALTY = 0.8;
const OFF_MAP_PENALTY = 8;
const FIRE_PENALTY = 6;
const HOT_GROUND_PENALTY = 1.5;
const BROOK_BONUS = 1;
const WATER_PENALTY = 4;
const BURNT_GROUND_BONUS = 0.6;
const STEEP_PENALTY = 2;

interface Flight {
  readonly heading: number;
  readonly reach: number;
}

function safestFlight(world: WorldState, from: Waypoint, danger: Waypoint): Flight {
  const away = Math.atan2(from.x - danger.x, from.z - danger.z);

  let bestScore = Number.NEGATIVE_INFINITY;
  let best: Flight = { heading: away, reach: 0 };

  for (const offset of FLEE_OFFSETS) {
    const heading = away + offset;
    const reach = openRun(world, from, heading);

    const score =
      routeScore(world, from, heading) - Math.abs(offset) * TURN_PENALTY + (reach / FLEE_DISTANCE) * OPEN_RUN_WEIGHT;

    if (score > bestScore) {
      bestScore = score;
      best = { heading, reach };
    }
  }

  return best;
}

function openRun(world: WorldState, from: Waypoint, heading: number): number {
  let reach = 0;
  let wetFrom = NOT_WET;

  for (let distance = RUN_STEP; distance <= FLEE_DISTANCE; distance += RUN_STEP) {
    const cell = world.grid.cellAt(from.x + Math.sin(heading) * distance, from.z + Math.cos(heading) * distance);

    if (cell >= 0 && world.isBrook(cell)) {
      wetFrom = wetFrom === NOT_WET ? distance : wetFrom;

      if (distance - wetFrom > HOP_REACH) {
        return reach;
      }

      continue;
    }

    if (!world.isWalkable(cell)) {
      return reach;
    }

    wetFrom = NOT_WET;
    reach = distance;
  }

  return reach;
}

function routeScore(world: WorldState, from: Waypoint, heading: number): number {
  let score = 0;

  for (let step = 1; step <= LOOKAHEAD_STEPS; step += 1) {
    const cell = world.grid.cellAt(
      from.x + Math.sin(heading) * LOOKAHEAD_STEP * step,
      from.z + Math.cos(heading) * LOOKAHEAD_STEP * step
    );

    if (cell < 0) {
      return score - OFF_MAP_PENALTY;
    }

    score += cellScore(world, cell) / step;
  }

  return score;
}

function cellScore(world: WorldState, cell: number): number {
  const { fields } = world;

  let score = 0;

  if (fields.fire[cell] > 0) {
    score -= FIRE_PENALTY;
  } else if (fields.heat[cell] > HOT_GROUND) {
    score -= HOT_GROUND_PENALTY;
  }

  if (world.isBrook(cell)) {
    score += BROOK_BONUS;
  } else if (world.isWater(cell)) {
    score -= WATER_PENALTY;
  } else if (fields.scorch[cell] > BURNT_OUT) {
    score += BURNT_GROUND_BONUS;
  }

  if (world.slope(cell) > STEEP) {
    score -= STEEP_PENALTY;
  }

  return score;
}

export class FleeJob implements Job {
  readonly kind = "flee";

  constructor(tick: PersonTick, danger: Waypoint) {
    const { person } = tick;

    const flight = safestFlight(tick.context.world, person.mover, danger);

    const isCornered = flight.reach < CORNERED_RUN;
    const reach = isCornered ? FLEE_DISTANCE : flight.reach;

    const refuge = {
      x: person.mover.x + Math.sin(flight.heading) * reach,
      z: person.mover.z + Math.cos(flight.heading) * reach,
    };

    dropCarrying(person);
    setDestination(person.mover, refuge, tick.context.navigation, { canPlanRoute: isCornered });
  }

  update(tick: PersonTick): Job | null {
    if (!walk(tick, runSpeed(tick.person))) {
      return this;
    }

    const danger = tick.context.hazards.dangerNear(tick.person.mover.x, tick.person.mover.z, DANGER_AWARENESS);

    if (danger !== null) {
      return new FleeJob(tick, danger);
    }

    return null;
  }
}
