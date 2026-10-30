import { BookOpen, Map as MapIcon, Maximize2, Minimize2, Settings } from "lucide-react";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { WithTooltip } from "../../design/tooltip.tsx";
import { useSidePanel } from "../journal/use-side-panel.ts";
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
  const { canGoFullscreen, isFullscreen, toggleFullscreen } = useFullscreen();

  if (!canGoFullscreen) {
    return null;
  }

  const label = isFullscreen ? "Leave full screen" : "Full screen";
  const Icon = isFullscreen ? Minimize2 : Maximize2;

  return (
    <WithTooltip content={label} side="bottom">
      <IconButton icon={<Icon aria-hidden="true" size={18} />} label={label} onClick={toggleFullscreen} />
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

      <WithTooltip content="World, weather, time and graphics" side="bottom">
        <IconButton icon={<Settings aria-hidden="true" size={18} />} label="Settings" onClick={openSettings} />
      </WithTooltip>

      <FullscreenButton />
    </nav>
  );
}
