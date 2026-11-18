import { Menu } from "@base-ui/react/menu";
import { BookOpen, Check, Download, Map as MapIcon, Menu as MenuIcon, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { MENU_ITEM, MENU_POPUP } from "../../design/styles.ts";
import { useInstall } from "../install/install-store.ts";
import { useSidePanel } from "../journal/use-side-panel.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { useFullscreen } from "./use-fullscreen.ts";

const GROUP_LABEL = "text-ink-muted px-2.5 pt-1.5 pb-1 text-xs font-semibold";

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
    <>
      <Menu.Separator className="border-line mx-2 my-1.5 border-t" />

      <Menu.Group aria-label="App installation">
        <MenuEntry icon={<Download aria-hidden="true" size={17} />} onClick={install}>
          Install the app
        </MenuEntry>
      </Menu.Group>
    </>
  );
}

export function CompactMenu() {
  const { handleJournal, isMapOpen, openSettings, toggleMap } = useCompactMenu();

  return (
    <Menu.Root>
      <Menu.Trigger render={<IconButton icon={<MenuIcon aria-hidden="true" size={19} />} label="Menu" />} />

      <Menu.Portal>
        <Menu.Positioner align="end" className="z-50" sideOffset={10}>
          <Menu.Popup
            className={cn(MENU_POPUP, "max-h-(--available-height) min-w-52 overflow-y-auto overscroll-contain")}
          >
            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL}>World views</Menu.GroupLabel>

              <MenuEntry icon={<BookOpen aria-hidden="true" size={17} />} onClick={handleJournal}>
                Journal
              </MenuEntry>

              <Menu.CheckboxItem checked={isMapOpen} className={MENU_ITEM} closeOnClick onCheckedChange={toggleMap}>
                <MapIcon aria-hidden="true" className="text-ink-soft" size={17} />
                Map
                <Menu.CheckboxItemIndicator className="text-dawn-strong ml-auto">
                  <Check aria-hidden="true" size={16} />
                </Menu.CheckboxItemIndicator>
              </Menu.CheckboxItem>
            </Menu.Group>

            <Menu.Separator className="border-line mx-2 my-1.5 border-t" />

            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL}>Game controls</Menu.GroupLabel>

              <MenuEntry icon={<Settings aria-hidden="true" size={17} />} onClick={openSettings}>
                Settings
              </MenuEntry>

              <FullscreenEntry />
            </Menu.Group>

            <InstallEntry />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
