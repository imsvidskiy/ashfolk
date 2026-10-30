import { Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { IconButton, TextButton } from "./buttons.tsx";

const PLUS_ICON = <Plus aria-hidden="true" size={16} />;

describe("icon button", () => {
  it("is named by its label", async () => {
    const screen = await render(<IconButton icon={PLUS_ICON} label="Add a tribe" />);

    await expect.element(screen.getByRole("button", { name: "Add a tribe" })).toBeVisible();
  });

  it("is a plain button when it does not say whether it is pressed", async () => {
    const screen = await render(<IconButton icon={PLUS_ICON} label="Add a tribe" />);

    await expect.element(screen.getByRole("button", { name: "Add a tribe" })).not.toHaveAttribute("aria-pressed");
  });

  it("reports its pressed state when it works as a toggle", async () => {
    const screen = await render(
      <>
        <IconButton icon={PLUS_ICON} isPressed={true} label="Map" />

        <IconButton icon={PLUS_ICON} isPressed={false} label="Journal" />
      </>
    );

    await expect.element(screen.getByRole("button", { name: "Map", pressed: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Journal", pressed: false })).toBeVisible();
  });
});

describe("text button", () => {
  it("shows its text and runs its action when clicked", async () => {
    const handleClick = vi.fn();

    const screen = await render(
      <TextButton onClick={handleClick} tone="quiet">
        Reset all
      </TextButton>
    );

    await screen.getByRole("button", { name: "Reset all" }).click();

    expect(handleClick).toHaveBeenCalledOnce();
  });
});
