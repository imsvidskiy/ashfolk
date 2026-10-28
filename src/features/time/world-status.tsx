import type { WeatherKind } from "../../content/weather.ts";
import { formatClock } from "../../design/format.ts";
import { GameIcon } from "../../design/game-icon.tsx";
import type { GameIconName } from "../../design/game-icon-sources.ts";
import { useWorldStore } from "../world/world-store.ts";

const WEATHER_ICONS: Readonly<Record<WeatherKind, GameIconName>> = {
  blizzard: "snow",
  clear: "clear",
  cloudy: "cloud",
  fog: "fog",
  heat: "heat",
  overcast: "overcast",
  rain: "rain",
  snow: "snow-cloud",
  storm: "storm",
};

const CHIP_CLASS = "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-ink/5 pr-3 pl-1.5 text-ink text-sm";

const RING_RADIUS = 21;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function daylightIcon(hours: number): GameIconName {
  if (hours >= 5 && hours < 8) {
    return "sunrise";
  }

  if (hours >= 8 && hours < 18) {
    return "sun";
  }

  if (hours >= 18 && hours < 21) {
    return "sunset";
  }

  return "moon";
}

function DayRing({ hours }: { readonly hours: number }) {
  const elapsed = (RING_LENGTH * hours) / 24;

  return (
    <span className="relative grid size-12 shrink-0 place-items-center">
      <svg aria-hidden="true" className="absolute inset-0 -rotate-90" viewBox="0 0 48 48">
        <circle className="stroke-ink/8 fill-none" cx="24" cy="24" r={RING_RADIUS} strokeWidth="3" />

        <circle
          className="stroke-dawn fill-none"
          cx="24"
          cy="24"
          r={RING_RADIUS}
          strokeDasharray={`${elapsed} ${RING_LENGTH}`}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>

      <GameIcon name={daylightIcon(hours)} size={28} />
    </span>
  );
}

function WeatherReading() {
  const weather = useWorldStore((state) => state.snapshot?.weather);

  if (weather === undefined) {
    return null;
  }

  return (
    <span className={CHIP_CLASS}>
      <GameIcon name={WEATHER_ICONS[weather.kind]} size={22} />

      <span>{weather.name}</span>

      <span className="text-ink-muted text-xs tabular-nums">{Math.round(weather.windSpeed)} km/h</span>
    </span>
  );
}

function PopulationReading() {
  const population = useWorldStore((state) =>
    state.snapshot?.tribes.reduce((total, tribe) => total + tribe.population, 0)
  );
  const tribeCount = useWorldStore((state) => state.snapshot?.tribes.length);

  if (population === undefined || tribeCount === undefined) {
    return null;
  }

  const tribesLabel = tribeCount === 1 ? "1 tribe" : `${tribeCount} tribes`;

  return (
    <span className={CHIP_CLASS} title={`${population} people in ${tribesLabel}`}>
      <GameIcon name="population" size={22} />

      <span className="tabular-nums">{population}</span>

      <span className="text-ink-muted text-xs">{tribesLabel}</span>
    </span>
  );
}

export function CompactClock() {
  const calendar = useWorldStore((state) => state.snapshot?.calendar);

  if (calendar === undefined) {
    return null;
  }

  return (
    <div className="@container flex min-w-0 flex-1 items-center gap-2">
      <GameIcon className="@max-[6.5rem]:hidden" name={daylightIcon(calendar.hours)} />

      <div className="flex min-w-0 flex-col leading-none">
        <span className="text-ink text-sm font-semibold tabular-nums">{formatClock(calendar.hours)}</span>

        <span className="text-2xs text-ink-muted truncate">
          <span className="@max-[5rem]:hidden">{calendar.seasonName} · </span>
          Day {calendar.dayOfSeason}
        </span>
      </div>
    </div>
  );
}

export function WorldStatus() {
  const calendar = useWorldStore((state) => state.snapshot?.calendar);

  if (calendar === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <DayRing hours={calendar.hours} />

        <span className="flex flex-col gap-1 leading-none">
          <span className="text-ink text-2xl font-semibold tabular-nums">{formatClock(calendar.hours)}</span>

          <span className="text-ink-muted text-xs">
            {calendar.seasonName} · Day {calendar.dayOfSeason} · Year {calendar.year}
          </span>
        </span>
      </div>

      <div className="flex gap-1.5">
        <WeatherReading />

        <PopulationReading />
      </div>
    </div>
  );
}
