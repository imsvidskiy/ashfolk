import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProjectLinks } from "./project-links.tsx";

describe("project links", () => {
  it("links to the repository with its stars and to sponsorship", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        return Promise.resolve(Response.json({ stargazers_count: 1234 }));
      })
    );

    const screen = await render(<ProjectLinks />);

    await expect
      .element(screen.getByRole("link", { name: "Ashfolk on GitHub" }))
      .toHaveAttribute("href", "https://github.com/imsvidskiy/ashfolk");
    await expect.element(screen.getByText("1.2K")).toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Sponsor Ashfolk" }))
      .toHaveAttribute("href", "https://whop.com/ashfolk-supporter/");
    await expect.element(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy/");
  });

  it("leaves the stars out when GitHub does not answer", async () => {
    const screen = await render(<ProjectLinks />);

    await expect.element(screen.getByRole("link", { name: "Ashfolk on GitHub" })).not.toHaveTextContent("K");
  });
});
