import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ON_CALL_CACHE_MAX_AGE_MS,
  cacheOnCallEntries,
  clearOnCallEntryCache,
  onCallEntryCacheChangedEvent,
  onCallEntryCacheStorageKey,
  peekOnCallEntrySessionEpoch,
  readCachedOnCallEntries,
  updateCachedOnCallEntries,
} from "@/lib/on-call/entry-store";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

type EventHandler = (event: Event) => void;

const contact: OnCallEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  section: "contacts",
  slug: "psych-registrar-after-hours",
  title: "Psychiatry Registrar (after hours)",
  subtitle: null,
  body: null,
  details: { role: "After-hours registrar", phone: "0400 000 000" },
  linkedDocumentIds: [],
  tags: [],
  isPersonal: true,
  includeOnCard: true,
  sortOrder: 0,
  lastVerifiedAt: "2026-08-01T00:00:00.000Z",
};

describe("on-call entry cache", () => {
  let storage: Map<string, string>;
  let listeners: Map<string, Set<EventHandler>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));

    storage = new Map<string, string>();
    listeners = new Map<string, Set<EventHandler>>();

    const addEventListener = vi.fn((type: string, handler: EventHandler) => {
      const existing = listeners.get(type) ?? new Set<EventHandler>();
      existing.add(handler);
      listeners.set(type, existing);
    });
    const removeEventListener = vi.fn((type: string, handler: EventHandler) => {
      listeners.get(type)?.delete(handler);
    });
    const dispatchEvent = vi.fn((event: Event) => {
      listeners.get(event.type)?.forEach((handler) => handler(event));
      return true;
    });

    vi.stubGlobal("window", {
      localStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
        removeItem(key: string) {
          storage.delete(key);
        },
      },
      addEventListener,
      removeEventListener,
      dispatchEvent,
    });
    clearOnCallEntryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns null when nothing has ever been cached", () => {
    expect(readCachedOnCallEntries()).toBeNull();
  });

  it("writes the cache and records the save time", () => {
    const wrote = cacheOnCallEntries([contact]);

    expect(wrote).toBe(true);
    const cached = readCachedOnCallEntries();
    expect(cached?.entries).toEqual([contact]);
    // Recorded, not guessed: the save time is the moment of the write, not the
    // entry's own lastVerifiedAt.
    expect(cached?.savedAt).toBe("2026-09-04T12:00:00.000Z");
  });

  it("expires the cached copy at seven days", () => {
    cacheOnCallEntries([contact]);
    vi.advanceTimersByTime(ON_CALL_CACHE_MAX_AGE_MS - 1);
    expect(readCachedOnCallEntries()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(readCachedOnCallEntries()).toBeNull();
  });

  it.each(["invalid", "2027-01-01T00:00:00.000Z"])("rejects an invalid or future saved date: %s", (savedAt) => {
    storage.set(onCallEntryCacheStorageKey, JSON.stringify({ entries: [contact], savedAt }));
    expect(readCachedOnCallEntries()).toBeNull();
  });

  // Until 2026-09-26 the shared rows of an older copy were kept and only the private ones
  // dropped. Nothing fetched may stay on the device now, so the whole copy goes.
  it("does not revive entries persisted by an older release, and removes the copy", () => {
    storage.set(onCallEntryCacheStorageKey, JSON.stringify({ entries: [contact], savedAt: new Date().toISOString() }));
    storage.set(
      "clinical-kb-on-call-entries-cache",
      JSON.stringify({ entries: [{ ...contact, isPersonal: false }], savedAt: new Date().toISOString() }),
    );
    expect(readCachedOnCallEntries()).toBeNull();
    expect(storage.has(onCallEntryCacheStorageKey)).toBe(false);
    expect(storage.has("clinical-kb-on-call-entries-cache")).toBe(false);
  });

  it("keeps a write in session memory only, never on the device", () => {
    cacheOnCallEntries([{ ...contact, isPersonal: false }]);
    expect(readCachedOnCallEntries()?.entries).toHaveLength(1);
    expect(storage.has(onCallEntryCacheStorageKey)).toBe(false);
  });

  it("dispatches the change event so a reactive reader picks up the write", () => {
    const handler = vi.fn();
    window.addEventListener(onCallEntryCacheChangedEvent, handler as EventListener);

    cacheOnCallEntries([contact]);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("treats corrupt stored JSON as no cache rather than throwing", () => {
    storage.set(onCallEntryCacheStorageKey, "{not-json");

    expect(readCachedOnCallEntries()).toBeNull();
  });

  it("treats a payload that no longer matches the entry schema as no cache", () => {
    storage.set(onCallEntryCacheStorageKey, JSON.stringify({ entries: [{ id: "not-an-entry" }], savedAt: "x" }));

    expect(readCachedOnCallEntries()).toBeNull();
  });

  it("empties the cache on clear and dispatches the change event", () => {
    cacheOnCallEntries([contact]);
    expect(readCachedOnCallEntries()).not.toBeNull();

    const handler = vi.fn();
    window.addEventListener(onCallEntryCacheChangedEvent, handler as EventListener);

    clearOnCallEntryCache();

    expect(readCachedOnCallEntries()).toBeNull();
    expect(storage.has(onCallEntryCacheStorageKey)).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("survives a storage accessor that throws on read, returning no cache rather than propagating", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
        setItem() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
        removeItem() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    expect(() => readCachedOnCallEntries()).not.toThrow();
    expect(readCachedOnCallEntries()).toBeNull();
  });

  it("survives a storage accessor that throws on write, reporting failure rather than propagating", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          return null;
        },
        setItem() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
        removeItem() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    expect(() => cacheOnCallEntries([contact])).not.toThrow();
    expect(cacheOnCallEntries([contact])).toBe(false);
    expect(() => clearOnCallEntryCache()).not.toThrow();
  });

  it("applies a late update to the latest cached list, not the snapshot the screen held", () => {
    const other: OnCallEntry = { ...contact, id: "22222222-2222-4222-8222-222222222222", slug: "other" };
    cacheOnCallEntries([contact, other]);
    // Both taps start from the same render's list.
    const snapshot = readCachedOnCallEntries()!.entries;
    const first = { ...contact, lastVerifiedAt: "2026-09-04T12:00:00.000Z" };
    const second = { ...other, lastVerifiedAt: "2026-09-04T12:00:00.000Z" };
    const replace = (updated: OnCallEntry) => (current: OnCallEntry[]) =>
      current.map((existing) => (existing.id === updated.id ? updated : existing));
    expect(updateCachedOnCallEntries(snapshot, replace(first))).toBe(true);
    expect(updateCachedOnCallEntries(snapshot, replace(second))).toBe(true);
    expect(readCachedOnCallEntries()?.entries).toEqual([first, second]);
  });

  it("falls back to the screen's own list when nothing is cached", () => {
    expect(updateCachedOnCallEntries([contact], (current) => current.filter(() => false))).toBe(true);
    expect(readCachedOnCallEntries()?.entries).toEqual([]);
    clearOnCallEntryCache();
    const updated = { ...contact, title: "Renamed" };
    updateCachedOnCallEntries([contact], (current) => current.map(() => updated));
    expect(readCachedOnCallEntries()?.entries).toEqual([updated]);
  });

  it("advances the session epoch only when the cache is cleared", () => {
    const before = peekOnCallEntrySessionEpoch();
    cacheOnCallEntries([contact]);
    expect(peekOnCallEntrySessionEpoch()).toBe(before);
    clearOnCallEntryCache();
    expect(peekOnCallEntrySessionEpoch()).toBe(before + 1);
  });
});
