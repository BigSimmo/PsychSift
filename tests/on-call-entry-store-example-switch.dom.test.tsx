/** @vitest-environment jsdom */

// On Call and Admin follow the one example data switch. Inside the work
// frame's scope, the switch swaps the invented corpus in for a signed-in
// reader exactly as signed-out visitors already see it: read-only, in memory,
// never written to the entry cache, the device or the server. The automatic
// default never covers an account's real entries.

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import {
  OnCallExampleDataScope,
  cacheOnCallEntries,
  clearOnCallEntryCache,
  isOnCallExampleEntry,
  readCachedOnCallEntries,
  useOnCallEntries,
} from "@/lib/on-call/entry-store";
import { areaDataState, resetExampleDataForTests, setExampleDataOn } from "@/lib/example-data/store";

const auth = vi.hoisted(() => ({
  status: "authenticated" as string,
  authEpoch: 1,
  session: { user: { created_at: "2020-01-01T00:00:00Z" } } as { user: { created_at: string } } | null,
}));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => auth }));

const realEntry = { ...DEMO_ON_CALL_ENTRIES[0], id: "3f1c2a7e-9b4d-4c11-8a2e-5d6f7a8b9c0d", slug: "ward-a-nurse" };

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function scope({ children }: { children: ReactNode }) {
  return <OnCallExampleDataScope>{children}</OnCallExampleDataScope>;
}

describe("useOnCallEntries and the example data switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetExampleDataForTests();
    clearOnCallEntryCache();
    auth.status = "authenticated";
    auth.session = { user: { created_at: "2020-01-01T00:00:00Z" } };
  });
  afterEach(() => {
    cleanup();
    clearOnCallEntryCache();
    window.localStorage.clear();
    resetExampleDataForTests();
    vi.restoreAllMocks();
  });

  it("shows the example corpus read-only to a signed-in reader who turned it on, and keeps it out of the cache and off the server", async () => {
    setExampleDataOn(true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ entries: [realEntry], signedOut: false }));
    const { result } = renderHook(() => useOnCallEntries(), { wrapper: scope });

    await waitFor(() => expect(result.current.sample).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.demoMode).toBe(true);
    expect(result.current.entries).toHaveLength(DEMO_ON_CALL_ENTRIES.length);
    expect(result.current.entries.every(isOnCallExampleEntry)).toBe(true);
    expect(result.current.cachedAt).toBeNull();

    // The real read still ran, and the cache holds the real row only.
    await waitFor(() => expect(readCachedOnCallEntries()?.entries.map((e) => e.id)).toEqual([realEntry.id]));

    // A screen writing back what it was shown (verify all, an edit's upsert) is refused.
    expect(cacheOnCallEntries(result.current.entries)).toBe(false);
    expect(cacheOnCallEntries([...result.current.entries.slice(1), realEntry])).toBe(false);
    expect(readCachedOnCallEntries()?.entries.map((e) => e.id)).toEqual([realEntry.id]);

    // The only request is the ordinary read: nothing is sent to the server.
    expect(fetchSpy.mock.calls.every(([url, init]) => String(url) === "/api/on-call/entries" && !init?.method)).toBe(
      true,
    );
  });

  it("shows the account's own entries once the switch is turned off", async () => {
    setExampleDataOn(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [realEntry], signedOut: false }));
    const { result } = renderHook(() => useOnCallEntries(), { wrapper: scope });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sample).toBe(false);
    expect(result.current.demoMode).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual([realEntry.id]);
  });

  it("never covers a new account's real entries in auto mode, and reports them to the switch", async () => {
    auth.session = { user: { created_at: new Date().toISOString() } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [realEntry], signedOut: false }));
    const { result } = renderHook(() => useOnCallEntries(), { wrapper: scope });
    await waitFor(() => expect(areaDataState("call")).toBe("has-data"));
    expect(areaDataState("admin")).toBe("has-data");
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sample).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual([realEntry.id]);
  });

  it("shows examples to a new account with no entries in auto mode", async () => {
    auth.session = { user: { created_at: new Date().toISOString() } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [], signedOut: false }));
    const { result } = renderHook(() => useOnCallEntries(), { wrapper: scope });
    await waitFor(() => expect(result.current.sample).toBe(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(areaDataState("call")).toBe("empty");
    expect(result.current.demoMode).toBe(true);
    expect(result.current.entries).toHaveLength(DEMO_ON_CALL_ENTRIES.length);
  });

  it("changes nothing outside the frame's scope", async () => {
    setExampleDataOn(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [realEntry], signedOut: false }));
    const { result } = renderHook(() => useOnCallEntries());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sample).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual([realEntry.id]);
    expect(areaDataState("call")).toBe("unknown");
  });

  it("recognises the demo corpus and leaves real rows alone", () => {
    expect(DEMO_ON_CALL_ENTRIES.every(isOnCallExampleEntry)).toBe(true);
    expect(isOnCallExampleEntry(realEntry)).toBe(false);
  });
});
