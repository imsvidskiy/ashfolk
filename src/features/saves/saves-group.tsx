import { LayoutGrid } from "lucide-react";
import { useEffect } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { TextButton } from "../../design/buttons.tsx";
import { SettingsGroup } from "../settings/settings-group.tsx";
import { formatSavedAt } from "./saved-time.ts";
import { useSavesStore } from "./saves-store.ts";
import { useLeaveWorld } from "./use-leave-world.ts";
import { useNow } from "./use-now.ts";

const CLOCK_MILLISECONDS = 15_000;
const AUTOSAVE_NOTE = "The world saves itself every minute.";

function useLastSave(): number | null {
  const worldId = useLaunchStore((state) => state.worldId);
  const lastSavedAt = useSavesStore((state) => state.lastSavedAt);
  const listed = useSavesStore((state) => state.worlds.find((world) => world.id === worldId));

  if (lastSavedAt !== null) {
    return lastSavedAt;
  }

  return listed === undefined ? null : listed.savedAt;
}

function useSaveDescription(): string {
  const hasFailed = useSavesStore((state) => state.hasFailed);
  const isSaving = useSavesStore((state) => state.isSaving);
  const lastSave = useLastSave();
  const now = useNow(CLOCK_MILLISECONDS);

  if (isSaving) {
    return "Saving the world…";
  }

  if (hasFailed) {
    return "The last save failed. This browser may block saving, for example in a private window.";
  }

  if (lastSave === null) {
    return `Not saved yet. ${AUTOSAVE_NOTE}`;
  }

  return `Saved ${formatSavedAt(lastSave, now)}. ${AUTOSAVE_NOTE}`;
}

function useSavesGroup() {
  const isSaving = useSavesStore((state) => state.isSaving);
  const saveNow = useSavesStore((state) => state.saveNow);
  const refresh = useSavesStore((state) => state.refresh);
  const chooseWorld = useLaunchStore((state) => state.chooseWorld);
  const leaveWorld = useLeaveWorld();

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  function handleSave(): void {
    saveNow().catch(() => undefined);
  }

  function handleAllWorlds(): void {
    leaveWorld(chooseWorld);
  }

  return { handleAllWorlds, handleSave, isSaving };
}

export function SavesGroup() {
  const description = useSaveDescription();
  const { handleAllWorlds, handleSave, isSaving } = useSavesGroup();

  return (
    <SettingsGroup description={description} title="Saves">
      <div className="grid grid-cols-2 gap-2">
        <TextButton onClick={handleAllWorlds} tone="outline">
          <LayoutGrid aria-hidden="true" size={16} />
          All worlds
        </TextButton>

        <TextButton disabled={isSaving} onClick={handleSave} tone="accent">
          Save now
        </TextButton>
      </div>
    </SettingsGroup>
  );
}
