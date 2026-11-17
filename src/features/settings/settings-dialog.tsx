import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import {
  Camera,
  ChevronDown,
  Clock3,
  CloudSun,
  FolderOpen,
  MapPin,
  SlidersHorizontal,
  Sprout,
  Volume2,
  X,
} from "lucide-react";
import type { ChangeEvent } from "react";
import { useLaunchStore } from "../../app/launch-store.ts";
import { IconButton } from "../../design/buttons.tsx";
import { cn } from "../../design/cn.ts";
import { Island } from "../../design/island.tsx";
import { DIALOG_BACKDROP, DIALOG_POPUP, DIALOG_VIEWPORT, FOCUS_RING } from "../../design/styles.ts";
import { useIsCompact } from "../../design/use-media-query.ts";
import { FilmingSection } from "../filming/filming-section.tsx";
import { type SettingsTab, useInterfaceStore } from "../interface/interface-store.ts";
import { useSavesStore } from "../saves/saves-store.ts";
import { GeneralSection } from "./general-section.tsx";
import { IslandSection } from "./island-section.tsx";
import { SoundSection } from "./sound-section.tsx";
import { TimeSection } from "./time-section.tsx";
import { WeatherSection } from "./weather-section.tsx";
import { WorldRulesSection } from "./world-rules-section.tsx";

const SECTIONS = {
  general: { Content: GeneralSection, Icon: SlidersHorizontal, label: "General" },
  island: { Content: IslandSection, Icon: FolderOpen, label: "Island & saves" },
  photo: { Content: FilmingSection, Icon: Camera, label: "Photo mode" },
  sound: { Content: SoundSection, Icon: Volume2, label: "Sound" },
  time: { Content: TimeSection, Icon: Clock3, label: "Time & seasons" },
  weather: { Content: WeatherSection, Icon: CloudSun, label: "Weather" },
  world: { Content: WorldRulesSection, Icon: Sprout, label: "World rules" },
};

const GROUPS: readonly { readonly label: string; readonly tabs: readonly SettingsTab[] }[] = [
  { label: "Preferences", tabs: ["general", "sound", "photo"] },
  { label: "This island", tabs: ["island", "time", "weather", "world"] },
];

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && Object.hasOwn(SECTIONS, value);
}

function selectSection(value: unknown): void {
  if (isSettingsTab(value)) {
    useInterfaceStore.getState().setSettingsTab(value);
  }
}

function handleSectionChange(event: ChangeEvent<HTMLSelectElement>): void {
  selectSection(event.currentTarget.value);
}

function SectionTabs() {
  return (
    <Tabs.List
      aria-label="Settings sections"
      className="border-line bg-canvas/60 flex w-48 shrink-0 flex-col gap-5 overflow-y-auto border-r p-3"
    >
      {GROUPS.map((group) => {
        return (
          <div className="flex flex-col gap-1" key={group.label}>
            <span className="text-ink-muted px-3 pb-1 text-xs font-bold">{group.label}</span>

            {group.tabs.map((tab) => {
              const { Icon, label } = SECTIONS[tab];

              return (
                <Tabs.Tab
                  className={cn(
                    FOCUS_RING,
                    "text-ink-soft hover:bg-paper-hover data-active:bg-dawn-soft data-active:text-dawn-strong flex h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold"
                  )}
                  key={tab}
                  value={tab}
                >
                  <Icon aria-hidden="true" size={17} />

                  {label}
                </Tabs.Tab>
              );
            })}
          </div>
        );
      })}
    </Tabs.List>
  );
}

function SectionSelect({ tab }: { readonly tab: SettingsTab }) {
  const { Icon } = SECTIONS[tab];

  return (
    <div className="bg-canvas relative mx-4 mt-3 rounded-xl">
      <Icon
        aria-hidden="true"
        className="text-dawn-strong pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        size={17}
      />

      <select
        aria-label="Settings section"
        className={cn(
          FOCUS_RING,
          "h-11 w-full appearance-none rounded-xl bg-transparent pr-10 pl-10 text-sm font-semibold"
        )}
        onChange={handleSectionChange}
        value={tab}
      >
        {GROUPS.map((group) => {
          return (
            <optgroup key={group.label} label={group.label}>
              {group.tabs.map((value) => {
                return (
                  <option key={value} value={value}>
                    {SECTIONS[value].label}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </select>

      <ChevronDown
        aria-hidden="true"
        className="text-ink-soft pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
        size={17}
      />
    </div>
  );
}

function SettingsBody() {
  const isCompact = useIsCompact();
  const tab = useInterfaceStore((state) => {
    return state.settingsTab;
  });
  const { Content, label } = SECTIONS[tab];

  if (isCompact) {
    return (
      <>
        <SectionSelect tab={tab} />

        <section aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" key={tab}>
          <Content />
        </section>
      </>
    );
  }

  return (
    <Tabs.Root className="flex min-h-0 flex-1" onValueChange={selectSection} orientation="vertical" value={tab}>
      <SectionTabs />

      <Tabs.Panel className="min-w-0 flex-1 overflow-y-auto overscroll-contain p-6 outline-none" key={tab} value={tab}>
        <h2 className="text-ink mb-5 text-xl font-bold">{label}</h2>

        <div>
          <Content />
        </div>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

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
              <header className="border-line flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
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

              <SettingsBody />
            </Island>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
