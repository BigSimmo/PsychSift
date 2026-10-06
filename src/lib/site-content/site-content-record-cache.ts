/**
 * Short-lived process cache for the canonical site-content catalogue read.
 *
 * WHY THIS EXISTS. Until 2026-09-09 the registry domains of universal search read their
 * catalogue through `owner-catalogue-cache` (5 s TTL, single flight, LRU) and asked Postgres for
 * roughly twenty named ranking columns, and only for a signed-in owner. Commit b753ed2b1
 * replaced all of that with `read_site_content_public_records`, which is the right source of
 * truth but arrived with no cache, the full `record` and `render_payload` JSON per row, and
 * every caller rather than owners alone. `src/lib/universal-search.ts` calls it once per registry
 * domain per search, so one federated search became three uncached round trips for a catalogue
 * that changes only when an operator publishes, and a debounced typeahead multiplied that again.
 * Search went from effectively instant to visibly slow across every catalogue mode at once.
 * (`owner-catalogue-cache` itself was deleted on 2026-09-19, issue `#BDJWAH`: it had kept its two
 * `invalidateOwnerCatalogueCache` calls in the seed writers for ten days after losing its last
 * reader, so publication looked cache-aware when nothing was being invalidated.
 * `docs/audit/2026-09-16-registry-search-outage.md` is the surviving record of what it did.)
 *
 * This restores the cache half. The wide payload is a property of the SQL function and cannot be
 * narrowed from here without a migration, which reaches the live clinical database on merge.
 *
 * The rows are a pure function of (kind, slug) plus the control plane's served state, and the
 * function is the PUBLIC projection, so nothing here is owner-scoped or per-request and one
 * process-wide cache is safe. That is not incidental: never widen this to a read that takes an
 * owner, a session or any caller identity.
 *
 * HOW STALENESS IS BOUNDED. A plain TTL still makes one unlucky reader per window wait for the
 * whole query, which is the symptom this exists to remove. So a cached entry has two ages:
 *
 *   * Within `siteContentRecordCacheTtlMs` it is fresh and served as is.
 *   * Between that and `siteContentRecordCacheStaleMs` it is served IMMEDIATELY and a refresh
 *     runs in the background. Nobody waits, and under any continued use the served catalogue is
 *     never more than the fresh window plus one query behind the database.
 *   * Beyond `siteContentRecordCacheStaleMs` it is discarded and the caller waits for a real
 *     read, so an idle process cannot serve something genuinely old.
 *
 * THE TTL IS THE WHOLE CONTRACT. THERE IS DELIBERATELY NO PUBLICATION-TIME INVALIDATION.
 * Settled 2026-09-19 under issue `#BDJWAH`, which asked the question directly. Four reasons, in
 * the order that decides it; reopen this only if one of them stops being true.
 *
 *   1. A PUBLICATION DOES NOT CHANGE WHAT THIS READ RETURNS. `read_site_content_public_records`
 *      serves `site_content_sync_state.active_release_id`. `publish_site_content_record` does not
 *      touch it: it raises a record's `head_change_epoch` above the served epoch, which makes the
 *      record `outstanding`, which makes every whole-catalogue read (the only reads that opt in
 *      here) return NO rows with `state = 'updating'`. Rule 1 below already refuses to store that
 *      and evicts on sight. The served catalogue changes only at `activate_site_content_release`
 *      or `rollback_site_content_release`.
 *   2. SO INVALIDATING ON PUBLISH WOULD MAKE THINGS WORSE, NOT STALER. Dropping the entry the
 *      moment an operator publishes replaces a complete, correct, last-known-good catalogue with
 *      an `updating` read that returns nothing, and the caller's seed fallback then serves the
 *      in-bundle copy shipped in the build. Readers would get OLDER content, not newer, for the
 *      whole span between the publish and the activation.
 *   3. NOTHING IN THIS PROCESS OBSERVES THE MOMENT THAT DOES MATTER. `activateSiteContentRelease`
 *      and `rollbackSiteContentRelease` have no caller anywhere in `src/`; the runbook that owns
 *      them calls them operator-driven and rare (`docs/site-content-sync-runbook.md`). There is no
 *      in-process event to hang a hook on, and a hook wired to the publication route instead
 *      would be a hook on the wrong event — which is exactly how the retired
 *      `invalidateOwnerCatalogueCache` came to be called by writers nothing read.
 *   4. AND IT WOULD NOT BE A GUARANTEE EVEN THEN. This map is per process. Production runs one
 *      warm replica today, but `docs/deployment-architecture.md` § 2.1 carries a scale-out plan
 *      to N, and an in-process clear reaches one cache of N while the other N-1 keep serving the
 *      same window. A control that silently covers 1/N is the misleading yes `#BDJWAH` was
 *      raised about.
 *
 * What bounds staleness instead: the 15 s fresh window plus one background query under continued
 * use, a 10 min hard ceiling when idle, and the fact that only the four whole-catalogue LIST
 * reads opt in at all — detail, publication and reconciliation reads deliberately do not, so an
 * operator checking their own record still sees their own change immediately.
 *
 * IF THIS DOES NEED REVISITING, the right mechanism is not this function. It would be a cheap
 * cross-process freshness probe — the snapshot already carries `releaseId` and `changeEpoch`, so
 * a reader could compare a served epoch against the live one without paying the whole canonical
 * read. `clearSiteContentRecordCache` below cannot do that job and was never going to.
 *
 * CONSERVATIVE BY CONSTRUCTION. Three rules keep a cache from prolonging a degraded or
 * mid-publication state, which on clinical content matters more than the latency it buys:
 *
 *   1. Only a settled snapshot is stored: `current`, or a retained epoch-zero bootstrap, which
 *      is frozen by definition. `updating` (a publication is outstanding) and a genuinely broken
 *      `unavailable` are re-read every time, so a degraded catalogue is re-checked on each
 *      request rather than pinned for the whole window. See `rowsAreCacheable` for why the
 *      bootstrap belongs on the cacheable side and why it is matched by release id, not by the
 *      absence of `current`.
 *   2. A failed blocking read is never stored and never served. The caller's existing fallback
 *      to the in-bundle seed catalogue stays reachable. A failed BACKGROUND refresh is
 *      different and deliberately does not evict: the last known-good canonical rows keep
 *      serving until their stale ceiling, because they are a better answer than seeds and the
 *      ceiling still bounds how long that can last.
 *   3. The windows are a ceiling on how long a freshly published record can stay invisible to
 *      search. Keep them short enough that an operator publishing a change does not think the
 *      publication failed.
 *
 * A READ THAT HAS STARTED IS ALLOWED TO FINISH, and this is what kept search on seeds for weeks.
 * Until 2026-10-06 a blocking flight was cancelled the moment its last waiter walked away. Search
 * waits 1200 ms (`catalogue-seed-fallback`), and from Railway the service and medication reads
 * take longer than that, so the waiter always walked away first: the query was aborted, nothing
 * was stored, the 30 s cooldown served seeds, and the next probe started the same doomed read
 * from scratch. Once the warm entry passed its 10 min ceiling the process never filled the cache
 * again until it restarted. The live domain monitor failed 25 of its last 29 runs on exactly this.
 *
 * So a waiter leaving no longer cancels anything. The flight carries on, stores its rows, and the
 * next reader is served from cache. What still bounds it is `siteContentRecordCacheFlightTimeoutMs`
 * on EVERY flight, blocking or background, so a hung query cannot be retained forever. The cost is
 * at most one whole-catalogue read per key in flight at a time, which the single flight already
 * guaranteed; an abandoned typeahead keystroke now finishes that one read instead of throwing it
 * away and making the next keystroke start another.
 */

import { isRetainedBootstrapReleaseId } from "@/lib/site-content/site-content-health";

/** How long a cached catalogue is served without any refresh at all. */
export const siteContentRecordCacheTtlMs = 15_000;

/**
 * How long a cached catalogue may still be served while a refresh runs behind it. Past this it
 * is discarded rather than served, so an idle container cannot answer from something old.
 */
export const siteContentRecordCacheStaleMs = 10 * 60_000;

/**
 * Hard cap on retained keys. Search caches five list reads at most (one per kind), so this is
 * never reached today. It exists because the key includes a caller-supplied slug: the day a
 * per-slug read opts in, an unbounded map keyed by slug becomes a memory-growth path in a
 * long-lived container, and a cap is a cheaper guarantee than remembering not to do that.
 */
export const siteContentRecordCacheMaxEntries = 32;

/**
 * Deadline on every flight. A flight may outlive all of its callers (see "A READ THAT HAS STARTED
 * IS ALLOWED TO FINISH" above), and a background refresh never had one, so this is what stops one
 * hung query from becoming a permanently hung flight that every later reader joins.
 *
 * 10 s is far past any healthy read (the largest catalogue, medication, is ~2.7 MB) and well
 * inside anything a reader would notice, because no reader waits on it: readers are bounded by
 * their own signals.
 */
export const siteContentRecordCacheFlightTimeoutMs = 10_000;

export type SiteContentRecordRows = Array<Record<string, unknown>>;

/** Which of the three ages answered this call. Reported for tests and telemetry, not policy. */
export type SiteContentRecordCacheAge = "fresh" | "stale" | "miss";

type CacheEntry = { rows: SiteContentRecordRows; storedAt: number };

type Inflight = {
  promise: Promise<SiteContentRecordRows>;
  /** Aborted only by the flight deadline. No caller can cancel a flight, by design. */
  controller: AbortController;
};

/**
 * Held on `globalThis` because the bundler gives each server layer its own copy of this module: a
 * production build has one copy for `instrumentation.ts` and another for the route handlers
 * (checked 2026-09-26, `next build --webpack`). Module-level maps would let the startup warm fill a
 * cache no request ever reads.
 */
const processCacheKey = Symbol.for("psychsift.siteContentRecordCache");
type ProcessCache = { entries: Map<string, CacheEntry>; inflight: Map<string, Inflight> };
const processCache = ((globalThis as { [processCacheKey]?: ProcessCache })[processCacheKey] ??= {
  entries: new Map(),
  inflight: new Map(),
});
const entries = processCache.entries;
const inflight = processCache.inflight;

/** `kind` is a fixed control-plane enum, so a literal separator cannot collide with a slug. */
function cacheKey(kind: string, slug: string | null, projection: "full" | "render") {
  return `${kind}::${slug ?? ""}::${projection}`;
}

/**
 * The snapshot the RPC returns alongside every row. A payload we cannot read is treated as not
 * cacheable rather than assumed healthy.
 *
 * TWO states are cacheable, and the second is the one production is actually in.
 *
 *   * `current` — the healthy steady state. Rule 1 above.
 *   * A RETAINED EPOCH-ZERO BOOTSTRAP, which `read_site_content_public_records` reports as
 *     `unavailable` because it hard-codes the bootstrap release id to that state
 *     (`20260916103000_push_kind_filter_into_site_content_public_records.sql`). Production has
 *     served that bootstrap since 2026-08-24 (ledger `#HTZPQ8`), so this cache stored NOTHING
 *     between the day it shipped and the day this was fixed, and every request paid the full
 *     canonical read. Measured live 2026-09-17: worst call 92,319 ms, and 63% of all slow
 *     database time on the instance.
 *
 * Caching the bootstrap does not weaken rule 1, because rule 1 is about not pinning a state the
 * control plane is moving through. A retained bootstrap is not a state anything is moving
 * through: it is frozen by definition, it changes only when an operator publishes a new release
 * (which changes the release id and so misses this test), and it is therefore the single most
 * cacheable thing the control plane can return. `updating` and a genuinely broken `unavailable`
 * are still re-read every time.
 *
 * The bootstrap is recognised POSITIVELY, by release id, through the same canonical helper the
 * form-record gate uses. Never widen this to "not current" — that would cache real breakage.
 */
function rowsAreCacheable(rows: SiteContentRecordRows) {
  const snapshot = rows.find((row) => row.snapshot != null)?.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const state = (snapshot as Record<string, unknown>).state;
  if (state === "current") return true;
  const releaseId = (snapshot as Record<string, unknown>).releaseId;
  return typeof releaseId === "string" && isRetainedBootstrapReleaseId(releaseId);
}

/**
 * Retain `rows` under `key`, dropping anything past its stale ceiling and then, if the cap is
 * still exceeded, the least recently stored key. `Map` iterates in insertion order and every
 * store re-inserts, so the first key is the oldest.
 */
function retain(key: string, rows: SiteContentRecordRows, now: () => number) {
  const at = now();
  for (const [candidate, entry] of entries) {
    if (at - entry.storedAt >= siteContentRecordCacheStaleMs) entries.delete(candidate);
  }
  entries.delete(key);
  entries.set(key, { rows, storedAt: at });
  while (entries.size > siteContentRecordCacheMaxEntries) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

function callerAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

function awaitWithCallerSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(callerAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(callerAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

type Read = (signal?: AbortSignal) => Promise<SiteContentRecordRows>;

/**
 * Start a read for `key`, or return the one already running. A background refresh and a
 * blocking read share the same flight, so a reader arriving mid-refresh waits for that refresh
 * rather than starting a second identical query.
 */
function startFlight(key: string, read: Read, now: () => number): Inflight {
  const existing = inflight.get(key);
  // A flight is only ever aborted by its own deadline, and it leaves the map as it settles, so an
  // aborted one here is a dying flight: start fresh rather than join it.
  if (existing && !existing.controller.signal.aborted) return existing;
  if (existing && inflight.get(key) === existing) inflight.delete(key);

  const controller = new AbortController();
  const created: Inflight = { promise: Promise.resolve([]), controller };
  // Every flight can outlive its callers, so every flight needs its own deadline. Without it a
  // read that never settles is held in `inflight` forever: every later caller joins that hung
  // flight and waits on it, and nothing recovers until the process restarts.
  // The deadline also releases the flight itself, rather than waiting for the read to notice, so
  // a read that ignores its signal cannot keep later callers joining it; waiters are released by
  // racing this same signal in `readSiteContentRecordsCached`.
  const deadline = setTimeout(() => {
    controller.abort(new DOMException("Site-content catalogue read timed out.", "TimeoutError"));
    if (inflight.get(key) === created) inflight.delete(key);
  }, siteContentRecordCacheFlightTimeoutMs);
  (deadline as { unref?: () => void }).unref?.();

  created.promise = (async () => {
    const rows = await read(controller.signal);
    // A read that ignored its signal and answered after the deadline is not stored: the deadline
    // is what callers were promised, and they have already been released (see the timer above).
    controller.signal.throwIfAborted();
    // Rule 1: a snapshot that is no longer `current` must EVICT, not merely decline to store.
    // Leaving the previous rows in place would keep serving a catalogue the control plane is
    // deliberately suppressing mid-publication, for the rest of the stale window.
    if (rowsAreCacheable(rows)) retain(key, rows, now);
    else entries.delete(key);
    return rows;
  })().finally(() => {
    clearTimeout(deadline);
    if (inflight.get(key) === created) inflight.delete(key);
  });
  // Nobody may be awaiting this any more (every waiter can leave), so a failure must not surface
  // as an unhandled rejection. Waiters still see it through their own `await`.
  created.promise.catch(() => {});
  inflight.set(key, created);
  return created;
}

/**
 * Serve `kind`/`slug` from cache where possible, refreshing behind the reader when the entry is
 * merely stale, and otherwise running `read` once and sharing that flight with every concurrent
 * caller for the same key.
 *
 * Sharing the flight matters on a cold cache: without it the first search of a session still
 * issues one query per domain, and a burst of users on a cold container stampedes the same
 * expensive read. A caller abort releases only that caller; the flight runs on to completion (or
 * its deadline) and fills the cache, because a search that gave up at its budget is exactly the
 * reader who most needs the next search to find the rows already stored.
 */
export async function readSiteContentRecordsCached(input: {
  kind: string;
  slug: string | null;
  /** A render-only search read must never populate a full list's governance cache. */
  projection?: "full" | "render";
  signal?: AbortSignal;
  read: Read;
  now?: () => number;
}): Promise<{ rows: SiteContentRecordRows; age: SiteContentRecordCacheAge }> {
  const now = input.now ?? Date.now;
  const key = cacheKey(input.kind, input.slug, input.projection ?? "full");

  const cached = entries.get(key);
  if (cached) {
    const age = now() - cached.storedAt;
    if (age < siteContentRecordCacheTtlMs) {
      input.signal?.throwIfAborted();
      return { rows: cached.rows, age: "fresh" };
    }
    if (age < siteContentRecordCacheStaleMs) {
      input.signal?.throwIfAborted();
      // Refresh behind the reader. A failure here deliberately leaves the entry in place: see
      // rule 2. `startFlight` already consumes the rejection.
      startFlight(key, input.read, now);
      return { rows: cached.rows, age: "stale" };
    }
    entries.delete(key);
  }

  input.signal?.throwIfAborted();
  const entry = startFlight(key, input.read, now);
  // Released by whichever comes first: the rows, this caller's own abort, or the flight deadline.
  const released = AbortSignal.any(input.signal ? [input.signal, entry.controller.signal] : [entry.controller.signal]);
  return { rows: await awaitWithCallerSignal(entry.promise, released), age: "miss" };
}

/**
 * Test seam only. It is NOT a publication hook: see "THE TTL IS THE WHOLE CONTRACT" in the header
 * for why this module has none, and what to build instead if that ever has to change.
 */
export function clearSiteContentRecordCache() {
  entries.clear();
  inflight.clear();
}
