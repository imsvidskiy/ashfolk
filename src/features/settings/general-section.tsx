import { Compass } from "lucide-react";
import { useState } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { storeQuality } from "../../app/preferences.ts";
import { TextButton } from "../../design/buttons.tsx";
import { ChoiceField } from "../../design/choice-field.tsx";
import { ToggleField } from "../../design/toggle-field.tsx";
import { isQualityLevel, QUALITY_LEVELS, type QualityLevel } from "../../rendering/render-quality.ts";
import { useGuideStore } from "../guide/guide-store.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { ProjectLinks } from "../project/project-links.tsx";
import { useLeaveWorld } from "../saves/use-leave-world.ts";
import { SettingsGroup } from "./settings-group.tsx";

const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = { high: "High", low: "Light", medium: "Balanced" };

const QUALITY_OPTIONS = QUALITY_LEVELS.map((level) => {
  return { label: QUALITY_LABELS[level], value: level };
});

function restartGuide(): void {
  useGuideStore.getState().setTipsShown(true);
  useInterfaceStore.getState().setSettingsOpen(false);
}

function useQualityChoice() {
  const active = useLaunchStore((state) => {
    return state.launch.quality;
  });
  const relaunch = useLaunchStore((state) => {
    return state.relaunch;
  });
  const leaveWorld = useLeaveWorld();
  const [quality, setQuality] = useState(active);

  function handleQualityChange(value: string): void {
    if (!isQualityLevel(value)) {
      return;
    }

    setQuality(value);
  }

  function handleApply(): void {
    leaveWorld(() => {
      storeQuality(quality);
      relaunch({ quality });
    });
  }

  return { handleApply, handleQualityChange, hasChanged: quality !== active, quality };
}

function QualityChoice() {
  const { handleApply, handleQualityChange, hasChanged, quality } = useQualityChoice();

  return (
    <SettingsGroup description="Light favors frame rate. High shows more detail in the distance." title="Graphics">
      <ChoiceField label="Quality" onChange={handleQualityChange} options={QUALITY_OPTIONS} value={quality} />

      {hasChanged ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-ink-soft text-sm">Applying saves and reopens this island.</p>

          <TextButton onClick={handleApply} tone="accent">
            Apply
          </TextButton>
        </div>
      ) : null}
    </SettingsGroup>
  );
}

function DisplayChoice() {
  const areLabelsShown = useInterfaceStore((state) => {
    return state.areLabelsShown;
  });
  const setLabelsShown = useInterfaceStore((state) => {
    return state.setLabelsShown;
  });
  const areOutlinesShown = useInterfaceStore((state) => {
    return state.areOutlinesShown;
  });
  const setOutlinesShown = useInterfaceStore((state) => {
    return state.setOutlinesShown;
  });

  return (
    <SettingsGroup title="Map details">
      <ToggleField
        description="Tribe banners and the names of peaks and lakes."
        isChecked={areLabelsShown}
        label="Map labels"
        onChange={setLabelsShown}
      />

      <ToggleField
        description="A dark line around people, animals, plants and buildings."
        isChecked={areOutlinesShown}
        label="Outlines"
        onChange={setOutlinesShown}
      />
    </SettingsGroup>
  );
}

export function GeneralSection() {
  return (
    <>
      <SettingsGroup
        action={
          <TextButton onClick={restartGuide} tone="outline">
            <Compass aria-hidden="true" size={16} />
            Restart guide
          </TextButton>
        }
        description="Take your first steps on this island again."
        title="Island guide"
      />

      <DisplayChoice />

      <QualityChoice />

      <ProjectLinks className="border-line justify-start border-t pt-3" />
    </>
  );
}
