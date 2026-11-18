import { BookOpen, Download, Map as MapIcon, Settings } from "lucide-react";
import { IconButton, TextButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { WithTooltip } from "../../design/tooltip.tsx";
import { useInstall } from "../install/install-store.ts";
import { useSidePanel } from "../journal/use-side-panel.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { useFullscreen } from "./use-fullscreen.ts";

const ROW = "flex h-12 items-center gap-0.5 px-1.5 pointer-coarse:h-13";

const VIEW_BUTTON =
  "h-10 gap-1.5 px-3 font-semibold aria-pressed:bg-dawn-soft aria-pressed:text-dawn-strong pointer-coarse:h-11";

function useMenuActions() {
  const { isJournalOpen, toggleJournal } = useSidePanel();
  const isMapOpen = useInterfaceStore((state) => {
    return state.isMapOpen;
  });
  const toggleMap = useInterfaceStore((state) => {
    return state.toggleMap;
  });
  const openSettings = useInterfaceStore((state) => {
    return state.openSettings;
  });

  return { isJournalOpen, isMapOpen, openSettings, toggleJournal, toggleMap };
}

function FullscreenButton() {
  const { canGoFullscreen, icon: Icon, label, toggleFullscreen } = useFullscreen();

  if (!canGoFullscreen) {
    return null;
  }

  return (
    <WithTooltip content={label} side="bottom">
      <IconButton icon={<Icon aria-hidden="true" size={18} />} label={label} onClick={toggleFullscreen} />
    </WithTooltip>
  );
}

function InstallButton() {
  const { canInstall, install } = useInstall();

  if (!canInstall) {
    return null;
  }

  return (
    <Island className="shrink-0">
      <div className={ROW}>
        <WithTooltip content="Play from your home screen or desktop" side="bottom">
          <TextButton
            aria-label="Install the app"
            className="h-10 gap-1.5 px-2.5 font-semibold pointer-coarse:h-11"
            onClick={install}
            tone="quiet"
          >
            <Download aria-hidden="true" className="text-dawn-strong" size={17} />
            Install
          </TextButton>
        </WithTooltip>
      </div>
    </Island>
  );
}

export function MenuButtons({ className }: { readonly className?: string | undefined }) {
  const { isJournalOpen, isMapOpen, openSettings, toggleJournal, toggleMap } = useMenuActions();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <nav aria-label="Panels" className="flex items-center gap-2">
        <Island>
          <fieldset aria-label="World views" className={ROW}>
            <WithTooltip content="Tribes, relations and chronicle" side="bottom">
              <TextButton aria-pressed={isJournalOpen} className={VIEW_BUTTON} onClick={toggleJournal} tone="quiet">
                <BookOpen aria-hidden="true" size={17} />
                Journal
              </TextButton>
            </WithTooltip>

            <WithTooltip content="Map of the island" side="bottom">
              <TextButton aria-pressed={isMapOpen} className={VIEW_BUTTON} onClick={toggleMap} tone="quiet">
                <MapIcon aria-hidden="true" size={17} />
                Map
              </TextButton>
            </WithTooltip>
          </fieldset>
        </Island>

        <Island>
          <fieldset aria-label="Game controls" className={ROW}>
            <WithTooltip content="World, weather, time, graphics and sound" side="bottom">
              <TextButton
                aria-label="Settings"
                className="size-10 gap-1.5 p-0 font-semibold xl:w-auto xl:px-3 pointer-coarse:size-11"
                onClick={openSettings}
                tone="quiet"
              >
                <Settings aria-hidden="true" size={18} />

                <span className="hidden xl:inline">Settings</span>
              </TextButton>
            </WithTooltip>

            <FullscreenButton />
          </fieldset>
        </Island>
      </nav>

      <InstallButton />
    </div>
  );
}
