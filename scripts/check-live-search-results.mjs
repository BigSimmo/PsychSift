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
 * SINCE 21 OCT 2026 SEARCH NEEDS SIGN-IN. `/api/search/universal` answers a signed-out visitor
 * with 401 (#3728, the TGA rule in #3696), so this monitor, which makes the same anonymous GETs any
 * visitor makes, got 401 on every probe from then on and kept the daily health summary red for a
 * failure that was really the intended gate. It now does two things instead:
 *
 * 1. It reads Forms and Services through `/api/registry/records`, which is still public and runs
 *    the same canonical catalogue read with the same seed fallback and `degraded` flag. So the
 *    2026-09 outage, in either of its shapes, still fails here.
 * 2. It asserts that universal search still REFUSES a signed-out visitor. A 200 there means the
 *    sign-in gate has been lost, which matters as much as an empty catalogue.
 *
 * Medications has no public catalogue route any more, so it is not read here. It shares the
 * canonical read path with Forms and Services; a fault specific to it is not covered.
 *
 * Needs no secret: these are the same anonymous GETs any visitor makes, in keeping with the
 * calling workflow's no-secrets contract.
 *
 * The verdict logic is a pure function so it can be unit-tested offline
 * (`tests/live-search-results.test.ts`). The precedent is deliberate — the first version of the
 * deployment-freshness check measured the wrong thing and was only caught by a test that pinned
 * the false negative. A monitor nobody can test is a monitor nobody can trust.
 */

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

/**
 * One probe per public catalogue domain. The terms are chosen to match many records in the
 * in-bundle catalogue, so a zero count can only mean the read path is broken — never that the
 * corpus happened to drift away from an over-specific term. Verified against the ranking
 * functions when written: referral 5+, counselling 5+.
 */
export const liveSearchProbes = [
  { domain: "forms", kind: "form", query: "referral" },
  { domain: "services", kind: "service", query: "counselling" },
];

/** The signed-out request universal search must refuse. */
export const signInGateProbe = { domain: "medications", query: "sertraline" };

/**
 * Turn one registry probe's response into a verdict.
 *
 * @param {object} input
 * @param {string} input.domain
 * @param {number} input.status                HTTP status
 * @param {object|null} input.body             parsed `/api/registry/records` response, or null
 * @param {number} [input.latencyMs]           measured by the caller
 */
export function assessSearchProbe({ domain, status, body, latencyMs }) {
  const took = typeof latencyMs === "number" ? ` in ${latencyMs}ms` : "";
  if (status !== 200) {
    return { ok: false, domain, code: "http_error", message: `${domain}: catalogue returned HTTP ${status}.` };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, domain, code: "unreadable", message: `${domain}: response was not a catalogue object.` };
  }
  // Checked before the count, because a degraded read still returns records and would otherwise
  // pass. This is the exact shape the 2026-09-16 outage now takes with the seed fallback in place.
  if (body.degraded === true) {
    return {
      ok: false,
      domain,
      code: "degraded",
      message: `${domain}: answering from the in-bundle catalogue because the published one could not be read.`,
    };
  }
  // Only an array counts. A malformed body carrying `matches: "ok"` has a truthy `.length` of 2,
  // which would let this monitor call an unreadable response healthy — the one failure mode it
  // exists to catch.
  const count = Array.isArray(body.matches) ? body.matches.length : 0;
  if (count <= 0) {
    return {
      ok: false,
      domain,
      code: "no_results",
      message: `${domain}: returned zero matches${took} for a query with known matches.`,
    };
  }
  return { ok: true, domain, code: "ok", message: `${domain}: ${count} match(es)${took}.` };
}

/**
 * Universal search must refuse a signed-out visitor. 401 and 403 are both a refusal. A 200 means
 * clinical search is open to anyone again; anything else is reported as the server failing.
 *
 * @param {{ status: number }} input
 */
export function assessSignInGate({ status }) {
  if (status === 401 || status === 403) {
    return {
      ok: true,
      domain: "sign-in gate",
      code: "ok",
      message: `sign-in gate: search refused a signed-out visitor (HTTP ${status}).`,
    };
  }
  if (status >= 200 && status < 300) {
    return {
      ok: false,
      domain: "sign-in gate",
      code: "gate_open",
      message: `sign-in gate: search answered a signed-out visitor (HTTP ${status}). Search must need sign-in (docs/decisions/2026-10-20-clinical-decision-tools-need-sign-in.md).`,
    };
  }
  return {
    ok: false,
    domain: "sign-in gate",
    code: "http_error",
    message: `sign-in gate: search returned HTTP ${status}.`,
  };
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
 * Only `degraded` is re-probed. Zero results or an HTTP failure is never the
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
      failed.length === 0
        ? "Every catalogue domain returned live results, and search still needs sign-in."
        : `${failed.length} check(s) failed.`,
  };
}

async function probe(kind, domain, query, domainUrl, timeoutMs) {
  const url = new URL("/api/registry/records", domainUrl);
  url.searchParams.set("kind", kind);
  url.searchParams.set("q", query);
  url.searchParams.set("view", "search");
  url.searchParams.set("limit", "5");
  const started = Date.now();
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null);
  return assessSearchProbe({ domain, status: response.status, body, latencyMs: Date.now() - started });
}

async function probeSignInGate(domainUrl, timeoutMs) {
  const url = new URL("/api/search/universal", domainUrl);
  url.searchParams.set("q", signInGateProbe.query);
  url.searchParams.set("domains", signInGateProbe.domain);
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return assessSignInGate({ status: response.status });
  } catch (error) {
    return { ok: false, domain: "sign-in gate", code: "unreachable", message: `sign-in gate: ${error.message}` };
  }
}

async function main() {
  const domainUrl = process.env.LIVE_DOMAIN_URL;
  if (!domainUrl) throw new Error("LIVE_DOMAIN_URL is required.");
  const timeoutMs = Number(process.env.SEARCH_PROBE_TIMEOUT_MS || 30_000);
  const kinds = Object.fromEntries(liveSearchProbes.map((entry) => [entry.domain, entry.kind]));

  const results = await runSearchProbes({
    probe: (domain, query) => probe(kinds[domain], domain, query, domainUrl, timeoutMs),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  results.push(await probeSignInGate(domainUrl, timeoutMs));

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
    "::error::Catalogue or sign-in check failed on the live site. The catalogue reads read_site_content_public_records; check that RPC's latency first.",
  );
  process.exitCode = 1;
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.log(`::error::Live search results check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
