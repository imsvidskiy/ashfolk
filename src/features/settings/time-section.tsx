import { useSendCommand } from "../../app/use-engine.ts";
import { SEASONS } from "../../content/seasons.ts";
import { ChoiceField } from "../../design/choice-field.tsx";
import { formatClock, formatParameterValue } from "../../design/format.ts";
import { RangeField } from "../../design/range-field.tsx";
import { ToggleField } from "../../design/toggle-field.tsx";
import {
  type CalendarView,
  MAXIMUM_DAY_SECONDS,
  MAXIMUM_DAYS_PER_SEASON,
  MINIMUM_DAY_SECONDS,
  MINIMUM_DAYS_PER_SEASON,
} from "../../simulation/nature/calendar.ts";
import { useWorldStore } from "../world/world-store.ts";
import { FIELD_GRID, SettingsGroup } from "./settings-group.tsx";

const SEASON_OPTIONS = SEASONS.map((season, index) => ({ label: season, value: String(index) }));

function useTimeSettings() {
  const send = useSendCommand();

  function handleHoursChange(hours: number): void {
    send({ hours, type: "setHours" });
  }

  function handleSeasonChange(value: string): void {
    send({ season: Number(value), type: "setSeason" });
  }

  function handleDayLengthChange(seconds: number): void {
    send({ seconds, type: "setDaySeconds" });
  }

  function handleSeasonLengthChange(days: number): void {
    send({ days, type: "setDaysPerSeason" });
  }

  function handleFrozenChange(isFrozen: boolean): void {
    send({ isFrozen, type: "setTimeFrozen" });
  }

  return {
    handleDayLengthChange,
    handleFrozenChange,
    handleHoursChange,
    handleSeasonChange,
    handleSeasonLengthChange,
  };
}

function TimeSettings({ calendar }: { readonly calendar: CalendarView }) {
  const { handleDayLengthChange, handleFrozenChange, handleHoursChange, handleSeasonChange, handleSeasonLengthChange } =
    useTimeSettings();

  return (
    <>
      <SettingsGroup description="Move the sun and pick the season." title="Today">
        <RangeField
          label="Time of day"
          maximum={23.9}
          minimum={0}
          onChange={handleHoursChange}
          step={0.1}
          value={calendar.hours}
          valueText={formatClock(calendar.hours)}
        />

        <ChoiceField
          label="Season"
          onChange={handleSeasonChange}
          options={SEASON_OPTIONS}
          value={String(Math.floor(calendar.season) % SEASONS.length)}
        />

        <ToggleField
          description="Keep the sun where it is while life goes on."
          isChecked={calendar.isTimeFrozen}
          label="Stop the clock"
          onChange={handleFrozenChange}
        />
      </SettingsGroup>

      <SettingsGroup description="How long days and seasons last at normal speed." title="Calendar">
        <div className={FIELD_GRID}>
          <RangeField
            description="Real seconds in one day at normal speed."
            label="Day length"
            maximum={MAXIMUM_DAY_SECONDS}
            minimum={MINIMUM_DAY_SECONDS}
            onChange={handleDayLengthChange}
            step={30}
            value={calendar.daySeconds}
            valueText={formatParameterValue(calendar.daySeconds, "seconds")}
          />

          <RangeField
            label="Season length"
            maximum={MAXIMUM_DAYS_PER_SEASON}
            minimum={MINIMUM_DAYS_PER_SEASON}
            onChange={handleSeasonLengthChange}
            step={1}
            value={calendar.daysPerSeason}
            valueText={formatParameterValue(calendar.daysPerSeason, "days")}
          />
        </div>
      </SettingsGroup>
    </>
  );
}

export function TimeSection() {
  const calendar = useWorldStore((state) => state.snapshot?.calendar);

  if (calendar === undefined) {
    return null;
  }

  return <TimeSettings calendar={calendar} />;
}
