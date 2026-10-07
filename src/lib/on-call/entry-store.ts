"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";

import { mayContainOnCallCompliance } from "@/lib/on-call/compliance";
import { createBrowserStore } from "@/lib/client-store-factory";
import { isExampleRecord } from "@/lib/example-data/guards";
import { loadExampleDataset } from "@/lib/example-data/registry";
import { reportAreaData, useExampleData } from "@/lib/example-data/store";
// The key, its event and the clear function live in a module that imports
// nothing, so the auth provider can clear this cache without pulling the On
// Call domain model into every page's bundle. Re-exported here so existing
// call sites are unchanged.
import {
  clearOnCallEntryCache,
  isOnCallDemoPreviewActive,
  onCallEntryCacheChangedEvent,
  onCallEntryCacheStorageKey,
  peekOnCallEntrySessionEpoch,
  removeLegacyOnCallEntryCaches,
} from "@/lib/on-call/entry-cache-keys";
import { onCallEntrySchema, type OnCallEntry } from "@/lib/on-call/entry-model";

export { clearOnCallEntryCache, onCallEntryCacheChangedEvent, onCallEntryCacheStorageKey, peekOnCallEntrySessionEpoch };

/**
 * Cache for On Call entries (`src/lib/on-call/entry-model.ts`). A junior doctor
 * reading this in a hospital basement with no signal needs the last-known phone
 * numbers, not a spinner, so the last fetch is kept for this tab's session and
 * served when a later fetch fails. It is dropped on sign-out or an account
 * change, and it is not written to the device — see
 * `PERSIST_FETCHED_ON_CALL_ENTRIES` below.
 *
 * Follows `src/lib/saved-registry-storage.ts` for the storage shape and
 * `src/components/clinical-dashboard/use-sidebar-pins.ts` for wiring a
 * `localStorage`-backed value through `createBrowserStore`.
 */

export type CachedOnCallEntries = {
  entries: OnCallEntry[];
  /** ISO timestamp of when this cache was written. A cached number with no
   *  recorded age is worse than no number — the UI must always be able to
   *  show "as of when". */
  savedAt: string;
};

export const ON_CALL_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether fetched entries may be kept in `localStorage` — the one switch for
 * the device copy, which `public/offline.html` also reads.
 *
 * Off since 2026-09-26. Shared entries became readable by signed-in users only,
 * so they are no longer public, and docs/pwa.md (owner decision, 2026-09-25)
 * lets the device hold only public, non-patient information offline. Until the
 * owner decides otherwise, entries stay in this tab's memory and nowhere else,
 * and a copy an earlier release left on the device is removed on first read.
 *
 * The one thing still written is the signed-out example preview: the synthetic
 * corpus this bundle already ships, written only while
 * `isOnCallDemoPreviewActive()` and filtered to its `demo-` slugs, so nothing
 * fetched can ride along with it.
 */
const PERSIST_FETCHED_ON_CALL_ENTRIES: boolean = false;
const DEMO_PREVIEW_SLUG_PREFIX = "demo-";

/** What may be written to the device for this payload, or null for nothing. */
function devicePayload(payload: CachedOnCallEntries): string | null {
  if (!PERSIST_FETCHED_ON_CALL_ENTRIES && !isOnCallDemoPreviewActive()) return null;
  return JSON.stringify({
    ...payload,
    entries: payload.entries.filter(
      (entry) =>
        !entry.isPersonal &&
        !mayContainOnCallCompliance(entry.section, entry.details) &&
        (PERSIST_FETCHED_ON_CALL_ENTRIES || entry.slug.startsWith(DEMO_PREVIEW_SLUG_PREFIX)),
    ),
  });
}
// Private entries belong to the current session, never durable device storage.
let sessionCache: string | null = null;
let sessionCacheEpoch = peekOnCallEntrySessionEpoch();

const cachedEntriesSchema = z
  .object({
    entries: z.array(onCallEntrySchema),
    savedAt: z.string(),
  })
  .strict();

function parseCachedPayload(raw: string | null): CachedOnCallEntries | null {
  if (!raw) return null;
  try {
    const parsed = cachedEntriesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const age = Date.now() - Date.parse(parsed.data.savedAt);
    if (!Number.isFinite(age) || age < 0 || age >= ON_CALL_CACHE_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Read the cached copy of On Call entries. Never throws: a browser with site
 * data blocked, corrupt JSON, or a shape that no longer matches the schema all
 * return null rather than propagate into render.
 */
export function readCachedOnCallEntries(): CachedOnCallEntries | null {
  if (typeof window === "undefined") return null;
  try {
    scrubPersistedOnCallCache();
    return parseCachedPayload(getCacheSnapshot());
  } catch {
    return null;
  }
}

/**
 * Write a fresh cache and record when it was saved. Returns whether the write
 * succeeded, including the device half (a write, or the removal of any old
 * device copy); callers still have the freshly fetched entries for this render
 * even when it did not.
 */
export function cacheOnCallEntries(entries: OnCallEntry[]): boolean {
  if (typeof window === "undefined") return false;
  // Example rows shown by the example data switch are display only. A screen
  // that writes back the list it was given (verify all, an edit's upsert) must
  // never put them in the account's cache, so the whole write is refused and
  // the real cache is left exactly as it was.
  if (entries.some((entry) => shownExampleEntries.has(entry))) return false;
  try {
    const payload: CachedOnCallEntries = { entries, savedAt: new Date().toISOString() };
    sessionCache = JSON.stringify(payload);
    sessionCacheEpoch = peekOnCallEntrySessionEpoch();
    // The only `localStorage` write of On Call entries.
    const device = devicePayload(payload);
    if (device === null) window.localStorage.removeItem(onCallEntryCacheStorageKey);
    else window.localStorage.setItem(onCallEntryCacheStorageKey, device);
    window.dispatchEvent(new Event(onCallEntryCacheChangedEvent));
    return true;
  } catch {
    // Quota exceeded, private mode, or blocked storage: the caller already has
    // the entries in memory for this render, so there is nothing more to do.
    return false;
  }
}

function scrubPersistedOnCallCache(): void {
  removeLegacyOnCallEntryCaches();
  try {
    const raw = window.localStorage.getItem(onCallEntryCacheStorageKey);
    if (raw === null) return;
    const persisted = parseCachedPayload(raw);
    // Retire anything the device may no longer hold on first read, even while
    // offline: every fetched row while persistence is off, and private rows.
    const safe = persisted ? devicePayload(persisted) : null;
    if (safe === null) {
      window.localStorage.removeItem(onCallEntryCacheStorageKey);
      return;
    }
    if (safe !== raw) {
      try {
        window.localStorage.setItem(onCallEntryCacheStorageKey, safe);
      } catch {
        try {
          window.localStorage.removeItem(onCallEntryCacheStorageKey);
        } catch {
          /* Storage denied; only safe data is returned. */
        }
      }
    }
  } catch {
    /* Denied storage remains inaccessible; rendering still filters private rows. */
  }
}

function getCacheSnapshot(): string {
  if (sessionCacheEpoch !== peekOnCallEntrySessionEpoch()) {
    sessionCache = null;
    sessionCacheEpoch = peekOnCallEntrySessionEpoch();
  }
  if (sessionCache !== null) return parseCachedPayload(sessionCache) ? sessionCache : "";
  try {
    const persisted = parseCachedPayload(window.localStorage.getItem(onCallEntryCacheStorageKey));
    return (persisted && devicePayload(persisted)) ?? "";
  } catch {
    return "";
  }
}

function subscribeToCache(onChange: () => void) {
  // Subscription runs after render, keeping the external-store snapshot pure.
  scrubPersistedOnCallCache();
  function onFocus() {
    scrubPersistedOnCallCache();
    onChange();
  }
  function onStorage(event: StorageEvent) {
    if (event.key !== null && event.key !== onCallEntryCacheStorageKey) return;
    // Another tab's sign-out must also invalidate this tab's in-memory rows.
    if (event.newValue === null) clearOnCallEntryCache();
    else sessionCache = null;
    onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onFocus);
  window.addEventListener(onCallEntryCacheChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener(onCallEntryCacheChangedEvent, onChange);
  };
}

// A raw JSON string gives useSyncExternalStore a stable primitive to compare
// between renders; the hook below derives the parsed value with useMemo.
const useOnCallEntryCacheSnapshot = createBrowserStore(subscribeToCache, getCacheSnapshot, "");

const onCallEntriesResponseSchema = z.object({
  entries: z.array(z.unknown()),
  signedOut: z.boolean().default(false),
  // The API sets this only in demo mode, where the corpus is served from
  // memory and Supabase is never reached. Defaulted rather than required, so a
  // live response (which omits it) parses unchanged.
  demoMode: z.boolean().default(false),
});

export type OnCallEntriesState = {
  /** Last-known-good entries: freshly fetched when reachable, otherwise the
   *  cached copy. Empty, never undefined, so a render never has to guard a
   *  hole in the data. */
  entries: OnCallEntry[];
  /** When the entries currently shown were cached in this session. Null only
   *  when nothing has been cached. */
  cachedAt: string | null;
  /** True until the first fetch attempt has settled, success or failure. */
  loading: boolean;
  /** True when the most recent fetch attempt failed, so `entries` (if any)
   *  are being served from the offline cache rather than the network. */
  isOffline: boolean;
  /** Why the most recent fetch failed, or null when it did not. "offline"
   *  only when the browser reports no network; anything else (a server
   *  error, a malformed reply) is "failed", so a 500 is never described to
   *  the reader as their own lost signal. */
  loadError: "offline" | "failed" | null;
  /** Fetch again after a failure. */
  retry: () => void;
  /** Mirrors the API's `signedOut` flag from the most recent successful
   *  fetch. A signed-out response carries no entries (sign-in only since
   *  2026-09-26), so it empties the cache. */
  signedOut: boolean;
  /** True when the entries came from the in-memory demo corpus rather than the
   *  database. Nothing in this mode can be written, so a control that offers to
   *  is a control that can only fail. */
  demoMode: boolean;
  /** True while the invented sample is shown: to a signed-out visitor, or
   *  because the example data switch is showing examples in On Call or Admin.
   *  The rows live in memory only (never in the entry cache, on the device or
   *  on the server), and `demoMode` is also true so every control that writes
   *  stays off. */
  sample: boolean;
};

/**
 * Fetches On Call entries and keeps the last fetch for this session so a phone
 * that loses signal still shows the last-known numbers. Every storage access
 * goes through `readCachedOnCallEntries` / `cacheOnCallEntries`, both wrapped
 * in try/catch, so a browser blocking site data degrades to "no cached
 * entries" rather than throwing into render.
 */
export function useStoredOnCallEntries(): OnCallEntriesState {
  const cacheSnapshot = useOnCallEntryCacheSnapshot();
  const cached = useMemo(() => parseCachedPayload(cacheSnapshot || null), [cacheSnapshot]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [loadError, setLoadError] = useState<"offline" | "failed" | null>(null);
  // Bumped by `retry`; restarting the fetch effect on it is the whole retry.
  const [attempt, setAttempt] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  // What the fetch returned, held in memory. The cache is the live source once
  // it works — edits write there and must be seen — but a browser blocking
  // site data makes every write a silent no-op, and reading only the cache
  // then reported an empty hub after a perfectly successful fetch: search said
  // "nothing to search", the card said "nothing is flagged". This is the
  // fallback for that browser, not a second source of truth.
  const [fetched, setFetched] = useState<OnCallEntry[] | null>(null);
  // Stamped once, right when the fetch completes (an effect/event callback,
  // never render), so the freshness check below never calls `Date.now()`
  // while rendering (react-hooks/purity). `cacheFresh` is the render-safe
  // read of "is `expiresAt` still in the future", recomputed in an effect and
  // flipped off by a timer rather than by re-reading the clock on each render.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [cacheFresh, setCacheFresh] = useState(false);
  // Advanced only when `clearOnCallEntryCache` runs (sign-out / account
  // switch). Restarting the fetch on that number, and tagging the in-flight
  // request with it, is what stops a late response from account A writing
  // personal rows back after the persisted key has gone.
  const [sessionEpoch, setSessionEpoch] = useState(peekOnCallEntrySessionEpoch);

  useEffect(() => {
    function onCacheChanged() {
      if (peekOnCallEntrySessionEpoch() === sessionEpoch) return;
      // The persisted key is gone. Drop the in-memory fallback immediately —
      // `cached?.entries ?? fetched` would otherwise keep rendering account A's
      // personal rows once `cached` is null. Loading goes true here rather
      // than inside the fetch effect: that effect cannot call setState
      // synchronously (react-hooks/set-state-in-effect).
      setFetched(null);
      setLoading(true);
      setSessionEpoch(peekOnCallEntrySessionEpoch());
    }
    window.addEventListener(onCallEntryCacheChangedEvent, onCacheChanged);
    return () => window.removeEventListener(onCallEntryCacheChangedEvent, onCacheChanged);
  }, [sessionEpoch]);

  useEffect(() => {
    const epochAtStart = peekOnCallEntrySessionEpoch();
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        const response = await fetch("/api/on-call/entries", { signal: controller.signal });
        if (!response.ok) throw new Error(`On Call entries request failed: ${response.status}`);

        const rawBody: unknown = await response.json();
        const parsedResponse = onCallEntriesResponseSchema.safeParse(rawBody);
        if (!parsedResponse.success) throw new Error("On Call entries response was malformed.");

        const entries = parsedResponse.data.entries
          .map((entry) => onCallEntrySchema.safeParse(entry))
          .filter((result): result is { success: true; data: OnCallEntry } => result.success)
          .map((result) => result.data)
          .filter(
            (entry) =>
              !parsedResponse.data.signedOut ||
              (!entry.isPersonal && !mayContainOnCallCompliance(entry.section, entry.details)),
          );

        if (cancelled || peekOnCallEntrySessionEpoch() !== epochAtStart) return;
        setIsOffline(false);
        setLoadError(null);
        setSignedOut(parsedResponse.data.signedOut);
        setDemoMode(parsedResponse.data.demoMode);
        setFetched(entries);
        setExpiresAt(Date.now() + ON_CALL_CACHE_MAX_AGE_MS);
        // A successful empty response withdraws the previous rows. Only a failed
        // request may fall back to cache. Synthetic preview is an explicit,
        // separately marked choice and is not overwritten by real responses.
        if (!isOnCallDemoPreviewActive()) {
          cacheOnCallEntries(entries);
        }
      } catch (error) {
        // Abort is the account-transition path, not a network failure.
        if (cancelled || peekOnCallEntrySessionEpoch() !== epochAtStart) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Offline, server error, or a malformed payload: fall back to
        // whatever is already cached rather than surfacing a blank state.
        setIsOffline(true);
        setLoadError(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed");
      } finally {
        if (!cancelled && peekOnCallEntrySessionEpoch() === epochAtStart) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionEpoch, attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (expiresAt === null) {
      queueMicrotask(() => setCacheFresh(false));
      return;
    }
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      queueMicrotask(() => setCacheFresh(false));
      return;
    }
    queueMicrotask(() => setCacheFresh(true));
    const timer = window.setTimeout(() => setCacheFresh(false), remainingMs);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  return {
    entries: cached?.entries ?? (cacheFresh ? fetched : null) ?? [],
    cachedAt: cached?.savedAt ?? null,
    loading,
    isOffline,
    loadError,
    retry,
    signedOut,
    demoMode,
    sample: false,
  };
}

/**
 * The demo corpus's fixed ids (`src/lib/on-call/demo-entries.ts`). Real rows
 * get server-made random UUIDs, so this prefix never matches one.
 */
const DEMO_ENTRY_ID_PREFIX = "00000000-0000-4000-8000-";

/**
 * The example rows this module handed to a screen. They are fresh copies, so
 * the check is exact: only rows that came from the swap below are in it, never
 * a fetched row and never a test's fixture.
 */
const shownExampleEntries = new WeakSet<OnCallEntry>();

/**
 * True for an invented On Call entry: one shown by the example swap, one the
 * shared guards recognise, or a row of the demo corpus. Use it before a write
 * that takes a single entry (verify, edit, delete) and when deciding whether a
 * list holds any real data.
 */
export function isOnCallExampleEntry(entry: OnCallEntry): boolean {
  return shownExampleEntries.has(entry) || isExampleRecord(entry) || entry.id.startsWith(DEMO_ENTRY_ID_PREFIX);
}

type OnCallExampleScopeValue = {
  /** On Call or Admin shows example data now (the two read the same records). */
  readonly active: boolean;
  /** The user turned the switch on themselves, so there is nothing to wait for. */
  readonly explicit: boolean;
};

const OnCallExampleScopeContext = createContext<OnCallExampleScopeValue | null>(null);

/**
 * Connects `useOnCallEntries` to the example data switch. Mounted once by the
 * work frame around each work area's pages. Outside it (a unit test, a page
 * with no frame) the hook behaves exactly as before: signed-out sample only,
 * and nothing is reported to the switch.
 */
export function OnCallExampleDataScope({ children }: { readonly children?: ReactNode }) {
  const call = useExampleData("call");
  const admin = useExampleData("admin");
  const active = call.active || admin.active;
  const explicit = call.mode === "on";
  const value = useMemo(() => ({ active, explicit }), [active, explicit]);
  return createElement(OnCallExampleScopeContext.Provider, { value }, children);
}

/**
 * What every On Call and Admin screen reads. For a signed-in reader with the
 * example data switch off this is exactly `useStoredOnCallEntries`. It swaps in
 * the invented sample for a signed-out visitor (whom the server answers with
 * no entries), and, inside `OnCallExampleDataScope`, whenever the switch shows
 * examples in On Call or Admin.
 *
 * The sample comes from the example data registry on demand (so it never
 * counts towards anyone's first load) and is held in this component's memory
 * only: it is never written to the entry cache, the device or the server
 * (`cacheOnCallEntries` refuses it), and `demoMode` and `sample` are true so
 * every control that writes stays off. The real read still runs underneath, so
 * turning the switch off shows the user's own entries at once. While the
 * sample arrives the page keeps its loading state rather than showing a
 * sign-in dead end.
 *
 * Inside the scope it also tells the switch whether the real read found
 * anything, so the automatic default never covers real entries with examples.
 */
export function useOnCallEntries(): OnCallEntriesState {
  const stored = useStoredOnCallEntries();
  const scope = useContext(OnCallExampleScopeContext);
  const [sampleEntries, setSampleEntries] = useState<OnCallEntry[] | null>(null);
  const { signedOut, loading, isOffline, demoMode, entries } = stored;
  const signedOutSample = signedOut && !loading && !isOffline;
  // The automatic default waits for the real read, so it never flashes
  // examples over entries the account turns out to have.
  const switchSample = scope !== null && scope.active && (scope.explicit || !loading);
  const sampling = signedOutSample || switchSample;

  // Only a settled, signed-in, live read says anything about real data.
  const realState: "empty" | "has-data" | null =
    scope === null || loading || isOffline || signedOut || demoMode
      ? null
      : entries.some((entry) => !isOnCallExampleEntry(entry))
        ? "has-data"
        : "empty";

  useEffect(() => {
    if (realState === null) return;
    reportAreaData("call", realState);
    reportAreaData("admin", realState);
  }, [realState]);

  useEffect(() => {
    if (!sampling) return;
    let cancelled = false;
    void loadExampleDataset("onCall.entries").then((rows) => {
      if (cancelled) return;
      const copies = rows.map((row) => ({ ...row }));
      for (const copy of copies) shownExampleEntries.add(copy);
      setSampleEntries(copies);
    });
    return () => {
      cancelled = true;
    };
  }, [sampling]);

  if (!sampling) return stored;
  return {
    ...stored,
    entries: sampleEntries ?? [],
    cachedAt: null,
    loading: sampleEntries === null,
    isOffline: false,
    loadError: null,
    signedOut: false,
    demoMode: true,
    sample: true,
  };
}
