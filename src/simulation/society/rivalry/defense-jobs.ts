import type { RandomSource } from "../../../shared/random.ts";
import { faceTowards } from "../../agents/movement.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import { Errand, headTo, type Job, standStill, walk } from "../jobs/job.ts";
import { dropCarrying, type Person, runSpeed } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import type { Tribe } from "../tribe.ts";
import { nearCamp } from "../tribe-places.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { Engagement } from "./engagement.ts";
import { distanceTo, type Foe, foeMover, isFoeAlive, personFoe } from "./foes.ts";
import { livingRaiders, type Raid } from "./raids.ts";
import { assailantOf, nearestFoeAmong } from "./war-parties.ts";

const GUARD_RADIUS = 110;
const DEFEND_ENGAGE_RADIUS = 35;
const WOUNDED_HEALTH = 0.25;
const POST_DISTANCE = 16;
const POST_SPREAD = 7;
const POST_FILES = 5;
const MIDDLE_FILE = (POST_FILES - 1) / 2;
const LONGEST_FIGHT_SECONDS = 40;
const FIGHT_FIRST_DELAY_SHARE = 0.5;
const GIVE_UP_DISTANCE = 45;
const FLED_BEAST_DISTANCE = 12;
const REFUGE_SPREAD = 4;
const HIDING_DISTANCE = 70;
const MOURNING_SECONDS = 24;
const MOURNING_SPREAD = 9;

type GuardState = "heading" | "roaming" | "standing";

function guardPost(tribe: Tribe, raid: Raid, person: Person): Waypoint {
  const towardX = raid.rally.x - tribe.campX;
  const towardZ = raid.rally.z - tribe.campZ;
  const length = Math.max(1, Math.hypot(towardX, towardZ));
  const sideways = ((person.id % POST_FILES) - MIDDLE_FILE) / MIDDLE_FILE;

  return {
    x: tribe.campX + (towardX / length) * POST_DISTANCE - (towardZ / length) * POST_SPREAD * sideways,
    z: tribe.campZ + (towardZ / length) * POST_DISTANCE + (towardX / length) * POST_SPREAD * sideways,
  };
}

function nearestRaider(tick: PersonTick, raid: Raid, radius: number): Foe | null {
  const { tribe } = tick;

  const raiders = livingRaiders(tick.context.people, raid).filter((raider) => {
    return Math.hypot(raider.mover.x - tribe.campX, raider.mover.z - tribe.campZ) < GUARD_RADIUS;
  });

  return nearestFoeAmong(tick, raiders, radius);
}

function foeOfDefender(tick: PersonTick, raid: Raid): Foe | null {
  const attacker = assailantOf(tick, raid.attackerId);

  if (attacker !== null) {
    return personFoe(attacker);
  }

  return nearestRaider(tick, raid, DEFEND_ENGAGE_RADIUS);
}

function shelterFrom(tribe: Tribe, threat: Waypoint | null, random: RandomSource): Waypoint {
  if (threat === null) {
    return nearCamp(tribe, REFUGE_SPREAD, random);
  }

  const awayX = tribe.campX - threat.x;
  const awayZ = tribe.campZ - threat.z;
  const length = Math.max(1, Math.hypot(awayX, awayZ));

  return {
    x: tribe.campX + (awayX / length) * HIDING_DISTANCE + random.signed() * REFUGE_SPREAD,
    z: tribe.campZ + (awayZ / length) * HIDING_DISTANCE + random.signed() * REFUGE_SPREAD,
  };
}

export class DefendJob implements Job {
  readonly kind = "defend";
  readonly #engagement: Engagement;
  readonly #post: Waypoint;
  readonly #raidId: number;
  #guardState: GuardState = "roaming";

  constructor(tick: PersonTick, raid: Raid, weapon: CarriedWeapon) {
    this.#raidId = raid.id;
    this.#engagement = new Engagement(weapon, tick.context.rivalry.random.next());
    this.#post = guardPost(tick.tribe, raid, tick.person);
  }

  update(tick: PersonTick): Job | null {
    const raid = tick.context.rivalry.campaigns.raidOf(this.#raidId);

    if (raid === null) {
      return null;
    }

    const foe = foeOfDefender(tick, raid);

    if (foe !== null && tick.person.health < WOUNDED_HEALTH) {
      return new ShelterJob(tick, foeMover(foe));
    }

    if (foe !== null) {
      this.#engagement.update(tick, foe);
      this.#guardState = "roaming";

      return this;
    }

    if (raid.phase === "retreat") {
      return null;
    }

    this.#guard(tick, raid);

    return this;
  }

  #guard(tick: PersonTick, raid: Raid): void {
    const { person } = tick;

    if (this.#guardState === "standing") {
      standStill(person, "idle");
      faceTowards(person.mover, raid.rally.x, raid.rally.z);

      return;
    }

    if (this.#guardState === "roaming") {
      this.#guardState = "heading";
      headTo(person, this.#post, tick.context);
    }

    if (walk(tick, runSpeed(person))) {
      this.#guardState = "standing";
    }
  }
}

export class FightJob implements Job {
  readonly kind = "fight";
  readonly #engagement: Engagement;
  readonly #foe: Foe;
  #seconds = 0;

  constructor(tick: PersonTick, foe: Foe, weapon: CarriedWeapon) {
    this.#foe = foe;
    this.#engagement = new Engagement(weapon, tick.context.rivalry.random.next() * FIGHT_FIRST_DELAY_SHARE);
  }

  update(tick: PersonTick): Job | null {
    const foe = this.#foe;

    this.#seconds += tick.seconds;

    const distance = distanceTo(tick.person.mover, foe);

    if (!isFoeAlive(foe) || this.#seconds > LONGEST_FIGHT_SECONDS || distance > GIVE_UP_DISTANCE) {
      return null;
    }

    if (foe.kind === "animal" && !tick.context.fauna.isMenacing(foe.animal) && distance > FLED_BEAST_DISTANCE) {
      return null;
    }

    if (tick.person.health < WOUNDED_HEALTH) {
      return new ShelterJob(tick, null);
    }

    this.#engagement.update(tick, foe);

    return this;
  }
}

export class ShelterJob implements Job {
  readonly kind = "hide";

  constructor(tick: PersonTick, threat: Waypoint | null) {
    const { person, tribe } = tick;

    dropCarrying(person);
    headTo(person, shelterFrom(tribe, threat, tick.context.rivalry.random), tick.context);
  }

  update(tick: PersonTick): Job | null {
    if (walk(tick, runSpeed(tick.person))) {
      return null;
    }

    return this;
  }
}

export class MournJob implements Job {
  readonly kind = "mourn";
  readonly #errand = new Errand(MOURNING_SECONDS, "pray");

  constructor(tick: PersonTick) {
    headTo(tick.person, nearCamp(tick.tribe, MOURNING_SPREAD, tick.context.rivalry.random), tick.context);
  }

  update(tick: PersonTick): Job | null {
    const progress = this.#errand.update(tick);

    if (progress === "finished" || progress === "abandoned") {
      return null;
    }

    return this;
  }
}
