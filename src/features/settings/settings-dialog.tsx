import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Tabs } from "@base-ui/react/tabs";
import { X } from "lucide-react";
import type { ComponentType } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { SEGMENT, SEGMENT_TRACK } from "../../design/styles.ts";
import { FilmingSection } from "../filming/filming-section.tsx";
import { type SettingsTab, useInterfaceStore } from "../interface/interface-store.ts";
import { ProjectLinks } from "../project/project-links.tsx";
import { IslandSection } from "./island-section.tsx";
import { TimeSection } from "./time-section.tsx";
import { WeatherSection } from "./weather-section.tsx";
import { WorldRulesSection } from "./world-rules-section.tsx";

interface SettingsSection {
  readonly Content: ComponentType;
  readonly label: string;
  readonly value: SettingsTab;
}

const DEVELOPER_SECTIONS: readonly SettingsSection[] = import.meta.env.DEV
  ? [{ Content: FilmingSection, label: "Dev", value: "developer" }]
  : [];

const SECTIONS: readonly SettingsSection[] = [
  { Content: WorldRulesSection, label: "World", value: "world" },
  { Content: WeatherSection, label: "Weather", value: "weather" },
  { Content: TimeSection, label: "Time", value: "time" },
  { Content: IslandSection, label: "Island", value: "island" },
  ...DEVELOPER_SECTIONS,
];

function isSettingsTab(value: unknown): value is SettingsTab {
  return SECTIONS.some((section) => {
    return section.value === value;
  });
}

function SectionTab({ section }: { readonly section: SettingsSection }) {
  return (
    <Tabs.Tab className={cn(SEGMENT, "flex-1 text-sm pointer-coarse:h-10")} value={section.value}>
      {section.label}
    </Tabs.Tab>
  );
}

function SectionPanel({ section }: { readonly section: SettingsSection }) {
  const { Content } = section;

  return (
    <Tabs.Panel className="outline-none" value={section.value}>
      <Content />
    </Tabs.Panel>
  );
}

function useSettingsDialog() {
  const isSettingsOpen = useInterfaceStore((state) => {
    return state.isSettingsOpen;
  });
  const setSettingsOpen = useInterfaceStore((state) => {
    return state.setSettingsOpen;
  });
  const settingsTab = useInterfaceStore((state) => {
    return state.settingsTab;
  });
  const setSettingsTab = useInterfaceStore((state) => {
    return state.setSettingsTab;
  });
  const worldName = useLaunchStore((state) => {
    return state.launch.name;
  });

  function handleTabChange(value: unknown): void {
    if (isSettingsTab(value)) {
      setSettingsTab(value);
    }
  }

  return { handleTabChange, isSettingsOpen, setSettingsOpen, settingsTab, worldName };
}

export function SettingsDialog() {
  const { handleTabChange, isSettingsOpen, setSettingsOpen, settingsTab, worldName } = useSettingsDialog();

  return (
    <Dialog.Root onOpenChange={setSettingsOpen} open={isSettingsOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="bg-ink/12 fixed inset-0 z-40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />

        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center px-3 pt-(--dialog-inset-top) pb-(--dialog-inset-bottom)">
          <Dialog.Popup className="w-dialog ease-glide transition-[scale,opacity] duration-200 outline-none data-ending-style:scale-97 data-ending-style:opacity-0 data-starting-style:scale-97 data-starting-style:opacity-0">
            <Island className="max-h-dialog flex flex-col">
              <Tabs.Root className="flex min-h-0 flex-col" onValueChange={handleTabChange} value={settingsTab}>
                <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 sm:px-6">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Dialog.Title className="text-ink text-lg leading-tight font-semibold">Settings</Dialog.Title>

                    <Dialog.Description className="text-ink-soft text-sm">
                      Shape how the world of {worldName} behaves.
                    </Dialog.Description>
                  </div>

                  <Dialog.Close
                    render={
                      <IconButton
                        className="-mt-1.5 -mr-2 size-9 pointer-coarse:size-10"
                        icon={<X aria-hidden="true" size={18} />}
                        label="Close settings"
                      />
                    }
                  />
                </div>

                <Tabs.List aria-label="Settings sections" className={cn(SEGMENT_TRACK, "mx-5 mb-3 sm:mx-6")}>
                  {SECTIONS.map((section) => {
                    return <SectionTab key={section.value} section={section} />;
                  })}
                </Tabs.List>

                <ScrollArea.Root className="flex min-h-0 flex-auto flex-col">
                  <ScrollArea.Viewport className="scroll-fade relative min-h-0 flex-auto overscroll-contain px-5 pt-2 pb-5 outline-none sm:px-6">
                    {SECTIONS.map((section) => {
                      return <SectionPanel key={section.value} section={section} />;
                    })}
                  </ScrollArea.Viewport>

                  <ScrollArea.Scrollbar className="mr-1 mb-4 w-1 rounded-full opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100">
                    <ScrollArea.Thumb className="bg-ink/25 w-full rounded-full" />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
              </Tabs.Root>

              <ProjectLinks className="border-paper-edge border-t px-3 py-2" />
            </Island>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
