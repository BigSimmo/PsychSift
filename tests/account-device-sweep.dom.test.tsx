import { afterEach, describe, expect, it, vi } from "vitest";

import { sweepAccountDeviceData } from "@/lib/account-device-sweep";
import {
  clearAccountScopedBrowserStorage,
  MY_DAY_EARLIER_ALERTS_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("account device sweep", () => {
  it("removes every psychsift key and the clinical drafts, and keeps device preferences", () => {
    window.localStorage.setItem("psychsift:roster:anything-v1", "x");
    window.localStorage.setItem("psychsift:work:example-data-v1", "on");
    window.sessionStorage.setItem("psychsift:teaching:draft", "x");
    window.sessionStorage.setItem("psychsift_formulation_draft", "{}");
    window.sessionStorage.setItem("psychsift_dsm_draft_F32.1", "{}");
    window.sessionStorage.setItem("clinical.private-search-scope.0000", "{}");
    window.localStorage.setItem("psychsift:work-search-coach-seen", "1");
    window.localStorage.setItem("psychsift-shared-device", "1");
    window.localStorage.setItem("clinical-kb-theme", "dark");

    sweepAccountDeviceData();

    expect(window.localStorage.getItem("psychsift:roster:anything-v1")).toBeNull();
    expect(window.localStorage.getItem("psychsift:work:example-data-v1")).toBeNull();
    expect(window.sessionStorage.getItem("psychsift:teaching:draft")).toBeNull();
    expect(window.sessionStorage.getItem("psychsift_formulation_draft")).toBeNull();
    expect(window.sessionStorage.getItem("psychsift_dsm_draft_F32.1")).toBeNull();
    expect(window.sessionStorage.getItem("clinical.private-search-scope.0000")).toBeNull();
    expect(window.localStorage.getItem("psychsift:work-search-coach-seen")).toBe("1");
    expect(window.localStorage.getItem("psychsift-shared-device")).toBe("1");
    expect(window.localStorage.getItem("clinical-kb-theme")).toBe("dark");
  });

  it("deletes IndexedDB databases and page caches, keeps the service worker's caches, and closes PsychSift notifications", async () => {
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", {
      databases: async () => [{ name: "work-offline" }, { name: undefined }],
      deleteDatabase,
    });
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal("caches", {
      keys: async () => ["clinical-kb-pwa-static-1", "clinical-kb-pwa-shell-1", "some-library-cache"],
      delete: deleteCache,
    });
    const roster = { data: { t: "changed" }, close: vi.fn() };
    const other = { data: null, close: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: async () => ({ getNotifications: async () => [roster, other] }) },
    });

    sweepAccountDeviceData();
    await vi.waitFor(() => expect(roster.close).toHaveBeenCalledTimes(1));

    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("work-offline");
    expect(deleteCache).toHaveBeenCalledExactlyOnceWith("some-library-cache");
    expect(other.close).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("runs as part of the account transition clear, with the earlier-alerts key named", () => {
    window.localStorage.setItem(MY_DAY_EARLIER_ALERTS_STORAGE_KEY, "[]");
    window.localStorage.setItem("psychsift:admin:unnamed-v1", "x");
    clearAccountScopedBrowserStorage();
    expect(window.localStorage.getItem(MY_DAY_EARLIER_ALERTS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("psychsift:admin:unnamed-v1")).toBeNull();
  });
});
