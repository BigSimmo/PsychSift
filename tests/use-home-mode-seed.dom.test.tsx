/** @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReadonlyURLSearchParams } from "next/navigation";

import { useHomeModeSeed } from "@/components/clinical-dashboard/use-home-mode-seed";
import type { AppModeId } from "@/lib/app-modes";

function params(search: string) {
  return new URLSearchParams(search) as unknown as ReadonlyURLSearchParams;
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function renderSeed({
  search,
  previousSearch,
  currentMode,
  changedFromUi,
}: {
  search: string;
  previousSearch: string;
  currentMode: AppModeId;
  changedFromUi: boolean;
}) {
  const modeChangeFromUiRef = { current: changedFromUi };
  const searchModeRef = { current: currentMode };
  const lastSyncedSearchParamsRef = { current: previousSearch };
  const setSearchMode = vi.fn();
  const setModeSearchSubmitted = vi.fn();
  renderHook(() =>
    useHomeModeSeed({
      pathname: "/",
      searchParams: params(search),
      lastAppMode: "answer",
      setSearchMode,
      setQuery: vi.fn(),
      setQueryMode: vi.fn(),
      setScopeFilters: vi.fn(),
      setModeSearchSubmitted,
      setLoading: vi.fn(),
      setError: vi.fn(),
      setAnswerProgress: vi.fn(),
      clearModeResultState: vi.fn(),
      focusComposerInput: vi.fn(),
      stopSearch: vi.fn(),
      modeChangeFromUiRef,
      searchModeRef,
      lastSyncedSearchParamsRef,
    }),
  );
  return { modeChangeFromUiRef, setSearchMode, setModeSearchSubmitted };
}

describe("useHomeModeSeed ?mode= sync and the UI-change flag", () => {
  it("lets the URL own the mode when nothing flagged the change", async () => {
    const { setSearchMode, modeChangeFromUiRef } = renderSeed({
      search: "mode=documents",
      previousSearch: "mode=answer",
      currentMode: "answer",
      changedFromUi: false,
    });
    await waitFor(() => expect(setSearchMode).toHaveBeenCalledWith("documents"));
    expect(modeChangeFromUiRef.current).toBe(false);
  });

  it("skips the reset for a flagged change whose URL names the mode the UI already set", async () => {
    const { setSearchMode, setModeSearchSubmitted, modeChangeFromUiRef } = renderSeed({
      search: "mode=documents&q=lithium",
      previousSearch: "mode=answer",
      currentMode: "documents",
      changedFromUi: true,
    });
    await nextFrame();
    await nextFrame();
    expect(setSearchMode).not.toHaveBeenCalled();
    expect(setModeSearchSubmitted).not.toHaveBeenCalled();
    expect(modeChangeFromUiRef.current).toBe(false);
  });

  it("does not let a stale flag swallow a navigation to a different mode", async () => {
    // Regression: an answer submission raised the flag and moved the URL to a
    // run=1 result, which the sync ignored without consuming the flag. The next
    // sidebar shortcut then rewrote the URL to Documents and was skipped —
    // header, highlight and answer all stayed on Answer.
    const { setSearchMode, modeChangeFromUiRef } = renderSeed({
      search: "mode=documents",
      previousSearch: "mode=answer&q=lithium+dosing&run=1",
      currentMode: "answer",
      changedFromUi: true,
    });
    await waitFor(() => expect(setSearchMode).toHaveBeenCalledWith("documents"));
    expect(modeChangeFromUiRef.current).toBe(false);
  });

  it("consumes the flag on a run=1 result URL instead of carrying it forward", async () => {
    const { setSearchMode, modeChangeFromUiRef } = renderSeed({
      search: "mode=answer&q=lithium+dosing&run=1",
      previousSearch: "mode=answer",
      currentMode: "answer",
      changedFromUi: true,
    });
    await nextFrame();
    await nextFrame();
    expect(setSearchMode).not.toHaveBeenCalled();
    expect(modeChangeFromUiRef.current).toBe(false);
  });
});

describe("useHomeModeSeed cold / seeding", () => {
  it("restores the remembered mode on a hydrated cold load of /", async () => {
    // The real store is useSyncExternalStore with a server snapshot of the
    // default mode, so the hydration commit sees "answer" and only the next
    // render carries the stored mode.
    const replaceState = vi.spyOn(window.history, "replaceState");
    const subscribeNothing = () => () => undefined;
    renderHook(
      () => {
        const lastAppMode = useSyncExternalStore<AppModeId>(
          subscribeNothing,
          () => "prescribing",
          () => "answer",
        );
        useHomeModeSeed({
          pathname: "/",
          searchParams: params(""),
          lastAppMode,
          setSearchMode: vi.fn(),
          setQuery: vi.fn(),
          setQueryMode: vi.fn(),
          setScopeFilters: vi.fn(),
          setModeSearchSubmitted: vi.fn(),
          setLoading: vi.fn(),
          setError: vi.fn(),
          setAnswerProgress: vi.fn(),
          clearModeResultState: vi.fn(),
          focusComposerInput: vi.fn(),
          stopSearch: vi.fn(),
          modeChangeFromUiRef: { current: false },
          searchModeRef: { current: "answer" },
          lastSyncedSearchParamsRef: { current: "" },
        });
      },
      { hydrate: true },
    );
    await waitFor(() => expect(replaceState).toHaveBeenCalledWith(null, "", "/?mode=prescribing"));
    replaceState.mockRestore();
  });
});
