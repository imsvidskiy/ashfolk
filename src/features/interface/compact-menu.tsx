import { Menu } from "@base-ui/react/menu";
import { BookOpen, Download, Map as MapIcon, Menu as MenuIcon, Settings, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { MENU_ITEM, MENU_POPUP } from "../../design/styles.ts";
import { useInstall } from "../install/install-store.ts";
import { useSidePanel } from "../journal/use-side-panel.ts";
import { useSoundToggle } from "../sound/use-sound-toggle.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { useFullscreen } from "./use-fullscreen.ts";

interface MenuEntryProps {
  readonly children: ReactNode;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

function useCompactMenu() {
  const { openJournal } = useSidePanel();
  const isMapOpen = useInterfaceStore((state) => {
    return state.isMapOpen;
  });
  const openSettings = useInterfaceStore((state) => {
    return state.openSettings;
  });
  const toggleMap = useInterfaceStore((state) => {
    return state.toggleMap;
  });

  function handleJournal(): void {
    openJournal("tribes");
  }

  return { handleJournal, isMapOpen, openSettings, toggleMap };
}

function MenuEntry({ children, icon, onClick }: MenuEntryProps) {
  return (
    <Menu.Item className={MENU_ITEM} onClick={onClick}>
      <span className="text-ink-soft">{icon}</span>

      {children}
    </Menu.Item>
  );
}

function FullscreenEntry() {
  const { canGoFullscreen, icon: Icon, label, toggleFullscreen } = useFullscreen();

  if (!canGoFullscreen) {
    return null;
  }

  return (
    <MenuEntry icon={<Icon aria-hidden="true" size={17} />} onClick={toggleFullscreen}>
      {label}
    </MenuEntry>
  );
}

function InstallEntry() {
  const { canInstall, install } = useInstall();

  if (!canInstall) {
    return null;
  }

  return (
    <MenuEntry icon={<Download aria-hidden="true" size={17} />} onClick={install}>
      Install the app
    </MenuEntry>
  );
}

function SoundEntry() {
  const { isMuted, label, toggleSound } = useSoundToggle();

  const Icon = isMuted ? VolumeX : Volume2;

  return (
    <MenuEntry icon={<Icon aria-hidden="true" size={17} />} onClick={toggleSound}>
      {label}
    </MenuEntry>
  );
}

export function CompactMenu() {
  const { handleJournal, isMapOpen, openSettings, toggleMap } = useCompactMenu();

  return (
    <Menu.Root>
      <Menu.Trigger render={<IconButton icon={<MenuIcon aria-hidden="true" size={19} />} label="Menu" />} />

      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50" sideOffset={10}>
          <Menu.Popup className={cn(MENU_POPUP, "min-w-52")}>
            <MenuEntry icon={<BookOpen aria-hidden="true" size={17} />} onClick={handleJournal}>
              Journal
            </MenuEntry>

            <MenuEntry icon={<MapIcon aria-hidden="true" size={17} />} onClick={toggleMap}>
              {isMapOpen ? "Hide the map" : "Show the map"}
            </MenuEntry>

            <MenuEntry icon={<Settings aria-hidden="true" size={17} />} onClick={openSettings}>
              Settings
            </MenuEntry>

            <SoundEntry />

            <InstallEntry />

            <FullscreenEntry />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
