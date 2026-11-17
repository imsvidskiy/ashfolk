import { useLaunchStore, type WorldChoice } from "../../app/launch-store.ts";
import { TextButton } from "../../design/buttons.tsx";
import { useWorldDraft } from "../new-world/use-world-draft.ts";
import { NameField, SeedField, ShapeChoice, SizeChoice } from "../new-world/world-fields.tsx";
import { SavesGroup } from "../saves/saves-group.tsx";
import { useLeaveWorld } from "../saves/use-leave-world.ts";
import { GROUP_CLASS, GroupHeading } from "./settings-group.tsx";

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

      <NewWorld />
    </>
  );
}
