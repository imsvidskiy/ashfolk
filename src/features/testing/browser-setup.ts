import "../../styles.css";
import type {} from "@vitest/browser/matchers";
import { afterEach, beforeEach, vi } from "vitest";
import { useEngineStore } from "../../app/engine-store.ts";
import { useLaunchStore } from "../../app/launch-store.ts";
import { useGuideStore } from "../guide/guide-store.ts";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { usePowerStore } from "../powers/power-store.ts";
import { useStarStore } from "../project/github-stars.ts";
import { useSavesStore } from "../saves/saves-store.ts";
import { useWorldStore } from "../world/world-store.ts";

const initialEngine = useEngineStore.getState();
const initialLaunch = useLaunchStore.getState();
const initialGuide = useGuideStore.getState();
const initialInterface = useInterfaceStore.getState();
const initialPowers = usePowerStore.getState();
const initialSaves = useSavesStore.getState();
const initialWorld = useWorldStore.getState();
const initialStars = useStarStore.getState();
const initialAddress = window.location.href;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      return Promise.resolve(new Response(null, { status: 503 }));
    })
  );
});

afterEach(() => {
  useEngineStore.setState(initialEngine, true);
  useLaunchStore.setState(initialLaunch, true);
  useGuideStore.setState(initialGuide, true);
  useInterfaceStore.setState(initialInterface, true);
  usePowerStore.setState(initialPowers, true);
  useSavesStore.setState(initialSaves, true);
  useWorldStore.setState(initialWorld, true);
  useStarStore.setState(initialStars, true);

  localStorage.clear();

  window.history.replaceState(null, "", initialAddress);

  vi.useRealTimers();
  vi.unstubAllGlobals();
});
