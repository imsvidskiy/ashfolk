import { personName, tribeIdentity } from "../../content/names.ts";
import type { TechnologyId } from "../../content/technologies.ts";
import type { RandomSource } from "../../shared/random.ts";
import { NO_PLANT, type VegetationStore } from "../../world/vegetation-store.ts";
import { isHopping, isLeaping } from "../agents/hops.ts";
import { isStranded, moveAlong, placeMover, savedMover, stopMoving } from "../agents/movement.ts";
import type { Waypoint } from "../agents/navigation.ts";
import { nearestWalkableSpot } from "../agents/walkable-ground.ts";
import type { Chronicle } from "../chronicle.ts";
import type { IdentifierSource } from "../identifiers.ts";
import type { WorldState } from "../world/world-state.ts";
import type { BuildingSystem } from "./buildings.ts";
import { handleBuildingLoss } from "./construction.ts";
import { advanceJob, dropJob, updateMind } from "./decisions.ts";
import { abandonFields } from "./farming.ts";
import { walk } from "./jobs/job.ts";
import { updateNeeds } from "./needs.ts";
import { createPerson, type DeathCause, type Person, walkSpeed } from "./person.ts";
import { abandonPlots } from "./plots.ts";
import { syncEra } from "./progress.ts";
import { findCampSite } from "./settlement.ts";
import type { DeathAccount, PersonTick, SocietyContext } from "./society-context.ts";
import { createTribe, type Tribe } from "./tribe.ts";
import { updateTribe } from "./tribe-life.ts";
import { TroddenGround, type TroddenGroundSnapshot } from "./trodden-ground.ts";

const HOP_PACE = 1.5;
const CORPSE_SECONDS = 40;
const ARRIVAL_SEARCH_RADIUS = 260;
const ARRIVAL_SPREAD = 16;
const POSE_PHASE_RATE = 1.9;
const FALL_SECONDS = 1.5;
const VIOLENT_DEATHS: ReadonlySet<DeathCause> = new Set(["battle", "beast", "mammoth"]);

const DEATH_MESSAGES: Readonly<Record<DeathCause, string>> = {
  age: "died of old age",
  battle: "fell in battle",
  beast: "was killed by a wild beast",
  blast: "was killed by a blast",
  cold: "froze to death",
  earthquake: "was crushed in an earthquake",
  fire: "died in the flames",
  hunger: "starved",
  lava: "was swallowed by lava",
  lightning: "was struck by lightning",
  mammoth: "was trampled by a mammoth",
  tornado: "was swept away by a tornado",
};

export interface SocietySnapshot {
  people: Person[];
  tribeNumber: number;
  tribes: Tribe[];
  trodden: TroddenGroundSnapshot;
}

interface SocietyDependencies {
  buildings: BuildingSystem;
  chronicle: Chronicle;
  identifiers: IdentifierSource;
  world: WorldState;
}

interface TribeArrival {
  canSettleRoughGround: boolean;
  context: SocietyContext;
  people: number;
  technologies: readonly TechnologyId[];
  x: number;
  z: number;
}

function savedPerson(person: Person): Person {
  const saved: Person = structuredClone({ ...person, job: null, mover: savedMover(person.mover, false) });

  if (saved.isAlive && saved.mover.hop === null) {
    saved.pose = "idle";
    saved.speed = 0;
  }

  return saved;
}

function savedTribe(tribe: Tribe, people: readonly Person[]): Tribe {
  const saved: Tribe = structuredClone({ ...tribe, claimedPlants: new Set<number>() });

  for (const person of people) {
    if (person.tribeId === tribe.id) {
      person.job?.cancel?.(saved);
    }
  }

  return saved;
}

function deathAccountOf(person: Person, tribe: Tribe, cause: DeathCause, account: DeathAccount | null): DeathAccount {
  if (account !== null) {
    return account;
  }

  return {
    category: cause === "age" ? "death" : "warning",
    text: `${person.name} of ${tribe.name} ${DEATH_MESSAGES[cause]}`,
  };
}

function settleFall(person: Person): void {
  if (person.pose === "fall" && person.deathSeconds > FALL_SECONDS) {
    person.pose = "dead";
  }
}

function isLivingWithin(person: Person, x: number, z: number, radius: number): boolean {
  return person.isAlive && Math.hypot(person.mover.x - x, person.mover.z - z) < radius;
}

function newcomerAge(isGrownUp: boolean, random: RandomSource): number {
  if (isGrownUp) {
    return random.between(17, 35);
  }

  return random.between(4, 11);
}

function keepHopping(tick: PersonTick): void {
  const { context, person, seconds } = tick;
  const { hop } = person.mover;

  person.pose = isLeaping(person.mover) ? "leap" : "run";
  person.speed = hop === null ? 0 : hop.speed;
  moveAlong(person.mover, seconds, person.speed, context.world, context.navigation);
}

export class SocietySystem {
  readonly #dependencies: SocietyDependencies;
  readonly #peopleById = new Map<number, Person>();
  readonly #tribesById = new Map<number, Tribe>();
  readonly #trodden = new TroddenGround();
  #heldId: number | null = null;
  #people: Person[] = [];
  #tribeNumber = 0;
  #tribes: Tribe[] = [];

  constructor(dependencies: SocietyDependencies) {
    this.#dependencies = dependencies;
  }

  get people(): readonly Person[] {
    return this.#people;
  }

  get population(): number {
    return this.#people.filter((person) => {
      return person.isAlive;
    }).length;
  }

  snapshot(): SocietySnapshot {
    return {
      people: this.#people.map(savedPerson),
      tribeNumber: this.#tribeNumber,
      tribes: this.#tribes.map((tribe) => {
        return savedTribe(tribe, this.#people);
      }),
      trodden: this.#trodden.snapshot(),
    };
  }

  restore(snapshot: SocietySnapshot): void {
    this.#people = snapshot.people;
    this.#tribes = snapshot.tribes;
    this.#tribeNumber = snapshot.tribeNumber;
    this.#heldId = null;
    this.#peopleById.clear();
    this.#tribesById.clear();

    for (const person of this.#people) {
      this.#peopleById.set(person.id, person);
    }

    for (const tribe of this.#tribes) {
      this.#tribesById.set(tribe.id, tribe);
    }

    this.#trodden.restore(snapshot.trodden);
  }

  tribes(): readonly Tribe[] {
    return this.#tribes;
  }

  findPerson(id: number): Person | null {
    const person = this.#peopleById.get(id);

    if (person === undefined) {
      return null;
    }

    return person;
  }

  findTribe(id: number): Tribe | null {
    const tribe = this.#tribesById.get(id);

    if (tribe === undefined) {
      return null;
    }

    return tribe;
  }

  membersOf(tribe: Tribe): Person[] {
    return this.#people.filter((person) => {
      return person.isAlive && person.tribeId === tribe.id;
    });
  }

  membersOfEach(tribes: readonly Tribe[]): Person[][] {
    const positions = new Map(
      tribes.map((tribe, position) => {
        return [tribe.id, position];
      })
    );
    const members = tribes.map((): Person[] => {
      return [];
    });

    for (const person of this.#people) {
      const position = positions.get(person.tribeId);

      if (person.isAlive && position !== undefined) {
        members[position].push(person);
      }
    }

    return members;
  }

  createTribe(campX: number, campZ: number): Tribe {
    const tribe = createTribe({
      campX,
      campZ,
      day: this.#dependencies.chronicle.day,
      id: this.#dependencies.identifiers.next(),
      identity: tribeIdentity(this.#tribeNumber),
    });

    this.#tribeNumber += 1;
    this.#tribes.push(tribe);
    this.#tribesById.set(tribe.id, tribe);

    return tribe;
  }

  addPerson(tribe: Tribe, person: Person): void {
    person.tribeId = tribe.id;
    tribe.memberCount += 1;
    this.#people.push(person);
    this.#peopleById.set(person.id, person);
  }

  spawnTribe(arrival: TribeArrival): Tribe | null {
    const { context } = arrival;

    const site = findCampSite(
      {
        canSettleRoughGround: arrival.canSettleRoughGround,
        excluded: null,
        isNearOrigin: true,
        minimumNeighborDistance: 0,
        origin: { x: arrival.x, z: arrival.z },
        radius: ARRIVAL_SEARCH_RADIUS,
      },
      context,
      this.#tribes
    );

    if (site === null) {
      return null;
    }

    const tribe = this.createTribe(site.x, site.z);

    for (const technology of arrival.technologies) {
      tribe.technologies.add(technology);
    }

    syncEra(tribe);

    for (let member = 0; member < arrival.people; member += 1) {
      this.addPerson(tribe, this.#newcomer(tribe, site, member, arrival));
    }

    context.chronicle.record({
      category: "arrival",
      text: `${tribe.name} arrived in these lands`,
      tribeId: tribe.id,
      x: site.x,
      z: site.z,
    });

    return tribe;
  }

  hold(person: Person): void {
    this.#heldId = person.id;
    this.#forgetJob(person);
    person.pose = "idle";
    person.speed = 0;
    placeMover(person.mover, person.mover.x, person.mover.z);
  }

  setDown(person: Person, x: number, z: number): void {
    this.#heldId = null;
    this.#forgetJob(person);
    placeMover(person.mover, x, z);
  }

  isHeld(person: Person): boolean {
    return this.#heldId === person.id;
  }

  releasePlant(plant: number): void {
    for (const person of this.#people) {
      if (person.job?.claimedPlant === plant) {
        this.#forgetJob(person);
      }
    }

    for (const tribe of this.#tribes) {
      tribe.claimedPlants.delete(plant);

      for (const plot of tribe.plots) {
        for (const spot of plot.spots) {
          if (spot.plant === plant) {
            spot.plant = NO_PLANT;
          }
        }
      }
    }
  }

  returnPlant(plant: number, x: number, z: number, vegetation: VegetationStore): void {
    for (const tribe of this.#tribes) {
      for (const plot of tribe.plots) {
        for (const spot of plot.spots) {
          const isEmpty = spot.plant === NO_PLANT || !vegetation.isAlive(spot.plant);

          if (isEmpty && spot.x === x && spot.z === z) {
            spot.plant = plant;
          }
        }
      }
    }
  }

  kill(person: Person, cause: DeathCause, account: DeathAccount | null = null): void {
    if (!person.isAlive) {
      return;
    }

    const tribe = this.findTribe(person.tribeId);

    person.isAlive = false;
    person.causeOfDeath = cause;
    person.pose = VIOLENT_DEATHS.has(cause) ? "fall" : "dead";
    person.speed = 0;
    stopMoving(person.mover);

    if (tribe === null) {
      return;
    }

    dropJob(tribe, person);
    tribe.deaths += 1;
    tribe.memberCount -= 1;
    this.#dependencies.chronicle.record({
      ...deathAccountOf(person, tribe, cause, account),
      tribeId: tribe.id,
      x: person.mover.x,
      z: person.mover.z,
    });

    if (tribe.memberCount === 0) {
      this.#dissolve(tribe);
    }
  }

  damageArea(x: number, z: number, radius: number, damage: number, cause: DeathCause): void {
    for (const person of this.livingWithin(x, z, radius)) {
      const distance = Math.hypot(person.mover.x - x, person.mover.z - z);

      person.health -= damage * (1 - distance / radius);

      if (person.health <= 0) {
        this.kill(person, cause);
      }
    }
  }

  livingWithin(x: number, z: number, radius: number): Person[] {
    return this.#people.filter((person) => {
      return isLivingWithin(person, x, z, radius) && !this.isHeld(person);
    });
  }

  countNear(x: number, z: number, radius: number, accepts: (person: Person) => boolean): number {
    let count = 0;

    for (const person of this.#people) {
      if (isLivingWithin(person, x, z, radius) && accepts(person)) {
        count += 1;
      }
    }

    return count;
  }

  nearestPerson(x: number, z: number, radius: number, accepts: (person: Person) => boolean): Person | null {
    let nearest: Person | null = null;
    let nearestDistance = radius;

    for (const person of this.#people) {
      const offsetX = person.mover.x - x;
      const offsetZ = person.mover.z - z;

      if (!person.isAlive || Math.abs(offsetX) >= nearestDistance || Math.abs(offsetZ) >= nearestDistance) {
        continue;
      }

      const distance = Math.hypot(offsetX, offsetZ);

      if (distance < nearestDistance && !this.isHeld(person) && accepts(person)) {
        nearest = person;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  nearestTribe(x: number, z: number, radius: number): Tribe | null {
    let nearest: Tribe | null = null;
    let nearestDistance = radius;

    for (const tribe of this.#tribes) {
      const distance = Math.hypot(tribe.campX - x, tribe.campZ - z);

      if (distance < nearestDistance) {
        nearest = tribe;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  update(seconds: number, days: number, context: SocietyContext): void {
    this.#handleBuildingLosses(context);

    const tribes = [...this.#tribes];
    const members = this.membersOfEach(tribes);

    for (const [position, tribe] of tribes.entries()) {
      updateTribe({ context, days, members: members[position], seconds, tribe });
    }

    for (const person of [...this.#people]) {
      this.#updatePerson(person, seconds, days, context);
    }

    this.#trodden.update(days, context, this.#tribes);
    this.#removeRemains();
  }

  #newcomer(tribe: Tribe, site: Waypoint, member: number, arrival: TribeArrival): Person {
    const { random, world } = arrival.context;

    const isFemale = member % 2 === 1;
    const isGrownUp = member < arrival.people - 2;

    const arrivalSpot = { x: site.x + random.signed() * ARRIVAL_SPREAD, z: site.z + random.signed() * ARRIVAL_SPREAD };

    const spot = nearestWalkableSpot(world, arrivalSpot, ARRIVAL_SPREAD * 2);

    return createPerson(
      {
        age: newcomerAge(isGrownUp, random),
        id: this.#dependencies.identifiers.next(),
        isFemale,
        name: personName(random, isFemale),
        tribeId: tribe.id,
        x: spot.x,
        z: spot.z,
      },
      random
    );
  }

  #dissolve(tribe: Tribe): void {
    const { buildings, chronicle, world } = this.#dependencies;

    buildings.abandonTribe(tribe.id);
    abandonFields(tribe, world);
    abandonPlots(tribe, world);
    this.#tribes = this.#tribes.filter((candidate) => {
      return candidate !== tribe;
    });
    this.#tribesById.delete(tribe.id);
    chronicle.record({
      category: "death",
      text: `${tribe.name} is no more`,
      tribeId: tribe.id,
      x: tribe.campX,
      z: tribe.campZ,
    });
  }

  #handleBuildingLosses(context: SocietyContext): void {
    for (const loss of context.buildings.takeLosses()) {
      const tribe = this.findTribe(loss.building.tribeId);

      if (tribe !== null) {
        handleBuildingLoss(tribe, loss, context);
      }
    }
  }

  #updatePerson(person: Person, seconds: number, days: number, context: SocietyContext): void {
    if (this.isHeld(person)) {
      return;
    }

    if (!person.isAlive) {
      person.deathSeconds += seconds;
      settleFall(person);

      return;
    }

    const tribe = this.findTribe(person.tribeId);

    if (tribe === null) {
      return;
    }

    const tick: PersonTick = { context, person, seconds, tribe };

    person.mover.hopSpeed = walkSpeed(person) * HOP_PACE;

    const causeOfDeath = updateNeeds(tick, days);

    if (causeOfDeath !== null) {
      this.kill(person, causeOfDeath);

      return;
    }

    if (isHopping(person.mover)) {
      keepHopping(tick);
    } else if (isStranded(person.mover, context.world)) {
      dropJob(tribe, person);
      walk(tick, walkSpeed(person));
    } else {
      updateMind(tick);
      advanceJob(tick);
    }

    person.phase += seconds * person.speed * POSE_PHASE_RATE;
  }

  #forgetJob(person: Person): void {
    const tribe = this.findTribe(person.tribeId);

    if (tribe === null) {
      person.job = null;

      return;
    }

    dropJob(tribe, person);
  }

  #removeRemains(): void {
    const hasExpired = this.#people.some((person) => {
      return !person.isAlive && person.deathSeconds > CORPSE_SECONDS;
    });

    if (!hasExpired) {
      return;
    }

    const remaining: Person[] = [];

    for (const person of this.#people) {
      if (person.isAlive || person.deathSeconds <= CORPSE_SECONDS) {
        remaining.push(person);

        continue;
      }

      this.#peopleById.delete(person.id);
    }

    this.#people = remaining;
  }
}
