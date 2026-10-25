/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";

const sampleRow: OnCallEntry = {
  id: "44444444-4444-4444-8444-444444444444",
  section: "contacts",
  slug: "example-ed-registrar",
  title: "Example ED registrar",
  subtitle: null,
  body: null,
  details: { role: "Example role", phone: "0400 000 000" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: true,
  sortOrder: 0,
  lastVerifiedAt: null,
};

const loadExampleDataset = vi.fn();
vi.mock("@/lib/example-data/registry", () => ({
  loadExampleDataset: (...args: unknown[]) => loadExampleDataset(...args),
}));

const { clearOnCallEntryCache, useOnCallEntries } = await import("@/lib/on-call/entry-store");

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("useOnCallEntries signed-out sample", () => {
  beforeEach(() => {
    clearOnCallEntryCache();
    loadExampleDataset.mockReset();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ entries: [], signedOut: true }));
  });

  afterEach(() => {
    cleanup();
    clearOnCallEntryCache();
    vi.restoreAllMocks();
  });

  it("shows the load-failed state with a retry when the example file fails to download", async () => {
    loadExampleDataset.mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValueOnce([sampleRow]);

    const { result } = renderHook(() => useOnCallEntries());

    await waitFor(() => expect(result.current.loadError).toBe("failed"));
    expect(result.current.loading).toBe(false);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.entries).toEqual([]);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.entries.map((entry) => entry.id)).toEqual([sampleRow.id]));
    expect(result.current.loadError).toBeNull();
    expect(result.current.isOffline).toBe(false);
    expect(result.current.sample).toBe(true);
    expect(loadExampleDataset).toHaveBeenCalledTimes(2);
  });
});
