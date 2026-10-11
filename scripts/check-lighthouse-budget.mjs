#!/usr/bin/env node
/**
 * check-lighthouse-budget — grade Lighthouse reports from a LOCAL production build
 * against a committed baseline, so a performance regression is caught before merge.
 *
 * Why this exists alongside `.github/workflows/live-web-vitals.yml`: that workflow
 * measures the deployed origin, is dispatch-only by design, and answers the ledger
 * #017 question ("are the real numbers acceptable?"). It cannot stop a regression
 * from merging — by the time it runs, `main` has already auto-deployed to
 * psychiatry.tools. This gate answers the other question: "did this diff make the
 * app slower than the last known-good build?"
 *
 * It is deliberately a RELATIVE gate. Absolute web-vitals thresholds are meaningless
 * against a localhost server with no network latency — every route would pass
 * trivially and the gate would catch nothing. So this follows the same shape as
 * `check:bundle-budget`: a committed baseline, a tolerance, and an `enforce` flag.
 *   - No baseline recorded  -> warn, exit 0 (never breaks a run that has nothing to
 *     compare against).
 *   - Within tolerance      -> ok.
 *   - Over tolerance        -> fail when enforcing, warn otherwise.
 *   - Evidence incomplete   -> ALWAYS fail. A route that produced no report is not a
 *     pass; this is the failure mode `summarise-web-vitals.mjs` documents at length.
 *
 * Refresh the baseline from an intentional, known-good run:
 *   npm run check:lighthouse-budget -- --update
 *
 * `--update` deliberately ignores baseline-relative mismatches (a different Chrome
 * user-agent, or a newly added route with no prior row). Those are exactly why the
 * baseline is being refreshed; treating them as incomplete evidence made the
 * documented remediation unreachable after a runner-image Chrome bump.
 *
 * Flags: --update, --validate-baseline, --json, --dir <path>, --require-reports
 * (an empty directory is a failure, not a no-op — used by
 * run-lighthouse-budget.mjs, which owns the reports).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collidingRouteSlugs,
  hasUsableMetrics,
  measuredRequestedPage,
  routeSlug,
  summariseReport,
} from "./summarise-web-vitals.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET_PATH = path.join(root, "lighthouse-budget.json");

/** Metrics graded, and how a regression in each is decided. */
export const DEFAULT_TOLERANCE = Object.freeze({
  // Percentage growth alone flags noise on small numbers (12ms -> 16ms is +33%),
  // and an absolute floor alone flags nothing on slow routes. A breach needs both.
  lcpMs: { pct: 20, minAbsolute: 100 },
  tbtMs: { pct: 30, minAbsolute: 50 },
  // CLS is a unitless ratio that is usually 0 on a good build, where percentage
  // growth is undefined or infinite. Graded on absolute movement only.
  cls: { absolute: 0.02 },
});

/**
 * Runner tolerance floors for bimodal variance on high-variance routes.
 * Scoped to exact intended run ids only: desktop root ("desktop-root"), mobile root ("mobile-root"),
 * and the documents-search strategy runs ("mobile-documents-search", "desktop-documents-search").
 * Do NOT match bare "documents" substrings — that would raise the LCP floor on
 * unintended future /documents/* routes and false-green real regressions.
 * Headless Chromium runner scheduling exhibits ~150-180ms LCP jitter between runs
 * on identical code without application regression for these calibrated routes.
 */
export const BIMODAL_RUNNER_TOLERANCE_FLOORS = {
  lcpMs: 200,
};

/** Exact run ids that receive BIMODAL_RUNNER_TOLERANCE_FLOORS — keep this set narrow. */
const BIMODAL_RUNNER_VARIANCE_RUNS = new Set([
  "desktop-root",
  "mobile-root",
  "mobile-documents-search",
  "desktop-documents-search",
]);

export function isBimodalRunnerVarianceRun(runName) {
  if (!runName || typeof runName !== "string") return false;
  return BIMODAL_RUNNER_VARIANCE_RUNS.has(runName);
}

const BASELINE_METRICS = Object.freeze(["lcpMs", "cls", "tbtMs", "fcpMs"]);
const HEADLESS_CHROME_VERSION = /\bHeadlessChrome\/\d+(?:\.\d+){0,3}\b/;

function requiredBudgetMetrics(budget) {
  return new Set([...BASELINE_METRICS, ...Object.keys({ ...DEFAULT_TOLERANCE, ...(budget?.tolerance ?? {}) })]);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordedChromeVersion(row) {
  const value = row?.chromeVersion;
  return typeof value === "string" && HEADLESS_CHROME_VERSION.test(value) ? value : null;
}

/** Every `<strategy>-<slug>` run name the budget asks for. */
export function expectedBudgetRuns(budget) {
  const strategies = budget?.strategies ?? ["mobile", "desktop"];
  const slugs = (budget?.routes ?? []).map(routeSlug).filter(Boolean);
  return strategies.flatMap((strategy) => slugs.map((slug) => `${strategy}-${slug}`));
}

/**
 * Runs that cannot be graded at all: no report, no usable metrics, or a report that
 * measured a different page than the one requested (a redirect to /login produces
 * perfectly good numbers for the wrong route).
 *
 * Fails closed and is never downgraded by `enforce` — an ungraded route silently
 * counted as a pass is exactly how unmeasured latency claims got acted on before.
 *
 * Pass `{ ignoreBaseline: true }` for `--update`: baseline-relative problems (missing
 * prior row, Chrome user-agent drift) are the reason to refresh, not a reason to
 * refuse the refresh. Measurement gaps still block.
 */
export function incompleteBudgetEvidence(rows, budget, { ignoreBaseline = false } = {}) {
  const baseline = budget?.baseline ?? null;
  const hasBaseline = Boolean(baseline) && Object.keys(baseline).length > 0;
  // A slug collision means two routes write the same report filename, so the second
  // overwrites the first and the surviving file would satisfy the expected-run check
  // for both. The filename scheme cannot represent both pages, so this is fatal
  // before anything is measured rather than a per-run problem.
  const problems = new Set(collidingRouteSlugs(budget?.routes ?? []).map((slug) => `route slug collision: ${slug}`));
  const byRun = new Map(rows.filter(isRecord).map((row) => [row.run, row]));
  // Browser drift is collected separately from the other problems because it is ONE
  // fact about the baseline, not N independent per-route defects — see the collapse
  // below. The verdict is identical either way; only the message changes.
  const drift = new Map();

  const expectedRuns = expectedBudgetRuns(budget);
  const expectedRunSet = new Set(expectedRuns);
  const seenRuns = new Set();
  const reportVersions = new Set();

  for (const row of rows) {
    if (!isRecord(row) || typeof row.run !== "string" || row.run.length === 0) {
      problems.add("Lighthouse report has no valid run name");
      continue;
    }
    if (seenRuns.has(row.run)) problems.add(`${row.run}: more than one Lighthouse report was supplied`);
    seenRuns.add(row.run);
    if (!expectedRunSet.has(row.run)) problems.add(`${row.run}: unexpected Lighthouse report`);

    const version = recordedChromeVersion(row);
    if (!version) problems.add(`${row.run}: report has no valid HeadlessChrome version`);
    else reportVersions.add(version);
  }
  if (reportVersions.size > 1) {
    problems.add(
      `reports were measured by mixed Chrome versions (${[...reportVersions].sort().join(", ")}) — ` +
        "discard this evidence and rerun the complete matrix on one pinned browser",
    );
  }

  const baselineValidation = hasBaseline && !ignoreBaseline ? validateLighthouseBaseline(budget) : null;
  for (const error of baselineValidation?.errors ?? []) problems.add(error);
  const baselineComparable = !baselineValidation || baselineValidation.ok;

  for (const run of expectedRuns) {
    const row = byRun.get(run);
    if (!row) {
      problems.add(`${run}: no Lighthouse report produced`);
      continue;
    }
    if (!hasUsableMetrics(row)) {
      problems.add(`${run}: report has no LCP or CLS number`);
      continue;
    }
    if (!measuredRequestedPage(row)) {
      problems.add(`${run}: report measured a different page than requested`);
      continue;
    }
    // Completeness is derived from what is actually GRADED, not from the LCP/CLS pair
    // `hasUsableMetrics` checks for ledger #017. This budget also grades TBT, so a
    // report missing it would otherwise pass completeness and then have TBT silently
    // skipped by gradeRun.
    for (const metric of requiredBudgetMetrics(budget)) {
      if (!Number.isFinite(row[metric]) || row[metric] < 0) {
        problems.add(`${run}: report has no valid ${metric} number`);
      }
    }
    if (ignoreBaseline || !hasBaseline || !baselineComparable || reportVersions.size !== 1) continue;
    const before = baseline[run];
    // A route or strategy added after the baseline was recorded has nothing to
    // compare against, and gradeRun returns no breaches for a missing row — so an
    // arbitrarily bad new route would grade `ok`.
    if (!before) {
      problems.add(`${run}: no baseline row recorded — refresh with --update`);
      continue;
    }
    // Numbers are only comparable when the same browser produced them. Chrome comes
    // from the runner image and moves independently of the pinned Lighthouse
    // version, so a browser bump is otherwise indistinguishable from an application
    // regression. summarise-web-vitals.mjs makes the same point about its baselines.
    if (before.chromeVersion && row.chromeVersion && before.chromeVersion !== row.chromeVersion) {
      drift.set(run, { before: before.chromeVersion, after: row.chromeVersion });
    }
  }

  // One browser bump reds every run in the budget, and printing ten near-identical
  // sentences buried the single actionable instruction. Collapse to one line ONLY
  // when drift is the whole story and every run drifted the same way — any
  // measurement gap, or a mixed set of browsers, still lists per run because those
  // are genuinely different facts. This changes the message, never the verdict:
  // `compareToLighthouseBudget` still returns `fail` on a non-empty result,
  // independently of `enforce`.
  const driftPairs = new Set([...drift.values()].map(({ before, after }) => JSON.stringify([before, after])));
  if (drift.size > 0 && drift.size === expectedRuns.length && problems.size === 0 && driftPairs.size === 1) {
    const [{ before, after }] = drift.values();
    return [
      `browser drift on ${drift.size} run(s): the baseline was measured by ${before}, this run used ${after} — ` +
        'refresh it with the CI "Refresh Lighthouse baseline" dispatch (workflow_dispatch, refresh_lighthouse_baseline)',
    ];
  }
  for (const [run, { before, after }] of drift) {
    problems.add(`${run}: baseline measured by a different browser (${before} vs ${after}) — refresh with --update`);
  }
  return [...problems].sort();
}

/** Grade one run against its baseline. Returns the breaches, empty when within tolerance. */
export function gradeRun(row, baselineRow, tolerance = DEFAULT_TOLERANCE) {
  if (!baselineRow) return [];
  const breaches = [];
  const runName = row?.run ?? "";
  const isBimodalRun = isBimodalRunnerVarianceRun(runName);

  for (const [metric, rule] of Object.entries(tolerance)) {
    const current = row?.[metric];
    const before = baselineRow?.[metric];
    if (typeof current !== "number" || typeof before !== "number") continue;
    const delta = current - before;
    if (delta <= 0) continue;

    if (typeof rule.absolute === "number") {
      if (delta > rule.absolute) {
        breaches.push({
          run: row.run,
          metric,
          baseline: before,
          current,
          delta,
          reason: `${metric} +${delta.toFixed(3)} vs baseline (max +${rule.absolute})`,
        });
      }
      continue;
    }

    const pct = before === 0 ? Number.POSITIVE_INFINITY : (delta / before) * 100;
    const runnerFloor = isBimodalRun ? (BIMODAL_RUNNER_TOLERANCE_FLOORS[metric] ?? 0) : 0;
    const minAbsolute = Math.max(rule.minAbsolute ?? 0, runnerFloor);

    if (delta >= minAbsolute && pct > rule.pct) {
      breaches.push({
        run: row.run,
        metric,
        baseline: before,
        current,
        delta,
        reason:
          `${metric} +${delta.toFixed(0)} (+${Number.isFinite(pct) ? pct.toFixed(1) : "inf"}%) vs baseline ` +
          `(tolerance +${rule.pct}% and +${minAbsolute})`,
      });
    }
  }

  return breaches;
}

/**
 * Pure comparison over every graded run.
 * Returns { status: "ok"|"warn"|"fail", breaches, incomplete, ... }.
 */
export function compareToLighthouseBudget(rows, budget) {
  const tolerance = { ...DEFAULT_TOLERANCE, ...(budget?.tolerance ?? {}) };
  const baseline = budget?.baseline ?? null;
  const enforce = Boolean(budget?.enforce);
  const incomplete = incompleteBudgetEvidence(rows, budget);

  // Incompleteness is fatal regardless of `enforce`: there is nothing to grade, so
  // "warn" would report a pass for a route that was never measured.
  if (incomplete.length > 0) {
    return { status: "fail", reason: "evidence incomplete", breaches: [], incomplete, baseline, enforce, tolerance };
  }

  if (!baseline || Object.keys(baseline).length === 0) {
    return {
      status: "warn",
      reason: "no baseline recorded — run with --update after a known-good build",
      breaches: [],
      incomplete,
      baseline,
      enforce,
      tolerance,
    };
  }

  const breaches = rows.flatMap((row) => gradeRun(row, baseline[row.run], tolerance));
  if (breaches.length === 0) {
    return { status: "ok", reason: "within tolerance", breaches, incomplete, baseline, enforce, tolerance };
  }
  return {
    status: enforce ? "fail" : "warn",
    reason: `${breaches.length} metric(s) outside tolerance`,
    breaches,
    incomplete,
    baseline,
    enforce,
    tolerance,
  };
}

/** Unique Lighthouse cells whose numeric breach warrants targeted confirmation. */
export function numericBreachConfirmationRuns(rows, budget) {
  const result = compareToLighthouseBudget(rows, budget);
  if (result.incomplete.length > 0) return [];
  return [...new Set(result.breaches.map((breach) => breach.run))].sort();
}

/**
 * Decide a breached cell from its initial sample plus two confirmations.
 * Null means the evidence set is incomplete and callers must retain the initial
 * failing sample rather than clearing a required gate from partial evidence.
 */
export function majorityBreachDecision(samples) {
  if (!Array.isArray(samples) || samples.length !== 3 || samples.some((sample) => typeof sample !== "boolean")) {
    return null;
  }
  const breachCount = samples.filter(Boolean).length;
  return { breached: breachCount >= 2, breachCount, sampleCount: samples.length };
}

/** The baseline object to commit for a set of measured rows. */
export function baselineFromRows(rows, budget) {
  const metrics = requiredBudgetMetrics(budget);
  return Object.fromEntries(
    [...rows]
      .sort((a, b) => (a.run < b.run ? -1 : a.run > b.run ? 1 : 0))
      .map((row) => [
        row.run,
        // chromeVersion is stored so a later run can detect that the browser moved
        // underneath the baseline rather than the application regressing.
        {
          ...Object.fromEntries([...metrics].map((metric) => [metric, row[metric]])),
          chromeVersion: row.chromeVersion ?? null,
        },
      ]),
  );
}

export function renderBudgetTable(rows, result) {
  const format = (value, digits = 0) => (value === null || value === undefined ? "n/a" : value.toFixed(digits));
  const baseline = result.baseline ?? {};
  const lines = [
    "| run | LCP ms | baseline | TBT ms | baseline | CLS | baseline |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => {
      const before = baseline[row.run] ?? {};
      return (
        `| ${row.run} | ${format(row.lcpMs)} | ${format(before.lcpMs)} | ` +
        `${format(row.tbtMs)} | ${format(before.tbtMs)} | ` +
        `${format(row.cls, 3)} | ${format(before.cls, 3)} |`
      );
    }),
  ];

  lines.push("");
  if (result.incomplete.length > 0) {
    lines.push(`**Evidence incomplete.** ${result.incomplete.join("; ")}. Nothing is graded from this run.`);
    return lines.join("\n");
  }
  if (result.status === "warn" && result.breaches.length === 0) {
    lines.push(`_${result.reason}._`);
    return lines.join("\n");
  }
  if (result.breaches.length === 0) {
    lines.push(`**Every graded route is within tolerance of the committed baseline.**`);
    return lines.join("\n");
  }
  lines.push(
    `**${result.breaches.length} metric(s) regressed:** ` +
      `${result.breaches.map((breach) => `${breach.run} ${breach.reason}`).join("; ")}.` +
      (result.enforce ? "" : " Reported only — `enforce` is false in lighthouse-budget.json."),
  );
  return lines.join("\n");
}

export function loadBudget(budgetPath = BUDGET_PATH) {
  try {
    return JSON.parse(readFileSync(budgetPath, "utf8"));
  } catch {
    return { enforce: false, routes: [], strategies: ["mobile", "desktop"], baseline: null };
  }
}

export function readReports(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json") && file !== "summary.json")
    .sort()
    .map((file) =>
      summariseReport(file.replace(/\.json$/, ""), JSON.parse(readFileSync(path.join(directory, file), "utf8"))),
    );
}

/**
 * Validate that a baseline object contains exactly one distinct browser version
 * across all its recorded rows.
 */
export function validateBaselineBrowserVersions(baseline) {
  if (!isRecord(baseline)) return { ok: false, versions: [], error: "baseline is not an object" };
  const rows = Object.values(baseline);
  if (rows.length === 0) return { ok: false, versions: [], error: "no baseline rows recorded" };
  const versions = [...new Set(rows.map(recordedChromeVersion).filter(Boolean))];
  if (rows.some((row) => !recordedChromeVersion(row))) {
    return {
      ok: false,
      versions,
      error: `some rows are missing a valid HeadlessChrome version; found ${versions.length} version(s)`,
    };
  }
  if (versions.length !== 1) {
    return {
      ok: false,
      versions,
      error: `expected exactly one baseline Chrome version across all rows; found ${versions.length}`,
    };
  }
  return { ok: true, versions, error: null };
}

/**
 * Validate the committed baseline before any relative comparison is attempted.
 *
 * This is deliberately stricter than `gradeRun`, whose tolerant helpers skip an
 * absent value. Skipping is useful while rendering partial diagnostics, but it is
 * unsafe for a committed baseline: a hand-transcribed string or omitted metric
 * would silently remove that metric from the gate.
 */
export function validateLighthouseBaseline(budget) {
  const baseline = budget?.baseline;
  if (!isRecord(baseline)) {
    return { ok: false, versions: [], errors: ["baseline is not an object"] };
  }

  const expectedRuns = expectedBudgetRuns(budget);
  const expected = new Set(expectedRuns);
  const actualRuns = Object.keys(baseline);
  const errors = [];

  for (const run of expectedRuns) {
    if (!Object.hasOwn(baseline, run)) errors.push(`${run}: no baseline row recorded — refresh with --update`);
  }
  for (const run of actualRuns) {
    if (!expected.has(run)) errors.push(`${run}: unexpected baseline row`);
  }

  for (const run of actualRuns.filter((candidate) => expected.has(candidate)).sort()) {
    const row = baseline[run];
    if (!isRecord(row)) {
      errors.push(`${run}: baseline row is not an object`);
      continue;
    }
    for (const metric of requiredBudgetMetrics(budget)) {
      const value = row[metric];
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`${run}: baseline ${metric} must be a finite non-negative number`);
      }
    }
    if (!recordedChromeVersion(row)) errors.push(`${run}: baseline has no valid HeadlessChrome version`);
  }

  const browserValidation = validateBaselineBrowserVersions(baseline);
  if (!browserValidation.ok && !browserValidation.error?.includes("missing a valid HeadlessChrome")) {
    errors.push(`baseline browser identity invalid: ${browserValidation.error}`);
  }

  return {
    ok: errors.length === 0,
    versions: browserValidation.versions,
    errors: [...new Set(errors)].sort(),
  };
}

export function selfTest() {
  const sampleBudget = {
    routes: ["/", "/therapy-compass"],
    strategies: ["mobile", "desktop"],
    baseline: null,
  };
  const runs = expectedBudgetRuns(sampleBudget);
  if (runs.length !== 4) throw new Error(`selfTest failed: expected 4 runs, got ${runs.length}`);

  const sampleRows = runs.map((run) => ({
    run,
    url: `http://localhost:4461/${run}`,
    requestedUrl: `http://localhost:4461/${run}`,
    runtimeError: null,
    performanceScore: 0.99,
    lcpMs: 1000,
    cls: 0,
    tbtMs: 100,
    fcpMs: 500,
    chromeVersion: "HeadlessChrome/140",
  }));

  const cleanProblems = incompleteBudgetEvidence(sampleRows, sampleBudget);
  if (cleanProblems.length !== 0) {
    throw new Error(`selfTest failed: clean matrix produced problems: ${cleanProblems.join(", ")}`);
  }

  const staleBaseline = baselineFromRows(sampleRows.map((r) => ({ ...r, chromeVersion: "HeadlessChrome/131" })));
  const uniformDrift = incompleteBudgetEvidence(sampleRows, { ...sampleBudget, baseline: staleBaseline });
  if (uniformDrift.length !== 1 || !uniformDrift[0].includes("browser drift on 4 run(s)")) {
    throw new Error(`selfTest failed: uniform drift not collapsed to 1 message: ${uniformDrift.join(", ")}`);
  }

  const mixedBaseline = {
    ...staleBaseline,
    [runs[0]]: { ...staleBaseline[runs[0]], chromeVersion: null },
  };
  const nonUniformDrift = incompleteBudgetEvidence(sampleRows, { ...sampleBudget, baseline: mixedBaseline });
  if (nonUniformDrift.length !== 1 || !nonUniformDrift[0].includes("baseline has no valid HeadlessChrome version")) {
    throw new Error(
      `selfTest failed: invalid mixed baseline was not rejected before comparison: ${nonUniformDrift.join(", ")}`,
    );
  }

  const validationSuccess = validateBaselineBrowserVersions(staleBaseline);
  if (!validationSuccess.ok || validationSuccess.versions.length !== 1) {
    throw new Error("selfTest failed: valid baseline rejected by validateBaselineBrowserVersions");
  }
  const validationFailure = validateBaselineBrowserVersions(mixedBaseline);
  if (validationFailure.ok) {
    throw new Error("selfTest failed: mixed baseline accepted by validateBaselineBrowserVersions");
  }

  const gradeResult = gradeRun(sampleRows[0], { lcpMs: 500, cls: 0, tbtMs: 100 });
  if (gradeResult.length === 0) throw new Error("selfTest failed: gradeRun did not flag regression");

  // Calibrated runner tolerance floor accommodates bimodal runner variance on intended runs only
  const bimodalIgnored = gradeRun({ run: "desktop-root", lcpMs: 961 }, { lcpMs: 786, cls: 0, tbtMs: 100 });
  if (bimodalIgnored.length !== 0) throw new Error("selfTest failed: bimodal runner variance was not accommodated");

  const bimodalMobileRootIgnored = gradeRun({ run: "mobile-root", lcpMs: 961 }, { lcpMs: 786, cls: 0, tbtMs: 100 });
  if (bimodalMobileRootIgnored.length !== 0) {
    throw new Error("selfTest failed: mobile-root bimodal runner variance was not accommodated");
  }

  const bimodalDocsSearchIgnored = gradeRun(
    { run: "desktop-documents-search", lcpMs: 961 },
    { lcpMs: 786, cls: 0, tbtMs: 100 },
  );
  if (bimodalDocsSearchIgnored.length !== 0) {
    throw new Error("selfTest failed: documents-search bimodal runner variance was not accommodated");
  }

  const bimodalBreached = gradeRun({ run: "desktop-root", lcpMs: 1050 }, { lcpMs: 786, cls: 0, tbtMs: 100 });
  if (bimodalBreached.length === 0) throw new Error("selfTest failed: real regression on bimodal route not flagged");

  // Negative: bare "documents" substring must NOT raise the LCP floor (false-green risk)
  if (isBimodalRunnerVarianceRun("desktop-documents") || isBimodalRunnerVarianceRun("mobile-documents-upload")) {
    throw new Error("selfTest failed: bare documents substring incorrectly treated as bimodal");
  }
  const nonBimodalDocuments = gradeRun({ run: "desktop-documents", lcpMs: 961 }, { lcpMs: 786, cls: 0, tbtMs: 100 });
  if (nonBimodalDocuments.length === 0) {
    throw new Error("selfTest failed: unintended documents* run got bimodal LCP floor (false-green path)");
  }
  if (isBimodalRunnerVarianceRun("mobile-dsm")) {
    throw new Error("selfTest failed: mobile-dsm incorrectly treated as bimodal");
  }

  const comparison = compareToLighthouseBudget(sampleRows, { ...sampleBudget, baseline: staleBaseline });
  if (comparison.status !== "fail") throw new Error("selfTest failed: drifted baseline did not fail comparison");

  const majorityDecision = majorityBreachDecision([true, true, false]);
  if (!majorityDecision?.breached) throw new Error("selfTest failed: majority breach decision incorrect");

  console.log("check:lighthouse-budget self-test passed.");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const update = argv.includes("--update");
  const requireReports = argv.includes("--require-reports");
  const asJson = argv.includes("--json");
  const dirIndex = argv.indexOf("--dir");
  const directory = path.resolve(root, dirIndex >= 0 ? (argv[dirIndex + 1] ?? "lighthouse") : "lighthouse");

  const budget = loadBudget();

  if (argv.includes("--validate-baseline")) {
    const validation = validateLighthouseBaseline(budget);
    if (!validation.ok) {
      console.error(`::error::invalid Lighthouse baseline: ${validation.errors.join("; ")}`);
      process.exit(1);
    }
    console.log(`check:lighthouse-budget: baseline valid for ${expectedBudgetRuns(budget).length} run(s).`);
    console.log(`check:lighthouse-budget: browser ${validation.versions[0]}.`);
    return;
  }

  const rows = readReports(directory);

  if (rows.length === 0) {
    // Two situations share this branch, and conflating them is how a gate reports
    // success having measured nothing.
    //
    // Standalone (`npm run check:lighthouse-budget`): mirrors check:bundle-budget —
    // no reports means no build happened, which is not a verdict either way, so say
    // so and exit 0 rather than failing a run that simply did not build.
    //
    // With --require-reports (how run-lighthouse-budget.mjs always calls it): the
    // caller owns the directory and has just attempted every route, so empty means
    // every Lighthouse invocation failed. That is the fail-closed case.
    const relative = path.relative(root, directory);
    if (requireReports) {
      console.error(
        `::error::check:lighthouse-budget: no Lighthouse reports in ${relative} — every measurement failed, so nothing was graded.`,
      );
      process.exit(1);
    }
    console.log(`check:lighthouse-budget: no Lighthouse reports in ${relative} — nothing to grade.`);
    return;
  }

  const result = compareToLighthouseBudget(rows, budget);

  if (update) {
    // Only measurement gaps block a refresh. Browser drift / missing prior rows are
    // why `--update` exists — see incompleteBudgetEvidence({ ignoreBaseline: true }).
    const measurementGaps = incompleteBudgetEvidence(rows, budget, { ignoreBaseline: true });
    if (measurementGaps.length > 0) {
      console.error(`::error::refusing to update the baseline from incomplete evidence: ${measurementGaps.join("; ")}`);
      process.exit(1);
    }
    const nextBaseline = baselineFromRows(rows, budget);
    const validation = validateLighthouseBaseline({ ...budget, baseline: nextBaseline });
    if (!validation.ok) {
      console.error(`::error::refusing to update the baseline: ${validation.errors.join("; ")}.`);
      process.exit(1);
    }
    const next = {
      ...budget,
      baseline: nextBaseline,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(BUDGET_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`check:lighthouse-budget: baseline updated for ${rows.length} run(s) in lighthouse-budget.json.`);
    return;
  }

  const table = renderBudgetTable(rows, result);
  console.log(table);
  if (asJson) console.log(JSON.stringify({ ...result, rows }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse budget\n\n${table}\n`, { flag: "a" });
  }

  if (result.status === "fail") {
    console.error(`::error::check:lighthouse-budget failed — ${result.reason}`);
    process.exit(1);
  }
  if (result.status === "warn") console.log(`::warning::check:lighthouse-budget — ${result.reason}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-lighthouse-budget.mjs")) {
  main();
}
