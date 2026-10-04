/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { setOnCallDemoPreviewActive } from "@/lib/on-call/entry-cache-keys";
import {
  onCallEntryCacheStorageKey,
  cacheOnCallEntries,
  clearOnCallEntryCache,
  readCachedOnCallEntries,
  useStoredOnCallEntries as useOnCallEntries,
} from "@/lib/on-call/entry-store";

const contact: OnCallEntry = {
  id: "22222222-2222-4222-8222-222222222222",
  section: "contacts",
  slug: "ed-registrar-after-hours",
  title: "ED Registrar (after hours)",
  subtitle: null,
  body: null,
  details: { role: "After-hours ED registrar", phone: "0400 111 222" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: true,
  sortOrder: 0,
  lastVerifiedAt: "2026-08-01T00:00:00.000Z",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("useOnCallEntries", () => {
  beforeEach(() => {
    clearOnCallEntryCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    clearOnCallEntryCache();
    vi.restoreAllMocks();
  });

  it("leaves an active on-device preview alone when a NON-EMPTY shared response arrives", async () => {
    // The defect this exists for (Codex, 2026-09-22). The empty-response guard
    // below protects a shift whose session expired, but it tests emptiness —
    // and the signed-out shared read is not empty. So a reader who started the
    // example preview on the home and then opened a section page mounted a
    // fresh copy of this hook there, its shared response overwrote the example
    // rows, and the destination showed the real (empty) hub while the home
    // still offered "Clear the example preview" over data this device never
    // wrote. One tap, two pages disagreeing about what is on screen.
    const preview = { ...contact, id: "33333333-3333-4333-8333-333333333333", slug: "demo-preview-row" };
    setOnCallDemoPreviewActive(true);
    cacheOnCallEntries([preview]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [contact], signedOut: true }));

    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(readCachedOnCallEntries()?.entries).toEqual([preview]);
    expect(result.current.entries).toEqual([preview]);

    // And clearing the preview puts the hook straight back to normal: the
    // marker and the cache go together, so nothing can outlive the preview.
    clearOnCallEntryCache();
    expect(readCachedOnCallEntries()).toBeNull();
  });

  it("writes the cache and records the save time on a successful fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [contact], signedOut: false }));

    const { result } = renderHook(() => useOnCallEntries());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isOffline).toBe(false);
    expect(result.current.entries).toEqual([contact]);
    expect(result.current.cachedAt).not.toBeNull();

    // The write reached the session cache, not just component state — and not
    // the device, which has held no fetched entries since 2026-09-26.
    const cached = readCachedOnCallEntries();
    expect(cached?.entries).toEqual([contact]);
    expect(cached?.savedAt).toBe(result.current.cachedAt);
    expect(window.localStorage.getItem(onCallEntryCacheStorageKey)).toBeNull();
  });

  it("renders the cached copy, with its saved date, when the fetch fails", async () => {
    cacheOnCallEntries([contact]);
    const savedAt = readCachedOnCallEntries()?.savedAt;
    expect(savedAt).toBeTruthy();

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useOnCallEntries());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isOffline).toBe(true);
    expect(result.current.entries).toEqual([contact]);
    // The saved date is available to the UI even though the network is down.
    expect(result.current.cachedAt).toBe(savedAt);
  });

  // Regression, 2026-09-24: every failure was called "offline", so a server
  // error told a reader with full signal that they had lost it.
  it("calls a failure 'offline' only when the browser has no network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("500"));
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const first = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.loadError).toBe("failed");
    first.unmount();

    onLine.mockReturnValue(false);
    const second = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.loadError).toBe("offline");

    // Retrying fetches again, and a success clears the error.
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ entries: [contact], signedOut: false }), { status: 200 }));
    act(() => second.result.current.retry());
    await waitFor(() => expect(second.result.current.loadError).toBeNull());
    onLine.mockRestore();
  });

  // Since 2026-09-26 the server sends a signed-out caller no entries at all. The hook does not
  // second-guess a response that does carry shared rows: it shows them for the session, like any
  // other, and writes nothing to the device.
  it("keeps a signed-out response's shared rows for the session, not on the device", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [contact], signedOut: true }));

    const { result } = renderHook(() => useOnCallEntries());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signedOut).toBe(true);
    expect(result.current.entries).toEqual([contact]);
    expect(readCachedOnCallEntries()?.entries).toEqual([contact]);
    expect(window.localStorage.getItem(onCallEntryCacheStorageKey)).toBeNull();
  });

  it("removes withdrawn rows on a successful empty response", async () => {
    cacheOnCallEntries([contact]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [], signedOut: true }));

    const { result } = renderHook(() => useOnCallEntries());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // A successful response is authoritative; only a failed fetch uses old data.
    expect(result.current.entries).toEqual([]);
    expect(readCachedOnCallEntries()?.entries).toEqual([]);
  });

  it("drops private cached rows on a signed-out empty response", async () => {
    cacheOnCallEntries([{ ...contact, isPersonal: true }]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [], signedOut: true }));
    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toEqual([]);
    expect(readCachedOnCallEntries()?.entries).toEqual([]);
  });

  // Changed 2026-09-26: shared entries are sign-in only, so no longer public, and the device may
  // hold only public information offline (docs/pwa.md). Until then this asserted that the shared
  // row WAS written and only the personal and compliance rows were not.
  it("writes no fetched entries to the device, shared, personal or compliance", () => {
    cacheOnCallEntries([
      contact,
      { ...contact, isPersonal: true },
      { ...contact, section: "logistics", details: { category: "Registration" } },
    ]);
    expect(window.localStorage.getItem(onCallEntryCacheStorageKey)).toBeNull();
    expect(readCachedOnCallEntries()?.entries).toHaveLength(3);
  });

  it("removes a device copy an earlier release left, on first read", () => {
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(onCallEntryCacheStorageKey, JSON.stringify({ entries: [contact], savedAt }));
    window.localStorage.setItem("clinical-kb-on-call-entries-cache", JSON.stringify({ entries: [contact], savedAt }));
    expect(readCachedOnCallEntries()).toBeNull();
    expect(window.localStorage.getItem(onCallEntryCacheStorageKey)).toBeNull();
    expect(window.localStorage.getItem("clinical-kb-on-call-entries-cache")).toBeNull();
  });

  it("still writes the signed-out example preview, and nothing but its example rows", () => {
    const preview = { ...contact, id: "44444444-4444-4444-8444-444444444444", slug: "demo-preview-row" };
    setOnCallDemoPreviewActive(true);
    cacheOnCallEntries([
      preview,
      contact,
      { ...preview, id: "55555555-5555-4555-8555-555555555555", isPersonal: true },
    ]);
    expect(JSON.parse(window.localStorage.getItem(onCallEntryCacheStorageKey)!).entries).toEqual([preview]);
  });

  it("invalidates private session memory when another tab signs out", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ entries: [{ ...contact, isPersonal: true }], signedOut: false }))
      .mockResolvedValueOnce(jsonResponse({ entries: [], signedOut: true }));
    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    window.dispatchEvent(new StorageEvent("storage", { key: onCallEntryCacheStorageKey, newValue: null }));
    await waitFor(() => expect(result.current.entries).toEqual([]));
  });

  it("clears on demand", () => {
    cacheOnCallEntries([contact]);
    expect(readCachedOnCallEntries()).not.toBeNull();

    clearOnCallEntryCache();

    expect(readCachedOnCallEntries()).toBeNull();
  });

  it("survives a storage accessor that throws, returning an empty list rather than propagating", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });

    let hook: ReturnType<typeof renderHook<ReturnType<typeof useOnCallEntries>, unknown>> | undefined;
    expect(() => {
      hook = renderHook(() => useOnCallEntries());
    }).not.toThrow();

    await waitFor(() => expect(hook?.result.current.loading).toBe(false));

    expect(hook?.result.current.entries).toEqual([]);
    expect(hook?.result.current.cachedAt).toBeNull();
  });

  it("drops in-memory fetched rows when the cache is cleared on sign-out", async () => {
    const personal: OnCallEntry = {
      ...contact,
      isPersonal: true,
      title: "My personal registrar",
      slug: "personal-reg",
    };
    const shared: OnCallEntry = {
      ...contact,
      id: "33333333-3333-4333-8333-333333333333",
      title: "Shared switchboard",
      slug: "shared-switch",
    };

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ entries: [personal], signedOut: false }))
      .mockResolvedValueOnce(jsonResponse({ entries: [shared], signedOut: true }));

    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries.map((entry) => entry.title)).toEqual(["My personal registrar"]);

    clearOnCallEntryCache();

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.title)).toEqual(["Shared switchboard"]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a late first-fetch response after the cache is cleared", async () => {
    const personal: OnCallEntry = {
      ...contact,
      isPersonal: true,
      title: "Account A personal",
      slug: "acct-a",
    };
    const shared: OnCallEntry = {
      ...contact,
      id: "44444444-4444-4444-8444-444444444444",
      title: "Shared only",
      slug: "shared-only",
    };

    let releaseFirst: ((value: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls += 1;
      if (calls === 1) return first;
      return Promise.resolve(jsonResponse({ entries: [shared], signedOut: true }));
    });

    const { result } = renderHook(() => useOnCallEntries());
    expect(result.current.loading).toBe(true);

    clearOnCallEntryCache();
    releaseFirst?.(jsonResponse({ entries: [personal], signedOut: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries.map((entry) => entry.title)).toEqual(["Shared only"]);
    expect(result.current.entries.some((entry) => entry.isPersonal)).toBe(false);
  });
});
