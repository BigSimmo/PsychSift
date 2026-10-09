import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLegacyRecentQueries,
  clearRecentQueries,
  demoRecentQueryOwnerId,
  loadRecentQueries,
  recentQueriesChangeEvent,
  recentQueryStorageKey,
  removeRecentQuery,
} from "@/lib/recent-query-storage";

describe("recent query storage", () => {
  let localStore: Map<string, string>;
  let sessionStore: Map<string, string>;

  beforeEach(() => {
    localStore = new Map<string, string>();
    sessionStore = new Map<string, string>();
    const listeners = new Map<string, Set<EventListener>>();
    const storageFor = (store: Map<string, string>) => ({
      get length() {
        return store.size;
      },
      key(index: number) {
        return [...store.keys()][index] ?? null;
      },
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
      removeItem(key: string) {
        store.delete(key);
      },
    });
    vi.stubGlobal("window", {
      localStorage: storageFor(localStore),
      sessionStorage: storageFor(sessionStore),
      addEventListener(type: string, listener: EventListener) {
        const bucket = listeners.get(type) ?? new Set<EventListener>();
        bucket.add(listener);
        listeners.set(type, bucket);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: Event) {
        for (const listener of listeners.get(event.type) ?? []) listener(event);
        return true;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads only the owner-scoped session key", () => {
    sessionStore.set(`${recentQueryStorageKey}:user-a`, JSON.stringify(["clozapine monitoring"]));
    sessionStore.set(`${recentQueryStorageKey}:user-b`, JSON.stringify(["lithium toxicity"]));
    sessionStore.set(recentQueryStorageKey, JSON.stringify(["legacy unscoped query"]));
    localStore.set(recentQueryStorageKey, JSON.stringify(["legacy unscoped query"]));

    expect(loadRecentQueries("user-a")).toEqual(["clozapine monitoring"]);
    expect(loadRecentQueries("user-b")).toEqual(["lithium toxicity"]);
    expect(loadRecentQueries(demoRecentQueryOwnerId)).toEqual([]);
  });

  it("returns nothing without an owner", () => {
    localStore.set(recentQueryStorageKey, JSON.stringify(["legacy unscoped query"]));
    expect(loadRecentQueries(null)).toEqual([]);
  });

  it("drops malformed and blank entries and caps at five", () => {
    sessionStore.set(
      `${recentQueryStorageKey}:user-a`,
      JSON.stringify(["one", "", "  ", 42, { nested: true }, "two", "three", "four", "five", "six"]),
    );
    expect(loadRecentQueries("user-a")).toEqual(["one", "two", "three", "four", "five"]);

    sessionStore.set(`${recentQueryStorageKey}:user-a`, "{not json");
    expect(loadRecentQueries("user-a")).toEqual([]);
  });

  it("purges the legacy unscoped keys without migrating them", () => {
    // 2026-07-13 audit finding 4: the legacy value's owner cannot be
    // established, so it must be deleted, never surfaced under a new owner.
    localStore.set(recentQueryStorageKey, JSON.stringify(["legacy cross-user query"]));
    sessionStore.set(recentQueryStorageKey, JSON.stringify(["legacy cross-user query"]));
    sessionStore.set(`${recentQueryStorageKey}:user-a`, JSON.stringify(["scoped query"]));

    clearLegacyRecentQueries();

    expect(localStore.has(recentQueryStorageKey)).toBe(false);
    expect(sessionStore.has(recentQueryStorageKey)).toBe(false);
    expect(loadRecentQueries("user-a")).toEqual(["scoped query"]);
  });

  it("clearRecentQueries removes the legacy keys and every owner-scoped key", () => {
    // Sign-out / expiry boundary: the next person on a shared workstation must
    // not inherit anyone's recent clinical question text.
    localStore.set(recentQueryStorageKey, JSON.stringify(["legacy"]));
    sessionStore.set(recentQueryStorageKey, JSON.stringify(["legacy"]));
    sessionStore.set(`${recentQueryStorageKey}:user-a`, JSON.stringify(["a"]));
    sessionStore.set(`${recentQueryStorageKey}:user-b`, JSON.stringify(["b"]));
    sessionStore.set("unrelated-key", "untouched");

    clearRecentQueries();

    expect(localStore.has(recentQueryStorageKey)).toBe(false);
    expect([...sessionStore.keys()].some((key) => key.startsWith(recentQueryStorageKey))).toBe(false);
    expect(sessionStore.get("unrelated-key")).toBe("untouched");
  });

  it("clearRecentQueries notifies listeners so visible lists can refresh", () => {
    sessionStore.set(`${recentQueryStorageKey}:user-a`, JSON.stringify(["a"]));
    const listener = vi.fn();
    window.addEventListener(recentQueriesChangeEvent, listener);

    clearRecentQueries();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(recentQueriesChangeEvent, listener);
  });
  it("removeRecentQuery drops one question, ignoring case, and notifies listeners", () => {
    sessionStore.set(`${recentQueryStorageKey}:user-a`, JSON.stringify(["Lithium toxicity", "clozapine monitoring"]));
    sessionStore.set("unrelated-key", "untouched");
    const listener = vi.fn();
    window.addEventListener(recentQueriesChangeEvent, listener);

    removeRecentQuery("  lithium TOXICITY ");

    expect(loadRecentQueries("user-a")).toEqual(["clozapine monitoring"]);
    expect(sessionStore.get("unrelated-key")).toBe("untouched");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(recentQueriesChangeEvent, listener);
  });
});
