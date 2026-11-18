import { Dialog } from "@base-ui/react/dialog";
import { MapPin, X } from "lucide-react";
import { version } from "../../../package.json";
import { useLaunchStore } from "../../app/launch-store.ts";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { DIALOG_BACKDROP, DIALOG_POPUP, DIALOG_VIEWPORT } from "../../design/styles.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { ProjectLinks } from "../project/project-links.tsx";
import { useSavesStore } from "../saves/saves-store.ts";
import { SettingsSections } from "./settings-sections.tsx";

function SaveNotice() {
  const problem = useSavesStore((state) => {
    return state.saveProblem;
  });
  const isWaitingToLeave = useSavesStore((state) => {
    return state.isWaitingToLeave;
  });

  if (isWaitingToLeave) {
    return (
      <p className="bg-canvas px-4 py-2 text-sm sm:px-6" role="status">
        Saving your island…
      </p>
    );
  }

  if (problem === null) {
    return null;
  }

  return (
    <p className="bg-dawn-soft px-4 py-2 text-sm sm:px-6" role="alert">
      {problem === "busy"
        ? "The island is still changing. Return to play, resume time and try again when the effect ends."
        : "Your changes could not be saved. Check browser storage and try again."}
    </p>
  );
}

export function SettingsDialog() {
  const isSettingsOpen = useInterfaceStore((state) => {
    return state.isSettingsOpen;
  });
  const setSettingsOpen = useInterfaceStore((state) => {
    return state.setSettingsOpen;
  });
  const worldName = useLaunchStore((state) => {
    return state.launch.name;
  });

  return (
    <Dialog.Root onOpenChange={setSettingsOpen} open={isSettingsOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />

        <Dialog.Viewport className={DIALOG_VIEWPORT}>
          <Dialog.Popup className={cn(DIALOG_POPUP, "w-full max-w-3xl")}>
            <Island className="max-h-dialog flex h-[36rem] flex-col">
              <header className="border-line flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
                <Dialog.Title className="text-ink text-xl font-bold">Settings</Dialog.Title>

                <Dialog.Description className="text-ink-soft ml-auto flex min-w-0 items-center gap-1.5 text-sm">
                  <MapPin aria-hidden="true" className="shrink-0" size={15} />

                  <span className="truncate">{worldName}</span>
                </Dialog.Description>

                <Dialog.Close
                  render={<IconButton icon={<X aria-hidden="true" size={18} />} label="Close the settings" />}
                />
              </header>

              <SaveNotice />

              <SettingsSections />

              <footer className="border-line bg-paper flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t px-3 py-2 sm:px-5">
                <ProjectLinks className="justify-start max-sm:gap-0 max-sm:[&_a]:gap-1 max-sm:[&_a]:px-1.5 max-sm:[&_a>span]:hidden" />

                <span className="text-ink-muted ml-auto text-xs font-semibold tabular-nums">v{version}</span>
              </footer>
            </Island>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
