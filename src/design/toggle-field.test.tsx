import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ToggleField } from "./toggle-field.tsx";

function FrozenClockField() {
  const [isFrozen, setIsFrozen] = useState(false);

  return (
    <ToggleField
      description="Keep the sun where it is."
      isChecked={isFrozen}
      label="Stop the clock"
      onChange={setIsFrozen}
    />
  );
}

describe("toggle field", () => {
  it("exposes a switch named by its label", async () => {
    const screen = await render(<FrozenClockField />);

    await expect.element(screen.getByRole("switch", { name: "Stop the clock" })).not.toBeChecked();
  });

  it("switches on and off when clicked", async () => {
    const screen = await render(<FrozenClockField />);

    const toggle = screen.getByRole("switch", { name: "Stop the clock" });

    await toggle.click();

    await expect.element(toggle).toBeChecked();

    await toggle.click();

    await expect.element(toggle).not.toBeChecked();
  });

  it("reports the opposite of its current state to its owner", async () => {
    const handleChange = vi.fn();

    const screen = await render(<ToggleField isChecked={true} label="Embers" onChange={handleChange} />);

    await screen.getByRole("switch", { name: "Embers" }).click();

    expect(handleChange).toHaveBeenCalledOnce();
    expect(handleChange.mock.lastCall).toEqual([false, expect.anything()]);
  });

  it("shows its description as a hint", async () => {
    const screen = await render(<FrozenClockField />);

    await expect.element(screen.getByTitle("Keep the sun where it is.")).toBeInTheDocument();
  });
});
