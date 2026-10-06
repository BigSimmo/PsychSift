import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BIMODAL_RUNNER_TOLERANCE_FLOORS,
  DEFAULT_TOLERANCE,
  baselineFromRows,
  compareToLighthouseBudget,
  expectedBudgetRuns,
  gradeRun,
  incompleteBudgetEvidence,
  isBimodalRunnerVarianceRun,
  majorityBreachDecision,
  numericBreachConfirmationRuns,
  readReports,
  renderBudgetTable,
  validateBaselineBrowserVersions,
  validateLighthouseBaseline,
} from "../scripts/check-lighthouse-budget.mjs";
import { routeWithLighthouseParams } from "../scripts/lib/lighthouse-route-params.mjs";
import { measurementFailureReason } from "../scripts/lighthouse-measurement-outcome.mjs";
import {
  deadlineAfter,
  lighthouseBuildTimeoutMs,
  processTimeoutMs,
  remainingMs,
} from "../scripts/lighthouse-time-budget.mjs";

/**
 * Synthetic fixture routes for the unit cases below — deliberately more than the
 * committed budget measures, so run-expansion and completeness have several rows
 * to work with. The committed list is asserted separately as COMMITTED_ROUTES.
 */
const ROUTES = ["/", "/therapy-compass", "/documents/search", "/dsm", "/forms"];

/**
 * What lighthouse-budget.json actually measures. `/therapy-compass`, `/dsm` and
 * `/forms` left the budget when home consolidation turned them into redirect
 * stubs — Lighthouse followed the 307 and graded `/?mode=<id>` against a baseline
 * captured on the retired detailed home. All three now render the same shared home
 * as `/`, so their removal costs duplication rather than coverage.
 */
const COMMITTED_ROUTES = ["/", "/documents/search"];

const budget = (overrides: Record<string, unknown> = {}) => ({
  enforce: true,
  routes: ROUTES,
  strategies: ["mobile", "desktop"],
  baseline: null,
  ...overrides,
});

function row(run: string, metrics: { lcpMs?: number | null; cls?: number | null; tbtMs?: number | null } = {}) {
  const url = `http://localhost:4461/${run}`;
  return {
    run,
    url,
    requestedUrl: url,
    runtimeError: null,
    performanceScore: 0.99,
    lcpMs: metrics.lcpMs ?? 1000,
    cls: metrics.cls ?? 0,
    tbtMs: metrics.tbtMs ?? 100,
    fcpMs: 500,
    chromeVersion: "HeadlessChrome/140",
  };
}

/** The shape `summariseReport` yields, as this suite fabricates it. The graded
    helpers come from an untyped `.mjs`, so callbacks over their results need an
    explicit annotation to stay under `noImplicitAny`. */
type Row = ReturnType<typeof row>;

/** A complete set of reports for the configured matrix. */
function completeRows(metrics: Record<string, { lcpMs?: number; cls?: number; tbtMs?: number }> = {}) {
  return expectedBudgetRuns(budget()).map((run: string) => row(run, metrics[run] ?? {}));
}

describe("expectedBudgetRuns", () => {
  it("expands routes across every configured strategy", () => {
    expect(expectedBudgetRuns(budget())).toEqual([
      "mobile-root",
      "mobile-therapy-compass",
      "mobile-documents-search",
      "mobile-dsm",
      "mobile-forms",
      "desktop-root",
      "desktop-therapy-compass",
      "desktop-documents-search",
      "desktop-dsm",
      "desktop-forms",
    ]);
  });

  it("returns nothing when no routes are configured", () => {
    expect(expectedBudgetRuns(budget({ routes: [] }))).toEqual([]);
  });
});

describe("incompleteBudgetEvidence", () => {
  it("passes a complete matrix", () => {
    expect(incompleteBudgetEvidence(completeRows(), budget())).toEqual([]);
  });

  it("reports a requested run that produced no report", () => {
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-dsm");

    expect(incompleteBudgetEvidence(rows, budget())).toEqual(["mobile-dsm: no Lighthouse report produced"]);
  });

  it("reports a run whose report carries no usable metrics", () => {
    const rows = completeRows().map((entry: Row) =>
      entry.run === "desktop-forms" ? { ...entry, lcpMs: null } : entry,
    );

    expect(incompleteBudgetEvidence(rows, budget())).toEqual(["desktop-forms: report has no LCP or CLS number"]);
  });

  it("reports a run that measured a different page than requested", () => {
    // A route that redirects to /login yields clean numbers for the wrong page.
    const rows = completeRows().map((entry: Row) =>
      entry.run === "mobile-dsm" ? { ...entry, url: "http://localhost:4461/login" } : entry,
    );

    expect(incompleteBudgetEvidence(rows, budget())).toEqual([
      "mobile-dsm: report measured a different page than requested",
    ]);
  });
});

describe("incompleteBudgetEvidence — completeness derived from what is graded", () => {
  it("rejects a report missing a graded metric even when LCP and CLS are present", () => {
    // hasUsableMetrics only checks the LCP/CLS pair ledger #017 grades. This budget
    // also grades TBT, so a report without it must not pass completeness and then
    // have TBT silently skipped.
    const rows = completeRows().map((entry: Row) => (entry.run === "mobile-dsm" ? { ...entry, tbtMs: null } : entry));

    expect(incompleteBudgetEvidence(rows, budget())).toEqual(["mobile-dsm: report has no valid tbtMs number"]);
  });

  it("rejects a report missing a newly configured tolerance metric", () => {
    const rows = completeRows().map((entry: Row) => ({ ...entry, performanceScore: undefined }));

    expect(incompleteBudgetEvidence(rows, budget({ tolerance: { performanceScore: { absolute: 0.02 } } }))).toContain(
      "mobile-root: report has no valid performanceScore number",
    );
  });

  it("rejects a run the recorded baseline does not cover", () => {
    // A route added after the baseline was recorded has nothing to compare against,
    // and gradeRun returns no breaches for a missing row — so it would grade ok at
    // any LCP.
    const rows = completeRows();
    const partial = baselineFromRows(rows.filter((entry: Row) => entry.run !== "mobile-forms"));

    expect(incompleteBudgetEvidence(rows, budget({ baseline: partial }))).toEqual([
      "mobile-forms: no baseline row recorded — refresh with --update",
    ]);
  });

  it("fails an enforcing budget whose baseline predates a new route", () => {
    const rows = completeRows({ "mobile-forms": { lcpMs: 99_000 } });
    const partial = baselineFromRows(completeRows().filter((entry: Row) => entry.run !== "mobile-forms"));
    const result = compareToLighthouseBudget(rows, budget({ baseline: partial }));

    expect(result.status).toBe("fail");
    expect(result.reason).toBe("evidence incomplete");
  });

  it("rejects a baseline measured by a different browser, collapsed to one instruction", () => {
    // One browser bump reds every run in the budget. Ten near-identical sentences
    // buried the single actionable line, so drift collapses to one message when it is
    // the whole story — the VERDICT is unchanged and asserted below.
    const rows = completeRows();
    const stale = baselineFromRows(rows.map((entry: Row) => ({ ...entry, chromeVersion: "HeadlessChrome/131" })));
    const problems = incompleteBudgetEvidence(rows, budget({ baseline: stale }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("browser drift on 10 run(s)");
    expect(problems[0]).toContain("HeadlessChrome/131");
    expect(problems[0]).toContain("HeadlessChrome/140");
    expect(problems[0]).toContain("Refresh Lighthouse baseline");

    // The collapse is cosmetic. Incomplete evidence still fails closed, and still
    // does so independently of `enforce`.
    for (const enforce of [true, false]) {
      const result = compareToLighthouseBudget(rows, budget({ baseline: stale, enforce }));
      expect(result.status).toBe("fail");
      expect(result.reason).toBe("evidence incomplete");
    }
  });

  it("rejects a mixed-browser baseline before making per-run comparisons", () => {
    // A row-by-row comparison would make a transcribed multi-run baseline look
    // valid when each current report happened to match its corresponding browser.
    const rows = completeRows();
    const mixed = Object.fromEntries(
      Object.entries(baselineFromRows(rows)).map(([run, entry], index) => [
        run,
        { ...(entry as object), chromeVersion: index % 2 === 0 ? "HeadlessChrome/131" : "HeadlessChrome/132" },
      ]),
    );
    const problems = incompleteBudgetEvidence(rows, budget({ baseline: mixed }));

    expect(problems).toEqual([
      expect.stringContaining("baseline browser identity invalid: expected exactly one baseline Chrome version"),
    ]);
  });

  it("keeps drift per run when a measurement gap shares the verdict", () => {
    // A missing report and a browser bump are different facts with different fixes;
    // collapsing here would hide the one that --update cannot resolve.
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-dsm");
    const stale = baselineFromRows(
      completeRows().map((entry: Row) => ({ ...entry, chromeVersion: "HeadlessChrome/131" })),
    );
    const problems = incompleteBudgetEvidence(rows, budget({ baseline: stale }));

    expect(problems).toEqual(
      expect.arrayContaining([
        "mobile-dsm: no Lighthouse report produced",
        expect.stringContaining("measured by a different browser"),
      ]),
    );
    expect(problems.length).toBeGreaterThan(1);
  });

  it("ignores browser drift and missing baseline rows when refreshing", () => {
    // `--update` must remain reachable after a runner Chrome bump; grading still
    // fails closed on the same evidence via the default ignoreBaseline:false path.
    const rows = completeRows();
    const stale = baselineFromRows(
      rows
        .filter((entry: Row) => entry.run !== "mobile-forms")
        .map((entry: Row) => ({ ...entry, chromeVersion: "HeadlessChrome/131" })),
    );

    expect(incompleteBudgetEvidence(rows, budget({ baseline: stale }), { ignoreBaseline: true })).toEqual([]);
    expect(incompleteBudgetEvidence(rows, budget({ baseline: stale }))).toEqual([
      "mobile-forms: no baseline row recorded — refresh with --update",
    ]);
  });

  it("still refuses a refresh when a report is missing", () => {
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-dsm");

    expect(incompleteBudgetEvidence(rows, budget(), { ignoreBaseline: true })).toEqual([
      "mobile-dsm: no Lighthouse report produced",
    ]);
  });

  it("rejects a baseline that recorded no browser identity", () => {
    // Without browser identity the metrics cannot be shown comparable to this run.
    const rows = completeRows();
    const legacy = Object.fromEntries(
      Object.entries(baselineFromRows(rows)).map(([run, row]) => [run, { ...(row as object), chromeVersion: null }]),
    );

    expect(incompleteBudgetEvidence(rows, budget({ baseline: legacy }))).toEqual(
      expect.arrayContaining([expect.stringContaining("baseline has no valid HeadlessChrome version")]),
    );
  });

  it("rejects a baseline when even one row lacks a browser version", () => {
    const rows = completeRows();
    const mixed = Object.fromEntries(
      Object.entries(baselineFromRows(rows)).map(([run, entry], index) => [
        run,
        { ...(entry as object), chromeVersion: index === 0 ? null : "HeadlessChrome/131" },
      ]),
    );
    const problems = incompleteBudgetEvidence(rows, budget({ baseline: mixed }));

    expect(problems).toEqual([expect.stringContaining("baseline has no valid HeadlessChrome version")]);
  });

  it("rejects colliding route slugs before anything is measured", () => {
    // `/a/b` and `/a-b` both write `a-b.json`, so the second overwrites the first and
    // the survivor would satisfy the expected-run check for both pages.
    const colliding = budget({ routes: ["/a/b", "/a-b"], baseline: null });

    expect(incompleteBudgetEvidence([], colliding)).toContain("route slug collision: a-b");
  });
});

describe("isBimodalRunnerVarianceRun", () => {
  it("matches only the calibrated desktop-root and documents-search run ids", () => {
    expect(isBimodalRunnerVarianceRun("desktop-root")).toBe(true);
    expect(isBimodalRunnerVarianceRun("mobile-documents-search")).toBe(true);
    expect(isBimodalRunnerVarianceRun("desktop-documents-search")).toBe(true);
    expect(BIMODAL_RUNNER_TOLERANCE_FLOORS.lcpMs).toBe(200);
  });

  it("rejects bare documents substrings and other routes (false-green guard)", () => {
    expect(isBimodalRunnerVarianceRun("desktop-documents")).toBe(false);
    expect(isBimodalRunnerVarianceRun("mobile-documents")).toBe(false);
    expect(isBimodalRunnerVarianceRun("mobile-documents-upload")).toBe(false);
    expect(isBimodalRunnerVarianceRun("documents")).toBe(false);
    expect(isBimodalRunnerVarianceRun("mobile-root")).toBe(false);
    expect(isBimodalRunnerVarianceRun("")).toBe(false);
    expect(isBimodalRunnerVarianceRun(null as unknown as string)).toBe(false);
  });
});

describe("gradeRun", () => {
  it("records no breach without a baseline for that run", () => {
    expect(gradeRun(row("mobile-root", { lcpMs: 9000 }), undefined)).toEqual([]);
  });

  it("applies the bimodal LCP floor only on intended run ids", () => {
    const baseline = { lcpMs: 786, cls: 0, tbtMs: 100 };
    // +175ms clears default minAbsolute(100) + pct but stays under bimodal floor(200)
    expect(gradeRun(row("desktop-root", { lcpMs: 961 }), baseline)).toEqual([]);
    expect(gradeRun(row("desktop-documents-search", { lcpMs: 961 }), baseline)).toEqual([]);
    // Unintended documents* name must still flag — closes false-green path
    expect(gradeRun(row("desktop-documents", { lcpMs: 961 }), baseline)).toHaveLength(1);
    expect(gradeRun(row("mobile-root", { lcpMs: 961 }), baseline)).toHaveLength(1);
  });

  it("ignores an improvement", () => {
    expect(gradeRun(row("mobile-root", { lcpMs: 800 }), { lcpMs: 1000, cls: 0, tbtMs: 100 })).toEqual([]);
  });

  it("ignores percentage noise on a small absolute number", () => {
    // 12ms -> 16ms is +33% but only +4ms; flagging it would make the gate useless.
    expect(gradeRun(row("mobile-root", { tbtMs: 16 }), { lcpMs: 1000, cls: 0, tbtMs: 12 })).toEqual([]);
  });

  it("ignores a large absolute rise that stays within the percentage tolerance", () => {
    // +100ms on a 5s LCP is +2%: real but well inside the noise band.
    expect(gradeRun(row("mobile-root", { lcpMs: 5100 }), { lcpMs: 5000, cls: 0, tbtMs: 100 })).toEqual([]);
  });

  it("flags a rise that clears both the percentage and absolute floors", () => {
    const breaches = gradeRun(row("mobile-root", { lcpMs: 1400 }), { lcpMs: 1000, cls: 0, tbtMs: 100 });

    expect(breaches).toHaveLength(1);
    expect(breaches[0].metric).toBe("lcpMs");
    expect(breaches[0].delta).toBe(400);
  });

  it("grades CLS on absolute movement because percentage growth from zero is undefined", () => {
    expect(gradeRun(row("mobile-root", { cls: 0.01 }), { lcpMs: 1000, cls: 0, tbtMs: 100 })).toEqual([]);

    const breaches = gradeRun(row("mobile-root", { cls: 0.05 }), { lcpMs: 1000, cls: 0, tbtMs: 100 });

    expect(breaches).toHaveLength(1);
    expect(breaches[0].metric).toBe("cls");
  });

  it("skips a metric the baseline never recorded", () => {
    expect(gradeRun(row("mobile-root", { tbtMs: 5000 }), { lcpMs: 1000, cls: 0 })).toEqual([]);
  });

  it("honours a caller-supplied tolerance", () => {
    // Spread the defaults so this overrides one metric rather than dropping the others.
    const strict = { ...DEFAULT_TOLERANCE, lcpMs: { pct: 1, minAbsolute: 1 } };

    expect(gradeRun(row("mobile-root", { lcpMs: 1100 }), { lcpMs: 1000 }, strict)).toHaveLength(1);
  });
});

describe("compareToLighthouseBudget", () => {
  it("rejects a missing configured metric in reports or baseline rows", () => {
    const rows = completeRows();
    const baseline = baselineFromRows(rows);
    const config = budget({ baseline, tolerance: { performanceScore: { absolute: 0.02 } } });
    const missingReport = rows.map((entry: Row) => ({ ...entry, performanceScore: undefined }));
    const reportResult = compareToLighthouseBudget(missingReport, config);
    expect(reportResult.status).toBe("fail");
    expect(reportResult.incomplete).toContain("mobile-root: report has no valid performanceScore number");
    const missingBaseline = Object.fromEntries(
      Object.entries(baseline).map(([run, entry]) => [run, { ...(entry as object), performanceScore: undefined }]),
    );
    expect(compareToLighthouseBudget(rows, { ...config, baseline: missingBaseline }).status).toBe("fail");
  });

  const baseline = baselineFromRows(completeRows());

  it("fails evidence when a configured tolerance metric is missing from the baseline", () => {
    const result = compareToLighthouseBudget(
      completeRows(),
      budget({ baseline, tolerance: { performanceScore: { absolute: 0.02 } } }),
    );

    expect(result).toMatchObject({ status: "fail", reason: "evidence incomplete", breaches: [] });
    expect(result.incomplete).toContain("mobile-root: baseline performanceScore must be a finite non-negative number");
  });

  it("warns rather than failing when no baseline is recorded yet", () => {
    const result = compareToLighthouseBudget(completeRows(), budget({ baseline: null }));

    expect(result.status).toBe("warn");
    expect(result.reason).toContain("no baseline");
  });

  it("passes an unchanged run against its baseline", () => {
    const result = compareToLighthouseBudget(completeRows(), budget({ baseline }));

    expect(result.status).toBe("ok");
    expect(result.breaches).toEqual([]);
  });

  it("fails an enforcing budget when a metric regresses", () => {
    const rows = completeRows({ "mobile-dsm": { lcpMs: 4000 } });
    const result = compareToLighthouseBudget(rows, budget({ baseline }));

    expect(result.status).toBe("fail");
    expect(result.breaches.map((breach: { run: string }) => breach.run)).toEqual(["mobile-dsm"]);
  });

  it("only warns about the same regression when enforce is false", () => {
    const rows = completeRows({ "mobile-dsm": { lcpMs: 4000 } });
    const result = compareToLighthouseBudget(rows, budget({ baseline, enforce: false }));

    expect(result.status).toBe("warn");
    expect(result.breaches).toHaveLength(1);
  });

  it("fails on incomplete evidence even when not enforcing", () => {
    // An ungraded route counted as a pass is the failure mode this repo has
    // already acted on; `enforce: false` must not downgrade it.
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-forms");
    const result = compareToLighthouseBudget(rows, budget({ baseline, enforce: false }));

    expect(result.status).toBe("fail");
    expect(result.incomplete).toEqual(["mobile-forms: no Lighthouse report produced"]);
  });

  it("fails on incomplete evidence before it reports a missing baseline", () => {
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-forms");
    const result = compareToLighthouseBudget(rows, budget({ baseline: null }));

    expect(result.status).toBe("fail");
    expect(result.reason).toBe("evidence incomplete");
  });

  it("treats an empty baseline object like no baseline", () => {
    const result = compareToLighthouseBudget(completeRows(), budget({ baseline: {} }));

    expect(result.status).toBe("warn");
  });

  it("exposes the default tolerance when the budget supplies none", () => {
    const result = compareToLighthouseBudget(completeRows(), budget({ baseline }));

    expect(result.tolerance).toMatchObject(DEFAULT_TOLERANCE);
  });
});

describe("numeric breach confirmation", () => {
  const baseline = baselineFromRows(completeRows());

  it("targets only cells with a numeric breach", () => {
    const rows = completeRows({ "mobile-dsm": { lcpMs: 4000 }, "desktop-forms": { cls: 0.2 } });
    expect(numericBreachConfirmationRuns(rows, budget({ baseline }))).toEqual(["desktop-forms", "mobile-dsm"]);
  });

  it("does not turn missing evidence into a numeric retry", () => {
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-dsm");
    expect(numericBreachConfirmationRuns(rows, budget({ baseline }))).toEqual([]);
  });

  it("requires two breached samples out of three", () => {
    expect(majorityBreachDecision([true, true, false])).toEqual({ breached: true, breachCount: 2, sampleCount: 3 });
    expect(majorityBreachDecision([true, false, false])).toEqual({
      breached: false,
      breachCount: 1,
      sampleCount: 3,
    });
  });

  it("fails closed when the three-sample set is incomplete", () => {
    expect(majorityBreachDecision([true, false])).toBeNull();
    expect(majorityBreachDecision([true, false, undefined])).toBeNull();
  });
});

describe("Lighthouse reuses the shared Playwright build", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
  const overrides = (source: string) => {
    const call = /offlineTestEnvironment\([^,]+,\s*\{([\s\S]*?)\n\s*\}\);/.exec(source)?.[1] ?? "";
    return Object.fromEntries(
      [...call.matchAll(/^\s*([A-Z_]+):\s*(.+?),?\s*$/gm)].map((match) => [match[1], match[2].trim()]),
    );
  };

  it("builds with the same command and environment as the Playwright runner it reuses", () => {
    const lighthouse = read("scripts/run-lighthouse-budget.mjs");
    const playwright = read("scripts/run-playwright.mjs");
    const build = '["--max-old-space-size=8192", nextBin, "build", "--webpack"]';
    expect(lighthouse).toContain(build);
    expect(playwright).toContain(build);

    const lighthouseEnv = overrides(lighthouse);
    const playwrightEnv = overrides(playwright);
    // Every build-affecting override must match; only the port differs (it is a runtime value).
    for (const key of ["NEXT_DIST_DIR", "NEXT_TSCONFIG_PATH", "NODE_ENV", "PLAYWRIGHT_OFFLINE_MODE"]) {
      expect(lighthouseEnv[key], key).toBe(playwrightEnv[key]);
    }
    expect(lighthouseEnv.PLAYWRIGHT_BASE_URL).toBe("baseUrl");
    expect(playwrightEnv.PLAYWRIGHT_BASE_URL).toBe("baseUrl");
    expect(lighthouseEnv.NEXT_PUBLIC_MOCKUPS_ENABLED).toBe('"false"');
    expect(playwrightEnv.NEXT_PUBLIC_MOCKUPS_ENABLED).toBe('mockupProjectRequested ? "true" : "false"');
    expect(Object.keys(lighthouseEnv).sort()).toEqual(Object.keys(playwrightEnv).sort());
  });

  it("downloads the mockups-disabled build only when its producer passed, and otherwise builds", () => {
    const ci = read(".github/workflows/ci.yml");
    const producer = /\n  ui-playwright-build:\n[\s\S]*?\n  ui-critical-fast:/.exec(ci)?.[0] ?? "";
    expect(producer).toContain("PLAYWRIGHT_BUILD_ROOT_ID: ci-${{ github.run_id }}");
    // --project=chromium only: the chromium-mockups project would bake mockups in.
    expect(producer).toContain("run: node scripts/run-playwright.mjs --project=chromium\n");
    expect(producer).toContain("name: playwright-next-build-${{ github.run_id }}");

    const job = /\n  lighthouse-budget:\n[\s\S]*?\n  lighthouse-baseline-refresh:/.exec(ci)?.[0] ?? "";
    expect(job).toContain("needs: [changes, ui-playwright-build]");
    expect(job).toMatch(/if: >\n\s+!cancelled\(\) &&\n\s+needs\.changes\.result == 'success' &&/);
    expect(job).toContain(
      "(needs.ui-playwright-build.result == 'success' || needs.ui-playwright-build.result == 'skipped')",
    );
    expect(job).toMatch(
      /Download shared Playwright Next build\n\s+if: needs\.ui-playwright-build\.result == 'success'[\s\S]*?name: playwright-next-build-\$\{\{ github\.run_id \}\}\n\s+path: \.next-playwright\/ci-\$\{\{ github\.run_id \}\}/,
    );
    expect(job).toContain(
      "LIGHTHOUSE_REUSE_BUILD_ROOT_ID: ${{ needs.ui-playwright-build.result == 'success' && format('ci-{0}', github.run_id) || '' }}",
    );

    // Same source revision: the artifact is keyed by this run's id, so it can only come from
    // this run's producer, and neither job overrides the checkout ref, so both build/serve the
    // run's own github.sha (the merge ref on a PR). A `ref:` on either side would break that.
    const checkout = (segment: string) =>
      /- name: Checkout\n\s+uses: actions\/checkout@[^\n]+\n\s+with:\n((?:\s{10}[^\n]+\n)+)/.exec(segment)?.[1] ?? "";
    for (const segment of [producer, job]) {
      expect(segment).toContain("uses: actions/checkout@");
      expect(checkout(segment)).not.toMatch(/\bref:|repository:/);
    }
  });

  it("fails closed when a requested build is missing and never deletes a reused build root", () => {
    const runner = read("scripts/run-lighthouse-budget.mjs");
    expect(runner).toContain('path.join(absoluteRunRoot, "dist", "BUILD_ID")');
    expect(runner).toMatch(/if \(!reuseBuildRootId\) \{\s*try \{\s*removePathSync\(absoluteRunRoot/);
  });
});

describe("baselineFromRows", () => {
  it("records the graded metrics per run, sorted for a stable diff", () => {
    const baseline = baselineFromRows([row("mobile-root", { lcpMs: 1200 }), row("desktop-root", { lcpMs: 900 })]);

    expect(Object.keys(baseline)).toEqual(["desktop-root", "mobile-root"]);
    expect(baseline["mobile-root"]).toEqual({
      lcpMs: 1200,
      cls: 0,
      tbtMs: 100,
      fcpMs: 500,
      // Stored so a later comparison can tell a browser bump from a regression.
      chromeVersion: "HeadlessChrome/140",
    });
  });
});

describe("check:lighthouse-budget --update", () => {
  it("writes every configured tolerance metric into the refreshed baseline", () => {
    // Removing the budget-aware serialization from the update path must make this
    // fail: the refreshed baseline would omit performanceScore and reject itself.
    const budgetPath = path.join(process.cwd(), "lighthouse-budget.json");
    const originalBudget = readFileSync(budgetPath, "utf8");
    const directory = mkdtempSync(path.join(tmpdir(), "lighthouse-update-"));
    try {
      writeFileSync(
        budgetPath,
        JSON.stringify({
          enforce: true,
          routes: ["/"],
          strategies: ["mobile"],
          tolerance: { performanceScore: { absolute: 0.02 } },
          baseline: null,
        }),
      );
      writeFileSync(
        path.join(directory, "mobile-root.json"),
        JSON.stringify({
          requestedUrl: "http://localhost:4461/",
          finalDisplayedUrl: "http://localhost:4461/",
          environment: { hostUserAgent: "HeadlessChrome/140" },
          categories: { performance: { score: 0.99 } },
          audits: {
            "largest-contentful-paint": { numericValue: 1000 },
            "cumulative-layout-shift": { numericValue: 0 },
            "total-blocking-time": { numericValue: 100 },
            "first-contentful-paint": { numericValue: 500 },
          },
        }),
      );

      execFileSync(process.execPath, ["scripts/check-lighthouse-budget.mjs", "--update", "--dir", directory], {
        cwd: process.cwd(),
        encoding: "utf8",
      });

      const updated = JSON.parse(readFileSync(budgetPath, "utf8"));
      expect(updated.baseline["mobile-root"].performanceScore).toBe(0.99);
      expect(validateLighthouseBaseline(updated)).toMatchObject({ ok: true });
    } finally {
      writeFileSync(budgetPath, originalBudget);
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("committed lighthouse-budget.json", () => {
  const committed = JSON.parse(readFileSync(path.join(process.cwd(), "lighthouse-budget.json"), "utf8")) as {
    routes: string[];
    strategies: string[];
    lighthouseVersion: string;
    enforce: boolean;
    baseline: Record<string, { chromeVersion?: unknown }>;
  };

  it("measures the routes this suite grades", () => {
    expect(committed.routes).toEqual(COMMITTED_ROUTES);
  });

  it("pins the same Lighthouse version as the live-domain workflow", () => {
    // Two entry points drive Lighthouse (this pre-merge budget and the dispatch-only
    // live baseline). A version skew between them makes their numbers incomparable,
    // which is the whole reason the live workflow pins exactly rather than `@12`.
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "live-web-vitals.yml"), "utf8");
    const pinned = /LIGHTHOUSE_VERSION:\s*"([^"]+)"/.exec(workflow)?.[1];

    expect(pinned, "LIGHTHOUSE_VERSION not found in live-web-vitals.yml").toBeTruthy();
    expect(committed.lighthouseVersion).toBe(pinned);
  });

  it("names a strategy set the grader understands", () => {
    expect(committed.strategies).toEqual(["mobile", "desktop"]);
  });

  it("records a complete baseline from one named browser identity", () => {
    const rows = Object.values(committed.baseline ?? {});
    const versions = rows
      .map((row) => row.chromeVersion)
      .filter((version): version is string => typeof version === "string" && version.length > 0);

    expect(rows).toHaveLength(committed.routes.length * committed.strategies.length);
    expect(versions).toHaveLength(rows.length);
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toContain("HeadlessChrome/");
    expect(validateLighthouseBaseline(committed)).toMatchObject({ ok: true });
  });

  it("measures every route without a query string", () => {
    // Budget routes stay query-free so a silent `?q=` addition cannot hide new
    // client-driven API traffic. This is a signal, not a complete proof that no API
    // runs on load — `/` already fetches /api/setup-status and /api/local-project-id,
    // and those handlers are carved into perfInitialLoadApiPatterns.
    expect(committed.routes.filter((route) => route.includes("?"))).toEqual([]);
  });

  it("writes an isolated tsconfig that silences TS5101 baseUrl deprecation", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts", "run-lighthouse-budget.mjs"), "utf8");

    // Same Next 16.3 + TS 6 TS5101 trap as the Playwright runner (#1798).
    expect(runner).toContain('ignoreDeprecations: "6.0"');
    expect(runner).toContain('baseUrl: "../.."');
    expect(runner).toContain('paths: { "@/*": ["src/*"] }');
    expect(runner).toContain('extends: "../../tsconfig.typecheck.json"');
    expect(runner).not.toContain('extends: "../../tsconfig.json"');
  });

  it("invokes npm's JavaScript npx CLI through Node when available", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts", "run-lighthouse-budget.mjs"), "utf8");

    expect(runner).toContain('const npxCli = path.join(path.dirname(npmExecPath), "npx-cli.js")');
    expect(runner).toContain("process.env.npm_node_execpath ?? process.execPath");
    expect(runner).toMatch(/spawn\(\s*npxInvocation\.command,/);
    expect(runner).toContain("...npxInvocation.prefixArgs");
    expect(runner).not.toMatch(/spawnSync\(\s*"npx",/);
    expect(runner).not.toMatch(/spawnSync\(\s*"npx\.cmd",/);
    expect(runner).toContain("stopOwnedProcessTree(child)");
    expect(runner).toContain('detached: process.platform !== "win32"');
  });

  it("uses two targeted confirmations and restores the initial breach when evidence is incomplete", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts", "run-lighthouse-budget.mjs"), "utf8");

    expect(runner).toContain("for (let attempt = 1; attempt <= 2; attempt += 1)");
    expect(runner).toContain("majorityBreachDecision(samples)");
    expect(runner).toMatch(/if \(unavailable \|\| !decision\) \{\s*copyFileSync\(initial, target\.output\)/);
  });

  it("bounds each Lighthouse process independently of its navigation timeout", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts", "run-lighthouse-budget.mjs"), "utf8");

    expect(runner).toMatch(
      /const buildTimeoutMs = lighthouseBuildTimeoutMs\(\{\s*platform: process\.platform,\s*ci: process\.env\.CI !== undefined,\s*\}\);/,
    );
    expect(runner).toContain("timeout: buildTimeoutMs");
    expect(runner).toContain("waitForServer(baseUrl, server, LIGHTHOUSE_SERVER_READY_TIMEOUT_MS)");
    expect(runner).toContain("if (requestTimeout === 0) break");
    expect(runner).toContain("deadlineAfter(LIGHTHOUSE_MEASUREMENT_SUITE_TIMEOUT_MS)");
    expect(runner).toContain("LIGHTHOUSE_PROCESS_TIMEOUT_MS");
    expect(runner).toContain("--max-wait-for-load=60000");
    expect(runner).not.toMatch(/stdio:\s*"inherit",\s*\n\s*timeout,/);
  });

  it("disables local-dev install prompts during Lighthouse measurements", () => {
    expect(routeWithLighthouseParams("/forms")).toBe("/forms?pwa-dev=0");
    expect(routeWithLighthouseParams("/forms?feature=abc")).toBe("/forms?feature=abc&pwa-dev=0");
  });

  it("attributes a failing layout-shift cell from the reports before they are cleared", () => {
    const runner = readFileSync(path.join(process.cwd(), "scripts", "run-lighthouse-budget.mjs"), "utf8");

    // `#TYZK23`: mobile-/ CLS is bistable and fires only on CI, so a red gate
    // that prints a bare number forces every investigation through the retained
    // artifact. The report already names the shifting element.
    expect(runner).toContain('const LAYOUT_SHIFT_AUDIT_IDS = ["layout-shifts", "layout-shift-elements"');
    expect(runner).toContain("if (childProcessExitCode(grade) !== 0) reportLayoutShiftAttribution(reportDirectory);");

    // Diagnostics run against the reports, so they must precede the delete that a
    // non-`--keep` run performs, and must not influence the graded exit code.
    const attribution = runner.indexOf("if (childProcessExitCode(grade) !== 0) reportLayoutShiftAttribution");
    const clear = runner.indexOf("if (!keep) removePathSync(reportDirectory, { recursive: true });");
    expect(attribution).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(attribution);
  });
});

describe("Lighthouse time budget", () => {
  it("selects the supported build duration by execution environment", () => {
    expect(lighthouseBuildTimeoutMs({ platform: "win32", ci: false })).toBe(20 * 60_000);
    expect(lighthouseBuildTimeoutMs({ platform: "win32", ci: true })).toBe(10 * 60_000);
    expect(lighthouseBuildTimeoutMs({ platform: "linux", ci: false })).toBe(10 * 60_000);
  });

  it("uses a real deadline for server readiness and each process", () => {
    const deadline = deadlineAfter(120_000, 1_000);

    expect(deadline).toBe(121_000);
    expect(remainingMs(deadline, 61_000)).toBe(60_000);
    expect(processTimeoutMs(deadline, 120_000, 61_000)).toBe(60_000);
    expect(processTimeoutMs(deadline, 120_000, deadline)).toBe(0);
  });
});

describe("measurementFailureReason", () => {
  const report = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ requestedUrl: "http://localhost:4461/forms", audits: {}, ...extra });

  it("passes a clean run through", () => {
    expect(measurementFailureReason(0, report())).toBeNull();
  });

  it("flags a non-zero exit that wrote no report", () => {
    expect(measurementFailureReason(1, null)).toContain("exited 1");
  });

  it("grades a parseable report even when post-measurement cleanup exits non-zero", () => {
    expect(measurementFailureReason(1, report())).toBeNull();
  });

  it("flags a run that was killed without a status", () => {
    expect(measurementFailureReason(null, null)).toContain("without a status");
  });

  it("flags a clean exit that wrote no report", () => {
    expect(measurementFailureReason(0, null)).toBe("no report file was written");
    expect(measurementFailureReason(0, "")).toBe("no report file was written");
  });

  it("flags an unparseable report", () => {
    expect(measurementFailureReason(0, "{not json")).toBe("report is not valid JSON");
  });

  it("flags the NO_NAVSTART shape that exits zero with a well-formed report", () => {
    // Ledger #147: `/forms` did this locally while the live dispatch measured it
    // fine. An exit-code check alone leaves it unretried, because Lighthouse both
    // exits 0 and writes a valid file whose only content is the runtime error.
    expect(measurementFailureReason(0, report({ runtimeError: { code: "NO_NAVSTART" } }))).toBe(
      "lighthouse runtimeError NO_NAVSTART",
    );
  });

  it("never retries a real measurement that produced bad numbers", () => {
    // The line that keeps this a retry and not a re-roll: a page that loaded and
    // scored badly is evidence, and re-running it until it goes green is the failure
    // mode this whole gate exists to prevent.
    const slow = report({ audits: { "largest-contentful-paint": { numericValue: 9999 } } });

    expect(measurementFailureReason(0, slow)).toBeNull();
  });
});

describe("readReports", () => {
  it("ignores the retry sidecar rather than reading it as a report", () => {
    // retries.txt is deliberately not .json: readReports globs *.json and skips only
    // summary.json, so a JSON sidecar would be parsed as a Lighthouse report and
    // become a phantom row named `retries` — a run the budget never asked for,
    // carrying no metrics.
    const directory = mkdtempSync(path.join(tmpdir(), "lighthouse-reports-"));
    try {
      writeFileSync(
        path.join(directory, "mobile-root.json"),
        JSON.stringify({ requestedUrl: "http://localhost:4461/", finalUrl: "http://localhost:4461/", audits: {} }),
      );
      writeFileSync(path.join(directory, "retries.txt"), "mobile /forms (lighthouse runtimeError NO_NAVSTART)\n");

      expect(readReports(directory).map((entry: { run: string }) => entry.run)).toEqual(["mobile-root"]);
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("renderBudgetTable", () => {
  it("subordinates every measurement when the evidence is incomplete", () => {
    const rows = completeRows().filter((entry: Row) => entry.run !== "mobile-forms");
    const result = compareToLighthouseBudget(rows, budget({ baseline: baselineFromRows(completeRows()) }));

    expect(renderBudgetTable(rows, result)).toContain("Evidence incomplete");
  });

  it("says a warned regression was reported only", () => {
    const rows = completeRows({ "mobile-dsm": { lcpMs: 4000 } });
    const result = compareToLighthouseBudget(
      rows,
      budget({ baseline: baselineFromRows(completeRows()), enforce: false }),
    );

    expect(renderBudgetTable(rows, result)).toContain("enforce` is false");
  });

  it("states the pass explicitly when every route is within tolerance", () => {
    const rows = completeRows();
    const result = compareToLighthouseBudget(rows, budget({ baseline: baselineFromRows(rows) }));

    expect(renderBudgetTable(rows, result)).toContain("within tolerance of the committed baseline");
  });
});

describe("validateBaselineBrowserVersions", () => {
  it("accepts a baseline with exactly one browser version across all rows", () => {
    const baseline = baselineFromRows(completeRows());
    const result = validateBaselineBrowserVersions(baseline);

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual(["HeadlessChrome/140"]);
    expect(result.error).toBeNull();
  });

  it("rejects an empty baseline", () => {
    const result = validateBaselineBrowserVersions({});

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no baseline rows recorded");
  });

  it("rejects a baseline with mixed browser versions", () => {
    const rows = completeRows();
    const mixed = Object.fromEntries(
      Object.entries(baselineFromRows(rows)).map(([run, entry], index) => [
        run,
        { ...(entry as object), chromeVersion: index % 2 === 0 ? "HeadlessChrome/140" : "HeadlessChrome/141" },
      ]),
    );
    const result = validateBaselineBrowserVersions(mixed);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("expected exactly one baseline Chrome version");
  });

  it("rejects a baseline where some rows are missing a browser version", () => {
    const rows = completeRows();
    const partial = Object.fromEntries(
      Object.entries(baselineFromRows(rows)).map(([run, entry], index) => [
        run,
        { ...(entry as object), chromeVersion: index === 0 ? null : "HeadlessChrome/140" },
      ]),
    );
    const result = validateBaselineBrowserVersions(partial);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("some rows are missing a valid HeadlessChrome version");
  });
});

describe("validateLighthouseBaseline", () => {
  it("rejects a transcribed numeric string instead of silently skipping that metric", () => {
    const baseline = baselineFromRows(completeRows());
    baseline["mobile-root"].lcpMs = "2281.896" as unknown as number;

    const validation = validateLighthouseBaseline(budget({ baseline }));

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("mobile-root: baseline lcpMs must be a finite non-negative number");
    const comparison = compareToLighthouseBudget(completeRows(), budget({ baseline }));
    expect(comparison).toMatchObject({ status: "fail", reason: "evidence incomplete", breaches: [] });
  });

  it.each([
    ["non-finite", Number.NaN],
    ["negative", -1],
  ])("rejects a %s baseline metric", (_label, value) => {
    const baseline = baselineFromRows(completeRows());
    baseline["desktop-root"].tbtMs = value;

    expect(validateLighthouseBaseline(budget({ baseline })).errors).toContain(
      "desktop-root: baseline tbtMs must be a finite non-negative number",
    );
  });

  it("rejects missing and unexpected rows", () => {
    const baseline = baselineFromRows(completeRows());
    delete baseline["mobile-root"];
    baseline["desktop-transcribed"] = { ...baseline["desktop-root"] };

    expect(validateLighthouseBaseline(budget({ baseline })).errors).toEqual(
      expect.arrayContaining([
        "mobile-root: no baseline row recorded — refresh with --update",
        "desktop-transcribed: unexpected baseline row",
      ]),
    );
  });

  it("rejects a malformed browser label even when every row repeats it", () => {
    const malformed = Object.fromEntries(
      Object.entries(baselineFromRows(completeRows())).map(([run, entry]) => [
        run,
        { ...(entry as object), chromeVersion: "Chrome one-fifty-one" },
      ]),
    );

    expect(validateLighthouseBaseline(budget({ baseline: malformed })).errors).toEqual(
      expect.arrayContaining([expect.stringContaining("baseline has no valid HeadlessChrome version")]),
    );
  });

  it("refuses mixed report browsers before comparing numbers", () => {
    const rows = completeRows().map((entry: Row, index: number) => ({
      ...entry,
      chromeVersion: index % 2 === 0 ? "HeadlessChrome/150.0.0.0" : "HeadlessChrome/151.0.0.0",
    }));
    const matchingMixedBaseline = baselineFromRows(rows);

    const result = compareToLighthouseBudget(rows, budget({ baseline: matchingMixedBaseline }));

    expect(result).toMatchObject({ status: "fail", reason: "evidence incomplete", breaches: [] });
    expect(result.incomplete).toEqual(
      expect.arrayContaining([
        expect.stringContaining("reports were measured by mixed Chrome versions"),
        expect.stringContaining("baseline browser identity invalid"),
      ]),
    );
  });

  it("wires the GitHub refresh job to the shared full validator", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    const refreshJob = workflow.slice(
      workflow.indexOf("  lighthouse-baseline-refresh:"),
      workflow.indexOf("  db-reset-verify:"),
    );

    expect(refreshJob).toContain("node scripts/check-lighthouse-budget.mjs --validate-baseline");
    expect(refreshJob).not.toContain("node -e \"const b=require('./lighthouse-budget.json')");
  });
});
