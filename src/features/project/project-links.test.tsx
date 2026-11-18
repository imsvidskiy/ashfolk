import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ProjectLinks } from "./project-links.tsx";

describe("project links", () => {
  it("links to the project, sponsorship and privacy", async () => {
    const screen = await render(<ProjectLinks />);

    await expect
      .element(screen.getByRole("link", { name: "Ashfolk on GitHub" }))
      .toHaveAttribute("href", "https://github.com/imsvidskiy/ashfolk");
    await expect
      .element(screen.getByRole("link", { name: "Sponsor Ashfolk" }))
      .toHaveAttribute("href", "https://whop.com/ashfolk/ashfolk-supporter/");
    await expect.element(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy/");
  });
});
