/** @vitest-environment jsdom */

// The doctor's self-chosen work stage is a person's, not the device's: an
// account transition (sign-out, expiry, another user) removes it, keeps the
// display settings, and the open preferences store shows the change at once.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => ({ status: "signed_out" }) }));

import { useAppPreferences } from "@/components/clinical-dashboard/use-app-preferences";
import { APP_PREFERENCES_STORAGE_KEY, clearAccountScopedBrowserStorage } from "@/lib/account-scoped-browser-state";
import { cpdArea } from "@/lib/work-profile/model";

beforeEach(() => {
  window.localStorage.clear();
});

describe("account transition and the work stage", () => {
  it("removes the stage and keeps the display settings", () => {
    window.localStorage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ density: "compact", workStage: "registrar", ranzcpStage: 2 }),
    );
    clearAccountScopedBrowserStorage();
    const stored = JSON.parse(window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({ density: "compact" });
  });

  it("the open store drops the stage, so CPD no longer says Covered", () => {
    window.localStorage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ workStage: "registrar", ranzcpStage: 2 }),
    );
    const { result } = renderHook(() => useAppPreferences());
    expect(result.current.preferences.workStage).toBe("registrar");
    act(() => clearAccountScopedBrowserStorage());
    const { workStage, ranzcpStage } = result.current.preferences;
    expect(workStage).toBeNull();
    expect(ranzcpStage).toBeNull();
    expect(cpdArea({ status: "loading" }, workStage, ranzcpStage).label).toBe("Not checked");
  });

  it("leaves preferences without a stage untouched", () => {
    const raw = JSON.stringify({ density: "compact" });
    window.localStorage.setItem(APP_PREFERENCES_STORAGE_KEY, raw);
    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(APP_PREFERENCES_STORAGE_KEY)).toBe(raw);
  });
});
