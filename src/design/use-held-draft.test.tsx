import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { useHeldDraft } from "./use-held-draft.ts";

interface ConfirmedProps {
  readonly confirmed: number;
}

function useDraftOf(props?: ConfirmedProps) {
  if (props === undefined) {
    throw new Error("The test passes the confirmed value as props");
  }

  return useHeldDraft(props.confirmed);
}

describe("held draft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("shows the confirmed value until something is held", async () => {
    const { result } = await renderHook(() => useHeldDraft(4));

    expect(result.current[0]).toBe(4);
  });

  it("shows the held value while the confirmed one lags behind", async () => {
    const { act, result } = await renderHook(useDraftOf, {
      initialProps: { confirmed: 4 },
    });

    await act(() => result.current[1](9));

    expect(result.current[0]).toBe(9);
  });

  it("returns to the confirmed value once the hold expires", async () => {
    const { act, rerender, result } = await renderHook(useDraftOf, {
      initialProps: { confirmed: 4 },
    });

    await act(() => result.current[1](9));
    await rerender({ confirmed: 8 });

    expect(result.current[0]).toBe(9);

    await act(() => vi.advanceTimersByTime(800));

    expect(result.current[0]).toBe(8);
  });

  it("keeps holding while new values keep coming", async () => {
    const { act, result } = await renderHook(() => useHeldDraft(4));

    await act(() => result.current[1](5));
    await act(() => vi.advanceTimersByTime(500));
    await act(() => result.current[1](6));
    await act(() => vi.advanceTimersByTime(500));

    expect(result.current[0]).toBe(6);
  });
});
