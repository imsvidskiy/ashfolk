import { useState } from "react";
import { useLaunchStore, type WorldChoice } from "../../app/launch-store.ts";
import { storeQuality } from "../../app/preferences.ts";
import { TextButton } from "../../design/buttons.tsx";
import { ChoiceField } from "../../design/choice-field.tsx";
import { ToggleField } from "../../design/toggle-field.tsx";
import { isQualityLevel, QUALITY_LEVELS, type QualityLevel } from "../../rendering/render-quality.ts";
import { useGuideStore } from "../guide/guide-store.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { useWorldDraft } from "../new-world/use-world-draft.ts";
import { NameField, SeedField, ShapeChoice, SizeChoice } from "../new-world/world-fields.tsx";
import { SavesGroup } from "../saves/saves-group.tsx";
import { useLeaveWorld } from "../saves/use-leave-world.ts";
import { GROUP_CLASS, GroupHeading, SettingsGroup } from "./settings-group.tsx";

const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = { high: "High", low: "Light", medium: "Balanced" };

const QUALITY_OPTIONS = QUALITY_LEVELS.map((level) => {
  return { label: QUALITY_LABELS[level], value: level };
});

function useCreateWorld(): (choice: WorldChoice) => void {
  const createWorld = useLaunchStore((state) => {
    return state.createWorld;
  });
  const leaveWorld = useLeaveWorld();

  return (choice) => {
    leaveWorld(() => {
      createWorld(choice);
    });
  };
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
    storeQuality(value);
  }

  function handleApply(): void {
    leaveWorld(() => {
      relaunch({ quality });
    });
  }

  return { handleApply, handleQualityChange, hasChanged: quality !== active, quality };
}

function QualityChoice() {
  const { handleApply, handleQualityChange, hasChanged, quality } = useQualityChoice();

  return (
    <SettingsGroup
      action={
        <TextButton className="h-8 px-3.5" disabled={!hasChanged} onClick={handleApply} tone="accent">
          Apply
        </TextButton>
      }
      description="The island is saved and reopened to switch the quality."
      title="Graphics"
    >
      <ChoiceField
        description="Light suits phones and older laptops; High adds sharper shadows and more detail far away."
        label="Quality"
        onChange={handleQualityChange}
        options={QUALITY_OPTIONS}
        value={quality}
      />
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
  const areTipsShown = useGuideStore((state) => {
    return !state.progress.isOff;
  });
  const setTipsShown = useGuideStore((state) => {
    return state.setTipsShown;
  });

  return (
    <SettingsGroup description="What is drawn over the island, and the tips for new players." title="Display">
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

      <ToggleField
        description="Tips start again from the first one."
        isChecked={areTipsShown}
        label="Tips"
        onChange={setTipsShown}
      />
    </SettingsGroup>
  );
}

function NewWorld() {
  const launch = useLaunchStore((state) => {
    return state.launch;
  });
  const createWorld = useCreateWorld();
  const draft = useWorldDraft(launch, createWorld);

  return (
    <form aria-label="New world" className={GROUP_CLASS} onSubmit={draft.handleSubmit}>
      <GroupHeading
        description="Every seed grows a different island. The current one stays in your worlds."
        title="New world"
      />

      <NameField onChange={draft.handleNameChange} onRoll={draft.handleNameRoll} value={draft.nameText} />

      <ShapeChoice onChange={draft.handleShapeChange} value={draft.shape} />

      <SizeChoice onChange={draft.handleSizeChange} value={draft.size} />

      <div className="flex items-center gap-2">
        <SeedField
          className="min-w-0 flex-1"
          onChange={draft.handleSeedChange}
          onRoll={draft.handleSeedRoll}
          value={draft.seedText}
        />

        <TextButton disabled={draft.choice === null} tone="accent" type="submit">
          Create
        </TextButton>
      </div>
    </form>
  );
}

export function IslandSection() {
  return (
    <>
      <SavesGroup />

      <QualityChoice />

      <DisplayChoice />

      <NewWorld />
    </>
  );
}
