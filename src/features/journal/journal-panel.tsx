import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "../../design/cn.ts";
import { ScrollPanel } from "../../design/scroll-panel.tsx";
import { FOCUS_RING } from "../../design/styles.ts";
import { type JournalTab, useInterfaceStore } from "../interface/interface-store.ts";
import { RelationList } from "../rivalry/relation-list.tsx";
import { ChronicleList } from "./chronicle-list.tsx";
import { TribeList } from "./tribe-list.tsx";

const TABS: readonly { readonly label: string; readonly value: JournalTab }[] = [
  { label: "Tribes", value: "tribes" },
  { label: "Relations", value: "relations" },
  { label: "Chronicle", value: "chronicle" },
];

function isJournalTab(value: unknown): value is JournalTab {
  return TABS.some((tab) => tab.value === value);
}

function JournalTabButton({ label, value }: { readonly label: string; readonly value: JournalTab }) {
  return (
    <Tabs.Tab
      className={cn(
        FOCUS_RING,
        "text-ink-soft hover:text-ink data-active:text-ink h-8 flex-1 rounded-full px-3 text-sm font-semibold transition-colors data-active:bg-white pointer-coarse:h-10"
      )}
      value={value}
    >
      {label}
    </Tabs.Tab>
  );
}

function ScrollingPanel({ children, value }: { readonly children: ReactNode; readonly value: JournalTab }) {
  return (
    <Tabs.Panel className="flex min-h-0 flex-1 flex-col outline-none" value={value}>
      <ScrollPanel>{children}</ScrollPanel>
    </Tabs.Panel>
  );
}

function useJournalTab() {
  const journalTab = useInterfaceStore((state) => state.journalTab);
  const setJournalTab = useInterfaceStore((state) => state.setJournalTab);

  function handleTabChange(value: unknown): void {
    if (isJournalTab(value)) {
      setJournalTab(value);
    }
  }

  return { handleTabChange, journalTab };
}

export function JournalPanel() {
  const { handleTabChange, journalTab } = useJournalTab();

  return (
    <Tabs.Root className="flex min-h-0 flex-1 flex-col gap-2" onValueChange={handleTabChange} value={journalTab}>
      <Tabs.List aria-label="Journal" className="bg-ink/8 flex gap-1 rounded-full p-1">
        {TABS.map((tab) => (
          <JournalTabButton key={tab.value} label={tab.label} value={tab.value} />
        ))}
      </Tabs.List>

      <ScrollingPanel value="tribes">
        <TribeList />
      </ScrollingPanel>

      <ScrollingPanel value="relations">
        <RelationList />
      </ScrollingPanel>

      <ScrollingPanel value="chronicle">
        <ChronicleList />
      </ScrollingPanel>
    </Tabs.Root>
  );
}
