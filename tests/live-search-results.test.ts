import { describe, expect, it } from "vitest";

import {
  assessSearchProbe,
  assessSignInGate,
  degradedReprobeDelayMs,
  liveSearchProbes,
  runSearchProbes,
  signInGateProbe,
  summariseSearchProbes,
} from "../scripts/check-live-search-results.mjs";
import {
  catalogueBackgroundFillBudgetMs,
  catalogueListFallbackBudgetMs,
  catalogueSeedFallbackCooldownMs,
} from "../src/lib/site-content/catalogue-seed-fallback";

/**
 * Pins the monitor against the outage it was written for.
 *
 * Between 2026-09-09 and 2026-09-16 the live site returned zero results for every catalogue search
 * while every existing probe stayed green, because they all measured status codes and a search
 * returning nothing is a 200. The two cases that matter here are `no_results` — the outage as it
 * happened — and `degraded` — the same outage as it now presents, with the seed fallback serving
 * real items while the published catalogue is unreachable.
 *
 * If one of these fails, do not relax it. Each corresponds to a shape of live failure that this
 * repository has either already shipped or deliberately introduced as a survival mechanism.
 */

function response(overrides: Record<string, unknown> = {}) {
  return { status: 200, body: { matches: [{ record: { slug: "a" } }], total: 40, ...overrides } };
}

describe("assessSearchProbe", () => {
  it("passes a domain that returns matches canonically", () => {
    const verdict = assessSearchProbe({ domain: "forms", ...response(), latencyMs: 120 });
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toBe("forms: 1 match(es) in 120ms.");
  });

  // THE OUTAGE. A well-formed HTTP 200 with nothing in it.
  it("fails a domain that returned zero matches", () => {
    const verdict = assessSearchProbe({ domain: "forms", ...response({ matches: [] }) });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("no_results");
  });

  // THE FALSE NEGATIVE THIS CHECK MUST NOT HAVE. With the seed fallback in place the same database
  // failure returns a full, plausible result set. A monitor that only counts items calls this
  // healthy and the next outage runs unseen again.
  it("fails a domain serving seeds, even though it returned matches", () => {
    const verdict = assessSearchProbe({ domain: "forms", ...response({ degraded: true }) });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("degraded");
  });

  it("fails on a non-200 status or an unreadable body", () => {
    expect(assessSearchProbe({ domain: "forms", status: 401, body: null }).code).toBe("http_error");
    expect(assessSearchProbe({ domain: "forms", status: 503, body: null }).code).toBe("http_error");
    expect(assessSearchProbe({ domain: "forms", status: 200, body: null }).code).toBe("unreadable");
    expect(assessSearchProbe({ domain: "forms", status: 200, body: [] }).code).toBe("unreadable");
  });

  // A string has a truthy `.length`, so counting it blind let a malformed body pass as healthy —
  // an unreadable live response is precisely what this monitor exists to catch.
  it.each([
    ["a string", "ok"],
    ["an object", { length: 3 }],
    ["null", null],
    ["absent", undefined],
  ])("does not count %s as matches", (_label, matches) => {
    const verdict = assessSearchProbe({ domain: "forms", status: 200, body: { matches, total: 40 } });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("no_results");
  });
});

// Since 21 Oct 2026 search needs sign-in (#3728, #3696). The monitor's anonymous probe getting 401
// is the gate working; a 200 is the gate lost.
describe("assessSignInGate", () => {
  it.each([401, 403])("passes when search refuses a signed-out visitor with %i", (status) => {
    expect(assessSignInGate({ status })).toMatchObject({ ok: true, code: "ok" });
  });

  it("fails when search answers a signed-out visitor", () => {
    const verdict = assessSignInGate({ status: 200 });
    expect(verdict).toMatchObject({ ok: false, code: "gate_open" });
    expect(verdict.message).toContain("must need sign-in");
  });

  it("reports a server failure as a failure, not as the gate holding", () => {
    expect(assessSignInGate({ status: 500 })).toMatchObject({ ok: false, code: "http_error" });
    expect(assessSignInGate({ status: 429 })).toMatchObject({ ok: false, code: "http_error" });
  });
});

describe("the probe set", () => {
  it("covers every public catalogue domain, and checks the sign-in gate on search", () => {
    expect(liveSearchProbes.map((probe: { domain: string }) => probe.domain).sort()).toEqual(["forms", "services"]);
    expect(liveSearchProbes.map((probe: { kind: string }) => probe.kind).sort()).toEqual(["form", "service"]);
    expect(signInGateProbe.domain).toBe("medications");
  });

  it("reports failure when any domain fails, not only when all of them do", () => {
    const summary = summariseSearchProbes([
      { ok: true, message: "forms ok" },
      { ok: false, message: "services failed" },
    ]);
    expect(summary.ok).toBe(false);
    expect(summary.failed).toHaveLength(1);
  });
});

/**
 * The one re-probe a degraded domain gets (2026-10-06). The app now lets a canonical read that
 * missed the search budget finish in the background and lift its cooldown, so the first probe after
 * idle can be seeds once by design. The re-probe must accept that and nothing else.
 */
describe("runSearchProbes", () => {
  const canonical = (domain: string) => ({ ok: true, domain, code: "ok", message: `${domain}: 5 result(s) in 80ms.` });
  const degraded = (domain: string) => ({
    ok: false,
    domain,
    code: "degraded",
    message: `${domain}: answering from the in-bundle catalogue because the published one could not be read.`,
  });

  function scripted(outcomes: Record<string, Array<(domain: string) => Record<string, unknown>>>) {
    const calls: string[] = [];
    const probe = async (domain: string) => {
      calls.push(domain);
      const next = outcomes[domain]?.shift() ?? canonical;
      return next(domain) as { ok: boolean; domain: string; code: string; message: string };
    };
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    return { probe, sleep, calls, slept };
  }

  it("passes a domain that served seeds once and then answered canonically, and marks it", async () => {
    const harness = scripted({ services: [degraded, canonical] });
    const results = await runSearchProbes(harness);

    expect(summariseSearchProbes(results).ok).toBe(true);
    const services = results.find((result) => result.domain === "services");
    expect(services).toMatchObject({ ok: true, healedAfterColdRead: true });
    expect(services?.message).toContain("served seeds on a cold read");
    expect(harness.slept).toEqual([degradedReprobeDelayMs]);
  });

  // The outage, and the defect this re-probe was introduced alongside: still degraded when asked
  // again, because nothing lifted the cooldown. Must stay red.
  it("fails a domain that is still serving seeds on the re-probe", async () => {
    const harness = scripted({ forms: [degraded, degraded] });
    const results = await runSearchProbes(harness);

    expect(summariseSearchProbes(results).ok).toBe(false);
    expect(results.find((result) => result.domain === "forms")).toMatchObject({ ok: false, code: "degraded" });
  });

  it("never re-probes zero results or an unreachable domain", async () => {
    const harness = scripted({
      forms: [() => ({ ok: false, domain: "forms", code: "no_results", message: "forms: zero" })],
      services: [
        () => {
          throw new Error("fetch failed");
        },
      ],
    });
    const results = await runSearchProbes(harness);

    expect(harness.calls).toEqual(["forms", "services"]);
    expect(harness.slept).toEqual([]);
    expect(results.map((result) => result.code)).toEqual(["no_results", "unreachable"]);
  });

  // The two bounds that make the re-probe honest, pinned against the app's own constants so a
  // change on either side cannot silently turn the re-probe into a mask.
  it("waits past the app's background fill, and well inside the cooldown a real failure opens", () => {
    expect(degradedReprobeDelayMs).toBeGreaterThan(catalogueBackgroundFillBudgetMs);
    // The registry route the probes read waits longer than search before it falls back.
    expect(degradedReprobeDelayMs).toBeGreaterThan(catalogueListFallbackBudgetMs);
    expect(degradedReprobeDelayMs).toBeLessThan(catalogueSeedFallbackCooldownMs / 2);
  });
});
