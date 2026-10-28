import { Menu } from "@base-ui/react/menu";
import { BookOpen, Map as MapIcon, Maximize2, Menu as MenuIcon, Minimize2, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { PAPER_SURFACE, POPUP_MOTION } from "../../design/styles.ts";
import { useSidePanel } from "../journal/use-side-panel.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { useFullscreen } from "./use-fullscreen.ts";

interface MenuEntryProps {
  readonly children: ReactNode;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}

function MenuEntry({ children, icon, onClick }: MenuEntryProps) {
  return (
    <Menu.Item
      className="text-ink data-highlighted:bg-paper-hover flex h-11 cursor-default items-center gap-3 rounded-xl px-3 text-sm outline-none select-none"
      onClick={onClick}
    >
      <span className="text-ink-soft">{icon}</span>

      {children}
    </Menu.Item>
  );
}

function FullscreenEntry() {
  const { canGoFullscreen, isFullscreen, toggleFullscreen } = useFullscreen();

  if (!canGoFullscreen) {
    return null;
  }

  const Icon = isFullscreen ? Minimize2 : Maximize2;

  return (
    <MenuEntry icon={<Icon aria-hidden="true" size={17} />} onClick={toggleFullscreen}>
      {isFullscreen ? "Leave full screen" : "Full screen"}
    </MenuEntry>
  );
}

function useCompactMenu() {
  const { openJournal } = useSidePanel();
  const isMapOpen = useInterfaceStore((state) => state.isMapOpen);
  const openSettings = useInterfaceStore((state) => state.openSettings);
  const toggleMap = useInterfaceStore((state) => state.toggleMap);

  function handleJournal(): void {
    openJournal("tribes");
  }

  return { handleJournal, isMapOpen, openSettings, toggleMap };
}

export function CompactMenu() {
  const { handleJournal, isMapOpen, openSettings, toggleMap } = useCompactMenu();

  return (
    <Menu.Root>
      <Menu.Trigger render={<IconButton icon={<MenuIcon aria-hidden="true" size={19} />} label="Menu" />} />

      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50" sideOffset={10}>
          <Menu.Popup
            className={cn(PAPER_SURFACE, POPUP_MOTION, "rounded-island min-w-52 p-1.5 duration-150 outline-none")}
          >
            <MenuEntry icon={<BookOpen aria-hidden="true" size={17} />} onClick={handleJournal}>
              Tribes and chronicle
            </MenuEntry>

            <MenuEntry icon={<MapIcon aria-hidden="true" size={17} />} onClick={toggleMap}>
              {isMapOpen ? "Hide the map" : "Show the map"}
            </MenuEntry>

            <MenuEntry icon={<Settings aria-hidden="true" size={17} />} onClick={openSettings}>
              Settings
            </MenuEntry>

            <FullscreenEntry />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
