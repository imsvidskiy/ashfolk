import { useSendCommand } from "../../app/use-engine.ts";
import {
  MAXIMUM_TEMPERATURE_OFFSET,
  MAXIMUM_WIND_SPEED,
  MINIMUM_TEMPERATURE_OFFSET,
  WEATHER,
  WEATHER_KINDS,
  type WeatherKind,
} from "../../content/weather.ts";
import { ChoiceField } from "../../design/choice-field.tsx";
import { formatParameterValue } from "../../design/format.ts";
import { RangeField } from "../../design/range-field.tsx";
import { useHeldDraft } from "../../design/use-held-draft.ts";
import type { WeatherView } from "../../simulation/frame.ts";
import { useWorldStore } from "../world/world-store.ts";
import { FIELD_GRID, SettingsGroup } from "./settings-group.tsx";

const AUTOMATIC = "automatic";

const WEATHER_OPTIONS = [
  { label: "Changes by itself", value: AUTOMATIC },
  ...WEATHER_KINDS.map((kind) => {
    return { label: WEATHER[kind].name, value: kind };
  }),
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

interface WindSetting {
  readonly direction: number;
  readonly speed: number;
}

function compassName(degrees: number): string {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % COMPASS.length;
  const name = COMPASS[index];

  if (name === undefined) {
    return "N";
  }

  return name;
}

function isWeatherChoice(value: string): value is WeatherKind | typeof AUTOMATIC {
  return (
    value === AUTOMATIC ||
    WEATHER_KINDS.some((kind) => {
      return kind === value;
    })
  );
}

function useWeatherSettings(weather: WeatherView) {
  const send = useSendCommand();
  const [wind, holdWind] = useHeldDraft<WindSetting>({
    direction: weather.windDirection,
    speed: weather.windBaseSpeed,
  });

  function handleWeatherChange(value: string): void {
    if (isWeatherChoice(value)) {
      send({ type: "setWeather", weather: value });
    }
  }

  function changeWind(next: WindSetting): void {
    holdWind(next);
    send({ ...next, type: "setWind" });
  }

  function handleDirectionChange(direction: number): void {
    changeWind({ ...wind, direction });
  }

  function handleSpeedChange(speed: number): void {
    changeWind({ ...wind, speed });
  }

  function handleTemperatureChange(offset: number): void {
    send({ offset, type: "setTemperatureOffset" });
  }

  return { handleDirectionChange, handleSpeedChange, handleTemperatureChange, handleWeatherChange, wind };
}

function WeatherSettings({ weather }: { readonly weather: WeatherView }) {
  const { handleDirectionChange, handleSpeedChange, handleTemperatureChange, handleWeatherChange, wind } =
    useWeatherSettings(weather);

  const choice = weather.isAutomatic ? AUTOMATIC : weather.kind;
  const temperatureOffset = Math.round(weather.userTemperatureOffset);
  const windDirection = Math.round(wind.direction);

  return (
    <>
      <SettingsGroup description="Pick the weather or let the seasons decide." title="Sky">
        <ChoiceField label="Weather" onChange={handleWeatherChange} options={WEATHER_OPTIONS} value={choice} />

        <RangeField
          description="Makes the whole island warmer or colder."
          label="Temperature"
          maximum={MAXIMUM_TEMPERATURE_OFFSET}
          minimum={MINIMUM_TEMPERATURE_OFFSET}
          onChange={handleTemperatureChange}
          step={1}
          value={temperatureOffset}
          valueText={formatParameterValue(temperatureOffset, "celsius")}
        />
      </SettingsGroup>

      <SettingsGroup description="Where the wind blows from and how hard, before gusts." title="Wind">
        <div className={FIELD_GRID}>
          <RangeField
            description="Where the wind blows from."
            label="Wind from"
            maximum={359}
            minimum={0}
            onChange={handleDirectionChange}
            step={1}
            value={windDirection}
            valueText={`${compassName(wind.direction)} · ${windDirection}°`}
          />

          <RangeField
            description="Base wind speed before gusts."
            label="Wind speed"
            maximum={MAXIMUM_WIND_SPEED}
            minimum={0}
            onChange={handleSpeedChange}
            step={1}
            value={Math.round(wind.speed)}
            valueText={formatParameterValue(wind.speed, "kilometersPerHour")}
          />
        </div>
      </SettingsGroup>
    </>
  );
}

export function WeatherSection() {
  const weather = useWorldStore((state) => {
    return state.snapshot?.weather;
  });

  if (weather === undefined) {
    return null;
  }

  return <WeatherSettings weather={weather} />;
}
