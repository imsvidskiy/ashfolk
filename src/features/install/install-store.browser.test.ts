import { describe, expect, it, onTestFinished, vi } from "vitest";
import { offerInstall } from "../testing/install-fixtures.ts";
import { connectInstall, useInstallStore } from "./install-store.ts";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0";

function pretendToBeIphone(userAgent: string): void {
  Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

  onTestFinished(() => {
    Reflect.deleteProperty(navigator, "standalone");
  });
}

describe("install store", () => {
  it("forgets the offer once the app is installed", () => {
    onTestFinished(connectInstall(window));

    offerInstall();
    window.dispatchEvent(new Event("appinstalled"));

    expect(useInstallStore.getState().prompt).toBeNull();
  });

  it("offers the home screen guide in Safari on iPhone", () => {
    pretendToBeIphone(IPHONE_SAFARI);

    onTestFinished(connectInstall(window));

    expect(useInstallStore.getState().isGuideNeeded).toBe(true);
  });

  it("offers no home screen guide in an app's own browser", () => {
    pretendToBeIphone(IPHONE_INSTAGRAM);

    onTestFinished(connectInstall(window));

    expect(useInstallStore.getState().isGuideNeeded).toBe(false);
  });
});
