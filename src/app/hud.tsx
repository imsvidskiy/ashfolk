import { cn } from "../design/cn.ts";
import { Island } from "../design/island.tsx";
import { useIsCompact } from "../design/use-media-query.ts";
import { FilmingHint } from "../features/filming/filming-hint.tsx";
import { useFilming } from "../features/filming/use-filming.ts";
import { GuideCard } from "../features/guide/guide-card.tsx";
import { InstallGuideDialog } from "../features/install/install-guide-dialog.tsx";
import { CompactTopBar, PanelBar, StatusCard } from "../features/interface/top-bar.tsx";
import { JournalSheet } from "../features/journal/journal-sheet.tsx";
import { SidePanel } from "../features/journal/side-panel.tsx";
import { WorldLabels } from "../features/labels/world-labels.tsx";
import { MinimapIsland } from "../features/minimap/minimap-island.tsx";
import { NoticeFeed } from "../features/notices/notice-feed.tsx";
import { PowerDock } from "../features/powers/power-dock.tsx";
import { PowerSettings } from "../features/powers/power-settings.tsx";
import { ProjectLinks } from "../features/project/project-links.tsx";
import { LandChangedDialog } from "../features/saves/land-changed-dialog.tsx";
import { SettingsDialog } from "../features/settings/settings-dialog.tsx";
import { useEngineBridges } from "./use-engine-bridges.ts";

const HUD_FRAME = "pointer-events-none fixed inset-0 z-10 flex flex-col p-safe";

function WideHud() {
  return (
    <div className={cn(HUD_FRAME, "gap-3")}>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
          <StatusCard />

          <NoticeFeed className="items-start" />
        </div>

        <div className="grid min-h-0 grid-rows-[auto_minmax(12rem,1fr)_minmax(0,auto)] justify-items-end gap-3">
          <PanelBar />

          <SidePanel />

          <PowerSettings className="max-h-full w-72 self-center" />
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex min-w-fit flex-1">
          <MinimapIsland />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <GuideCard className="w-0 min-w-full" />

          <PowerDock className="max-w-full min-w-0" />
        </div>

        <div className="flex flex-1 justify-end">
          <Island className="px-1.5 py-1">
            <ProjectLinks hasPrivacy={false} />
          </Island>
        </div>
      </div>
    </div>
  );
}

function CompactHud() {
  return (
    <div className={cn(HUD_FRAME, "gap-2")}>
      <CompactTopBar />

      <NoticeFeed />

      <div className="mt-auto flex min-h-0 flex-col gap-2">
        <MinimapIsland className="self-start" />

        <PowerSettings className="max-h-details min-h-0" />

        <GuideCard />

        <PowerDock />
      </div>

      <JournalSheet />
    </div>
  );
}

function HudPanels({ isCompact }: { readonly isCompact: boolean }) {
  return isCompact ? <CompactHud /> : <WideHud />;
}

export function Hud() {
  useEngineBridges();

  const isCompact = useIsCompact();
  const { areMarkersHidden, isInterfaceHidden } = useFilming();

  return (
    <>
      {areMarkersHidden ? null : <WorldLabels />}

      {isInterfaceHidden ? null : <HudPanels isCompact={isCompact} />}

      <SettingsDialog />

      <LandChangedDialog />

      <InstallGuideDialog />

      <FilmingHint />
    </>
  );
}
