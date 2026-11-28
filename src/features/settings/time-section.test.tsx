import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SEASONS } from "../../content/seasons.ts";
import { startTestEngine } from "../testing/engine-fixtures.ts";
import { createCalendar, showWorld } from "../testing/world-fixtures.ts";
import { TimeSection } from "./time-section.tsx";

describe("time section", () => {
  it("stays empty until the first frame arrives", async () => {
    const screen = await render(<TimeSection />);

    expect(screen.container).toBeEmptyDOMElement();
  });

  it("shows the time as a clock and moves it with the slider", async () => {
    const { send } = await startTestEngine();

    showWorld({ calendar: createCalendar({ hours: 14.5 }) });

    const screen = await render(<TimeSection />);
    const time = screen.getByRole("slider", { name: "Time of day" });

    await expect.element(time).toHaveValue("14.5");
    await expect.element(screen.getByText("14:30")).toBeVisible();

    time.element().focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(send).toHaveBeenCalledExactlyOnceWith({ hours: 14.6, type: "setHours" });
  });

  it("shows the current season and sends the chosen season to the simulation", async () => {
    const { send } = await startTestEngine();

    showWorld({ calendar: createCalendar({ season: 2.4, seasonName: "Autumn" }) });

    const screen = await render(<TimeSection />);
    const seasonField = screen.getByRole("combobox", { name: "Season" });

    await expect.element(seasonField).toHaveTextContent("Autumn");
    await seasonField.click();

    await Promise.all(
      SEASONS.map((season) => {
        return expect.element(screen.getByRole("option", { name: season })).toBeInTheDocument();
      })
    );

    await screen.getByRole("option", { name: "Winter" }).click();

    expect(send).toHaveBeenCalledExactlyOnceWith({ season: 3, type: "setSeason" });
  });

  it("sends day length in seconds and season length in days", async () => {
    const { send } = await startTestEngine();

    showWorld({ calendar: createCalendar({ daySeconds: 300, daysPerSeason: 1 }) });

    const screen = await render(<TimeSection />);
    const day = screen.getByRole("slider", { name: "Day length" });
    const season = screen.getByRole("slider", { name: "Season length" });

    await expect.element(day).toHaveValue("300");
    await expect.element(screen.getByText("300 s")).toBeVisible();
    await expect.element(season).toHaveValue("1");
    await expect.element(screen.getByText("1 day")).toBeVisible();

    day.element().focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(send).toHaveBeenLastCalledWith({ seconds: 330, type: "setDaySeconds" });

    season.element().focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(send).toHaveBeenLastCalledWith({ days: 2, type: "setDaysPerSeason" });
  });

  it("restarts a stopped clock", async () => {
    const { send } = await startTestEngine();

    showWorld({ calendar: createCalendar({ isTimeFrozen: true }) });

    const screen = await render(<TimeSection />);
    const clock = screen.getByRole("switch", { name: "Stop the clock" });

    await expect.element(clock).toBeChecked();
    await clock.click();

    expect(send).toHaveBeenCalledExactlyOnceWith({ isFrozen: false, type: "setTimeFrozen" });
  });
});
