import { create } from "zustand";

interface InstallPrompt extends Event {
  readonly prompt: () => Promise<unknown>;
}

interface InstallStore {
  readonly isGuideNeeded: boolean;
  readonly isGuideOpen: boolean;
  readonly prompt: InstallPrompt | null;
  readonly setGuideOpen: (isOpen: boolean) => void;
}

function isInstallPrompt(event: Event): event is InstallPrompt {
  return "prompt" in event;
}

function canAddToHomeScreen(target: Window): boolean {
  const { navigator } = target;

  return Reflect.get(navigator, "standalone") === false && navigator.userAgent.includes(" Safari/");
}

export const useInstallStore = create<InstallStore>()((set) => {
  return {
    isGuideNeeded: false,
    isGuideOpen: false,
    prompt: null,
    setGuideOpen: (isOpen) => {
      set({ isGuideOpen: isOpen });
    },
  };
});

export function connectInstall(target: Window): () => void {
  const abort = new AbortController();

  useInstallStore.setState({ isGuideNeeded: canAddToHomeScreen(target) });

  target.addEventListener(
    "beforeinstallprompt",
    (event) => {
      if (isInstallPrompt(event)) {
        event.preventDefault();
        useInstallStore.setState({ prompt: event });
      }
    },
    { signal: abort.signal }
  );

  target.addEventListener(
    "appinstalled",
    () => {
      useInstallStore.setState({ isGuideNeeded: false, prompt: null });
    },
    { signal: abort.signal }
  );

  return () => {
    abort.abort();
  };
}

export function useInstall() {
  const isGuideNeeded = useInstallStore((state) => {
    return state.isGuideNeeded;
  });
  const prompt = useInstallStore((state) => {
    return state.prompt;
  });
  const setGuideOpen = useInstallStore((state) => {
    return state.setGuideOpen;
  });

  function install(): void {
    if (prompt === null) {
      setGuideOpen(true);

      return;
    }

    useInstallStore.setState({ prompt: null });
    prompt.prompt().catch((error: unknown) => {
      console.warn("Could not offer to install the app", error);
    });
  }

  return { canInstall: prompt !== null || isGuideNeeded, install };
}
