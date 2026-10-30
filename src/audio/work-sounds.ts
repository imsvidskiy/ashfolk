import { HUMAN_CLIPS } from "../models/people/human-clips.ts";
import { PERSON_STRIDE, PersonField } from "../world/agent-buffers.ts";
import { PERSON_POSES, type PersonPose } from "../world/agent-poses.ts";
import { SOUNDS, type SoundDefinition } from "./sound-catalog.ts";
import type { SoundEngine } from "./sound-engine.ts";

const HEARING_VIEW_DISTANCE = 350;
const HEARING_REACH = 120;
const LOUDEST_WORKERS = 3;
const LARGEST_KEPT_DRIFT = 0.2;

const STRIKES: ReadonlyMap<PersonPose, Strike> = new Map([
  ["brawl", strike(SOUNDS.fight, "brawl", 0.5)],
  ["build", strike(SOUNDS.workBuild, "build", 0.64)],
  ["chop", strike(SOUNDS.workChop, "chop", 0.5)],
  ["dig", strike(SOUNDS.workDig, "dig", 0.55)],
  ["mine", strike(SOUNDS.workMine, "mine", 0.56)],
  ["thrust", strike(SOUNDS.fight, "thrust", 0.5)],
]);

interface Strike {
  readonly at: number;
  readonly cycleSeconds: number;
  readonly sound: SoundDefinition;
}

interface Worker {
  readonly id: number;
  readonly phase: number;
  readonly strike: Strike;
  readonly x: number;
  readonly z: number;
}

export interface WorkView {
  readonly focusX: number;
  readonly focusZ: number;
  readonly viewDistance: number;
}

function strike(sound: SoundDefinition, pose: PersonPose, at: number): Strike {
  const { timing } = HUMAN_CLIPS[pose];

  return { at, cycleSeconds: timing.kind === "stride" ? 1 : timing.cycleSeconds, sound };
}

function drift(from: number, to: number): number {
  const difference = Math.abs(from - to) % 1;

  return Math.min(difference, 1 - difference);
}

function crosses(from: number, to: number, mark: number): boolean {
  if (to >= from) {
    return from < mark && mark <= to;
  }

  return from < mark || mark <= to;
}

export function nearestWorkers(people: Float32Array, count: number, view: WorkView): Worker[] {
  const workers: Worker[] = [];

  for (let index = 0; index < count; index += 1) {
    const offset = index * PERSON_STRIDE;
    const pose = PERSON_POSES[people[offset + PersonField.Pose]];
    const found = pose === undefined ? undefined : STRIKES.get(pose);
    const x = people[offset + PersonField.X];
    const z = people[offset + PersonField.Z];

    if (found === undefined || Math.hypot(x - view.focusX, z - view.focusZ) > HEARING_REACH) {
      continue;
    }

    workers.push({
      id: people[offset + PersonField.Id],
      phase: people[offset + PersonField.Phase],
      strike: found,
      x,
      z,
    });
  }

  return workers
    .toSorted((first, second) => {
      return (
        Math.hypot(first.x - view.focusX, first.z - view.focusZ) -
        Math.hypot(second.x - view.focusX, second.z - view.focusZ)
      );
    })
    .slice(0, LOUDEST_WORKERS);
}

export class WorkSounds {
  readonly #engine: SoundEngine;
  readonly #heightAt: (x: number, z: number) => number;
  readonly #phases = new Map<number, number>();
  #workers: Worker[] = [];

  constructor(engine: SoundEngine, heightAt: (x: number, z: number) => number) {
    this.#engine = engine;
    this.#heightAt = heightAt;
  }

  listen(people: Float32Array, count: number, view: WorkView): void {
    if (view.viewDistance > HEARING_VIEW_DISTANCE) {
      this.#workers = [];
      this.#phases.clear();

      return;
    }

    const known = new Map(this.#phases);

    this.#workers = nearestWorkers(people, count, view);
    this.#phases.clear();

    for (const worker of this.#workers) {
      const local = known.get(worker.id);
      const isInStep = local !== undefined && drift(local, worker.phase) < LARGEST_KEPT_DRIFT;

      this.#phases.set(worker.id, isInStep ? local : worker.phase);
    }
  }

  update(gameSeconds: number): void {
    if (gameSeconds <= 0) {
      return;
    }

    for (const worker of this.#workers) {
      const from = this.#phases.get(worker.id);

      if (from === undefined) {
        continue;
      }

      const to = (from + gameSeconds / worker.strike.cycleSeconds) % 1;

      this.#phases.set(worker.id, to);

      if (crosses(from, to, worker.strike.at)) {
        this.#engine.play(worker.strike.sound, { x: worker.x, y: this.#heightAt(worker.x, worker.z), z: worker.z });
      }
    }
  }
}
