import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { TimeControls } from "../time/time-controls.tsx";
import { CompactClock, WorldStatus } from "../time/world-status.tsx";
import { CompactMenu } from "./compact-menu.tsx";
import { MenuButtons } from "./menu-buttons.tsx";

const BAR_CLASS = "flex h-12 pointer-coarse:h-13 items-center";

export function StatusCard() {
  return (
    <Island>
      <header className="flex flex-col gap-3 p-3">
        <WorldStatus />

        <TimeControls />
      </header>
    </Island>
  );
}

export function PanelBar() {
  return <MenuButtons className="max-w-full justify-end" />;
}

export function CompactTopBar() {
  return (
    <header className="flex items-start gap-2">
      <Island className="min-w-0 flex-1">
        <div className={cn(BAR_CLASS, "gap-2 pr-2 pl-3")}>
          <CompactClock />

          <TimeControls />
        </div>
      </Island>

      <Island className="shrink-0">
        <div className={cn(BAR_CLASS, "justify-center px-1")}>
          <CompactMenu />
        </div>
      </Island>
    </header>
  );
}
