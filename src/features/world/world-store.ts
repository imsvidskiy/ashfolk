import { create } from "zustand";
import type { WorldRules } from "../../content/world-rules.ts";
import type { ChronicleCategory, ChronicleEntry } from "../../simulation/chronicle.ts";
import type { SimulationFrame, TribeSummary, WeatherView } from "../../simulation/frame.ts";
import type { Inspection } from "../../simulation/inspection.ts";
import type { CalendarView } from "../../simulation/nature/calendar.ts";
import type { RivalryView } from "../../simulation/society/rivalry/rivalry-system.ts";

const REFRESH_MILLISECONDS = 125;
const MAXIMUM_NOTICES = 4;
const NOTICE_MILLISECONDS = 7000;
const ANNOUNCED_CATEGORIES: ReadonlySet<ChronicleCategory> = new Set([
  "arrival",
  "beast",
  "discovery",
  "era",
  "feud",
  "peace",
  "raid",
  "split",
  "warning",
]);

let nextNoticeId = 1;

export interface WorldSnapshot {
  readonly calendar: CalendarView;
  readonly inspection: Inspection | null;
  readonly isPaused: boolean;
  readonly rivalry: RivalryView;
  readonly rules: WorldRules;
  readonly speed: number;
  readonly tribes: readonly TribeSummary[];
  readonly weather: WeatherView;
}

export interface WorldNotice {
  readonly category: ChronicleCategory | "notice";
  readonly expiresAt: number;
  readonly id: number;
  readonly text: string;
}

export interface WorldFeed {
  readonly chronicle: readonly ChronicleEntry[];
  readonly frame: SimulationFrame;
  readonly subscribe: (listener: (frame: SimulationFrame) => void) => () => void;
}

interface WorldStore {
  readonly chronicle: readonly ChronicleEntry[];
  readonly notices: readonly WorldNotice[];
  readonly snapshot: WorldSnapshot | null;
}

export const useWorldStore = create<WorldStore>()(() => {
  return {
    chronicle: [],
    notices: [],
    snapshot: null,
  };
});

function keptRules(previous: WorldSnapshot | null, rules: WorldRules): WorldRules {
  if (previous === null || JSON.stringify(previous.rules) !== JSON.stringify(rules)) {
    return rules;
  }

  return previous.rules;
}

function snapshotOf(frame: SimulationFrame, previous: WorldSnapshot | null): WorldSnapshot {
  return {
    calendar: frame.calendar,
    inspection: frame.inspection,
    isPaused: frame.isPaused,
    rivalry: frame.rivalry,
    rules: keptRules(previous, frame.rules),
    speed: frame.speed,
    tribes: frame.tribes,
    weather: frame.weather,
  };
}

function createNotice(category: WorldNotice["category"], text: string): WorldNotice {
  const notice = { category, expiresAt: performance.now() + NOTICE_MILLISECONDS, id: nextNoticeId, text };

  nextNoticeId += 1;

  return notice;
}

function noticesFrom(frame: SimulationFrame): WorldNotice[] {
  const announced = frame.chronicle
    .filter((entry) => {
      return ANNOUNCED_CATEGORIES.has(entry.category);
    })
    .map((entry) => {
      return createNotice(entry.category, entry.text);
    });

  return [
    ...frame.notices.map((text) => {
      return createNotice("notice", text);
    }),
    ...announced,
  ];
}

export function connectWorldStore(feed: WorldFeed): () => void {
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let trailingRefresh: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleExpiry(): void {
    clearTimeout(expiryTimer);

    const [first] = useWorldStore.getState().notices;

    if (first !== undefined) {
      expiryTimer = setTimeout(expireNotices, Math.max(0, Math.ceil(first.expiresAt - performance.now())));
    }
  }

  function expireNotices(): void {
    const now = performance.now();

    useWorldStore.setState((state) => {
      return {
        notices: state.notices.filter((notice) => {
          return notice.expiresAt > now;
        }),
      };
    });

    scheduleExpiry();
  }

  function refresh(frame: SimulationFrame): void {
    clearTimeout(trailingRefresh);
    trailingRefresh = undefined;
    lastRefresh = performance.now();
    useWorldStore.setState((state) => {
      return { snapshot: snapshotOf(frame, state.snapshot) };
    });
  }

  useWorldStore.setState({
    chronicle: [...feed.chronicle],
    notices: [],
    snapshot: snapshotOf(feed.frame, null),
  });

  const unsubscribe = feed.subscribe((frame) => {
    const now = performance.now();
    const hasNews = frame.chronicle.length > 0 || frame.notices.length > 0;

    if (hasNews) {
      const newNotices = noticesFrom(frame);

      useWorldStore.setState((state) => {
        return {
          chronicle: [...feed.chronicle],
          notices: newNotices.length > 0 ? [...state.notices, ...newNotices].slice(-MAXIMUM_NOTICES) : state.notices,
        };
      });

      if (newNotices.length > 0) {
        scheduleExpiry();
      }
    }

    if (now - lastRefresh < REFRESH_MILLISECONDS && !hasNews) {
      if (trailingRefresh === undefined) {
        trailingRefresh = setTimeout(
          () => {
            refresh(feed.frame);
          },
          lastRefresh + REFRESH_MILLISECONDS - now
        );
      }

      return;
    }

    refresh(frame);
  });

  return () => {
    clearTimeout(trailingRefresh);
    clearTimeout(expiryTimer);

    unsubscribe();
  };
}
