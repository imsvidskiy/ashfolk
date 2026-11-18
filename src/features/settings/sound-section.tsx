import { formatPercent } from "../../design/format.ts";
import { RangeField } from "../../design/range-field.tsx";
import { ToggleField } from "../../design/toggle-field.tsx";
import { useSoundStore, type VolumeKey } from "../sound/sound-store.ts";
import { FIELD_GRID, SettingsGroup } from "./settings-group.tsx";

interface VolumeField {
  readonly key: VolumeKey;
  readonly label: string;
}

const MIX: readonly VolumeField[] = [
  { key: "music", label: "Music" },
  { key: "ambience", label: "Nature" },
  { key: "effects", label: "Effects" },
  { key: "interface", label: "Interface" },
];

function handleSoundChange(isEnabled: boolean): void {
  useSoundStore.getState().setMuted(!isEnabled);
}

function useVolume(key: VolumeKey) {
  const volume = useSoundStore((state) => {
    return state.levels[key];
  });
  const setVolume = useSoundStore((state) => {
    return state.setVolume;
  });

  function handleChange(next: number): void {
    setVolume(key, next);
  }

  return { handleChange, volume };
}

function VolumeRange({ field }: { readonly field: VolumeField }) {
  const { handleChange, volume } = useVolume(field.key);

  return (
    <RangeField
      label={field.label}
      maximum={1}
      minimum={0}
      onChange={handleChange}
      step={0.05}
      value={volume}
      valueText={formatPercent(volume)}
    />
  );
}

export function SoundSection() {
  const isMuted = useSoundStore((state) => {
    return state.levels.isMuted;
  });

  return (
    <>
      <SettingsGroup title="Playback">
        <ToggleField
          description="Music, nature and the sounds of the world."
          isChecked={!isMuted}
          label="Play sound"
          onChange={handleSoundChange}
        />

        <VolumeRange field={{ key: "master", label: "Volume" }} />
      </SettingsGroup>

      <SettingsGroup title="Mix">
        <div className={FIELD_GRID}>
          {MIX.map((field) => {
            return <VolumeRange field={field} key={field.key} />;
          })}
        </div>
      </SettingsGroup>
    </>
  );
}
