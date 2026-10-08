export const recentQueryStorageKey = "clinical-kb-recent-queries";

export const recentQueriesChangeEvent = "clinical-kb-recent-queries-change";

export const demoRecentQueryOwnerId = "local-demo-session";

export function loadRecentQueries(ownerId: string | null): string[] {
  if (typeof window === "undefined" || !ownerId) return [];
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(`${recentQueryStorageKey}:${ownerId}`) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 5);
  } catch {
    return [];
  }
}

// The owner-scoped write. Kept beside `loadRecentQueries` so the key shape,
// the owner guard, and the "convenience only, never throw" contract live in one
// place rather than being re-derived at the call site.
//
// Deliberately knows nothing about the "Save recent searches" preference: the
// preference snapshot lives in the client hook layer, and pulling it down here
// would point this lib module back at a component hook. Callers gate the call.
export function saveRecentQueries(ownerId: string | null, queries: string[]) {
  if (typeof window === "undefined" || !ownerId) return;
  try {
    window.sessionStorage.setItem(`${recentQueryStorageKey}:${ownerId}`, JSON.stringify(queries));
    window.dispatchEvent(new Event(recentQueriesChangeEvent));
  } catch {
    // Recent questions are a convenience only; ignore storage failures.
  }
}

// Removes one question from the recent list (the side menu's swipe to remove).
// Only this tab's signed-in reader has a key here, because sign-out clears them
// all, so the menu need not know the owner id. Matching ignores case, the same
// way a new question replaces an older copy of itself.
export function removeRecentQuery(query: string) {
  if (typeof window === "undefined") return;
  const target = query.trim().toLowerCase();
  if (!target) return;
  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith(`${recentQueryStorageKey}:`)) continue;
      let stored: unknown;
      try {
        stored = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(stored)) continue;
      const kept = stored.filter((item) => typeof item !== "string" || item.trim().toLowerCase() !== target);
      if (kept.length !== stored.length) window.sessionStorage.setItem(key, JSON.stringify(kept));
    }
    window.dispatchEvent(new Event(recentQueriesChangeEvent));
  } catch {
    // Recent queries are a convenience only.
  }
}

// Total recent queries retained across every owner-scoped session key. Used by
// the settings privacy controls to show how much is stored and to disable the
// "Clear" affordance when there is nothing to remove.
export function countRecentQueries(): number {
  if (typeof window === "undefined") return 0;
  try {
    let total = 0;
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith(`${recentQueryStorageKey}:`)) continue;
      let stored: unknown;
      try {
        stored = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
      } catch {
        // Isolate a single corrupt entry: skip just this key rather than let one
        // malformed value zero the whole total and wrongly disable "Clear".
        continue;
      }
      if (Array.isArray(stored)) {
        total += stored.filter((item) => typeof item === "string" && Boolean(item.trim())).length;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

// The pre-owner-scoping build persisted recent clinical queries under the
// unscoped key, which survived logout, account switching, and demo/
// authenticated transitions on shared workstations (2026-07-13 audit,
// finding 4). A surviving value's owner cannot be established, so it is
// deleted, never migrated or displayed.
export function clearLegacyRecentQueries() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(recentQueryStorageKey);
    window.sessionStorage.removeItem(recentQueryStorageKey);
  } catch {
    // Recent queries are a convenience only.
  }
}

// Sign-out / session-expiry boundary: on a shared workstation the next person
// must not inherit anyone's recent clinical question text, so remove every
// owner-scoped key too, not just the legacy unscoped residue.
export function clearRecentQueries() {
  if (typeof window === "undefined") return;
  try {
    clearLegacyRecentQueries();
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(`${recentQueryStorageKey}:`)) {
        window.sessionStorage.removeItem(key);
      }
    }
    window.dispatchEvent(new Event(recentQueriesChangeEvent));
  } catch {
    // Recent queries are a convenience only.
  }
}
