#!/usr/bin/env node
/**
 * check-live-search-results.mjs — does live search actually return results?
 *
 * THE OUTAGE THIS EXISTS FOR, 2026-09-09 to 2026-09-16. Forms, Medications and Services search
 * returned zero results on psychiatry.tools for every query, for every user, for seven days. The
 * canonical catalogue read was outrunning the 2500 ms budget `universal-search` gives a registry
 * domain, so each domain aborted and was converted into an errored empty group:
 *
 *     {"kind":"forms","total":0,"items":[],"latencyMs":2503,"error":true}
 *
 * `live-domain-monitor.yml` stayed green throughout, and every probe in it was telling the truth.
 * `/forms` returned 200. The app shell rendered. `/api/health` said ok. **A search that returns
 * nothing is an HTTP 200 carrying a well-formed body**, and status codes cannot see the
 * difference between "no matches" and "the catalogue is unreachable". It was found by an operator
 * noticing his own searches were empty, seven days in.
 *
 * ZERO RESULTS IS NOT THE ONLY FAILURE TO WATCH FOR, and this is the subtle half. The fix for the
 * outage added a seed fallback: when the canonical read cannot answer, the domain serves the
 * in-bundle catalogue rather than nothing. That is right for the reader and it would make the NEXT
 * occurrence invisible to a monitor that only counts items — results on screen, published data
 * unreachable, nobody told. So this asserts `degraded !== true` with exactly the same severity as
 * a zero count. A domain answering from seeds is a broken database that happens to be survivable.
 *
 * Needs no secret: these are the same anonymous GETs any visitor makes, in keeping with the
 * calling workflow's no-secrets contract.
 *
 * The verdict logic is a pure function so it can be unit-tested offline
 * (`tests/live-search-results.test.ts`). The precedent is deliberate — the first version of the
 * deployment-freshness check measured the wrong thing and was only caught by a test that pinned
 * the false negative. A monitor nobody can test is a monitor nobody can trust.
 */

/**
 * One probe per catalogue-backed domain. The terms are chosen to match many records in the
 * in-bundle catalogue, so a zero count can only mean the search path is broken — never that the
 * corpus happened to drift away from an over-specific term. Verified against the ranking
 * functions when written: referral 5+, counselling 5+, sertraline 5+.
 */
export const liveSearchProbes = [
  { domain: "forms", query: "referral" },
  { domain: "services", query: "counselling" },
  { domain: "medications", query: "sertraline" },
];

/**
 * Turn one probe's response into a verdict.
 *
 * @param {object} input
 * @param {string} input.domain
 * @param {number} input.status                HTTP status
 * @param {object|null} input.body             parsed `/api/search/universal` response, or null
 */
export function assessSearchProbe({ domain, status, body }) {
  if (status !== 200) {
    return { ok: false, domain, code: "http_error", message: `${domain}: search returned HTTP ${status}.` };
  }
  const groups = Array.isArray(body?.groups) ? body.groups : null;
  if (!groups) {
    return { ok: false, domain, code: "unreadable", message: `${domain}: response carried no groups array.` };
  }
  const group = groups.find((candidate) => candidate?.kind === domain);
  if (!group) {
    return { ok: false, domain, code: "missing_domain", message: `${domain}: no group for the requested domain.` };
  }
  if (group.error === true) {
    return {
      ok: false,
      domain,
      code: "domain_errored",
      message: `${domain}: the domain failed or timed out after ${group.latencyMs}ms.`,
    };
  }
  // Checked before the count, because a degraded domain still returns items and would otherwise
  // pass. This is the exact shape the 2026-09-16 outage now takes with the seed fallback in place.
  if (group.degraded === true) {
    return {
      ok: false,
      domain,
      code: "degraded",
      message: `${domain}: answering from the in-bundle catalogue because the published one could not be read.`,
    };
  }
  // `items` is only a count when it is actually an array. A malformed body carrying
  // `items: "ok"` has a truthy `.length` of 2, which would let this monitor call an unreadable
  // response healthy — the one failure mode it exists to catch.
  const total = typeof group.total === "number" ? group.total : Array.isArray(group.items) ? group.items.length : 0;
  if (total <= 0) {
    return {
      ok: false,
      domain,
      code: "no_results",
      message: `${domain}: returned zero results after ${group.latencyMs}ms for a query with known matches.`,
    };
  }
  return { ok: true, domain, code: "ok", message: `${domain}: ${total} result(s) in ${group.latencyMs}ms.` };
}

/**
 * ONE RE-PROBE FOR A DEGRADED DOMAIN, and why it does not hide an outage.
 *
 * Since 2026-10-06 a canonical read that misses the 1200 ms search budget is no longer cancelled:
 * the reader gets seeds, the read finishes in the background, fills the process cache, and lifts
 * the seed-fallback cooldown (`catalogue-seed-fallback.ts`). So the first search after a long idle
 * can still be answered from seeds once, by design, and a second search moments later is canonical.
 * This monitor probes every six hours, which is always after idle, so it would report that one
 * designed miss as an outage.
 *
 * The re-probe waits longer than the app's background-fill ceiling, so a healthy cold read has
 * finished, and well inside the 30 s cooldown a GENUINE failure opens, so a catalogue that really
 * cannot be read is still answering from seeds when it is asked again and still fails here. The
 * defect this was written alongside (the read cancelled at the budget, so the cache never filled)
 * also still fails: nothing lifts its cooldown. `tests/live-search-results.test.ts` pins both
 * bounds against the app's own constants.
 *
 * Only `degraded` is re-probed. Zero results, an errored group, or an HTTP failure is never the
 * designed cold path, and is reported on the first sight as before.
 */
export const degradedReprobeDelayMs = 12_000;

/**
 * Probe every domain in turn, re-probing a degraded one once after `reprobeDelayMs`.
 *
 * @param {object} input
 * @param {(domain: string, query: string) => Promise<{ok: boolean, domain: string, code: string, message: string}>} input.probe
 * @param {(ms: number) => Promise<void>} input.sleep
 * @param {number} [input.reprobeDelayMs]
 */
export async function runSearchProbes({ probe, sleep, reprobeDelayMs = degradedReprobeDelayMs }) {
  const attempt = async (domain, query) => {
    try {
      return await probe(domain, query);
    } catch (error) {
      return { ok: false, domain, code: "unreachable", message: `${domain}: ${error.message}` };
    }
  };

  const results = [];
  for (const { domain, query } of liveSearchProbes) {
    const first = await attempt(domain, query);
    if (first.code !== "degraded") {
      results.push(first);
      continue;
    }
    await sleep(reprobeDelayMs);
    const second = await attempt(domain, query);
    results.push(
      second.ok
        ? {
            ...second,
            healedAfterColdRead: true,
            message: `${domain}: served seeds on a cold read, then answered canonically ${reprobeDelayMs / 1000}s later (${second.message.replace(`${domain}: `, "")})`,
          }
        : second,
    );
  }
  return results;
}

/** @param {Array<{ok: boolean, message: string}>} results */
export function summariseSearchProbes(results) {
  const failed = results.filter((result) => !result.ok);
  return {
    ok: failed.length === 0,
    failed,
    message:
      failed.length === 0 ? "Every catalogue domain returned live results." : `${failed.length} domain(s) failed.`,
  };
}

async function probe(domain, query, domainUrl, timeoutMs) {
  const url = new URL("/api/search/universal", domainUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("domains", domain);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null);
  return assessSearchProbe({ domain, status: response.status, body });
}

async function main() {
  const domainUrl = process.env.LIVE_DOMAIN_URL;
  if (!domainUrl) throw new Error("LIVE_DOMAIN_URL is required.");
  const timeoutMs = Number(process.env.SEARCH_PROBE_TIMEOUT_MS || 30_000);

  const results = await runSearchProbes({
    probe: (domain, query) => probe(domain, query, domainUrl, timeoutMs),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  for (const result of results) {
    // A healed cold read passes, but stays visible: it is still a reader who was served seeds.
    if (result.ok && result.healedAfterColdRead) console.log(`::warning::${result.message}`);
    else console.log(result.ok ? result.message : `::error::${result.message}`);
  }

  const summary = summariseSearchProbes(results);
  if (summary.ok) {
    console.log(summary.message);
    return;
  }
  console.log(
    "::error::Catalogue search is not answering on the live site. Registry search reads read_site_content_public_records; check that RPC's latency first.",
  );
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.log(`::error::Live search results check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
