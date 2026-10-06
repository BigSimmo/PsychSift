/**
 * Keeps a registry search answering when the canonical catalogue read cannot.
 *
 * WHAT THIS EXISTS FOR, measured against production on 2026-09-16. `read_site_content_public_records`
 * was taking longer than the 2500 ms budget `universal-search` gives a registry domain, every single
 * time. The domain therefore aborted, produced an errored empty group, and Forms, Medications and
 * Services returned NOTHING on the live site:
 *
 *     {"kind":"medications","total":0,"items":[],"latencyMs":2501,"error":true}
 *     {"kind":"services",   "total":0,"items":[],"latencyMs":2502,"error":true}
 *     {"kind":"forms",      "total":0,"items":[],"latencyMs":2503,"error":true}
 *
 * The in-bundle seed catalogue was already being passed into that read and thrown away on failure,
 * even though it is exactly what those domains served before 2026-09-09 and is still what guests and
 * the demo corpus get. Returning it is strictly better than returning nothing.
 *
 * THIS IS A STOPGAP, NOT THE FIX. The defect is that the read is too slow; see the ledger row for the
 * `kind` filter that cannot reach the scan beneath the left join to `site_content_publications`. When
 * that lands this helper should stop reporting `degraded` on its own, which is the signal that it is
 * no longer load-bearing.
 *
 * WHY A COOLDOWN AND NOT JUST A TIMEOUT. A bare per-request budget makes every keystroke wait the
 * full budget before falling back, which is still slow search. After one failure the read is skipped
 * outright for `catalogueSeedFallbackCooldownMs`, so the first search pays the probe and the rest are
 * immediate. It re-probes after the cooldown, so the moment the database is fixed this heals itself
 * with no deploy.
 *
 * THE BUDGET BOUNDS THE WAIT, NOT THE READ (2026-10-06). A read that misses the budget is left to
 * finish, up to `catalogueBackgroundFillBudgetMs`, so it still fills the process cache, and if it
 * succeeds it lifts the cooldown at once. Before this the budget cancelled the read, the cancel
 * reached the cache, and a catalogue whose read took longer than the budget from Railway (services
 * and medications, routinely) could never be cached at all: it stayed on seeds until the process
 * restarted, which is what the live domain monitor reported on 25 of 29 runs.
 *
 * CLINICAL CAVEAT, and the reason `degraded` is returned rather than swallowed. Seeds can lag behind
 * anything published since the last release. That is acceptable for a search index whose entries all
 * link to a detail page that reads canonically, and it is bounded by the cooldown, but a caller must
 * be able to tell the reader that the list may be stale. Never drop `degraded` on the floor.
 *
 * WHY COLD READS ARE SERIALISED ACROSS KINDS. The one-shot retry above is per scope+kind. That is
 * not enough when `universal-search` `Promise.all`s forms, services and medications on an idle
 * process: each kind independently looks cold, three connection setups race, and all three blow the
 * 1200 ms budget (live monitor #2919; control experiment in #WFSMMT showed the penalty tracks
 * POSITION, not kind). Until this process has completed one successful canonical read, concurrent
 * callers share a single flight so only the first pays setup and the rest see a warm connection.
 * Once any kind has succeeded, the gate opens and steady-state parallelism is unchanged.
 */

import { logger } from "@/lib/logger";
import {
  siteContentRecordCacheFlightTimeoutMs,
  siteContentRecordCacheStaleMs,
} from "@/lib/site-content/site-content-record-cache";

/** How long one canonical read may take before the reader is served seeds instead. */
export const catalogueSeedFallbackBudgetMs = 1_200;

/**
 * The budget for a whole-catalogue LIST read, which is a different job from a search read.
 *
 * Search sits under a 2500 ms per-domain timeout, so 1200 ms is generous there. A list route has
 * no such ceiling and legitimately takes longer — the medication catalogue alone is megabytes — so
 * reusing the search budget would abandon healthy reads and pin those routes to seeds. A read that
 * takes longer than this is unhealthy by any reading, which is why it is still short enough to
 * matter to someone waiting for the page.
 */
export const catalogueListFallbackBudgetMs = 6_000;

/**
 * How long a read that has missed its budget may keep running so it can still fill the process
 * cache. Equal to the cache's own flight deadline: the read below this layer is cut off then
 * anyway, so waiting longer could never observe a success.
 */
export const catalogueBackgroundFillBudgetMs = siteContentRecordCacheFlightTimeoutMs;

/** How long to skip the canonical read entirely after it fails, before probing again. */
export const catalogueSeedFallbackCooldownMs = 30_000;

/**
 * Cooldown scopes. A cooldown says "a read under THIS budget failed recently", so it cannot be
 * shared across callers whose budgets differ by five seconds: a search giving up at 1200 ms is no
 * evidence that a list read allowed 6000 ms would also fail, and keying the cooldown on kind alone
 * meant one search timeout sent every list request straight to seeds without trying, silently
 * bypassing the longer budget the list routes were given.
 */
export const catalogueSearchScope = "search";
export const catalogueListScope = "list";

type Outcome<T> = {
  /** Mutable so the per-domain rankers can sort in place; the seed path is copied, never aliased. */
  records: T[];
  /** True when seeds were served because the canonical read failed, timed out, or is cooling down. */
  degraded: boolean;
};

/**
 * The budget for ONE retry of a scope+kind's FIRST read, and only that one. See
 * `readCatalogueWithSeedFallback` for why the first read is the one that needs it.
 *
 * Sized from the warm measurements rather than guessed: every warm read of every kind finished
 * inside 604 ms (2026-09-21, same PostgREST RPC the app calls — form 996 kB/216 ms,
 * differential 1.47 MB/264 ms, service 2.64 MB/396 ms, medication 4.66 MB/604 ms). A retry that
 * has not answered in 1000 ms is therefore not a cold connection, it is a sick one, and waiting
 * longer only delays the seeds.
 *
 * It is capped against the caller's own budget so it can never exceed it, and the search worst
 * case stays under the 2500 ms per-domain timeout the search budget is chosen against:
 * 1200 + 1000 = 2200 ms, paid at most once per scope+kind per cold period (see `warmedAt`).
 */
export const catalogueSeedFallbackRetryBudgetMs = 1_000;

const cooldownUntil = new Map<string, number>();

/**
 * When each scope+kind last completed a canonical read (or spent its retry). This is what makes the
 * retry below cost nothing in steady state: it is offered to a cold path only, so a genuine outage
 * after warm-up falls back at exactly the speed it always did.
 *
 * COLD AGAIN AFTER IDLE, not only once per process. Past `siteContentRecordCacheStaleMs` the record
 * cache discards its entry and the next read is a full blocking read on a connection that has gone
 * idle, which is the same cold penalty the retry exists for. The live monitor (#3037) probes every
 * six hours, always after idle: forms answered in 1151 ms, just inside the 1200 ms budget, while
 * the larger service and medication reads missed it with no retry left, because a Set spent the
 * retry on the process's first read days earlier. A timestamp re-offers it once per idle period,
 * which adds at most one retry budget per kind per ten minutes during a real outage.
 */
const warmedAt = new Map<string, number>();

function isColdKey(key: string, nowMs: number) {
  const at = warmedAt.get(key);
  return at === undefined || nowMs - at >= siteContentRecordCacheStaleMs;
}

/**
 * Process-level connection warm flag. Distinct from per-kind `warmedAt`: the measured cold penalty is
 * connection setup on the FIRST catalogue read of a process, shared across kinds. Boot pre-warm
 * and the serialisation gate below both set this.
 */
let processHasWarmedCanonicalRead = false;

/**
 * When the process was marked warm. The site-content record cache discards entries after
 * `siteContentRecordCacheStaleMs`; past that the next catalogue read is cold again, so the
 * serialisation gate must re-arm even though `processHasWarmedCanonicalRead` was set earlier.
 */
let processWarmedAtMs: number | null = null;

/**
 * Single owner of the cold path. Concurrent cold callers await the current owner rather than each
 * starting their own connection setup; once `processHasWarmedCanonicalRead` is true they all run
 * in parallel again.
 */
let processColdOwner: Promise<void> | null = null;

/**
 * After the first cold owner finishes WITHOUT warming the process, queued callers skip the gate.
 * Otherwise they await the full attempt+retry (~2200 ms) and the 2500 ms domain timeout aborts
 * them before seed fallback. Cleared on a successful warm, on stale re-arm, and on test reset.
 */
let processColdBypassSerialisation = false;

/** Cooldowns are per (scope, kind): see the scope constants for why kind alone was wrong. */
function cooldownKey(scope: string, kind: string) {
  return `${scope}::${kind}`;
}

function markProcessConnectionWarmedAt(nowMs: number) {
  processHasWarmedCanonicalRead = true;
  processWarmedAtMs = nowMs;
  processColdBypassSerialisation = false;
}

/**
 * Boot pre-warm (and tests) may populate the catalogue cache without going through this helper.
 * Marking the process warm there still opens the serialisation gate for the first real search.
 */
export function markCatalogueProcessConnectionWarmed(nowMs: number = Date.now()) {
  markProcessConnectionWarmedAt(nowMs);
}

/**
 * The record cache's idle ceiling has elapsed since we last warmed — the next read pays cold
 * connection setup again, so concurrent kinds must serialise once more.
 */
function rearmColdSerialisationIfStale(nowMs: number) {
  if (!processHasWarmedCanonicalRead || processWarmedAtMs === null) return;
  if (nowMs - processWarmedAtMs < siteContentRecordCacheStaleMs) return;
  processHasWarmedCanonicalRead = false;
  processWarmedAtMs = null;
  processColdBypassSerialisation = false;
}

function abortIsDomainTimeout(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  const reason = signal.reason;
  return reason instanceof DOMException
    ? reason.name === "TimeoutError"
    : reason instanceof Error && reason.name === "TimeoutError";
}

/**
 * Until one canonical read has succeeded in this process, run `work` under a single-flight gate so
 * `Promise.all` of forms/services/medications cannot triple the cold-connection penalty. After the
 * process is warm this is a no-op and callers proceed in parallel.
 *
 * A failed cold owner sets `processColdBypassSerialisation` so waiters do not serialise behind
 * another miss and can still reach seed fallback inside the domain timeout.
 */
async function runSerializedWhileProcessCold<T>(
  work: () => Promise<T>,
  signal: AbortSignal | undefined,
  now: () => number,
): Promise<T> {
  rearmColdSerialisationIfStale(now());
  if (processHasWarmedCanonicalRead || processColdBypassSerialisation) return work();

  while (!processHasWarmedCanonicalRead) {
    if (signal?.aborted) throw abortReason(signal);
    if (processColdBypassSerialisation) return work();
    if (processColdOwner) {
      await processColdOwner;
      continue;
    }

    let release!: () => void;
    processColdOwner = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      // A predecessor may have warmed us between the check above and claiming ownership.
      if (processHasWarmedCanonicalRead || processColdBypassSerialisation) return work();
      return await work();
    } finally {
      // Owner finished without warming: open the gate so queued domains keep their fallback window.
      if (!processHasWarmedCanonicalRead) processColdBypassSerialisation = true;
      processColdOwner = null;
      release();
    }
  }

  return work();
}

/**
 * Exported so the Sentry Logs allowlist can be pinned against it. The forwarding bridge rewrites
 * any message it does not recognise to a bare "Application error", so a drift between this string
 * and `SENTRY_LOG_MESSAGES.CATALOGUE_SEED_FALLBACK` silently un-does the point of logging it.
 */
export const catalogueSeedFallbackLogMessage = "Canonical catalogue read failed; search is serving in-bundle seeds";

/**
 * Falling back MUST be loud. The 2026-09-16 outage lasted seven days because degradation was
 * silent: the endpoint answered HTTP 200 with an empty body and nothing was logged, so there was
 * no error rate to spike and no signal to alert on. A fallback that hides the failure it is
 * absorbing would reproduce exactly that, only with results on screen to make it less visible.
 *
 * The cooldown rate-limits this for free. A read is only attempted when no cooldown is open, so
 * every failure reaching here is a transition into degraded mode: at most one line per kind per
 * `cooldownMs`, paired with one recovery line when the next probe succeeds.
 *
 * Carries the catalogue kind and the failure shape only. There is no user query on this path at
 * all — the read fetches every record of a kind — and none is passed here.
 */
function reportFallback(kind: string, error: unknown, budgetMs: number, cooldownMs: number) {
  logger.error(catalogueSeedFallbackLogMessage, {
    catalogue_kind: kind,
    failure: error instanceof Error ? error.name : typeof error,
    detail: error instanceof Error ? error.message : undefined,
    budget_ms: budgetMs,
    cooldown_ms: cooldownMs,
  });
}

/**
 * A cold read that the retry rescued is still a reader waiting over a second, so it is reported.
 * Silence here would hide the cost this fix absorbs, which is the same mistake as a silent
 * fallback: the outage that made this module necessary lasted seven days because nothing was said.
 */
function reportColdRetry(kind: string, error: unknown, retryBudgetMs: number) {
  logger.info("Canonical catalogue read succeeded on its cold-start retry", {
    catalogue_kind: kind,
    first_attempt: error instanceof Error ? error.name : typeof error,
    detail: error instanceof Error ? error.message : undefined,
    retry_budget_ms: retryBudgetMs,
  });
}

/**
 * The other half of `reportFallback`. A fallback that heals itself a second later is still worth a
 * line: the reader who triggered it was served seeds, and the gap between the two lines is how
 * long the cold read really took.
 */
function reportBackgroundFill(kind: string) {
  logger.info("Canonical catalogue read finished after the search budget; cache filled and search recovered", {
    catalogue_kind: kind,
  });
}

function reportRecovery(kind: string) {
  logger.info("Canonical catalogue read recovered; search is no longer degraded", {
    catalogue_kind: kind,
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Read `kind` canonically, or serve `seeds` when that cannot be done inside the budget.
 *
 * A CALLER abort is never a fallback: it means the whole search is being discarded, so it
 * propagates untouched and does not open the cooldown. Only the internal budget and a genuine read
 * failure do that.
 */
export async function readCatalogueWithSeedFallback<T>(input: {
  kind: string;
  /** Which caller's budget this read runs under. Defaults to search, the tighter of the two. */
  scope?: string;
  seeds: readonly T[];
  signal?: AbortSignal;
  read: (signal: AbortSignal) => Promise<T[]>;
  now?: () => number;
  budgetMs?: number;
  /** Budget for the one retry a cold scope+kind is allowed. Capped at `budgetMs`. */
  retryBudgetMs?: number;
  cooldownMs?: number;
}): Promise<Outcome<T>> {
  const now = input.now ?? Date.now;
  const budgetMs = input.budgetMs ?? catalogueSeedFallbackBudgetMs;
  const cooldownMs = input.cooldownMs ?? catalogueSeedFallbackCooldownMs;
  const key = cooldownKey(input.scope ?? catalogueSearchScope, input.kind);

  input.signal?.throwIfAborted();

  const coolingUntil = cooldownUntil.get(key);
  // Reaching past this point with a cooldown recorded means it has just expired, so this read is
  // the re-probe — which is what makes a success below a recovery worth reporting rather than an
  // ordinary read.
  const probing = coolingUntil !== undefined;
  if (coolingUntil !== undefined) {
    if (coolingUntil > now()) return { records: [...input.seeds], degraded: true };
    cooldownUntil.delete(key);
  }

  const attempt = async (attemptBudgetMs: number): Promise<T[]> => {
    // TWO SIGNALS, and keeping them apart is the fix for the 2026-10 monitor failures.
    //
    // The BUDGET bounds how long this request waits: when it fires, the reader is answered from
    // seeds at once, exactly as before. It does NOT cancel the read. Until 2026-10-06 it did, and
    // the cancellation travelled down into the process cache and killed the query, so a read that
    // needed 1.5 s from Railway was abandoned at 1.2 s on every probe and the cache never filled.
    // The domain stayed on seeds indefinitely, because the next probe started the same doomed read
    // from scratch.
    //
    // `reading` is the read's own signal. It follows a genuine CALLER abort while this request is
    // still waiting (navigation, parent cancel), and a hard ceiling of
    // `catalogueBackgroundFillBudgetMs`, so a read left running cannot run forever. If it finishes
    // inside that ceiling after the budget, `healAfterBudget` lifts the cooldown, so the very next
    // search reads the rows it just stored instead of serving seeds for the rest of the 30 s.
    const reading = new AbortController();
    const forwardCallerAbort = () => reading.abort(input.signal?.reason);
    if (input.signal?.aborted) forwardCallerAbort();
    else input.signal?.addEventListener("abort", forwardCallerAbort, { once: true });

    // RACE, do not merely signal. A read that ignores its signal, or is wedged below the layer that
    // honours it, would otherwise hold this await open past the budget and hand the domain the same
    // empty group this helper exists to prevent. The budget has to be enforced here, by whoever is
    // waiting, or it is not a budget.
    let rejectWaiting: ((reason: Error) => void) | undefined;
    const abandoned = new Promise<never>((_resolve, reject) => {
      rejectWaiting = reject;
    });
    let lostToBudget = false;
    const budgetTimer = setTimeout(() => {
      lostToBudget = true;
      rejectWaiting?.(new DOMException(`Canonical ${input.kind} read exceeded ${attemptBudgetMs}ms.`, "TimeoutError"));
    }, attemptBudgetMs);
    (budgetTimer as { unref?: () => void }).unref?.();
    const fillTimer = setTimeout(() => {
      reading.abort(
        new DOMException(
          `Canonical ${input.kind} read exceeded its ${catalogueBackgroundFillBudgetMs}ms background ceiling.`,
          "TimeoutError",
        ),
      );
    }, catalogueBackgroundFillBudgetMs);
    (fillTimer as { unref?: () => void }).unref?.();
    const onReadingAbort = () => rejectWaiting?.(abortReason(reading.signal));
    reading.signal.addEventListener("abort", onReadingAbort, { once: true });
    if (reading.signal.aborted) onReadingAbort();

    // A read that throws synchronously must still reach the `finally` below, or the budget timer
    // would fire later into a race nobody is listening to.
    let pending: Promise<T[]>;
    try {
      pending = input.read(reading.signal);
    } catch (error) {
      pending = Promise.reject(error);
    }
    // Observed for the whole of the read's life, not just this request's. Only a read that lost to
    // the BUDGET and then succeeded heals anything; a caller abort aborts `reading`, so that read
    // rejects and is ignored here, and a read that won the race was already handled by `succeed`.
    pending.then(
      () => {
        clearTimeout(fillTimer);
        if (lostToBudget) healAfterBudget();
      },
      () => clearTimeout(fillTimer),
    );

    try {
      return await Promise.race([pending, abandoned]);
    } finally {
      clearTimeout(budgetTimer);
      // From here the reader has been answered. Its later aborts (the 2500 ms domain timeout, the
      // whole search being discarded) are no reason to stop a read whose only remaining job is to
      // fill the cache, so they stop being forwarded.
      input.signal?.removeEventListener("abort", forwardCallerAbort);
      reading.signal.removeEventListener("abort", onReadingAbort);
    }
  };

  /**
   * A read that missed the budget finished anyway, inside its background ceiling, and the process
   * cache now holds its rows. Lift the cooldown so the next search reads them, and record the
   * key as warm, which is true: the database just answered.
   */
  const healAfterBudget = () => {
    const wasCooling = cooldownUntil.has(key);
    cooldownUntil.delete(key);
    warmedAt.set(key, now());
    markProcessConnectionWarmedAt(now());
    if (wasCooling) reportBackgroundFill(input.kind);
  };

  const succeed = (records: T[]): Outcome<T> => {
    cooldownUntil.delete(key);
    warmedAt.set(key, now());
    markProcessConnectionWarmedAt(now());
    if (probing) reportRecovery(input.kind);
    return { records, degraded: false };
  };

  const serveSeedsAfterFailedColdGate = (error: unknown, usedBudgetMs: number): Outcome<T> => {
    cooldownUntil.set(key, now() + cooldownMs);
    reportFallback(input.kind, error, usedBudgetMs, cooldownMs);
    return { records: [...input.seeds], degraded: true };
  };

  // Serialise until the process has one successful canonical read. Without this,
  // universal-search's Promise.all of forms/services/medications triples the cold
  // connection setup and every domain falls to seeds (monitor #2919).
  try {
    return await runSerializedWhileProcessCold(
      async () => {
        try {
          return succeed(await attempt(budgetMs));
        } catch (error) {
          // Domain timeout after a failed cold owner: serve seeds rather than an empty errored group.
          // A non-timeout caller abort (navigation / parent cancel) still propagates untouched.
          if (input.signal?.aborted) {
            if (
              abortIsDomainTimeout(input.signal) &&
              processColdBypassSerialisation &&
              !processHasWarmedCanonicalRead
            ) {
              return serveSeedsAfterFailedColdGate(abortReason(input.signal), budgetMs);
            }
            throw abortReason(input.signal);
          }

          // THE COLD FIRST READ, and the only case that gets a second go.
          //
          // Measured 2026-09-21 against the live project: the first catalogue read in a fresh process
          // cost 1781 ms (1599 ms of it before the first byte) and blew this budget on connection setup
          // alone, while every warm read of every kind finished inside 604 ms. The control was reversing
          // the order the kinds are read in — the penalty moved with the POSITION, not the kind
          // (medication first 1268 ms; form, read last, 213 ms). So this is not a slow catalogue, it is
          // an unwarmed connection, and the very next call is fast.
          //
          // That is why the retry is offered ONCE per scope+kind per cold period (first read, or
          // first read after the record cache's idle ceiling) rather than on every failure. A
          // retry-always would add its budget to every request of a genuine outage, which is the
          // opposite of what this helper is for; gating on `warmedAt` makes the steady state
          // byte-for-byte what it was before.
          //
          // The process-level serialisation above is the other half: per-kind retry alone still lets
          // three cold kinds race under Promise.all and all miss the budget.
          const cold = isColdKey(key, now()) && !(input.signal?.aborted ?? false);
          if (cold) {
            // Consume the one-shot retry before attempting it. If both attempts fail, cooldown
            // still opens below; without this, expiry would make `cold` true again and re-offer
            // the retry budget on a genuine outage (and concurrent cold callers could each claim one).
            warmedAt.set(key, now());
            const retryBudgetMs = Math.min(budgetMs, input.retryBudgetMs ?? catalogueSeedFallbackRetryBudgetMs);
            try {
              const records = await attempt(retryBudgetMs);
              reportColdRetry(input.kind, error, retryBudgetMs);
              return succeed(records);
            } catch (retryError) {
              if (input.signal?.aborted) {
                if (
                  abortIsDomainTimeout(input.signal) &&
                  processColdBypassSerialisation &&
                  !processHasWarmedCanonicalRead
                ) {
                  return serveSeedsAfterFailedColdGate(abortReason(input.signal), retryBudgetMs);
                }
                throw abortReason(input.signal);
              }
              return serveSeedsAfterFailedColdGate(retryError, retryBudgetMs);
            }
          }

          return serveSeedsAfterFailedColdGate(error, budgetMs);
        }
      },
      input.signal,
      now,
    );
  } catch (error) {
    // Aborted while blocked on the cold gate after a failed warm attempt — same seed path.
    if (abortIsDomainTimeout(input.signal) && processColdBypassSerialisation && !processHasWarmedCanonicalRead) {
      return serveSeedsAfterFailedColdGate(error instanceof Error ? error : abortReason(input.signal!), budgetMs);
    }
    throw error;
  }
}

// The reader-facing notice lives in a dependency-free module so client components can show it
// without bundling this server-side fallback machinery. Re-exported here for server callers.
export { catalogueDegradedNotice, withCatalogueDegradedNotice } from "@/lib/site-content/catalogue-degraded-notice";

/** Test seam, and the hook an operator-triggered "try the database again now" would use. */
export function clearCatalogueSeedFallbackCooldown() {
  cooldownUntil.clear();
  warmedAt.clear();
  processHasWarmedCanonicalRead = false;
  processWarmedAtMs = null;
  processColdBypassSerialisation = false;
  processColdOwner = null;
}
