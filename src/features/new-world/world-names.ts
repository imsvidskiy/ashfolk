export const LONGEST_WORLD_NAME = 32;

const BEGINNINGS = [
  "Amber",
  "Ash",
  "Birch",
  "Bright",
  "Cedar",
  "Cloud",
  "Dawn",
  "Dusk",
  "Elder",
  "Ember",
  "Fern",
  "Frost",
  "Hazel",
  "Mist",
  "Moss",
  "Oak",
  "Raven",
  "Reed",
  "Rowan",
  "Sky",
  "Stone",
  "Storm",
  "Sun",
  "Thorn",
  "Willow",
  "Wolf",
] as const;

const ENDINGS = [
  "crest",
  "dale",
  "fall",
  "fell",
  "field",
  "ford",
  "glen",
  "haven",
  "hold",
  "holm",
  "hollow",
  "mere",
  "moor",
  "reach",
  "shore",
  "stead",
  "vale",
  "wood",
] as const;

function endingAfter(beginning: string, index: number): string {
  for (let offset = 0; offset < ENDINGS.length; offset += 1) {
    const ending = ENDINGS[(index + offset) % ENDINGS.length];

    if (ending !== undefined && !beginning.endsWith(ending.charAt(0))) {
      return ending;
    }
  }

  return "land";
}

export function worldNameFor(seed: number): string {
  const beginning = BEGINNINGS[seed % BEGINNINGS.length];

  if (beginning === undefined) {
    return "Dawnland";
  }

  return `${beginning}${endingAfter(beginning, Math.floor(seed / BEGINNINGS.length))}`;
}

export function readWorldName(text: string): string | null {
  const name = text.trim().replaceAll(/\s+/gu, " ");

  if (name.length === 0 || name.length > LONGEST_WORLD_NAME) {
    return null;
  }

  return name;
}
