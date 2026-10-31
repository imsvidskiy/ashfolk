import { BUILDINGS } from "../../content/buildings.ts";
import { personName } from "../../content/names.ts";
import { nearestWalkableSpot } from "../agents/walkable-ground.ts";
import { isComplete } from "./buildings.ts";
import { planConstruction } from "./construction.ts";
import { abandonFloodedFields, updateFields } from "./farming.ts";
import { assignHomes, housingCapacity } from "./housing.ts";
import { createPerson, isChild, isElder, type Person } from "./person.ts";
import { updatePlots } from "./plots.ts";
import { discover, isReadyToDiscover } from "./progress.ts";
import { considerMoving, considerSplit, updateMigration } from "./settlement.ts";
import type { SocietyContext } from "./society-context.ts";
import { type Storage, spoilFood, totalFood } from "./stock.ts";
import { FAITH_BASELINE, knows, learn, type Tribe, upcomingTechnology } from "./tribe.ts";
import { completedOfKind, tribeBuildings } from "./tribe-places.ts";

const BASE_LEARNING_PER_DAY = 24;
const ADULT_LEARNING = 4.5;
const ELDER_LEARNING = 5;
const FAITH_LEARNING = 0.05;
const DISCOVERY_EFFORT = 0.15;
const OPEN_FOOD_STORAGE = 40;
const PLANNING_SECONDS = 3;
const BIRTH_CHECK_DAYS = 0.25;
const DAILY_CHECK_DAYS = 0.5;
const CROP_DISPLAY_DAYS = 0.08;
const WORKSHOP_LEARNING = 4;
const TOTEM_LEARNING = 2;
const FAITH_DRIFT = 0.05;
const MOTHER_YOUNGEST = 15;
const MOTHER_OLDEST = 45;
const FATHER_YOUNGEST = 16;
const DAYS_BETWEEN_CHILDREN = 2;
const FOOD_PER_PERSON_FOR_BIRTHS = 2.5;
const BIRTH_ODDS_PER_DAY = 0.4;
const BIRTH_ODDS_PER_FAITH = 0.004;
const MAXIMUM_MOTHERS_COUNTED = 4;
const BIRTHPLACE_SEARCH_RADIUS = 30;

interface TribeTick {
  context: SocietyContext;
  days: number;
  members: readonly Person[];
  seconds: number;
  tribe: Tribe;
}

export function updateTribe(tick: TribeTick): void {
  learnAndDiscover(tick);
  spoilStock(tick);
  tendLand(tick);
  planBuildings(tick);
  considerBirths(tick);
  driftFaith(tick);
  runDailyChecks(tick);
}

function buildingLearning(tick: TribeTick): number {
  const { context, tribe } = tick;

  const workshop = completedOfKind(tribe, context.buildings, "workshop") === null ? 0 : WORKSHOP_LEARNING;
  const totem = completedOfKind(tribe, context.buildings, "totem") === null ? 0 : TOTEM_LEARNING;

  return workshop + totem;
}

function memberLearning(members: readonly Person[]): number {
  let adults = 0;
  let elders = 0;

  for (const person of members) {
    if (!isChild(person)) {
      adults += 1;
    }

    if (isElder(person)) {
      elders += 1;
    }
  }

  return adults * ADULT_LEARNING + elders * ELDER_LEARNING;
}

function learnAndDiscover(tick: TribeTick): void {
  const { context, members, tribe } = tick;

  const learning =
    BASE_LEARNING_PER_DAY + memberLearning(members) + tribe.faith * FAITH_LEARNING + buildingLearning(tick);

  learn(tribe, tick.days * learning, context.rules);
  discoverUpcoming(tribe, context);

  if (!knows(tribe, "fire") && context.hazards.isFireAround(tribe.campX, tribe.campZ)) {
    discover(tribe, "fire", `${tribe.name} saw a wildfire and kept the flame`, context);
  }
}

function discoverUpcoming(tribe: Tribe, context: SocietyContext): void {
  const upcoming = upcomingTechnology(tribe);

  if (upcoming === undefined || tribe.knowledge < upcoming.cost) {
    return;
  }

  if (!isReadyToDiscover(tribe, upcoming)) {
    tribe.knowledge = upcoming.cost;

    return;
  }

  tribe.knowledge = Math.max(0, tribe.knowledge - upcoming.cost * DISCOVERY_EFFORT);
  discover(tribe, upcoming.id, `${tribe.name} discovered ${upcoming.name.toLowerCase()}`, context);
}

function storageOf(tribe: Tribe, context: SocietyContext): Storage {
  const stores = tribeBuildings(tribe, context.buildings).filter((building) => {
    return isComplete(building) && BUILDINGS[building.kind].storage > 0;
  });

  const extra = stores.reduce((total, building) => {
    return total + BUILDINGS[building.kind].storage;
  }, 0);

  return {
    foodCapacity: OPEN_FOOD_STORAGE + extra,
    hasGranary: stores.some((building) => {
      return building.kind === "granary";
    }),
    hasStorehouse: stores.some((building) => {
      return building.kind === "storehouse";
    }),
    pottery: tribe.stock.pottery,
  };
}

function spoilStock(tick: TribeTick): void {
  const { context, tribe } = tick;

  spoilFood(tribe.stock, tick.days, storageOf(tribe, context));
}

function tendLand(tick: TribeTick): void {
  const { context, tribe } = tick;

  tribe.timers.cropDays += tick.days;
  abandonFloodedFields(tribe, context.world);

  if (tribe.timers.cropDays > CROP_DISPLAY_DAYS) {
    updateFields(tribe, context, tribe.timers.cropDays);
    tribe.timers.cropDays = 0;
  }

  updatePlots(tribe, context, tick.days);
}

function planBuildings(tick: TribeTick): void {
  const { timers } = tick.tribe;

  timers.planningSeconds -= tick.seconds;

  if (timers.planningSeconds > 0) {
    return;
  }

  timers.planningSeconds = PLANNING_SECONDS;
  planConstruction(tick.tribe, tick.context);
}

function considerBirths(tick: TribeTick): void {
  const { timers } = tick.tribe;

  timers.birthDays += tick.days;

  if (timers.birthDays <= BIRTH_CHECK_DAYS) {
    return;
  }

  const elapsedDays = timers.birthDays;

  timers.birthDays = 0;

  const mother = chooseMother(tick, elapsedDays);

  if (mother !== null) {
    giveBirth(tick, mother);
  }
}

function chooseMother(tick: TribeTick, elapsedDays: number): Person | null {
  const { context, members, tribe } = tick;
  const { day } = context.environment;

  const mothers = members.filter((person) => {
    const isOfAge = person.age > MOTHER_YOUNGEST && person.age < MOTHER_OLDEST;

    return person.isFemale && isOfAge && day - person.lastBirthDay > DAYS_BETWEEN_CHILDREN;
  });
  const hasFather = members.some((person) => {
    return !person.isFemale && person.age > FATHER_YOUNGEST;
  });
  const children = members.filter((person) => {
    return isChild(person);
  }).length;

  const isFed = totalFood(tribe.stock) > members.length * FOOD_PER_PERSON_FOR_BIRTHS;
  const hasRoom = members.length < housingCapacity(tribe, context.buildings);
  const hasEnoughAdults = children <= members.length - children;

  if (mothers.length === 0 || !hasFather || !isFed || !hasRoom || !hasEnoughAdults) {
    return null;
  }

  const odds =
    elapsedDays *
    (BIRTH_ODDS_PER_DAY + tribe.faith * BIRTH_ODDS_PER_FAITH) *
    Math.min(MAXIMUM_MOTHERS_COUNTED, mothers.length) *
    context.rules.life.birthRate;

  if (!context.random.chance(odds)) {
    return null;
  }

  return context.random.pick(mothers);
}

function giveBirth(tick: TribeTick, mother: Person): void {
  const { context, tribe } = tick;
  const { random } = context;

  const isFemale = random.chance(0.5);
  const besideMother = { x: mother.mover.x + 1, z: mother.mover.z + 1 };

  const birthplace = nearestWalkableSpot(context.world, besideMother, BIRTHPLACE_SEARCH_RADIUS);

  const child = createPerson(
    {
      age: 0,
      id: context.identifiers.next(),
      isFemale,
      name: personName(random, isFemale),
      tribeId: tribe.id,
      x: birthplace.x,
      z: birthplace.z,
    },
    random
  );

  mother.lastBirthDay = context.environment.day;
  tribe.births += 1;
  context.people.addPerson(tribe, child);
  assignHomes(tribe, context.buildings, context.people.membersOf(tribe));
  context.chronicle.record({
    category: "birth",
    text: `${child.name} was born to ${tribe.name}`,
    tribeId: tribe.id,
    x: child.mover.x,
    z: child.mover.z,
  });
}

function driftFaith(tick: TribeTick): void {
  const { tribe } = tick;

  tribe.faith += (FAITH_BASELINE - tribe.faith) * tick.days * FAITH_DRIFT;
}

function runDailyChecks(tick: TribeTick): void {
  const { context, members, tribe } = tick;

  tribe.timers.dailyDays += tick.days;

  if (tribe.timers.dailyDays <= DAILY_CHECK_DAYS) {
    return;
  }

  tribe.timers.dailyDays = 0;

  if (tribe.isMigrating) {
    updateMigration(tribe, members, context);
  } else {
    considerMoving(tribe, members, context);
  }

  considerSplit(tribe, members, context);
}
