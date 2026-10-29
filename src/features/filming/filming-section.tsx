import { useEngine } from "../../app/use-engine.ts";
import { TextButton } from "../../design/buttons.tsx";
import { ToggleField } from "../../design/toggle-field.tsx";
import type { Filming, FilmingSettings } from "../../game/filming.ts";
import { SettingsGroup } from "../settings/settings-group.tsx";
import { useFilming } from "./use-filming.ts";

interface FilmingToggle {
  readonly description: string;
  readonly key: keyof FilmingSettings;
  readonly label: string;
}

const SHADOW_TOGGLES: readonly FilmingToggle[] = [
  {
    description: "Shadows reach across the whole island, and plants cast them at every distance.",
    key: "hasFarShadows",
    label: "Shadows at any distance",
  },
  {
    description: "The shadow map grows to 8192 pixels, or the largest the graphics card holds.",
    key: "hasSharpestShadows",
    label: "Max shadow resolution",
  },
];

const DETAIL_TOGGLES: readonly FilmingToggle[] = [
  {
    description: "Trees never drop out in the distance, and their detailed models reach farther.",
    key: "hasFarPlants",
    label: "Vegetation at any distance",
  },
  {
    description: "Terrain and water keep their finest level of detail everywhere.",
    key: "hasFinestGround",
    label: "Max terrain and water detail",
  },
  {
    description: "The resolution stays sharp instead of dropping when frames run slow.",
    key: "isResolutionHeld",
    label: "Hold full resolution",
  },
];

const FRAME_TOGGLES: readonly FilmingToggle[] = [
  {
    description: "Markers over people and animals, tribe banners and place names.",
    key: "areMarkersHidden",
    label: "Hide markers",
  },
  {
    description: "The panels, dock and minimap. Press H anywhere to hide or show them.",
    key: "isInterfaceHidden",
    label: "Hide interface",
  },
];

interface FilmingToggleFieldProps {
  readonly filming: Filming;
  readonly settings: FilmingSettings;
  readonly toggle: FilmingToggle;
}

interface FilmingGroupProps {
  readonly description: string;
  readonly filming: Filming;
  readonly settings: FilmingSettings;
  readonly title: string;
  readonly toggles: readonly FilmingToggle[];
}

function useToggleChange(filming: Filming, key: keyof FilmingSettings) {
  return (isChecked: boolean) => {
    filming.set({ [key]: isChecked });
  };
}

function useToggleAll(filming: Filming, isAllOn: boolean) {
  return () => {
    filming.setAll(!isAllOn);
  };
}

function FilmingToggleField({ filming, settings, toggle }: FilmingToggleFieldProps) {
  const handleChange = useToggleChange(filming, toggle.key);

  return (
    <ToggleField
      description={toggle.description}
      isChecked={settings[toggle.key]}
      label={toggle.label}
      onChange={handleChange}
    />
  );
}

function FilmingGroup({ description, filming, settings, title, toggles }: FilmingGroupProps) {
  return (
    <SettingsGroup description={description} title={title}>
      {toggles.map((toggle) => {
        return <FilmingToggleField filming={filming} key={toggle.key} settings={settings} toggle={toggle} />;
      })}
    </SettingsGroup>
  );
}

function FilmingControls({ filming }: { readonly filming: Filming }) {
  const settings = useFilming();
  const isAllOn = Object.values(settings).every((value) => {
    return value;
  });

  const handleToggleAll = useToggleAll(filming, isAllOn);

  return (
    <>
      <div className="flex items-center justify-between gap-3 pb-4">
        <p className="text-ink-soft text-sm">Turn off optimizations to film the island. Changes apply at once.</p>

        <TextButton className="-mr-3 h-8 px-3" onClick={handleToggleAll} tone="quiet">
          {isAllOn ? "All off" : "All on"}
        </TextButton>
      </div>

      <FilmingGroup
        description="Costly at a distance, so they are off in play."
        filming={filming}
        settings={settings}
        title="Shadows"
        toggles={SHADOW_TOGGLES}
      />

      <FilmingGroup
        description="Detail the game normally trades for frame rate."
        filming={filming}
        settings={settings}
        title="Detail"
        toggles={DETAIL_TOGGLES}
      />

      <FilmingGroup
        description="A clean frame. Scripts can use ?filming=1 or window.ashfolk.filming.set()."
        filming={filming}
        settings={settings}
        title="Frame"
        toggles={FRAME_TOGGLES}
      />
    </>
  );
}

export function FilmingSection() {
  const engine = useEngine();

  if (engine === null) {
    return null;
  }

  return <FilmingControls filming={engine.filming} />;
}
