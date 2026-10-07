/** @vitest-environment jsdom */

// Set up Work's progress is this account's, not the device's: every account
// transition (sign-out, expiry, another user) removes it, and the open store
// forgets it at once, so the next doctor on a shared phone starts fresh.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { clearAccountScopedBrowserStorage, WORK_SETUP_PROGRESS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { INITIAL_WORK_SETUP_PROGRESS, serialiseWorkSetupProgress } from "@/lib/work-setup/progress";

const STORED = serialiseWorkSetupProgress({
  status: "in-progress",
  step: "roster",
  areas: ["rost", "teach"],
  completed: ["stage", "areas"],
  skipped: ["time-zone"],
});

beforeEach(() => {
  window.localStorage.clear();
});

describe("account transition and Set up Work progress", () => {
  it("removes the stored progress", () => {
    window.localStorage.setItem(WORK_SETUP_PROGRESS_STORAGE_KEY, STORED);
    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(WORK_SETUP_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it("the open store drops the progress at once", () => {
    window.localStorage.setItem(WORK_SETUP_PROGRESS_STORAGE_KEY, STORED);
    const { result } = renderHook(() => useWorkSetupProgress());
    expect(result.current.progress.step).toBe("roster");
    act(() => clearAccountScopedBrowserStorage());
    expect(result.current.progress).toEqual(INITIAL_WORK_SETUP_PROGRESS);
  });
});
