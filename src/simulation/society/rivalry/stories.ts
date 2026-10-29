import { RESOURCE_KINDS, RESOURCES } from "../../../content/resources.ts";
import type { ChronicleCategory, ChronicleRecord } from "../../chronicle.ts";
import type { Person } from "../person.ts";
import { type Stock, totalFood } from "../stock.ts";
import type { Tribe } from "../tribe.ts";
import type { Raid } from "./raids.ts";
import type { Grudge, Relation, Stance } from "./relations.ts";

const LISTED_GOODS = 3;
const NUMBER_WORDS: readonly string[] = ["no one", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const GRUDGE_REASONS: Readonly<Record<Grudge, string>> = {
  blood: "over blood spilled",
  burning: "over buildings set ablaze",
  hunting: "over hunting grounds",
  land: "over land",
  plunder: "over stolen stores",
  trespass: "over trespassing foragers",
};

interface StanceStory {
  readonly category: ChronicleCategory;
  readonly text: string;
}

function goodsPhrases(stock: Stock): string[] {
  const phrases: string[] = [];

  const food = totalFood(stock);

  if (food >= 1) {
    phrases.push(`${Math.round(food)} food`);
  }

  for (const kind of RESOURCE_KINDS) {
    if (RESOURCES[kind].group !== "food" && stock[kind] >= 1) {
      phrases.push(`${Math.round(stock[kind])} ${RESOURCES[kind].name.toLowerCase()}`);
    }
  }

  return phrases;
}

function numberWord(count: number): string {
  const word = NUMBER_WORDS[count];

  if (word === undefined) {
    return String(count);
  }

  return word;
}

function namesOrCount(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return numberWord(names.length);
}

function lootPhrase(loot: Stock): string | null {
  const goods = goodsPhrases(loot).slice(0, LISTED_GOODS);

  if (goods.length === 0) {
    return null;
  }

  return `carried off ${listed(goods)}`;
}

function listed(items: readonly string[]): string {
  if (items.length < 2) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function theTribe(name: string): string {
  return `the ${name}`;
}

export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function raidSummary(raid: Raid, attacker: string, defender: string): string {
  const outcomes: string[] = [];
  const plunder = lootPhrase(raid.loot);

  if (raid.fallenDefenders.length > 0) {
    outcomes.push(`${namesOrCount(raid.fallenDefenders)} fell`);
  }

  for (const building of raid.burned) {
    outcomes.push(`the ${building} was set ablaze`);
  }

  if (plunder !== null) {
    outcomes.push(plunder);
  }

  const losses = raid.fallenRaiders.length > 0 ? `, losing ${namesOrCount(raid.fallenRaiders)} of their own` : "";

  if (outcomes.length === 0) {
    return capitalized(`${theTribe(defender)} drove off a raid by ${theTribe(attacker)}${losses}`);
  }

  return capitalized(`${theTribe(attacker)} raided ${theTribe(defender)}: ${outcomes.join(", ")}${losses}`);
}

export function fallText(victim: Person, victimTribe: Tribe, slayerTribe: Tribe, raid: Raid | null): string {
  if (raid?.warriorIds.includes(victim.id) === true) {
    return `${victim.name} of ${theTribe(victimTribe.name)} fell raiding ${theTribe(slayerTribe.name)}`;
  }

  if (raid !== null) {
    return `${victim.name} of ${theTribe(victimTribe.name)} fell to the raiders of ${theTribe(slayerTribe.name)}`;
  }

  return `${victim.name} of ${theTribe(victimTribe.name)} was slain by ${theTribe(slayerTribe.name)}`;
}

export function mourningText(tribe: Tribe, fallen: readonly string[]): string {
  return capitalized(`${theTribe(tribe.name)} mourned ${listed(fallen)}`);
}

export function envoyText(guest: Tribe, host: Tribe): string {
  return capitalized(`${theTribe(guest.name)} brought gifts to ${theTribe(host.name)}, and they made peace`);
}

export function raidLaunchText(attacker: Tribe, defender: Tribe, warriorCount: number): string {
  return capitalized(`${theTribe(attacker.name)} sent ${warriorCount} warriors against ${theTribe(defender.name)}`);
}

export function truceText(seeker: Tribe, host: Tribe): string {
  return capitalized(`${theTribe(seeker.name)} and ${theTribe(host.name)} agreed to a truce`);
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
