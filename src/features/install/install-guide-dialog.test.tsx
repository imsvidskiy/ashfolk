import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { CompactMenu } from "../interface/compact-menu.tsx";
import { InstallGuideDialog } from "./install-guide-dialog.tsx";
import { useInstallStore } from "./install-store.ts";

describe("install guide dialog", () => {
  it("explains the home screen where the browser has no prompt", async () => {
    useInstallStore.setState({ isGuideNeeded: true });

    const screen = await render(
      <>
        <CompactMenu />

        <InstallGuideDialog />
      </>
    );

    await screen.getByRole("button", { name: "Menu" }).click();
    await screen.getByRole("menuitem", { name: "Install the app" }).click();

    const guide = screen.getByRole("dialog", { name: "Install Ashfolk" });

    await expect.element(guide).toBeVisible();
    await expect.element(guide.getByText("then Add to Home Screen", { exact: false })).toBeVisible();

    await screen.getByRole("button", { name: "Got it" }).click();

    await expect.element(guide).not.toBeInTheDocument();
  });
});
