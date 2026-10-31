import { BookOpen, Download, Map as MapIcon, Maximize2, Minimize2, Settings, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { WithTooltip } from "../../design/tooltip.tsx";
import { useInstall } from "../install/install-store.ts";
import { useSidePanel } from "../journal/use-side-panel.ts";
import { useSoundToggle } from "../sound/use-sound-toggle.ts";
import { useInterfaceStore } from "./interface-store.ts";
import { useFullscreen } from "./use-fullscreen.ts";

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
  const { canGoFullscreen, isFullscreen, label, toggleFullscreen } = useFullscreen();

  if (!canGoFullscreen) {
    return null;
  }

  const Icon = isFullscreen ? Minimize2 : Maximize2;

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
    <WithTooltip content="Play from your home screen or desktop" side="bottom">
      <IconButton icon={<Download aria-hidden="true" size={18} />} label="Install the app" onClick={install} />
    </WithTooltip>
  );
}

function SoundButton() {
  const { isMuted, label, toggleSound } = useSoundToggle();

  const Icon = isMuted ? VolumeX : Volume2;

  return (
    <WithTooltip content={label} side="bottom">
      <IconButton icon={<Icon aria-hidden="true" size={18} />} label={label} onClick={toggleSound} />
    </WithTooltip>
  );
}

export function MenuButtons({ className }: { readonly className?: string | undefined }) {
  const { isJournalOpen, isMapOpen, openSettings, toggleJournal, toggleMap } = useMenuActions();

  return (
    <nav aria-label="Panels" className={cn("flex items-center gap-1", className)}>
      <WithTooltip content="Tribes, relations and chronicle" side="bottom">
        <IconButton
          icon={<BookOpen aria-hidden="true" size={18} />}
          isPressed={isJournalOpen}
          label="Journal"
          onClick={toggleJournal}
        />
      </WithTooltip>

      <WithTooltip content="Map of the island" side="bottom">
        <IconButton
          icon={<MapIcon aria-hidden="true" size={18} />}
          isPressed={isMapOpen}
          label="Map"
          onClick={toggleMap}
        />
      </WithTooltip>

      <SoundButton />

      <WithTooltip content="World, weather, time, graphics and sound" side="bottom">
        <IconButton icon={<Settings aria-hidden="true" size={18} />} label="Settings" onClick={openSettings} />
      </WithTooltip>

      <InstallButton />

      <FullscreenButton />
    </nav>
  );
}
