import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { FactList } from "./fact-list.tsx";

const FACTS = [
  { label: "Ground", value: "Grass" },
  { label: "Height", value: "212 m" },
  { label: "Food", value: 12 },
];

describe("fact list", () => {
  it("lists each fact as a term with its value, numbers as they are", async () => {
    const screen = await render(<FactList facts={FACTS} />);

    await expect.element(screen.getByRole("term").nth(0)).toHaveTextContent("Ground");
    await expect.element(screen.getByRole("definition").nth(0)).toHaveTextContent("Grass");
    await expect.element(screen.getByRole("term").nth(1)).toHaveTextContent("Height");
    await expect.element(screen.getByRole("definition").nth(1)).toHaveTextContent("212 m");
    await expect.element(screen.getByRole("definition").nth(2)).toHaveTextContent("12");
  });
});
