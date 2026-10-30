import { clamp } from "../../../shared/math.ts";
import { faceTowards } from "../../agents/movement.ts";
import type { Waypoint } from "../../agents/navigation.ts";
import { type Building, setAlight } from "../buildings.ts";
import { headTo, type Job, standStill, walk } from "../jobs/job.ts";
import { runSpeed, walkSpeed } from "../person.ts";
import type { PersonTick } from "../society-context.ts";
import type { Stock } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import { campPoint, completedBuilding } from "../tribe-places.ts";
import type { CarriedWeapon } from "../weapons.ts";
import { Engagement } from "./engagement.ts";
import { type Foe, personFoe } from "./foes.ts";
import { plunderSurplus, totalGoods, unpack } from "./provisions.ts";
import { buildingName, burnableBuilding, eatRation, MARCH_SPEED, type Raid } from "./raids.ts";
import { assailantOf, formationOffset, nearbyFighters, nearestFoeAmong, offsetFrom } from "./war-parties.ts";

const ENGAGE_RADIUS = 22;
const CORNERED_RADIUS = 16;
const SEEK_RADIUS = 90;
const FREEZING_WARMTH = 0.2;
const WORK_REACH = 2.2;
const PLUNDER_SECONDS = 3;
const KINDLING_SECONDS = 2.5;
const PLUNDER_SHARE = 0.06;
const SPARED_FOOD = 8;
const BROKEN_HEALTH = 0.25;
const RALLY_SPREAD = 1.4;
const TARGET_SPREAD = 2.2;
const HOME_SPREAD = 3;
const LOADED_SPEED_SHARE = 1.15;
const CATCH_UP_DISTANCE = 30;
const SLOWEST_PACE = 0.55;
const FASTEST_PACE = 1.35;
const STARVING_HUNGER = 0.85;

type Destination = "home" | "objective" | "rally" | "target";

type Leg = "homeward" | "outward";

export interface RaiderState {
  leg: Leg;
  readonly loot: Stock;
  readonly personId: number;
  readonly raidId: number;
  rations: number;
  readonly slot: number;
}

function plunderSpot(tribe: Tribe, tick: PersonTick): Waypoint {
  const storehouse = completedBuilding(tick.context.buildings, tribe.buildings.storehouseId);

  if (storehouse === null) {
    return campPoint(tribe);
  }

  return { x: storehouse.x, z: storehouse.z };
}

function setAblaze(building: Building, raid: Raid): void {
  if (building.burningSeconds > 0) {
    return;
  }

  setAlight(building);
  raid.burned.push(buildingName(building));
}

function marchPace(tick: PersonTick, raid: Raid): number {
  const { person } = tick;

  const ownDistance = Math.hypot(person.mover.x - raid.target.x, person.mover.z - raid.target.z);

  let total = 0;
  let count = 0;

  for (const id of raid.warriorIds) {
    const comrade = tick.context.people.findPerson(id);

    if (comrade?.isAlive === true && comrade.job instanceof RaidJob) {
      total += Math.hypot(comrade.mover.x - raid.target.x, comrade.mover.z - raid.target.z);
      count += 1;
    }
  }

  if (count === 0) {
    return 1;
  }

  return clamp(1 + (ownDistance - total / count) / CATCH_UP_DISTANCE, SLOWEST_PACE, FASTEST_PACE);
}

function nearestFoe(tick: PersonTick, raid: Raid, radius: number): Foe | null {
  const attacker = assailantOf(tick, raid.defenderId);

  if (attacker !== null) {
    return personFoe(attacker);
  }

  return nearestFoeAmong(tick, nearbyFighters(tick, raid.defenderId, radius), radius);
}

export class RaidJob implements Job {
  readonly kind = "raid";
  readonly #engagement: Engagement;
  readonly #offset: Waypoint;
  readonly #state: RaiderState;
  readonly #weapon: CarriedWeapon;
  #destination: Destination | null = null;
  #workSeconds = 0;

  constructor(state: RaiderState, weapon: CarriedWeapon, firstDelay: number) {
    this.#state = state;
    this.#weapon = weapon;
    this.#engagement = new Engagement(weapon, firstDelay);
    this.#offset = formationOffset(state.slot);
  }

  get raidId(): number {
    return this.#state.raidId;
  }

  saved(): RaiderState {
    return structuredClone(this.#state);
  }

  update(tick: PersonTick): Job | null {
    const raid = tick.context.rivalry.raidOf(this.raidId);

    this.#state.rations = eatRation(tick.person, this.#state.rations);

    if (raid === null || this.#state.leg === "homeward" || raid.phase === "retreat") {
      return this.#goHome(tick);
    }

    const { health, hunger, warmth } = tick.person;

    if (health < BROKEN_HEALTH || hunger > STARVING_HUNGER || warmth < FREEZING_WARMTH) {
      raid.routedIds.add(tick.person.id);
      this.#state.leg = "homeward";

      return this;
    }

    if (raid.phase === "muster") {
      this.#muster(tick, raid);

      return this;
    }

    if (raid.phase === "march") {
      this.#march(tick, raid);

      return this;
    }

    this.#assault(tick, raid);

    return this;
  }

  #muster(tick: PersonTick, raid: Raid): void {
    const { person } = tick;

    if (this.#destination !== "rally") {
      this.#destination = "rally";
      headTo(person, offsetFrom(raid.rally, this.#offset, RALLY_SPREAD), tick.context);
    }

    if (walk(tick, walkSpeed(person))) {
      standStill(person, "idle");
      faceTowards(person.mover, raid.target.x, raid.target.z);

      return;
    }

    person.pose = "march";
  }

  #march(tick: PersonTick, raid: Raid): void {
    const foe = nearestFoe(tick, raid, ENGAGE_RADIUS);

    if (foe !== null) {
      this.#engagement.update(tick, foe);
      this.#destination = null;

      return;
    }

    if (this.#destination !== "target") {
      this.#destination = "target";
      headTo(tick.person, offsetFrom(raid.target, this.#offset, TARGET_SPREAD), tick.context);
    }

    walk(tick, MARCH_SPEED * marchPace(tick, raid));
    tick.person.pose = "march";
  }

  #assault(tick: PersonTick, raid: Raid): void {
    const { person } = tick;

    if (raid.struckIds.has(person.id)) {
      this.#state.leg = "homeward";

      return;
    }

    const foe = nearestFoe(tick, raid, raid.aim === "revenge" ? SEEK_RADIUS : CORNERED_RADIUS);

    if (foe !== null) {
      this.#engagement.update(tick, foe);
      this.#destination = null;
      this.#workSeconds = 0;

      return;
    }

    const victims = tick.context.people.findTribe(raid.defenderId);

    if (victims === null) {
      this.#state.leg = "homeward";

      return;
    }

    const building =
      raid.aim === "burn" && raid.burned.length === 0 ? burnableBuilding(tick.context.buildings.all, victims) : null;

    if (building !== null) {
      this.#workAt(tick, raid, building, KINDLING_SECONDS, () => {
        setAblaze(building, raid);
      });

      return;
    }

    this.#workAt(tick, raid, plunderSpot(victims, tick), PLUNDER_SECONDS, () => {
      this.#plunder(raid, victims);
    });
  }

  #plunder(raid: Raid, victims: Tribe): void {
    const taken = plunderSurplus(victims.stock, PLUNDER_SHARE, victims.memberCount * SPARED_FOOD);

    unpack(raid.loot, { ...taken });
    unpack(this.#state.loot, taken);
  }

  #workAt(tick: PersonTick, raid: Raid, spot: Waypoint, seconds: number, finish: () => void): void {
    const { person } = tick;

    if (this.#destination !== "objective") {
      this.#destination = "objective";
      this.#workSeconds = 0;
      headTo(person, spot, tick.context);
    }

    if (!this.#reach(tick, spot)) {
      return;
    }

    standStill(person, "gather");
    faceTowards(person.mover, spot.x, spot.z);
    this.#workSeconds += tick.seconds;

    if (this.#workSeconds < seconds) {
      return;
    }

    finish();
    raid.struckIds.add(person.id);
    this.#state.leg = "homeward";
  }

  #reach(tick: PersonTick, spot: Waypoint): boolean {
    const { person } = tick;

    if (Math.hypot(spot.x - person.mover.x, spot.z - person.mover.z) <= WORK_REACH) {
      return true;
    }

    if (walk(tick, runSpeed(person))) {
      return true;
    }

    person.pose = this.#weapon.kind === "spear" ? "charge" : "run";

    return false;
  }

  #goHome(tick: PersonTick): Job | null {
    const { person, tribe } = tick;

    if (this.#destination !== "home") {
      this.#destination = "home";
      headTo(person, offsetFrom(campPoint(tribe), this.#offset, HOME_SPREAD), tick.context);
    }

    const isLoaded = totalGoods(this.#state.loot) > 0;
    const speed = isLoaded ? walkSpeed(person) * LOADED_SPEED_SHARE : runSpeed(person);

    if (!walk(tick, speed)) {
      return this;
    }

    unpack(tribe.stock, this.#state.loot);

    return null;
  }
}
