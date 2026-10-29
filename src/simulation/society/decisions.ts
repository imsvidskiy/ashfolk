import { isWinter } from "../../content/seasons.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { isExpeditionSeason } from "./jobs/build-job.ts";
import { DeliverJob } from "./jobs/deliver-job.ts";
import { EatJob, eatProvisions } from "./jobs/eat-job.ts";
import { DANGER_AWARENESS, FleeJob } from "./jobs/flee-job.ts";
import { findBerries } from "./jobs/gather-job.ts";
import { HomewardJob } from "./jobs/homeward-job.ts";
import type { Job, JobKind } from "./jobs/job.ts";
import { MigrateJob } from "./jobs/migrate-job.ts";
import { SleepJob } from "./jobs/sleep-job.ts";
import { WanderJob } from "./jobs/wander-job.ts";
import { WarmJob } from "./jobs/warm-job.ts";
import { isStandingInFire } from "./needs.ts";
import { carriedFood, isCarryingAnything, isChild, type Person } from "./person.ts";
import { respondToFoes } from "./rivalry/responses.ts";
import type { PersonTick, SocietyContext } from "./society-context.ts";
import { totalFood } from "./stock.ts";
import type { Tribe } from "./tribe.ts";
import { nearCamp } from "./tribe-places.ts";
import { isWithinReach, nearestWarmPlace, warmthOnArrival } from "./warmth.ts";
import { isWorthIt } from "./work-needs.ts";
import { chooseWork } from "./work-planner.ts";

const RETHINK_SECONDS = 5;
const RETHINK_VARIATION = 4;
const DANGER_CHECK_SECONDS = 0.5;
const FIRE_ESCAPE_RADIUS = 40;
const URGENT_HUNGER = 0.75;
const HUNGRY = 0.5;
const HUNGRY_ON_THE_ROAD = 0.55;
const FREEZING = 0.3;
const CHILLY = 0.45;
const GATHERING_AGE = 7;
const MEAL_SPREAD = 4;
const PACKED_MEAL_DISTANCE = 90;
const HOMEWARD_DISTANCE = 220;
const STRANDED_RETRY_DAYS = 1;
const NIGHT_JOBS: ReadonlySet<JobKind> = new Set(["clay", "deliver", "eat", "mine", "sleep", "warm"]);
const UNWAVERING_JOBS: ReadonlySet<JobKind> = new Set(["flee", "raid"]);
const STEADFAST_JOBS: ReadonlySet<JobKind> = new Set(["defend", "envoy", "fight", "hide", "migrate"]);

export function updateMind(tick: PersonTick): void {
  const { person } = tick;

  reactToDanger(tick);

  if (person.job === null) {
    assignJob(tick, decideJob(tick));

    return;
  }

  person.rethinkSeconds -= tick.seconds;

  if (person.rethinkSeconds > 0) {
    return;
  }

  person.rethinkSeconds = RETHINK_SECONDS + tick.context.random.next() * RETHINK_VARIATION;

  if (isOnTheRoad(person.job) && isStarving(tick)) {
    eatProvisions(person, tick.tribe);
  }

  if (shouldInterrupt(tick, person.job)) {
    assignJob(tick, decideJob(tick));
  }
}

function isOnTheRoad(job: Job): boolean {
  return job.isExpedition === true || job.kind === "deliver";
}

export function assignJob(tick: PersonTick, job: Job): void {
  leaveJob(tick.tribe, tick.person.job);
  tick.person.job = job;
}

export function takeUpJob(
  person: Person,
  tribe: Tribe,
  context: SocietyContext,
  start: (tick: PersonTick) => Job
): void {
  const tick = { context, person, seconds: 0, tribe };

  assignJob(tick, start(tick));
}

export function advanceJob(tick: PersonTick): void {
  const { person } = tick;

  const current = person.job;

  if (current === null) {
    return;
  }

  const next = current.update(tick);

  person.job = next;

  if (next === current) {
    return;
  }

  if (next !== null && next.claimedPlant === current.claimedPlant) {
    return;
  }

  releaseClaim(tick.tribe, current);
}

export function dropJob(tribe: Tribe, person: Person): void {
  leaveJob(tribe, person.job);
  person.job = null;
}

function leaveJob(tribe: Tribe, job: Job | null): void {
  job?.cancel?.(tribe);
  releaseClaim(tribe, job);
}

function releaseClaim(tribe: Tribe, job: Job | null): void {
  const claimedPlant = job?.claimedPlant;

  if (claimedPlant === undefined) {
    return;
  }

  tribe.claimedPlants.delete(claimedPlant);
}

function reactToDanger(tick: PersonTick): void {
  const { person } = tick;

  if (person.job?.kind === "flee") {
    return;
  }

  if (isStandingInFire(tick)) {
    fleeFrom(tick, FIRE_ESCAPE_RADIUS);

    return;
  }

  person.dangerCheckSeconds -= tick.seconds;

  if (person.dangerCheckSeconds > 0) {
    return;
  }

  person.dangerCheckSeconds = DANGER_CHECK_SECONDS;
  fleeFrom(tick, DANGER_AWARENESS);
  answerFoes(tick);
}

function answerFoes(tick: PersonTick): void {
  if (tick.person.job?.kind === "flee") {
    return;
  }

  const response = respondToFoes(tick);

  if (response !== null) {
    assignJob(tick, response);
  }
}

function fleeFrom(tick: PersonTick, radius: number): void {
  const { mover } = tick.person;

  const danger = tick.context.hazards.dangerNear(mover.x, mover.z, radius);

  if (danger !== null) {
    assignJob(tick, new FleeJob(tick, danger));
  }
}

function hasFood(tick: PersonTick): boolean {
  return totalFood(tick.tribe.stock) >= 1 || carriedFood(tick.person) >= 1;
}

function isStarving(tick: PersonTick): boolean {
  return tick.person.hunger > URGENT_HUNGER && hasFood(tick);
}

function shouldInterrupt(tick: PersonTick, job: Job): boolean {
  const { environment } = tick.context;

  if (UNWAVERING_JOBS.has(job.kind)) {
    return false;
  }

  if (STEADFAST_JOBS.has(job.kind)) {
    return isStarving(tick);
  }

  if (job.kind !== "eat" && isStarving(tick)) {
    return true;
  }

  if (environment.isNight && !NIGHT_JOBS.has(job.kind) && job.isExpedition !== true) {
    return true;
  }

  if (job.isExpedition === true && !isExpeditionSeason(environment.season)) {
    return true;
  }

  if (job.kind === "eat" || job.kind === "warm") {
    return false;
  }

  return isFreezingOnTheWay(tick);
}

function isFreezingOnTheWay(tick: PersonTick): boolean {
  const place = nearestWarmPlace(tick);

  if (place === null || isWithinReach(tick, place)) {
    return false;
  }

  return warmthOnArrival(tick, place) < FREEZING;
}

export function decideJob(tick: PersonTick): Job {
  const { person, tribe } = tick;
  const { environment } = tick.context;

  if (tribe.isMigrating) {
    return migrationJob(tick);
  }

  if (isStarving(tick)) {
    return new EatJob(tick, mealPlace(tick));
  }

  if (isCarryingAnything(person) && carriedFood(person) <= 0) {
    return new DeliverJob(tick);
  }

  if (isAwayOutOfSeason(tick)) {
    return new HomewardJob(tick);
  }

  if (environment.isNight) {
    return nightJob(tick);
  }

  if (person.hunger > HUNGRY && hasFood(tick)) {
    return new EatJob(tick, mealPlace(tick));
  }

  if (isCarryingAnything(person)) {
    return new DeliverJob(tick);
  }

  const warming = warmingJob(tick);

  if (warming !== null) {
    return warming;
  }

  if (isChild(person)) {
    return childActivity(tick);
  }

  return adultActivity(tick);
}

function isAwayOutOfSeason(tick: PersonTick): boolean {
  const { mover } = tick.person;
  const { tribe } = tick;
  const { day, season } = tick.context.environment;

  if (isExpeditionSeason(season) || day - tick.person.strandedDay < STRANDED_RETRY_DAYS) {
    return false;
  }

  return Math.hypot(mover.x - tribe.campX, mover.z - tribe.campZ) > HOMEWARD_DISTANCE;
}

function mealPlace(tick: PersonTick): Waypoint {
  const { mover } = tick.person;
  const { tribe } = tick;

  if (Math.hypot(mover.x - tribe.campX, mover.z - tribe.campZ) > PACKED_MEAL_DISTANCE) {
    return { x: mover.x, z: mover.z };
  }

  return nearCamp(tribe, MEAL_SPREAD, tick.context.random);
}

function nightJob(tick: PersonTick): Job {
  const place = nearestWarmPlace(tick);

  if (place === null || warmthOnArrival(tick, place) >= FREEZING) {
    return new SleepJob(tick);
  }

  return new WarmJob(tick, place);
}

function warmingJob(tick: PersonTick): Job | null {
  const place = nearestWarmPlace(tick);

  if (place === null || isWithinReach(tick, place) || warmthOnArrival(tick, place) >= CHILLY) {
    return null;
  }

  return new WarmJob(tick, place);
}

function migrationJob(tick: PersonTick): Job {
  if (tick.person.hunger > HUNGRY_ON_THE_ROAD && hasFood(tick)) {
    return new EatJob(tick, { x: tick.person.mover.x, z: tick.person.mover.z });
  }

  return new MigrateJob(tick);
}

function mayGatherBerries(tick: PersonTick): boolean {
  const { environment, random } = tick.context;

  if (tick.person.age < GATHERING_AGE || isWinter(environment.season)) {
    return false;
  }

  if (!isWorthIt(tick, "berries", 0.3)) {
    return false;
  }

  return random.chance(0.5);
}

function childActivity(tick: PersonTick): Job {
  if (!mayGatherBerries(tick)) {
    return new WanderJob(tick, "play");
  }

  const gathering = findBerries(tick);

  if (gathering === null) {
    return new WanderJob(tick, "play");
  }

  return gathering;
}

function adultActivity(tick: PersonTick): Job {
  const work = chooseWork(tick);

  if (work === null) {
    return new WanderJob(tick, "idle");
  }

  return work;
}
