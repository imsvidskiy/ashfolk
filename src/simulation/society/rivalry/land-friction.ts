import type { JobKind } from "../jobs/job.ts";
import { isChild, type Person } from "../person.ts";
import type { SocietyContext } from "../society-context.ts";
import { aggrieve, type Grudge, isTruce, type Relation, type RelationBook } from "./relations.ts";
import { type Claim, claimOverlap, isInsideClaim, rangeOverlap } from "./territory.ts";

const CLAIM_FRICTION_PER_DAY = 24;
const RANGE_FRICTION_PER_DAY = 13;
const TRESPASS_PER_DAY = 34;
const POACHING_FACTOR = 2;
const WORK_JOBS: ReadonlySet<JobKind> = new Set(["chop", "fish", "gather", "hunt", "quarry"]);

function trespass(
  person: Person,
  isPoaching: boolean,
  weight: number,
  claims: ReadonlyMap<number, Claim>,
  relations: RelationBook,
  day: number
): void {
  for (const claim of claims.values()) {
    if (claim.tribeId === person.tribeId || !isInsideClaim(claim, person.mover)) {
      continue;
    }

    const relation = relations.find(person.tribeId, claim.tribeId);

    if (relation === null || isTruce(relation, day)) {
      continue;
    }

    const insult = TRESPASS_PER_DAY * weight * (isPoaching ? POACHING_FACTOR : 1);

    aggrieve(relation, claim.tribeId, insult, isPoaching ? "hunting" : "trespass");
  }
}

export function chafeAtBorders(
  relation: Relation,
  claims: ReadonlyMap<number, Claim>,
  days: number,
  context: SocietyContext
): void {
  const first = claims.get(relation.first.tribeId);
  const second = claims.get(relation.second.tribeId);

  if (first === undefined || second === undefined) {
    return;
  }

  const landShare = claimOverlap(first, second);
  const huntingShare = rangeOverlap(first, second);

  const friction =
    context.rules.life.rivalry * days * (CLAIM_FRICTION_PER_DAY * landShare + RANGE_FRICTION_PER_DAY * huntingShare);

  if (friction <= 0) {
    return;
  }

  const grudge: Grudge = landShare > 0 ? "land" : "hunting";

  aggrieve(relation, first.tribeId, friction / 2, grudge);
  aggrieve(relation, second.tribeId, friction / 2, grudge);
}

export function watchTrespass(
  claims: ReadonlyMap<number, Claim>,
  relations: RelationBook,
  days: number,
  context: SocietyContext
): void {
  const weight = context.rules.life.rivalry * days;

  for (const tribe of context.people.tribes()) {
    const home = claims.get(tribe.id);

    for (const person of context.people.membersOf(tribe)) {
      const kind = person.job?.kind;

      if (kind === undefined || !WORK_JOBS.has(kind) || isChild(person)) {
        continue;
      }

      if (home !== undefined && isInsideClaim(home, person.mover)) {
        continue;
      }

      trespass(person, kind === "hunt", weight, claims, relations, context.environment.day);
    }
  }
}
