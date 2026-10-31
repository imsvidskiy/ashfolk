import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { createStock } from "../testing/world-fixtures.ts";
import { StockList } from "./stock-list.tsx";

describe("stock list", () => {
  it("totals a group from the amounts it shows", async () => {
    const screen = await render(<StockList stock={createStock({ stone: 3.4, wood: 8.4 })} />);

    const materials = screen.getByRole("region", { name: "Materials" });

    await expect.element(materials.getByText("8", { exact: true })).toBeVisible();
    await expect.element(materials.getByText("3", { exact: true })).toBeVisible();
    await expect.element(materials.getByText("11", { exact: true })).toBeVisible();
  });

  it("leaves out what rounds to nothing", async () => {
    const screen = await render(<StockList stock={createStock({ clay: 0.4 })} />);

    await expect.element(screen.getByText("The stores are empty.")).toBeVisible();
  });
});
