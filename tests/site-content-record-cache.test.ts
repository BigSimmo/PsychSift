import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSiteContentRecordCache,
  readSiteContentRecordsCached,
  siteContentRecordCacheFlightTimeoutMs,
  siteContentRecordCacheMaxEntries,
  siteContentRecordCacheRefreshTimeoutMs,
  siteContentRecordCacheStaleMs,
  siteContentRecordCacheTtlMs,
  type SiteContentRecordRows,
} from "@/lib/site-content/site-content-record-cache";

function rows(state: "current" | "updating" | "unavailable", records = 1): SiteContentRecordRows {
  return Array.from({ length: records }, (_unused, index) => ({
    initialized: true,
    record: { slug: `record-${index}` },
    render_payload: { slug: `record-${index}` },
    snapshot: { state, changeEpoch: "7" },
  }));
}

/**
 * The shape production actually returns: `unavailable`, but carrying a release id. The live RPC
 * reports the retained epoch-zero bootstrap that way by construction, so this is the only row
 * shape that exercises the path every real request takes.
 */
function bootstrapRows(releaseId: string, records = 1): SiteContentRecordRows {
  return Array.from({ length: records }, (_unused, index) => ({
    initialized: true,
    record: { slug: `record-${index}` },
    render_payload: { slug: `record-${index}` },
    snapshot: { state: "unavailable", changeEpoch: "0", releaseId },
  }));
}

/** A clock the tests advance deliberately, so TTL expiry is asserted rather than waited for. */
function clock(startedAt = 1_000_000) {
  let value = startedAt;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  clearSiteContentRecordCache();
});

describe("readSiteContentRecordsCached", () => {
  it("serves a second read of the same kind from cache instead of querying again", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));

    const first = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    const second = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

    expect(read).toHaveBeenCalledTimes(1);
    expect(first.age).toBe("miss");
    expect(second.age).toBe("fresh");
    expect(second.rows).toEqual(first.rows);
  });

  it("keeps render-only medication search rows apart from the full governance rows", async () => {
    const time = clock();
    const renderRead = vi.fn(async () => [
      {
        initialized: true,
        render_payload: { slug: "published" },
        snapshot: { state: "current", releaseId: "11111111-1111-5111-8111-111111111111" },
      },
    ]);
    const fullRead = vi.fn(async () => rows("current"));

    const search = await readSiteContentRecordsCached({
      kind: "medication",
      slug: null,
      projection: "render",
      read: renderRead,
      now: time.now,
    });
    const list = await readSiteContentRecordsCached({
      kind: "medication",
      slug: null,
      projection: "full",
      read: fullRead,
      now: time.now,
    });
    const repeat = await readSiteContentRecordsCached({
      kind: "medication",
      slug: null,
      projection: "render",
      read: renderRead,
      now: time.now,
    });

    expect(search.rows[0]).not.toHaveProperty("record");
    expect(list.rows[0]).toHaveProperty("record");
    expect(renderRead).toHaveBeenCalledTimes(1);
    expect(fullRead).toHaveBeenCalledTimes(1);
    expect(repeat.age).toBe("fresh");
  });

  it("shares one cache across separately loaded copies of the module", async () => {
    // A production build loads this module once for instrumentation.ts and again for the route
    // handlers; the startup warm only helps if both copies read the same entries.
    const time = clock();
    const read = vi.fn(async () => rows("current"));
    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

    vi.resetModules();
    const otherCopy = await import("@/lib/site-content/site-content-record-cache");
    const fromOtherCopy = await otherCopy.readSiteContentRecordsCached({
      kind: "form",
      slug: null,
      read,
      now: time.now,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(fromOtherCopy.age).toBe("fresh");
  });

  it("holds the fresh window, then refreshes once past it", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    time.advance(siteContentRecordCacheTtlMs - 1);
    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    expect(read).toHaveBeenCalledTimes(1);

    time.advance(2);
    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps each kind on its own entry", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    await readSiteContentRecordsCached({ kind: "service", slug: null, read, now: time.now });
    await readSiteContentRecordsCached({ kind: "medication", slug: null, read, now: time.now });

    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps a slug read separate from the list read for the same kind", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    await readSiteContentRecordsCached({ kind: "form", slug: "mha-form-1", read, now: time.now });

    expect(read).toHaveBeenCalledTimes(2);
  });

  // Rule 1: a degraded control plane is re-read every request, never pinned for the TTL.
  it.each(["updating", "unavailable"] as const)(
    "does not cache a %s snapshot that carries no retained-bootstrap release",
    async (state) => {
      const time = clock();
      const read = vi.fn(async () => rows(state));

      await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  // THE REGRESSION THIS FILE MISSED. The cache shipped 2026-09-16 and stored nothing in
  // production for the next eight days, while every suite here stayed green, because every case
  // above drives `state` directly and production's state is reached a different way:
  // `read_site_content_public_records` hard-codes the retained epoch-zero bootstrap release to
  // report `unavailable` (20260916103000). Production has served that bootstrap since
  // 2026-08-24, so `rowsAreCacheable` was false on every real request. Measured live 2026-09-17,
  // before the fix: worst catalogue read 92,319 ms, 63% of all slow database time.
  //
  // Asserting the flag is passed, or that some snapshot caches, would not have caught it. Only
  // driving the shape production actually returns does.
  it("caches a retained epoch-zero bootstrap even though it reports unavailable", async () => {
    const time = clock();
    const read = vi.fn(async () => bootstrapRows("e4a1dd29-14f6-556c-8fb7-f4f947d8b846"));

    const first = await readSiteContentRecordsCached({ kind: "differential", slug: null, read, now: time.now });
    const second = await readSiteContentRecordsCached({ kind: "differential", slug: null, read, now: time.now });

    expect(read).toHaveBeenCalledTimes(1);
    expect(first.age).toBe("miss");
    expect(second.age).toBe("fresh");
    expect(second.rows).toEqual(first.rows);
  });

  // The other half of the contract: the fix recognises the bootstrap POSITIVELY, by release id.
  // Widening it to "anything that is not current" would cache genuine breakage for ten minutes,
  // which is the failure rule 1 exists to prevent.
  it("still refuses an unavailable snapshot whose release is not a retained bootstrap", async () => {
    const time = clock();
    const read = vi.fn(async () => bootstrapRows("11111111-2222-3333-4444-555555555555"));

    await readSiteContentRecordsCached({ kind: "differential", slug: null, read, now: time.now });
    await readSiteContentRecordsCached({ kind: "differential", slug: null, read, now: time.now });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not cache rows whose snapshot is missing or unreadable", async () => {
    const time = clock();
    const read = vi.fn(async () => [{ initialized: true, record: {}, render_payload: {}, snapshot: null }]);

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

    expect(read).toHaveBeenCalledTimes(2);
  });

  // Rule 2: no stale-while-error path. The caller's seed fallback must stay reachable.
  it("propagates a failure and caches nothing", async () => {
    const time = clock();
    const read = vi.fn(async () => {
      throw new Error("Canonical site-content read failed: boom");
    });

    await expect(readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now })).rejects.toThrow(
      /boom/,
    );
    await expect(readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now })).rejects.toThrow(
      /boom/,
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  // The point of the stale window: past the fresh TTL the reader is served immediately and the
  // refresh happens behind them. Nobody waits for the query, which is the whole regression.
  it("serves a stale entry at once and refreshes behind the reader", async () => {
    const time = clock();
    const gate = deferred<SiteContentRecordRows>();
    const read = vi
      .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
      .mockResolvedValueOnce(rows("current", 1))
      .mockImplementationOnce(() => gate.promise);

    const first = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    time.advance(siteContentRecordCacheTtlMs + 1);

    // Resolves while the refresh is still in flight, and returns the previous rows.
    const second = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    expect(second.age).toBe("stale");
    expect(second.rows).toEqual(first.rows);
    expect(read).toHaveBeenCalledTimes(2);

    gate.resolve(rows("current", 2));
    await gate.promise;
    const third = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    expect(third.age).toBe("fresh");
    expect(third.rows).toHaveLength(2);
  });

  // Rule 2, second half. A failed BACKGROUND refresh must not evict: the last known-good
  // canonical rows are a better answer than the seed catalogue, and the ceiling still bounds it.
  it("keeps serving the last good rows when a background refresh fails", async () => {
    const time = clock();
    const read = vi
      .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
      .mockResolvedValueOnce(rows("current"))
      .mockRejectedValue(new Error("boom"));

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    time.advance(siteContentRecordCacheTtlMs + 1);

    const served = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    expect(served.age).toBe("stale");
    expect(served.rows).toEqual(rows("current"));
  });

  // Review finding #2805 (P1). Declining to STORE a degraded snapshot is not enough: the prior
  // `current` entry has to go, or search keeps serving a catalogue the control plane is
  // deliberately suppressing mid-publication for the rest of the stale window.
  it.each(["updating", "unavailable"] as const)(
    "evicts the cached rows when a background refresh reports %s",
    async (state) => {
      const time = clock();
      const read = vi
        .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
        .mockResolvedValueOnce(rows("current"))
        .mockResolvedValue(rows(state));

      await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      time.advance(siteContentRecordCacheTtlMs + 1);

      // Serves the stale rows once while the refresh runs, which is the contract.
      const duringRefresh = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      expect(duringRefresh.age).toBe("stale");
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));

      // Once that refresh lands degraded the entry is gone, so the next read is a real one.
      const afterRefresh = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      expect(afterRefresh.age).toBe("miss");
    },
  );

  // Review finding #2805 (P2). A background refresh has no waiter to cancel it, so a hung query
  // would otherwise stay in the flight map and every later caller would join it forever.
  it("gives a background refresh its own deadline so a hung one cannot trap later callers", async () => {
    vi.useFakeTimers();
    try {
      const time = clock();
      const hung = deferred<SiteContentRecordRows>();
      let refreshSignal: AbortSignal | undefined;
      const read = vi
        .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
        .mockResolvedValueOnce(rows("current"))
        .mockImplementationOnce((signal) => {
          refreshSignal = signal;
          return hung.promise;
        });

      await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      time.advance(siteContentRecordCacheTtlMs + 1);
      await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      expect(refreshSignal?.aborted).toBe(false);

      vi.advanceTimersByTime(siteContentRecordCacheRefreshTimeoutMs);
      expect(refreshSignal?.aborted).toBe(true);
      expect((refreshSignal?.reason as DOMException).name).toBe("TimeoutError");
    } finally {
      vi.useRealTimers();
    }
  });

  // Rule 2, first half, and the ceiling that stops "stale" becoming "indefinite".
  it("stops serving past the stale ceiling and surfaces the failure instead", async () => {
    const time = clock();
    const read = vi
      .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
      .mockResolvedValueOnce(rows("current"))
      .mockRejectedValue(new Error("boom"));

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    time.advance(siteContentRecordCacheStaleMs);

    await expect(readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now })).rejects.toThrow(
      /boom/,
    );
  });

  it("does not let a reader who joins a background refresh cancel it", async () => {
    const time = clock();
    const gate = deferred<SiteContentRecordRows>();
    let refreshSignal: AbortSignal | undefined;
    const read = vi
      .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
      .mockResolvedValueOnce(rows("current"))
      .mockImplementationOnce((signal) => {
        refreshSignal = signal;
        return gate.promise;
      });

    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    time.advance(siteContentRecordCacheStaleMs - 1);
    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

    // Past the ceiling this caller must block, so it joins the refresh already running.
    time.advance(2);
    const caller = new AbortController();
    const blocked = readSiteContentRecordsCached({
      kind: "form",
      slug: null,
      signal: caller.signal,
      read,
      now: time.now,
    });
    caller.abort();
    await expect(blocked).rejects.toThrow();

    expect(refreshSignal?.aborted).toBe(false);
    gate.resolve(rows("current", 3));
    await expect(gate.promise).resolves.toHaveLength(3);
  });

  it("keeps the retained set bounded and evicts the oldest key first", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));
    const keys = siteContentRecordCacheMaxEntries + 4;

    for (let index = 0; index < keys; index += 1) {
      await readSiteContentRecordsCached({ kind: "form", slug: `slug-${index}`, read, now: time.now });
    }
    expect(read).toHaveBeenCalledTimes(keys);

    // The four oldest keys were evicted, so re-reading the very first one queries again while
    // the most recent one is still served from cache.
    await readSiteContentRecordsCached({ kind: "form", slug: "slug-0", read, now: time.now });
    expect(read).toHaveBeenCalledTimes(keys + 1);

    await readSiteContentRecordsCached({ kind: "form", slug: `slug-${keys - 1}`, read, now: time.now });
    expect(read).toHaveBeenCalledTimes(keys + 1);
  });

  it("prunes a key past its stale ceiling on the next store, leaving the fresh one alone", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));

    await readSiteContentRecordsCached({ kind: "form", slug: "abandoned", read, now: time.now });
    time.advance(siteContentRecordCacheStaleMs);
    // Storing this key runs the prune, which must drop the abandoned one and keep this one.
    await readSiteContentRecordsCached({ kind: "service", slug: null, read, now: time.now });

    await readSiteContentRecordsCached({ kind: "service", slug: null, read, now: time.now });
    expect(read).toHaveBeenCalledTimes(2);

    // The abandoned key is gone rather than merely stale, so it blocks on a real read.
    const revisited = await readSiteContentRecordsCached({ kind: "form", slug: "abandoned", read, now: time.now });
    expect(revisited.age).toBe("miss");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("shares one flight between concurrent callers for the same key", async () => {
    const time = clock();
    const gate = deferred<SiteContentRecordRows>();
    const read = vi.fn(() => gate.promise);

    const a = readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    const b = readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
    gate.resolve(rows("current"));

    const [first, second] = await Promise.all([a, b]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(first.rows).toEqual(second.rows);
    expect(second.age).toBe("miss");
  });

  it("keeps the shared query running when one of several waiters aborts", async () => {
    const time = clock();
    const gate = deferred<SiteContentRecordRows>();
    let readSignal: AbortSignal | undefined;
    const read = vi.fn((signal?: AbortSignal) => {
      readSignal = signal;
      return gate.promise;
    });

    const abandoned = new AbortController();
    const abandonedRead = readSiteContentRecordsCached({
      kind: "form",
      slug: null,
      signal: abandoned.signal,
      read,
      now: time.now,
    });
    const survivor = readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

    abandoned.abort();
    await expect(abandonedRead).rejects.toThrow();
    expect(readSignal?.aborted).toBe(false);

    gate.resolve(rows("current"));
    await expect(survivor).resolves.toMatchObject({ rows: rows("current") });
  });

  // THE 2026-10 LIVE DEFECT. This case used to assert the opposite: that the query was cancelled
  // when its last waiter left. Search's waiter is the 1200 ms seed-fallback budget, and from
  // Railway the service and medication reads take longer than that, so the waiter always left
  // first, the query was always cancelled, nothing was ever stored, and both domains served seeds
  // until the process restarted (live domain monitor: 25 of 29 runs failing).
  it("lets the query finish and fill the cache when its last waiter gives up", async () => {
    const time = clock();
    const gate = deferred<SiteContentRecordRows>();
    let readSignal: AbortSignal | undefined;
    const read = vi.fn((signal?: AbortSignal) => {
      readSignal = signal;
      return gate.promise;
    });

    const caller = new AbortController();
    const pending = readSiteContentRecordsCached({
      kind: "service",
      slug: null,
      projection: "render",
      signal: caller.signal,
      read,
      now: time.now,
    });

    caller.abort(new DOMException("Canonical service read exceeded 1200ms.", "TimeoutError"));
    await expect(pending).rejects.toThrow(/exceeded 1200ms/);
    expect(readSignal?.aborted).toBe(false);

    // The read answers after the caller has gone. The next reader is served from cache.
    gate.resolve(rows("current", 2));
    await gate.promise;
    await Promise.resolve();
    const next = await readSiteContentRecordsCached({
      kind: "service",
      slug: null,
      projection: "render",
      read,
      now: time.now,
    });
    expect(next).toMatchObject({ age: "fresh", rows: rows("current", 2) });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("lets a later caller join a flight every earlier caller abandoned, rather than start another", async () => {
    const time = clock();
    const gate = deferred<SiteContentRecordRows>();
    const read = vi.fn(() => gate.promise);

    const caller = new AbortController();
    const abandoned = readSiteContentRecordsCached({
      kind: "medication",
      slug: null,
      signal: caller.signal,
      read,
      now: time.now,
    });
    caller.abort();
    await expect(abandoned).rejects.toThrow();

    // The cold retry in `catalogue-seed-fallback` arrives here: it should wait on the query that is
    // already most of the way through, not start a second cold one.
    const retry = readSiteContentRecordsCached({ kind: "medication", slug: null, read, now: time.now });
    gate.resolve(rows("current"));
    await expect(retry).resolves.toMatchObject({ age: "miss", rows: rows("current") });
    expect(read).toHaveBeenCalledTimes(1);
  });

  // The bound that replaces cancellation. A flight that every caller has left must still die.
  it("still cuts an abandoned flight off at its deadline, stores nothing, and starts afresh after", async () => {
    vi.useFakeTimers();
    try {
      const time = clock();
      const hung = deferred<SiteContentRecordRows>();
      let firstSignal: AbortSignal | undefined;
      const read = vi
        .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
        .mockImplementationOnce((signal) => {
          firstSignal = signal;
          // Honours its signal, as the Supabase client does.
          signal?.addEventListener("abort", () => hung.reject(signal.reason), { once: true });
          return hung.promise;
        })
        .mockResolvedValueOnce(rows("current"));

      const caller = new AbortController();
      const abandoned = readSiteContentRecordsCached({
        kind: "form",
        slug: null,
        signal: caller.signal,
        read,
        now: time.now,
      });
      caller.abort();
      await expect(abandoned).rejects.toThrow();
      expect(firstSignal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(siteContentRecordCacheFlightTimeoutMs);
      expect(firstSignal?.aborted).toBe(true);
      expect((firstSignal?.reason as DOMException).name).toBe("TimeoutError");

      const healthy = readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      await expect(healthy).resolves.toMatchObject({ age: "miss" });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not store rows from a read that ignored its signal and answered after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const time = clock();
      const late = deferred<SiteContentRecordRows>();
      const read = vi
        .fn<(signal?: AbortSignal) => Promise<SiteContentRecordRows>>()
        .mockReturnValueOnce(late.promise)
        .mockResolvedValueOnce(rows("current", 4));

      const first = readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      const firstOutcome = expect(first).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(siteContentRecordCacheFlightTimeoutMs);
      late.resolve(rows("current", 9));
      await firstOutcome;

      const next = await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });
      expect(next).toMatchObject({ age: "miss", rows: rows("current", 4) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects an already-aborted caller without serving the cache", async () => {
    const time = clock();
    const read = vi.fn(async () => rows("current"));
    await readSiteContentRecordsCached({ kind: "form", slug: null, read, now: time.now });

    const aborted = AbortSignal.abort();
    await expect(
      readSiteContentRecordsCached({ kind: "form", slug: null, signal: aborted, read, now: time.now }),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

/**
 * Tripwire on the decision recorded in the module header under "THE TTL IS THE WHOLE CONTRACT":
 * this cache has NO publication-time invalidation, on purpose, and `clearSiteContentRecordCache`
 * is a test seam rather than the hook for one. Issue `#BDJWAH` settled that on 2026-09-19, after
 * the cache this one replaced spent ten days being "invalidated" by two writers whose reader had
 * already been deleted — a control that looked like a guarantee and was not.
 *
 * This is not a prohibition. If a publication-time invalidation is genuinely wanted, read the
 * four reasons in that header first — in particular that a publish makes the read report
 * `updating` rather than changing what it serves, so clearing on publish hands readers the
 * in-bundle seeds instead of the last good catalogue — then update the header and this test
 * together, so the next reader inherits the reasoning rather than a bare call site.
 */
describe("publication-time invalidation", () => {
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
  }

  it("is not wired up anywhere in src/, and the header says why", () => {
    const root = resolve(process.cwd(), "src");
    const owner = resolve(root, "lib/site-content/site-content-record-cache.ts");
    const callers = sourceFiles(root)
      .filter((path) => resolve(path) !== owner)
      .filter((path) => readFileSync(path, "utf8").includes("clearSiteContentRecordCache"))
      .map((path) => relative(process.cwd(), path));

    expect(callers).toEqual([]);
    expect(readFileSync(owner, "utf8")).toContain("THERE IS DELIBERATELY NO PUBLICATION-TIME INVALIDATION");
  });
});
