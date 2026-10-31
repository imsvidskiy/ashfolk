import { describe, expect, it } from "vitest";
import { AMBIENCE_LAYERS, MUSIC_TRACKS, SOUNDS } from "./sound-catalog.ts";

const ENCODED = Object.keys(import.meta.glob("./sounds/*.webm")).map(fileName);

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function listedFiles(): string[] {
  const definitions = [...Object.values(SOUNDS), ...Object.values(AMBIENCE_LAYERS)];

  return [
    ...definitions.flatMap((sound) => {
      return sound.files;
    }),
    ...Object.values(MUSIC_TRACKS).flat(),
  ].map(fileName);
}

describe("sound catalog", () => {
  it("lists every encoded sound once and nothing else", () => {
    expect(listedFiles().toSorted()).toEqual(ENCODED.toSorted());
  });
});
