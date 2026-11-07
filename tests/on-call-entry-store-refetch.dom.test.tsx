/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { clearOnCallEntryCache, updateCachedOnCallEntries, useStoredOnCallEntries } from "@/lib/on-call/entry-store";

const entry = (id: string, title: string): OnCallEntry => ({
  id,
  section: "contacts",
  slug: `synthetic-${id.slice(0, 4)}`,
  title,
  subtitle: null,
  body: null,
  details: { role: "Synthetic role", phone: "0400 000 000" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: false,
  includeOnCard: true,
  sortOrder: 0,
  lastVerifiedAt: "2026-08-01T00:00:00.000Z",
});
const existing = entry("11111111-1111-4111-8111-111111111111", "Synthetic existing contact");
const saved = entry("22222222-2222-4222-8222-222222222222", "Synthetic saved contact");

afterEach(() => {
  clearOnCallEntryCache();
  vi.restoreAllMocks();
});

describe("useStoredOnCallEntries", () => {
  it("reads the list again when a save lands while the first list is loading", async () => {
    let releaseFirst!: (response: Response) => void;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (releaseFirst = resolve)))
      .mockImplementation(async () => Response.json({ entries: [existing, saved], signedOut: false }));

    const { result } = renderHook(() => useStoredOnCallEntries());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A save while the first read is in flight leaves only the new entry cached.
    act(() => {
      updateCachedOnCallEntries([], (current) => [...current, saved], 0);
    });
    await act(async () => releaseFirst(Response.json({ entries: [existing], signedOut: false })));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries.map(({ title }) => title)).toEqual([
      "Synthetic existing contact",
      "Synthetic saved contact",
    ]);
  });
});
