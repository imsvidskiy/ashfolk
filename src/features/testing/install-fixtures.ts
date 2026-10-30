import { vi } from "vitest";

export function offerInstall() {
  const prompt = vi.fn(() => {
    return Promise.resolve();
  });
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });

  window.dispatchEvent(event);

  return { event, prompt };
}
