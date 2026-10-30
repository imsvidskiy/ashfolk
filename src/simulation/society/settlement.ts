import { DEPOSITS } from "../../content/deposits.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { findCampSite, LONGEST_MIGRATION_DAYS, siteSearchNear } from "./camp-sites.ts";
import { dropJob } from "./decisions.ts";
import { abandonFields } from "./farming.ts";
import { assignHomes } from "./housing.ts";
import { isChild, isElder, type Person } from "./person.ts";
import { abandonPlots } from "./plots.ts";
import { syncEra } from "./progress.ts";
import { prospectingMove } from "./prospecting.ts";
import type { SocietyContext } from "./society-context.ts";
import { shareFood, totalFood } from "./stock.ts";
import { isWorthLookingFor, type Tribe } from "./tribe.ts";
import { campfireOf, campPoint } from "./tribe-places.ts";

const SPLIT_NEIGHBOR_DISTANCE = 650;
const MOVE_SEARCH_RADIUS = 900;
const SPLIT_SEARCH_RADIUS = 1500;
const SPLIT_POPULATION = 16;
const SPLIT_ADULTS = 8;
const MAXIMUM_TRIBES = 10;
const LATEST_SPLIT_SEASON = 2.3;
const SPLIT_SHARE = 0.4;
const YOUNG_ADULT_AGE = 32;
const SETTLED_DISTANCE = 60;
const SETTLED_SHARE = 0.7;
const BURNT_CAMP = 0.8;
const PROSPECTING_SHARE = 0.5;

export function updateMigration(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  const arrived = members.filter((person) => {
    return Math.hypot(person.mover.x - tribe.campX, person.mover.z - tribe.campZ) < SETTLED_DISTANCE;
  });

  const isLongOverdue = context.environment.day - tribe.migrationStartDay > LONGEST_MIGRATION_DAYS;

  if (arrived.length >= members.length * SETTLED_SHARE) {
    tribe.isMigrating = false;

    return;
  }

  if (isLongOverdue) {
    tribe.isMigrating = false;
    settleWhereTheyStand(tribe, members);
  }
}

function settleWhereTheyStand(tribe: Tribe, members: readonly Person[]): void {
  const centerX =
    members.reduce((sum, person) => {
      return sum + person.mover.x;
    }, 0) / members.length;
  const centerZ =
    members.reduce((sum, person) => {
      return sum + person.mover.z;
    }, 0) / members.length;

  const [nearest] = [...members].sort((first, second) => {
    return (
      Math.hypot(first.mover.x - centerX, first.mover.z - centerZ) -
      Math.hypot(second.mover.x - centerX, second.mover.z - centerZ)
    );
  });

  if (Math.hypot(nearest.mover.x - tribe.campX, nearest.mover.z - tribe.campZ) < SETTLED_DISTANCE) {
    return;
  }

  tribe.campX = nearest.mover.x;
  tribe.campZ = nearest.mover.z;
}

function reasonToMove(tribe: Tribe, context: SocietyContext): string | null {
  const { environment, world } = context;

  const cell = world.grid.cellAt(tribe.campX, tribe.campZ);

  if (cell < 0 || world.isWater(cell)) {
    return "water flooded the camp";
  }

  if (world.fields.scorch[cell] > BURNT_CAMP && campfireOf(tribe, context.buildings) === null) {
    return "the camp burnt down";
  }

  const isStarving =
    totalFood(tribe.stock) < 1 &&
    !isWorthLookingFor(tribe, "berries", environment.day, 0.6) &&
    !isWorthLookingFor(tribe, "game", environment.day, 0.6);

  if (isStarving) {
    return "there was no food left nearby";
  }

  return null;
}

export function considerMoving(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  const reason = reasonToMove(tribe, context);

  if (reason === null) {
    prospect(tribe, members, context);

    return;
  }

  const site = findCampSite(
    { ...siteSearchNear(campPoint(tribe), MOVE_SEARCH_RADIUS, tribe), canSettleRoughGround: true },
    context,
    context.people.tribes()
  );

  if (site !== null) {
    moveCamp(tribe, members, site, reason, context);
  }
}

function prospect(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  const move = prospectingMove(tribe, context);

  if (move === null) {
    return;
  }

  const search = {
    ...siteSearchNear(move.origin, DEPOSITS[move.kind].reach * PROSPECTING_SHARE, tribe),
    isNearOrigin: true,
  };

  const site = findCampSite(search, context, context.people.tribes());

  if (site === null) {
    tribe.migrationStartDay = context.environment.day;

    return;
  }

  moveCamp(tribe, members, site, move.reason, context);
}

function moveCamp(
  tribe: Tribe,
  members: readonly Person[],
  site: Waypoint,
  reason: string,
  context: SocietyContext
): void {
  context.buildings.abandonTribe(tribe.id);
  tribe.campX = site.x;
  tribe.campZ = site.z;
  tribe.isMigrating = true;
  tribe.migrationStartDay = context.environment.day;
  abandonFields(tribe, context.world);
  abandonPlots(tribe, context.world);
  tribe.claimedPlants.clear();

  for (const person of members) {
    if (person.job?.kind !== "flee") {
      dropJob(tribe, person);
    }
  }

  context.chronicle.record({
    category: "migration",
    text: `${tribe.name} set out for a new camp: ${reason}`,
    tribeId: tribe.id,
    x: site.x,
    z: site.z,
  });
}

function canSplit(tribe: Tribe, members: readonly Person[], context: SocietyContext): boolean {
  if (members.length < SPLIT_POPULATION || tribe.isMigrating || context.people.tribes().length >= MAXIMUM_TRIBES) {
    return false;
  }

  if (context.environment.season >= LATEST_SPLIT_SEASON) {
    return false;
  }

  return (
    members.filter((person) => {
      return !isChild(person);
    }).length >= SPLIT_ADULTS
  );
}

function chooseSettlers(members: readonly Person[]): Person[] {
  const youngAdults = members
    .filter((person) => {
      return !isChild(person) && person.age < YOUNG_ADULT_AGE;
    })
    .sort((first, second) => {
      return first.age - second.age;
    });

  const women = youngAdults
    .filter((person) => {
      return person.isFemale;
    })
    .slice(0, 2);
  const men = youngAdults
    .filter((person) => {
      return !person.isFemale;
    })
    .slice(0, 2);

  if (women.length === 0 || men.length === 0) {
    return [];
  }

  const settlers = [...women, ...men];
  const wanted = Math.round(members.length * SPLIT_SHARE);

  for (const person of members) {
    if (settlers.length < wanted && !settlers.includes(person) && !isElder(person)) {
      settlers.push(person);
    }
  }

  return settlers;
}

function moveToTribe(person: Person, from: Tribe, to: Tribe): void {
  dropJob(from, person);
  from.memberCount -= 1;
  to.memberCount += 1;
  person.tribeId = to.id;
  person.homeId = null;
}

export function considerSplit(tribe: Tribe, members: readonly Person[], context: SocietyContext): void {
  if (!canSplit(tribe, members, context)) {
    return;
  }

  const settlers = chooseSettlers(members);

  if (settlers.length === 0) {
    return;
  }

  const search = {
    ...siteSearchNear(campPoint(tribe), SPLIT_SEARCH_RADIUS, tribe),
    minimumNeighborDistance: SPLIT_NEIGHBOR_DISTANCE,
  };

  const site = findCampSite(search, context, context.people.tribes());

  if (site === null) {
    return;
  }

  const offshoot = context.people.createTribe(site.x, site.z);

  offshoot.originId = tribe.id;
  shareWithOffshoot(tribe, offshoot, context);

  for (const person of settlers) {
    moveToTribe(person, tribe, offshoot);
  }

  assignHomes(tribe, context.buildings, context.people.membersOf(tribe));

  context.chronicle.record({
    category: "split",
    text: `${tribe.name} split up: ${offshoot.name} left to find new land`,
    tribeId: tribe.id,
    x: site.x,
    z: site.z,
  });
}

function shareWithOffshoot(tribe: Tribe, offshoot: Tribe, context: SocietyContext): void {
  const wood = Math.floor(tribe.stock.wood * 0.3);
  const spears = Math.floor(tribe.stock.spears * 0.4);

  for (const technology of tribe.technologies) {
    offshoot.technologies.add(technology);
  }

  syncEra(offshoot);
  offshoot.stock = shareFood(tribe.stock, 0.35);
  offshoot.knowledge = tribe.knowledge * 0.5;
  offshoot.tools = tribe.tools;
  offshoot.stock.wood = wood;
  offshoot.stock.spears = spears;
  offshoot.isMigrating = true;
  offshoot.migrationStartDay = context.environment.day;
  tribe.stock.wood -= wood;
  tribe.stock.spears -= spears;
}
