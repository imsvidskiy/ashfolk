import { FULL_TURN } from "../../../shared/math.ts";
import { aroundPoint } from "../../agents/navigation.ts";
import { type Person, runSpeed, walkSpeed } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import { campPoint } from "../tribe-places.ts";
import { headTo, type Job, standStill, walk } from "./job.ts";

const WANDER_PACE = 0.7;
const SHORTEST_LINGER_SECONDS = 5;
const LONGEST_LINGER_SECONDS = 13;

type WanderKind = "idle" | "play";

const WANDER_RANGES: Readonly<Record<WanderKind, readonly [number, number]>> = {
  idle: [6, 24],
  play: [6, 32],
};

type WanderPhase = "linger" | "travel";

function wanderSpeed(kind: WanderKind, person: Person): number {
  if (kind === "play") {
    return runSpeed(person) * WANDER_PACE;
  }

  return walkSpeed(person) * WANDER_PACE;
}

export class WanderJob implements Job {
  readonly kind: WanderKind;
  #lingerSeconds: number;
  #phase: WanderPhase = "travel";

  constructor(tick: PersonTick, kind: WanderKind) {
    const { random } = tick.context;
    const [nearest, farthest] = WANDER_RANGES[kind];

    const destination = aroundPoint(
      campPoint(tick.tribe),
      random.between(nearest, farthest),
      random.next() * FULL_TURN
    );

    this.kind = kind;
    this.#lingerSeconds = random.between(SHORTEST_LINGER_SECONDS, LONGEST_LINGER_SECONDS);
    headTo(tick.person, destination, tick.context);
  }

  update(tick: PersonTick): Job | null {
    if (this.#phase === "travel") {
      this.#travel(tick);

      return this;
    }

    standStill(tick.person, this.kind);
    this.#lingerSeconds -= tick.seconds;

    if (this.#lingerSeconds > 0) {
      return this;
    }

    return null;
  }

  #travel(tick: PersonTick): void {
    if (walk(tick, wanderSpeed(this.kind, tick.person))) {
      this.#phase = "linger";
    }
  }
}
