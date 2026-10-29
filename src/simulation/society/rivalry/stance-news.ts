import type { ChronicleCategory, ChronicleRecord } from "../../chronicle.ts";
import type { Tribe } from "../tribe.ts";
import { capitalized, theTribe } from "./raids.ts";
import type { Grudge, Relation, Stance } from "./relations.ts";

const GRUDGE_REASONS: Readonly<Record<Grudge, string>> = {
  blood: "over blood spilled",
  hunting: "over hunting grounds",
  land: "over land",
  plunder: "over stolen stores",
  trespass: "over trespassing foragers",
};

interface StanceStory {
  readonly category: ChronicleCategory;
  readonly text: string;
}

function stanceStory(relation: Relation, previous: Stance, pair: string): StanceStory | null {
  if (relation.stance === "hostile") {
    return { category: "feud", text: `${pair} became enemies ${GRUDGE_REASONS[relation.lastGrudge]}` };
  }

  if (previous === "hostile") {
    return { category: "feud", text: `${pair} let their feud cool` };
  }

  if (relation.stance === "friendly") {
    return { category: "peace", text: `${pair} became friends` };
  }

  return null;
}

export function stanceNews(relation: Relation, previous: Stance, first: Tribe, second: Tribe): ChronicleRecord | null {
  const story = stanceStory(relation, previous, `${theTribe(first.name)} and ${theTribe(second.name)}`);

  if (story === null) {
    return null;
  }

  return {
    category: story.category,
    text: capitalized(story.text),
    tribeId: first.id,
    x: (first.campX + second.campX) / 2,
    z: (first.campZ + second.campZ) / 2,
  };
}
