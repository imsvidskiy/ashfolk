import { Map as MapIcon } from "lucide-react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { IconButton } from "./buttons.tsx";
import { TooltipProvider, WithTooltip } from "./tooltip.tsx";

function MapButton() {
  return (
    <TooltipProvider>
      <WithTooltip content="Map of the island" side="bottom">
        <IconButton icon={<MapIcon aria-hidden="true" size={18} />} label="Map" />
      </WithTooltip>
    </TooltipProvider>
  );
}

describe("tooltip", () => {
  it("stays hidden until the pointer rests on its trigger", async () => {
    const screen = await render(<MapButton />);

    await expect.element(screen.getByRole("button", { name: "Map" })).toBeVisible();
    expect(screen.getByText("Map of the island").elements()).toHaveLength(0);
  });

  it("shows its text while the pointer rests on its trigger and hides it when the pointer leaves", async () => {
    const screen = await render(<MapButton />);

    const trigger = screen.getByRole("button", { name: "Map" });

    await trigger.hover();

    await expect.element(screen.getByText("Map of the island"), { timeout: 3000 }).toBeVisible();

    await trigger.unhover();

    await expect.element(screen.getByText("Map of the island"), { timeout: 3000 }).not.toBeInTheDocument();
  });
});
