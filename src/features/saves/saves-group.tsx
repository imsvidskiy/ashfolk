import { LayoutGrid } from "lucide-react";
import { useEffect } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { TextButton } from "../../design/buttons.tsx";
import { ignore } from "../../shared/ignore.ts";
import { SettingsGroup } from "../settings/settings-group.tsx";
import { formatSavedAt } from "./saved-time.ts";
import { useSavesStore } from "./saves-store.ts";
import { useLeaveWorld } from "./use-leave-world.ts";
import { useNow } from "./use-now.ts";

const CLOCK_MILLISECONDS = 15_000;
const AUTOSAVE_NOTE = "The world saves itself every minute.";

function useLastSave(): number | null {
  const worldId = useLaunchStore((state) => {
    return state.worldId;
  });
  const lastSavedAt = useSavesStore((state) => {
    return state.lastSavedAt;
  });
  const listed = useSavesStore((state) => {
    return state.worlds.find((world) => {
      return world.id === worldId;
    });
  });

  if (lastSavedAt !== null) {
    return lastSavedAt;
  }

  return listed === undefined ? null : listed.savedAt;
}

function useSaveDescription(): string {
  const isSaving = useSavesStore((state) => {
    return state.isSaving;
  });
  const lastSave = useLastSave();
  const now = useNow(CLOCK_MILLISECONDS);

  if (isSaving) {
    return "Saving the world…";
  }

  if (lastSave === null) {
    return `Not saved yet. ${AUTOSAVE_NOTE}`;
  }

  return `Saved ${formatSavedAt(lastSave, now)}. ${AUTOSAVE_NOTE}`;
}

function useSavesGroup() {
  const isSaving = useSavesStore((state) => {
    return state.isSaving;
  });
  const saveNow = useSavesStore((state) => {
    return state.saveNow;
  });
  const refresh = useSavesStore((state) => {
    return state.refresh;
  });
  const chooseWorld = useLaunchStore((state) => {
    return state.chooseWorld;
  });
  const leaveWorld = useLeaveWorld();

  useEffect(() => {
    refresh().catch(ignore);
  }, [refresh]);

  function handleSave(): void {
    saveNow().catch(ignore);
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
