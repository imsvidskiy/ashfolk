import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChronicleEntry } from "../../simulation/chronicle.ts";
import type { SimulationFrame } from "../../simulation/frame.ts";
import { createListeners } from "../testing/listener-fixtures.ts";
import { createChronicleEntry, createFrame, resetWorld } from "../testing/world-fixtures.ts";
import { connectWorldStore, dismissNotice, useWorldStore, type WorldFeed } from "./world-store.ts";

interface FakeFeed extends WorldFeed {
  readonly emit: (frame: SimulationFrame) => void;
  readonly listenerCount: () => number;
}

interface FeedOptions {
  readonly chronicle?: readonly ChronicleEntry[];
  readonly frame?: SimulationFrame;
}

function createFeed({ chronicle = [], frame = createFrame() }: FeedOptions = {}): FakeFeed {
  const frames = createListeners<SimulationFrame>();
  const entries = [...chronicle];
  let latest = frame;

  function emit(next: SimulationFrame): void {
    latest = next;
    entries.push(...next.chronicle);
    frames.emit(next);
  }

  return {
    chronicle: entries,
    emit,
    get frame() {
      return latest;
    },
    listenerCount: frames.listenerCount,
    subscribe: frames.subscribe,
  };
}

function noticeTexts(): string[] {
  return useWorldStore.getState().notices.map((notice) => {
    return notice.text;
  });
}

describe("world store", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetWorld();
  });

  it("starts from the chronicle and the current frame of the feed", () => {
    const entry = createChronicleEntry();
    const frame = createFrame({ isPaused: true, speed: 4 });

    connectWorldStore(createFeed({ chronicle: [entry], frame }));

    const state = useWorldStore.getState();

    expect(state.chronicle).toEqual([entry]);
    expect(state.notices).toEqual([]);
    expect(state.snapshot).toEqual({
      calendar: frame.calendar,
      inspection: null,
      isPaused: true,
      rivalry: frame.rivalry,
      rules: frame.rules,
      speed: 4,
      tribes: frame.tribes,
      weather: frame.weather,
    });
  });

  it("refreshes the snapshot at most every 125 milliseconds while nothing happens", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ speed: 2 }));
    clock.mockReturnValue(1100);
    feed.emit(createFrame({ speed: 4 }));

    expect(useWorldStore.getState().snapshot?.speed).toBe(2);

    clock.mockReturnValue(1125);
    feed.emit(createFrame({ speed: 8 }));

    expect(useWorldStore.getState().snapshot?.speed).toBe(8);
  });

  it("shows the latest throttled frame once the throttle window ends", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame());
    clock.mockReturnValue(1010);
    feed.emit(createFrame({ isPaused: true }));

    expect(useWorldStore.getState().snapshot?.isPaused).toBe(false);

    clock.mockReturnValue(1125);
    vi.advanceTimersByTime(125);

    expect(useWorldStore.getState().snapshot?.isPaused).toBe(true);
  });

  it("drops the pending refresh after disconnecting", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const feed = createFeed();

    const disconnect = connectWorldStore(feed);

    feed.emit(createFrame());
    clock.mockReturnValue(1010);
    feed.emit(createFrame({ isPaused: true }));
    disconnect();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes at once when a frame brings news", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ speed: 2 }));
    clock.mockReturnValue(1010);
    feed.emit(createFrame({ notices: ["Rain is coming."], speed: 4 }));

    expect(useWorldStore.getState().snapshot?.speed).toBe(4);
  });

  it("keeps the rules object while the rules stay the same", () => {
    const frame = createFrame();
    const feed = createFeed({ frame });

    connectWorldStore(feed);
    feed.emit(createFrame({ notices: ["Rain is coming."], rules: structuredClone(frame.rules) }));

    expect(useWorldStore.getState().snapshot?.rules).toBe(frame.rules);

    const bolder = { ...frame.rules, nature: { ...frame.rules.nature, beastBoldness: 2 } };

    feed.emit(createFrame({ notices: ["Wolves grow bold."], rules: bolder }));

    expect(useWorldStore.getState().snapshot?.rules).toBe(bolder);
  });

  it("copies the chronicle of the feed when new entries arrive", () => {
    const entry = createChronicleEntry({ category: "birth", text: "A child is born to the Bear Clan." });
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ chronicle: [entry] }));

    expect(useWorldStore.getState().chronicle).toEqual([entry]);
  });

  it("turns plain notices into notices", () => {
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ notices: ["Rain is coming."] }));

    expect(useWorldStore.getState().notices).toEqual([
      { category: "notice", id: expect.any(Number), text: "Rain is coming." },
    ]);
  });

  it("announces arrivals, discoveries, splits and warnings from the chronicle", () => {
    const feed = createFeed();
    const chronicle = [
      createChronicleEntry({ category: "arrival", id: 1, text: "The Bear Clan arrives." }),
      createChronicleEntry({ category: "birth", id: 2, text: "A child is born." }),
      createChronicleEntry({ category: "discovery", id: 3, text: "The Bear Clan learns to make fire." }),
      createChronicleEntry({ category: "death", id: 4, text: "An elder dies." }),
      createChronicleEntry({ category: "split", id: 5, text: "The Fox Clan leaves the Bear Clan." }),
      createChronicleEntry({ category: "warning", id: 6, text: "The Wolf Clan is starving." }),
    ];

    connectWorldStore(feed);
    feed.emit(createFrame({ chronicle }));

    const announced = useWorldStore.getState().notices.map((notice) => {
      return [notice.category, notice.text];
    });

    expect(announced).toEqual([
      ["arrival", "The Bear Clan arrives."],
      ["discovery", "The Bear Clan learns to make fire."],
      ["split", "The Fox Clan leaves the Bear Clan."],
      ["warning", "The Wolf Clan is starving."],
    ]);
  });

  it("announces feuds, raids, peace and attacks by beasts", () => {
    const feed = createFeed();
    const chronicle = [
      createChronicleEntry({ category: "feud", id: 1, text: "The Bear Clan and the Wolf Clan became enemies." }),
      createChronicleEntry({ category: "raid", id: 2, text: "The Wolf Clan raided the Bear Clan." }),
      createChronicleEntry({ category: "death", id: 3, text: "Ara of the Bear Clan fell to the raiders." }),
      createChronicleEntry({ category: "peace", id: 4, text: "The Bear Clan and the Wolf Clan made peace." }),
      createChronicleEntry({ category: "beast", id: 5, text: "Wolves attacked Tor near the river." }),
    ];

    connectWorldStore(feed);
    feed.emit(createFrame({ chronicle }));

    expect(
      useWorldStore.getState().notices.map((notice) => {
        return notice.category;
      })
    ).toEqual(["feud", "raid", "peace", "beast"]);
  });

  it("puts plain notices before the announced chronicle entries of the same frame", () => {
    const feed = createFeed();
    const arrival = createChronicleEntry({ category: "arrival", text: "The Bear Clan arrives." });

    connectWorldStore(feed);
    feed.emit(createFrame({ chronicle: [arrival], notices: ["Rain is coming."] }));

    expect(noticeTexts()).toEqual(["Rain is coming.", "The Bear Clan arrives."]);
  });

  it("keeps only the four latest notices", () => {
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ notices: ["First", "Second"] }));
    feed.emit(createFrame({ notices: ["Third", "Fourth"] }));
    feed.emit(createFrame({ notices: ["Fifth", "Sixth"] }));

    expect(noticeTexts()).toEqual(["Third", "Fourth", "Fifth", "Sixth"]);
  });

  it("gives every notice its own id", () => {
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ notices: ["First", "Second", "Third"] }));

    const noticeIds = useWorldStore.getState().notices.map((notice) => {
      return notice.id;
    });

    expect(new Set(noticeIds).size).toBe(noticeIds.length);
  });

  it("stops listening after disconnecting", () => {
    const feed = createFeed();

    const disconnect = connectWorldStore(feed);

    disconnect();
    feed.emit(createFrame({ notices: ["Nobody hears this."] }));

    expect(feed.listenerCount()).toBe(0);
    expect(useWorldStore.getState().notices).toEqual([]);
  });

  it("dismisses one notice and keeps the others", () => {
    const feed = createFeed();

    connectWorldStore(feed);
    feed.emit(createFrame({ notices: ["First", "Second"] }));

    const [first] = useWorldStore.getState().notices;

    if (first === undefined) {
      throw new Error("Expected a notice to dismiss");
    }

    dismissNotice(first.id);

    expect(noticeTexts()).toEqual(["Second"]);
  });
});
