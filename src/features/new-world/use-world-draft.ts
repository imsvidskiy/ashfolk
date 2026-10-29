import { type ChangeEvent, type FormEvent, useState } from "react";
import type { WorldChoice } from "../../app/launch-store.ts";
import { isIslandShapeKind } from "../../world/island-shape.ts";
import { isIslandSizeKind } from "../../world/island-size.ts";
import { randomSeed, readSeed } from "./seeds.ts";
import { readWorldName, worldNameFor } from "./world-names.ts";

export function useWorldDraft(initial: WorldChoice, onCreate: (choice: WorldChoice) => void) {
  const [nameText, setNameText] = useState(initial.name);
  const [seedText, setSeedText] = useState(String(initial.seed));
  const [shape, setShape] = useState(initial.shape);
  const [size, setSize] = useState(initial.size);

  const name = readWorldName(nameText);
  const seed = readSeed(seedText);
  const choice: WorldChoice | null = name === null || seed === null ? null : { name, seed, shape, size };

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setNameText(event.target.value);
  }

  function handleNameRoll(): void {
    setNameText(worldNameFor(randomSeed()));
  }

  function handleSeedChange(event: ChangeEvent<HTMLInputElement>): void {
    setSeedText(event.target.value);
  }

  function handleSeedRoll(): void {
    setSeedText(String(randomSeed()));
  }

  function handleShapeChange(value: string): void {
    if (isIslandShapeKind(value)) {
      setShape(value);
    }
  }

  function handleSizeChange(value: string): void {
    if (isIslandSizeKind(value)) {
      setSize(value);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (choice !== null) {
      onCreate(choice);
    }
  }

  return {
    choice,
    handleNameChange,
    handleNameRoll,
    handleSeedChange,
    handleSeedRoll,
    handleShapeChange,
    handleSizeChange,
    handleSubmit,
    nameText,
    seedText,
    shape,
    size,
  };
}
