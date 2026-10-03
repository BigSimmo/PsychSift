#!/usr/bin/env node
/**
 * check-bundle-budget — guard client JS bundle size against regression.
 *
 * The repo did perf/bundle-hygiene work, but nothing stops a regression: the next
 * heavy dependency or an accidental client-side import of a big module (e.g. pulling
 * a snapshot into a client component) silently undoes it. This measures the built
 * client chunks and compares total gzip size against a committed baseline
 * (bundle-budget.json), failing when growth exceeds the tolerance.
 *
 * WHICH QUESTIONS THIS ANSWERS — three complementary views, on purpose.
 *
 * It used to answer one blurred question. `totalGzipBytes` summed EVERY built
 * client chunk, including `src/app/mockups/**` design scratch that 404s in
 * production, and compared that to a ceiling named as though it were production
 * weight. Two repo positions then disagreed with nothing to arbitrate them:
 * `#013` held that mockup chunks "are not an initial production bundle", while
 * this gate charged them against the ceiling anyway — which is how PR #1580
 * blocked on "+10.1% vs baseline" for chunks no user can load.
 *
 * Measured on `main` at af85cbc (2026-08-09), the blur had become the whole
 * signal: 1546.5 KiB total was +9.96% of the old baseline — 576 bytes from
 * failing — while the production-only number was 1279.1 KiB, or 9.06% BELOW
 * that same baseline. Every byte of the apparent regression was design scratch;
 * production had actually shrunk. So the split is not a way to raise a ceiling,
 * it is the only way either number means anything.
 *
 *   - `production` — chunks any non-mockup route reaches, plus every chunk no
 *     route manifest claims (framework, polyfills, runtime). This is user-facing
 *     weight and the regression guard the budget was written for. Enforced at
 *     `production.tolerancePct` (default 10%).
 *   - `routes` — chunks referenced by each configured user journey. These catch
 *     route-local growth that can be diluted by the aggregate production total.
 *   - `mockups` — chunks reachable ONLY from `/mockups/**`. Nobody downloads
 *     these, so this is a repo-hygiene ceiling that exists to catch unbounded
 *     accumulation (66 mockup routes today), not to gate the next mockup.
 *     Enforced at the deliberately looser `mockups.tolerancePct` (default 25%).
 *
 * A chunk shared by both is production: it would be built with or without the
 * mockup. Attribution failures fail the check rather than collapsing the
 * buckets.
 *
 * STATUS: enforced. `bundle-budget.json` carries `enforce: true` and committed
 * `production.gzipBytes`, route, and `mockups.gzipBytes` baselines.
 *   - After an intentional, known-good production build, run
 *     `npm run check:bundle-budget -- --update` to refresh every baseline.
 *   - Set `enforce: false` to fall back to warn-only.
 * Reads .next/static/chunks/**.js. If no build output exists it prints a note and
 * exits 0 (so it never breaks a run that didn't build).
 *
 * Flags: --refresh-baseline (strict provenance check and scheduled baseline refresh), --max-distance <n>, --update (write current measurement as baseline), --json.
 *
 * Exit hardening: CI has observed this check print success then never terminate
 * (GHA then cancels the Build job at timeout-minutes, which "Re-run failed jobs"
 * will not re-run). Measurement streams one file at a time, and every exit path
 * goes through {@link exitProcess} (stdio drain + hard failsafe).
 */
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

// `BUNDLE_BUDGET_ROOT` lets tests point at a disposable fixture tree without
// mutating the repo checkout's `.next` (and without relying on `process.cwd()`,
// which npm scripts do not always keep at the package root).
const root = process.env.BUNDLE_BUDGET_ROOT
  ? path.resolve(process.env.BUNDLE_BUDGET_ROOT)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHUNKS_DIR = path.join(root, ".next", "static", "chunks");
const BUDGET_PATH = path.join(root, "bundle-budget.json");
const APP_BUILD_MANIFEST_PATH = path.join(root, ".next", "app-build-manifest.json");
const BUILD_MANIFEST_PATH = path.join(root, ".next", "build-manifest.json");
const ROOT_PAGE_CLIENT_REFERENCE_MANIFEST_PATH = path.join(
  root,
  ".next",
  "server",
  "app",
  "page_client-reference-manifest.js",
);
const SERVER_APP_DIR = path.join(root, ".next", "server", "app");

/**
 * Route segment that marks design-scratch routes. `src/app/mockups/**` 404s in
 * production (see next.config.ts) and is exempt from the wiring and
 * reachability gates, so its client chunks are not production weight — but they
 * are still built, so they are still repo weight. Everything downstream of this
 * constant exists to keep those two facts in separate numbers.
 */
export const MOCKUP_ROUTE_SEGMENT = "mockups";

/** Hard ceiling so a stuck stdio drain cannot burn the whole Build job timeout. */
export const EXIT_FAILSAFE_MS = 1_000;

const fixtureSnapshotMarkerGroups = [
  {
    name: "services snapshot",
    markers: ["deep_research_citation_tokens", "canonical_name_key", "source_table_lines"],
  },
  {
    name: "forms fixture catalogue",
    markers: ["transport-crisis-form", "extension-transport-order", "detention-examination-movement"],
  },
  {
    name: "differentials snapshot",
    markers: ["redFlagFlows", "searchAliases", "exportedAt"],
  },
  // Prevention-only guards: these marker sets do not claim a measured speedup.
  // They fail only when an entire generated medication payload leaks into an
  // initial dashboard chunk, not when ordinary UI copy contains one marker.
  {
    name: "medications snapshot",
    markers: ["GABA / Glutamate Modulator", "1998 mg/day", "Renal Adj."],
  },
  {
    name: "medication interaction index",
    markers: ["generatedFrom", "sourceRowCount", "rowsWithCatalogueTarget", "medicationsWithUnresolvedRows"],
  },
];

function walkJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Measure client chunks → { files, totalRawBytes, totalGzipBytes, largest[] }. */
export function measureChunks(files) {
  const measured = files.map(({ name, buffer }) => ({
    name,
    rawBytes: buffer.length,
    gzipBytes: gzipSync(buffer).length,
  }));
  const totalRawBytes = measured.reduce((sum, f) => sum + f.rawBytes, 0);
  const totalGzipBytes = measured.reduce((sum, f) => sum + f.gzipBytes, 0);
  const largest = [...measured].sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 5);
  return { files: measured.length, totalRawBytes, totalGzipBytes, largest };
}

/**
 * Stream-measure every JS chunk without retaining file buffers. Keeps peak RSS
 * low and avoids leaving multi‑MiB ArrayBuffers alive across process exit on CI.
 */
export function measureChunkPaths(paths, readFile = readFileSync) {
  const measured = [];
  let totalRawBytes = 0;
  let totalGzipBytes = 0;
  for (const full of paths) {
    const buffer = readFile(full);
    const rawBytes = buffer.length;
    const gzipBytes = gzipSync(buffer).length;
    totalRawBytes += rawBytes;
    totalGzipBytes += gzipBytes;
    measured.push({ name: path.relative(CHUNKS_DIR, full), rawBytes, gzipBytes });
  }
  const largest = [...measured].sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, 5);
  // `measured` carries names and byte counts only — no buffers — so exposing it
  // for per-bucket subtotals does not reintroduce the RSS problem above.
  return { files: measured.length, totalRawBytes, totalGzipBytes, largest, measured };
}

/**
 * Pure comparison. Returns { status: "ok"|"warn"|"fail", overPct, ... }.
 * - no baseline → "warn" (nothing to compare yet).
 * - within tolerance and over warnTolerancePct → "warn" (drift warning below hard ceiling).
 * - within tolerance and within warnTolerancePct → "ok".
 * - over tolerance → "fail" if enforcing, else "warn".
 */
export function compareToBudget(current, budget) {
  const baseline = budget?.totalGzipBytes ?? null;
  const tolerancePct = budget?.tolerancePct ?? 10;
  const warnTolerancePct = typeof budget?.warnTolerancePct === "number" ? budget.warnTolerancePct : null;
  const enforce = Boolean(budget?.enforce);
  if (baseline == null) {
    return {
      status: "warn",
      reason: "no baseline recorded",
      overPct: null,
      baseline,
      tolerancePct,
      warnTolerancePct,
      enforce,
      isDriftWarning: false,
    };
  }
  // A zero baseline is valid (e.g. `--update` after a build with no mockup-exclusive
  // chunks). `(0 - 0) / 0` is NaN and would permanently fail an unchanged empty
  // budget; treat that as within tolerance, and any growth from zero as unbounded.
  const overPct =
    baseline === 0
      ? current.totalGzipBytes === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : ((current.totalGzipBytes - baseline) / baseline) * 100;
  const withinTolerance = Number.isFinite(overPct) && overPct <= tolerancePct;
  const isDriftWarning =
    withinTolerance && warnTolerancePct !== null && Number.isFinite(overPct) && overPct > warnTolerancePct;
  const overPctLabel = Number.isFinite(overPct) ? overPct.toFixed(1) : "∞";

  if (!withinTolerance) {
    return {
      status: enforce ? "fail" : "warn",
      reason: `+${overPctLabel}% vs baseline (tolerance ${tolerancePct}%)`,
      overPct,
      baseline,
      tolerancePct,
      warnTolerancePct,
      enforce,
      isDriftWarning: false,
    };
  }

  if (isDriftWarning) {
    return {
      status: "warn",
      reason: `+${overPctLabel}% vs baseline (drift warning > ${warnTolerancePct}%, tolerance ${tolerancePct}%)`,
      overPct,
      baseline,
      tolerancePct,
      warnTolerancePct,
      enforce,
      isDriftWarning: true,
    };
  }

  return {
    status: "ok",
    reason: "within tolerance",
    overPct,
    baseline,
    tolerancePct,
    warnTolerancePct,
    enforce,
    isDriftWarning: false,
  };
}

/** Resolve the JavaScript chunks required by the root App Router dashboard. */
export function initialDashboardChunkNames(appBuildManifest, pageClientReferenceManifest) {
  const pages = appBuildManifest?.pages ?? {};
  const pageClientChunks = Object.values(pageClientReferenceManifest?.clientModules ?? {}).flatMap((module) =>
    Array.isArray(module?.chunks) ? module.chunks : [],
  );
  const names = new Set([
    ...(appBuildManifest?.rootMainFiles ?? []),
    ...(pages["/layout"] ?? []),
    ...(pages["/page"] ?? []),
    ...pageClientChunks,
  ]);
  return [...names]
    .filter((name) => typeof name === "string" && name.endsWith(".js"))
    .map((name) => name.replace(/^\/?static\/chunks\//, ""));
}

function loadRootPageClientReferenceManifest() {
  if (!existsSync(ROOT_PAGE_CLIENT_REFERENCE_MANIFEST_PATH)) return null;
  const source = readFileSync(ROOT_PAGE_CLIENT_REFERENCE_MANIFEST_PATH, "utf8");
  const marker = 'globalThis.__RSC_MANIFEST["/page"]=';
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const jsonEnd = source.lastIndexOf(";");
  if (jsonEnd <= jsonStart) return null;
  return JSON.parse(source.slice(jsonStart, jsonEnd));
}

/**
 * Parse any per-route `*_client-reference-manifest.js` and return the client
 * chunk names it references. Next 16 (webpack) emits no `app-build-manifest.json`,
 * so these per-route manifests are the only route -> chunk mapping available.
 * Returns `null` when the file cannot be decoded so callers can fail closed —
 * an empty set only means a successfully parsed route with no client chunks.
 *
 * @param {string} source raw manifest file contents
 * @returns {Set<string>|null} chunk names relative to `.next/static/chunks`, or null
 */
export function clientChunkNamesFromManifestSource(source) {
  return clientRouteAndChunkNamesFromManifestSource(source)?.chunks ?? null;
}

/** Decode the route key and client chunks from one Next.js RSC manifest. */
export function clientRouteAndChunkNamesFromManifestSource(source) {
  const names = new Set();
  const marker = "globalThis.__RSC_MANIFEST[";
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const assign = source.indexOf("]=", start);
  if (assign < 0) return null;
  const end = source.lastIndexOf(";");
  if (end <= assign) return null;
  let manifest;
  let route;
  try {
    route = JSON.parse(source.slice(start + marker.length, assign));
    manifest = JSON.parse(source.slice(assign + 2, end));
  } catch {
    return null;
  }
  if (typeof route !== "string") return null;
  for (const clientModule of Object.values(manifest?.clientModules ?? {})) {
    for (const chunk of Array.isArray(clientModule?.chunks) ? clientModule.chunks : []) {
      if (typeof chunk === "string" && chunk.endsWith(".js")) {
        names.add(chunk.replace(/^\/?static\/chunks\//, ""));
      }
    }
  }
  return { route: normalizeManifestRoute(route), chunks: names };
}

/** Convert Next's `/segment/page` RSC key into its public route pathname. */
export function normalizeManifestRoute(route) {
  const withoutGroups = route
    .split("/")
    .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")))
    .join("/");
  const withoutPage = withoutGroups === "page" ? "" : withoutGroups.replace(/\/page$/, "");
  return `/${withoutPage}`.replace(/\/{2,}/g, "/");
}

/**
 * Walk `.next/server/app` and split client chunk names into the ones reachable
 * only from `/mockups/**` and the ones any production route reaches.
 *
 * A chunk shared by a mockup route and a production route is **production**: it
 * would be built regardless of whether the mockup existed, so charging it to
 * design scratch would understate production weight. Chunks no manifest
 * references at all (framework, polyfills, webpack runtime) are likewise
 * production — attribution failures must never shrink the production number,
 * because that is the number with the enforced ceiling.
 *
 * Every discovered `*_client-reference-manifest.js` must decode. Counting a
 * malformed file toward `routeCount` would bypass the later "none resolved"
 * checks, and a production parse failure with a surviving mockup parse would
 * leave shared chunks only in `mockupChunks`, understating the production budget.
 *
 * @returns {{
 *   mockupExclusive: Set<string>,
 *   routeCount: number,
 *   mockupRouteCount: number,
 *   unparseable: string[],
 *   routeChunks: Map<string, Set<string>>,
 * }}
 */
export function partitionRouteClientChunks(serverAppDir, deps = {}) {
  const { readDir = readdirSync, readFile = readFileSync } = deps;
  const mockupChunks = new Set();
  const productionChunks = new Set();
  const unparseable = [];
  const routeChunks = new Map();
  let routeCount = 0;
  let mockupRouteCount = 0;

  const walk = (dir, isMockup) => {
    for (const entry of readDir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, isMockup || entry.name === MOCKUP_ROUTE_SEGMENT);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith("_client-reference-manifest.js")) continue;
      const parsed = clientRouteAndChunkNamesFromManifestSource(readFile(full, "utf8"));
      if (parsed == null) {
        // Keep diagnostic paths stable across Windows and POSIX hosts. These
        // values are surfaced in CI output and asserted by the offline suite.
        unparseable.push(full.replaceAll("\\", "/"));
        continue;
      }
      routeCount += 1;
      if (isMockup) mockupRouteCount += 1;
      const target = isMockup ? mockupChunks : productionChunks;
      const routeTarget = routeChunks.get(parsed.route) ?? new Set();
      for (const name of parsed.chunks) {
        target.add(name);
        routeTarget.add(name);
      }
      routeChunks.set(parsed.route, routeTarget);
    }
  };
  walk(serverAppDir, false);

  const mockupExclusive = new Set([...mockupChunks].filter((name) => !productionChunks.has(name)));
  return { mockupExclusive, routeCount, mockupRouteCount, unparseable, routeChunks };
}

/** Sum the gzip bytes of the measured chunks whose names are in `names`. */
export function gzipBytesOf(measuredFiles, names) {
  return measuredFiles.reduce(
    (sum, file) => (names.has(file.name.replace(/\\/g, "/")) ? sum + file.gzipBytes : sum),
    0,
  );
}

/** Measure the client JavaScript referenced by each configured public route. */
export function measureBudgetRoutes(measuredFiles, routeChunks, routeBudgets) {
  const measured = {};
  const missing = [];
  for (const route of Object.keys(routeBudgets ?? {})) {
    const names = routeChunks.get(route);
    if (!names) {
      missing.push(route);
      continue;
    }
    measured[route] = { gzipBytes: gzipBytesOf(measuredFiles, names), chunks: names.size };
  }
  return { measured, missing };
}

/**
 * @typedef {object} ServerHtmlPayloadMeasurement
 * @property {boolean} found
 * @property {string} [file]
 * @property {number} rawBytes
 * @property {number} gzipBytes
 * @property {number} [rawBytesCeiling]
 * @property {number} [gzipBytesCeiling]
 * @property {"ok" | "fail" | "missing" | "error"} status
 * @property {string} [reason]
 */

/**
 * Measure static / server HTML page payloads generated in .next/server/app.
 * Guards large server pages such as /mockups/development/clinical-sign-off against unchecked growth.
 *
 * @param {string} serverAppDir
 * @param {Record<string, { rawBytesCeiling?: number; gzipBytesCeiling?: number; maxRawBytes?: number; maxGzipBytes?: number; required?: boolean }>} [serverPagesConfig]
 * @param {{ existsSync?: (p: string) => boolean; readFileSync?: (p: string) => Buffer; readdirSync?: (p: string) => string[] }} [fsOptions]
 * @returns {Record<string, ServerHtmlPayloadMeasurement>}
 */
export function measureServerHtmlPayloads(serverAppDir, serverPagesConfig, fsOptions = {}) {
  const fileExists = fsOptions.existsSync ?? existsSync;
  const fileRead = fsOptions.readFileSync ?? readFileSync;
  const readDirectory = fsOptions.readdirSync ?? readdirSync;

  // Next strips route groups from the URL but keeps them in the build output, so
  // `/sources/search` is emitted under `(search-app)/sources/search`. Almost
  // every route in this app lives in a group, so without this the block could
  // only guard the handful that do not, and a configured route would silently
  // report "missing" instead of guarding anything.
  let routeGroups = [];
  try {
    routeGroups = readDirectory(serverAppDir).filter((name) => name.startsWith("(") && name.endsWith(")"));
  } catch {
    routeGroups = [];
  }
  /** @type {Record<string, ServerHtmlPayloadMeasurement>} */
  const results = {};
  const defaults = {
    "/mockups/development/clinical-sign-off": {
      rawBytesCeiling: 750_000,
      gzipBytesCeiling: 110_000,
    },
  };
  const configs = serverPagesConfig ?? defaults;

  for (const [route, config] of Object.entries(configs)) {
    const rawCeiling = config.rawBytesCeiling ?? config.maxRawBytes ?? 2_500_000;
    const gzipCeiling = config.gzipBytesCeiling ?? config.maxGzipBytes ?? 350_000;

    const normalizedRoute = route.startsWith("/") ? route.slice(1) : route;
    // Prerendered HTML first, then the flight payload, then the compiled server
    // module: a dynamic route emits only the last of the three.
    const candidates = ["", ...routeGroups].flatMap((group) => {
      const base = group ? path.join(serverAppDir, group) : serverAppDir;
      return [
        path.join(base, `${normalizedRoute}.html`),
        path.join(base, normalizedRoute, "page.html"),
        path.join(base, `${normalizedRoute}.rsc`),
        path.join(base, normalizedRoute, "page.rsc"),
        path.join(base, `${normalizedRoute}.js`),
        path.join(base, normalizedRoute, "page.js"),
      ];
    });

    const match = candidates.find((cand) => fileExists(cand));
    if (!match) {
      results[route] = {
        found: false,
        rawBytes: 0,
        gzipBytes: 0,
        status: "missing",
        reason: "no build artifact found for configured server page",
      };
      continue;
    }

    try {
      const buffer = fileRead(match);
      const rawBytes = buffer.length;
      const gzipBytes = gzipSync(buffer).length;
      const exceededRaw = rawBytes > rawCeiling;
      const exceededGzip = gzipBytes > gzipCeiling;
      results[route] = {
        found: true,
        file: match,
        rawBytes,
        gzipBytes,
        rawBytesCeiling: rawCeiling,
        gzipBytesCeiling: gzipCeiling,
        status: exceededRaw || exceededGzip ? "fail" : "ok",
        reason: exceededRaw
          ? `HTML payload (${kb(rawBytes)}) exceeds raw ceiling (${kb(rawCeiling)})`
          : exceededGzip
            ? `HTML gzip payload (${kb(gzipBytes)}) exceeds gzip ceiling (${kb(gzipCeiling)})`
            : "within ceiling",
      };
    } catch {
      results[route] = { found: false, rawBytes: 0, gzipBytes: 0, status: "error" };
    }
  }

  return results;
}

/** Identify large fixture payloads from stable groups of serialized keys/slugs.
 * Requiring every marker in a group avoids failing on ordinary UI copy that
 * happens to mention one fixture term. */
export function findFixtureSnapshotsInChunks(files) {
  const content = files.map(({ buffer }) => buffer.toString("utf8")).join("\n");
  return fixtureSnapshotMarkerGroups
    .filter((group) => group.markers.every((marker) => content.includes(marker)))
    .map((group) => group.name);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function loadBudget() {
  try {
    return JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
  } catch {
    return { enforce: false, tolerancePct: 10, totalGzipBytes: null };
  }
}

function readCurrentGitHead() {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve immutable provenance for an intentional baseline refresh.
 * @param {Record<string, string | undefined>} [environment]
 * @param {() => string | null} [readHead]
 */
export function resolveBaselineSource(environment = process.env, readHead = readCurrentGitHead) {
  for (const candidate of [environment.BUNDLE_BUDGET_SOURCE_SHA, environment.GITHUB_SHA]) {
    if (typeof candidate === "string" && /^[0-9a-f]{40}$/i.test(candidate.trim())) {
      return candidate.trim().toLowerCase();
    }
  }
  const candidate = readHead();
  if (typeof candidate === "string" && /^[0-9a-f]{40}$/i.test(candidate.trim())) {
    return candidate.trim().toLowerCase();
  }
  return null;
}

export const STALE_BASELINE_COMMIT_DISTANCE_THRESHOLD = 50;

const BASELINE_SOURCE_REMEDIATION =
  "Fetch the recorded baseline commit so its ancestry can be verified, or deliberately refresh the baseline from a reviewed known-good production build with `npm run check:bundle-budget -- --update`.";

/**
 * Resolve whether a configured baseline names a local commit that is an
 * ancestor of HEAD. Git's exit 1 for `merge-base --is-ancestor` and command
 * failures both mean that commit distance is not trustworthy here.
 * @param {string | null | undefined} baselineSha
 * @param {string} [cwd]
 * @param {typeof execFileSync} [exec]
 */
export function resolveBaselineGitStatus(baselineSha, cwd = root, exec = execFileSync) {
  if (!baselineSha || typeof baselineSha !== "string" || !/^[0-9a-f]{40}$/i.test(baselineSha.trim())) {
    return { commitExists: null, comparableAsAncestor: null };
  }
  const normalized = baselineSha.trim().toLowerCase();
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
  try {
    exec("git", ["-C", cwd, "cat-file", "-e", `${normalized}^{commit}`], options);
  } catch {
    return { commitExists: false, comparableAsAncestor: null };
  }
  try {
    exec("git", ["-C", cwd, "merge-base", "--is-ancestor", normalized, "HEAD"], options);
    return { commitExists: true, comparableAsAncestor: true };
  } catch {
    return { commitExists: true, comparableAsAncestor: false };
  }
}

/** Pure decision for the non-failing baseline provenance warning. */
export function decideBaselineSourceWarning({ baselineSource, commitExists, comparableAsAncestor }) {
  if (typeof baselineSource !== "string" || !/^[0-9a-f]{40}$/i.test(baselineSource.trim()) || commitExists === null) {
    return null;
  }
  const normalized = baselineSource.trim().toLowerCase();
  if (!commitExists) {
    return {
      code: "baseline-source-unresolvable",
      baselineSource: normalized,
      message: `Configured baselineSource ${normalized} does not resolve to a local Git commit.`,
      remediation: BASELINE_SOURCE_REMEDIATION,
    };
  }
  if (!comparableAsAncestor) {
    return {
      code: "baseline-source-not-ancestor",
      baselineSource: normalized,
      message: `Configured baselineSource ${normalized} cannot be compared as an ancestor of HEAD.`,
      remediation: BASELINE_SOURCE_REMEDIATION,
    };
  }
  return null;
}

/**
 * Resolve commit distance between baseline SHA and current Git HEAD.
 * @param {string | null | undefined} baselineSha
 * @param {string} [cwd]
 * @param {typeof execFileSync} [exec]
 * @returns {number | null}
 */
export function resolveBaselineCommitDistance(baselineSha, cwd = root, exec = execFileSync) {
  if (!baselineSha || typeof baselineSha !== "string" || !/^[0-9a-f]{40}$/i.test(baselineSha.trim())) {
    return null;
  }
  try {
    const raw = exec("git", ["-C", cwd, "rev-list", "--count", `${baselineSha.trim().toLowerCase()}..HEAD`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const count = typeof raw === "string" ? raw.trim() : "";
    if (!/^\d+$/.test(count)) {
      return null;
    }
    const n = Number.parseInt(count, 10);
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Parse optional `--max-distance <n>` or `--max-distance=<n>` argument.
 * Returns `null` if not specified, non-negative integer if valid, or `NaN` if invalid.
 * @param {string[]} argv
 * @returns {number | null}
 */
export function parseMaxDistance(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-distance") {
      if (i + 1 < argv.length) {
        const val = Number(argv[i + 1]);
        if (Number.isSafeInteger(val) && val >= 0) return val;
      }
      return Number.NaN;
    }
    if (arg.startsWith("--max-distance=")) {
      const raw = arg.slice("--max-distance=".length);
      const val = Number(raw);
      if (Number.isSafeInteger(val) && val >= 0) return val;
      return Number.NaN;
    }
  }
  return null;
}

/**
 * Strict provenance check for baseline refresh.
 * Verifies that the baseline source SHA exists in Git, is an ancestor of HEAD (or HEAD itself),
 * and optionally enforces maximum commit distance behind HEAD.
 *
 * @param {string | null | undefined} baselineSha
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {number | null} [options.maxDistance]
 * @param {typeof execFileSync} [options.exec]
 * @returns {{
 *   valid: boolean;
 *   code?: "invalid-sha" | "commit-not-found" | "not-ancestor" | "distance-unresolvable" | "distance-exceeded";
 *   message: string;
 *   baselineSource?: string;
 *   commitDistance?: number;
 * }}
 */
export function validateBaselineProvenance(baselineSha, options = {}) {
  const { cwd = root, maxDistance = null, exec = execFileSync } = options;
  if (!baselineSha || typeof baselineSha !== "string" || !/^[0-9a-f]{40}$/i.test(baselineSha.trim())) {
    return {
      valid: false,
      code: "invalid-sha",
      message: "Baseline source must be a valid 40-character Git commit SHA.",
    };
  }
  const normalized = baselineSha.trim().toLowerCase();
  const gitStatus = resolveBaselineGitStatus(normalized, cwd, exec);

  if (gitStatus.commitExists !== true) {
    return {
      valid: false,
      code: "commit-not-found",
      message: `Baseline source commit ${normalized} does not exist in local Git history.`,
    };
  }

  if (gitStatus.comparableAsAncestor !== true) {
    return {
      valid: false,
      code: "not-ancestor",
      message: `Baseline source commit ${normalized} is not an ancestor of HEAD (or HEAD itself).`,
    };
  }

  const distance = resolveBaselineCommitDistance(normalized, cwd, exec);
  if (distance === null) {
    return {
      valid: false,
      code: "distance-unresolvable",
      message: `Could not determine commit distance between baseline source ${normalized} and HEAD.`,
    };
  }

  if (maxDistance !== null && distance > maxDistance) {
    return {
      valid: false,
      code: "distance-exceeded",
      message: `Baseline source commit ${normalized} is ${distance} commit(s) behind HEAD, exceeding maximum allowed distance of ${maxDistance}.`,
      commitDistance: distance,
    };
  }

  return {
    valid: true,
    baselineSource: normalized,
    commitDistance: distance,
    message: `Baseline source ${normalized} is verified (${distance === 0 ? "HEAD" : `${distance} commit(s) behind HEAD`}).`,
  };
}

/**
 * Injectable stdio/timer/exit surface for {@link exitProcess}. Defaults match
 * Node's process helpers; tests pass narrow mocks. Typed via JSDoc so Vitest
 * mocks do not have to satisfy `WriteStream` / `never` inference from defaults
 * (Static PR typecheck regression on PR #1489).
 *
 * @typedef {object} ExitProcessOptions
 * @property {(code: number) => void} [exitImpl]
 * @property {{ write: (chunk: string) => boolean; once?: (event: string, listener: () => void) => unknown }} [stdout]
 * @property {typeof setTimeout} [setTimer]
 * @property {number} [failsafeMs]
 */

/**
 * Force the process to terminate even when stdio drain or a stray handle would
 * otherwise keep the event loop alive (the PR #1489 Build cancellation mode).
 * Exported for unit tests; `exitImpl` / `setTimer` are injectable.
 *
 * @param {number} code
 * @param {ExitProcessOptions} [options]
 */
export function exitProcess(code, options = {}) {
  const {
    exitImpl = (value) => {
      process.exit(value);
    },
    stdout = process.stdout,
    setTimer = setTimeout,
    failsafeMs = EXIT_FAILSAFE_MS,
  } = options;
  process.exitCode = code;
  let exited = false;
  const force = () => {
    if (exited) return;
    exited = true;
    exitImpl(code);
  };
  const timer = setTimer(force, failsafeMs);
  timer.unref?.();
  try {
    if (!stdout || typeof stdout.write !== "function") {
      force();
      return;
    }
    // Drain any pending stdout before exit; if the write buffer is already
    // empty, `write` returns true and we can exit immediately.
    if (stdout.write("")) {
      force();
      return;
    }
    stdout.once?.("drain", force);
  } catch {
    force();
  }
}

function isMainModule() {
  return isDirectEntrypoint(import.meta.url);
}

export function selfTest() {
  const failures = [];
  const check = (label, condition) => {
    if (!condition) failures.push(label);
  };

  // compareToBudget
  const okVerdict = compareToBudget(
    { totalGzipBytes: 1000 },
    { enforce: true, tolerancePct: 10, totalGzipBytes: 1000 },
  );
  check("compareToBudget: exact baseline is ok", okVerdict.status === "ok" && !okVerdict.isDriftWarning);

  const driftVerdict = compareToBudget(
    { totalGzipBytes: 1060 },
    { enforce: true, tolerancePct: 10, warnTolerancePct: 5, totalGzipBytes: 1000 },
  );
  check(
    "compareToBudget: 6% growth triggers drift warning",
    driftVerdict.status === "warn" && driftVerdict.isDriftWarning,
  );

  const failVerdict = compareToBudget(
    { totalGzipBytes: 1150 },
    { enforce: true, tolerancePct: 10, warnTolerancePct: 5, totalGzipBytes: 1000 },
  );
  check(
    "compareToBudget: 15% growth fails when enforcing",
    failVerdict.status === "fail" && !failVerdict.isDriftWarning,
  );

  const noBaselineVerdict = compareToBudget({ totalGzipBytes: 1000 }, { enforce: true, totalGzipBytes: null });
  check(
    "compareToBudget: no baseline warns",
    noBaselineVerdict.status === "warn" && noBaselineVerdict.baseline === null,
  );

  const zeroBaselineOk = compareToBudget({ totalGzipBytes: 0 }, { enforce: true, tolerancePct: 10, totalGzipBytes: 0 });
  check("compareToBudget: zero baseline unchanged is ok", zeroBaselineOk.status === "ok");

  const zeroBaselineGrew = compareToBudget(
    { totalGzipBytes: 50 },
    { enforce: true, tolerancePct: 10, totalGzipBytes: 0 },
  );
  check("compareToBudget: zero baseline growth fails", zeroBaselineGrew.status === "fail");

  // resolveBaselineCommitDistance
  const nullSha = resolveBaselineCommitDistance("not-a-sha");
  check("resolveBaselineCommitDistance: invalid sha returns null", nullSha === null);

  const nonNumericExec = () => "12trailing\n";
  const nonNumeric = resolveBaselineCommitDistance("a".repeat(40), root, nonNumericExec);
  check("resolveBaselineCommitDistance: non-numeric count returns null", nonNumeric === null);

  const mockExec = () => "12\n";
  const distance = resolveBaselineCommitDistance("a".repeat(40), root, mockExec);
  check("resolveBaselineCommitDistance: mock exec returns count", distance === 12);

  const missingGitStatus = resolveBaselineGitStatus("a".repeat(40), root, () => {
    throw new Error("missing");
  });
  const missingSourceWarning = decideBaselineSourceWarning({
    baselineSource: "a".repeat(40),
    ...missingGitStatus,
  });
  check(
    "baseline source: unresolvable commit warns without changing budget verdicts",
    missingSourceWarning?.code === "baseline-source-unresolvable" &&
      missingSourceWarning.remediation.includes("Fetch the recorded baseline commit"),
  );

  const medicationFixture = findFixtureSnapshotsInChunks([
    { name: "test.js", buffer: Buffer.from("GABA / Glutamate Modulator 1998 mg/day Renal Adj.") },
  ]);
  check(
    "fixture guard: medication snapshot marker group is detected",
    medicationFixture.includes("medications snapshot"),
  );

  // measureChunks
  const m = measureChunks([{ name: "test.js", buffer: Buffer.from("console.log('hello');") }]);
  check("measureChunks: measures files", m.files === 1 && m.totalRawBytes > 0 && m.totalGzipBytes > 0);

  // normalizeManifestRoute
  check("normalizeManifestRoute: /page -> /", normalizeManifestRoute("/page") === "/");
  check(
    "normalizeManifestRoute: /(group)/route/page -> /route",
    normalizeManifestRoute("/(group)/route/page") === "/route",
  );

  // clientRouteAndChunkNamesFromManifestSource
  const manifestSrc = 'globalThis.__RSC_MANIFEST["/page"]={"clientModules":{"a":{"chunks":["static/chunks/a.js"]}}};';
  const parsed = clientRouteAndChunkNamesFromManifestSource(manifestSrc);
  check(
    "clientRouteAndChunkNamesFromManifestSource parses chunks",
    parsed && parsed.route === "/" && parsed.chunks.has("a.js"),
  );

  // parseMaxDistance
  check("parseMaxDistance: space separated valid", parseMaxDistance(["--max-distance", "10"]) === 10);
  check("parseMaxDistance: equal separated valid", parseMaxDistance(["--max-distance=5"]) === 5);
  check("parseMaxDistance: negative value is NaN", Number.isNaN(parseMaxDistance(["--max-distance", "-1"])));
  check("parseMaxDistance: non-numeric is NaN", Number.isNaN(parseMaxDistance(["--max-distance=abc"])));
  check("parseMaxDistance: absent returns null", parseMaxDistance([]) === null);

  // validateBaselineProvenance
  check("validateBaselineProvenance: invalid sha", validateBaselineProvenance("not-a-sha").code === "invalid-sha");
  const missingCommitProv = validateBaselineProvenance("a".repeat(40), {
    exec: () => {
      throw new Error("missing");
    },
  });
  check("validateBaselineProvenance: missing commit", missingCommitProv.code === "commit-not-found");
  const notAncestorProv = validateBaselineProvenance("a".repeat(40), {
    exec: (_cmd, args) => {
      if (args.includes("merge-base")) throw new Error("not ancestor");
      return "";
    },
  });
  check("validateBaselineProvenance: not ancestor", notAncestorProv.code === "not-ancestor");
  const distUnresProv = validateBaselineProvenance("a".repeat(40), {
    exec: (_cmd, args) => {
      if (args.includes("rev-list")) throw new Error("rev-list failed");
      return "";
    },
  });
  check("validateBaselineProvenance: distance unresolvable", distUnresProv.code === "distance-unresolvable");
  const distExceededProv = validateBaselineProvenance("a".repeat(40), {
    maxDistance: 5,
    exec: (_cmd, args) => {
      if (args.includes("rev-list")) return "12\n";
      return "";
    },
  });
  check("validateBaselineProvenance: distance exceeded", distExceededProv.code === "distance-exceeded");
  const validProv = validateBaselineProvenance("a".repeat(40), {
    maxDistance: 15,
    exec: (_cmd, args) => {
      if (args.includes("rev-list")) return "12\n";
      return "";
    },
  });
  check(
    "validateBaselineProvenance: valid ancestor within distance",
    validProv.valid === true && validProv.commitDistance === 12,
  );

  if (failures.length > 0) {
    console.error("[bundle-budget] self-test FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log("[bundle-budget] self-test passed.");
  return 0;
}

/** Run the check. Returns the process exit code (does not exit by itself). */
export function runBundleBudgetCheck(argv = process.argv.slice(2)) {
  if (argv.includes("--self-test")) {
    return selfTest();
  }

  const asJson = argv.includes("--json");
  const update = argv.includes("--update");
  const refreshBaseline = argv.includes("--refresh-baseline");
  const maxDistance = parseMaxDistance(argv);

  if (Number.isNaN(maxDistance)) {
    console.error("[bundle-budget] FAIL — invalid --max-distance value. Must be a non-negative integer.");
    return 1;
  }

  if (!existsSync(CHUNKS_DIR)) {
    if (refreshBaseline) {
      console.error(
        `[bundle-budget] FAIL — no build output at ${path.relative(root, CHUNKS_DIR)}; cannot refresh baseline without a build. Run \`npm run build\` first.`,
      );
      return 1;
    }
    console.log(
      `[bundle-budget] no build output at ${path.relative(root, CHUNKS_DIR)} — run \`npm run build\` first. Skipping.`,
    );
    return 0;
  }

  const chunkPaths = walkJsFiles(CHUNKS_DIR);
  const manifestPath = existsSync(APP_BUILD_MANIFEST_PATH)
    ? APP_BUILD_MANIFEST_PATH
    : existsSync(BUILD_MANIFEST_PATH)
      ? BUILD_MANIFEST_PATH
      : null;
  if (!manifestPath) {
    console.error("[bundle-budget] FAIL — no build manifest is available; cannot verify initial dashboard chunks.");
    return 1;
  }
  const appBuildManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pageClientReferenceManifest = loadRootPageClientReferenceManifest();
  const initialChunkNames = new Set(initialDashboardChunkNames(appBuildManifest, pageClientReferenceManifest));
  const initialDashboardChunks = chunkPaths
    .filter((full) => initialChunkNames.has(path.relative(CHUNKS_DIR, full).replace(/\\/g, "/")))
    .map((full) => ({
      name: path.relative(CHUNKS_DIR, full),
      buffer: readFileSync(full),
    }));
  if (initialDashboardChunks.length === 0) {
    console.error("[bundle-budget] FAIL — no root dashboard JavaScript chunks were resolved from the build manifest.");
    return 1;
  }
  const fixtureViolations = findFixtureSnapshotsInChunks(initialDashboardChunks);
  if (fixtureViolations.length > 0) {
    console.error(
      `[bundle-budget] FAIL — initial dashboard chunks contain fixture payloads: ${fixtureViolations.join(", ")}.`,
    );
    return 1;
  }
  // Drop fixture buffers before the full-tree gzip pass so peak RSS stays low.
  for (const chunk of initialDashboardChunks) chunk.buffer = Buffer.alloc(0);
  const current = measureChunkPaths(chunkPaths);

  // Attribute chunks to production vs design scratch. Fail closed: a broken or
  // missing route manifest tree must not silently collapse the two buckets,
  // because "everything is production" inflates the enforced number and
  // "everything is scratch" would hide a real regression.
  if (!existsSync(SERVER_APP_DIR)) {
    console.error(
      `[bundle-budget] FAIL — no route manifests at ${path.relative(root, SERVER_APP_DIR)}; cannot separate production weight from ${MOCKUP_ROUTE_SEGMENT}/ scratch.`,
    );
    return 1;
  }
  const { mockupExclusive, routeCount, mockupRouteCount, unparseable, routeChunks } =
    partitionRouteClientChunks(SERVER_APP_DIR);
  if (unparseable.length > 0) {
    console.error(
      `[bundle-budget] FAIL — ${unparseable.length} route manifest(s) could not be decoded; chunk attribution is broken.`,
    );
    for (const full of unparseable.slice(0, 5)) {
      console.error(`  ${path.relative(root, full)}`);
    }
    return 1;
  }
  if (routeCount === 0) {
    console.error("[bundle-budget] FAIL — the route manifest tree resolved no routes; chunk attribution is broken.");
    return 1;
  }
  const mockupRoutesBuilt = existsSync(path.join(SERVER_APP_DIR, MOCKUP_ROUTE_SEGMENT));
  if (mockupRoutesBuilt && mockupRouteCount === 0) {
    console.error(
      `[bundle-budget] FAIL — ${MOCKUP_ROUTE_SEGMENT}/ routes were built but none resolved a client manifest; chunk attribution is broken.`,
    );
    return 1;
  }

  const mockupGzipBytes = gzipBytesOf(current.measured, mockupExclusive);
  const productionGzipBytes = current.totalGzipBytes - mockupGzipBytes;
  const budget = loadBudget();
  const routeMeasurements = measureBudgetRoutes(current.measured, routeChunks, budget?.routes);
  if (routeMeasurements.missing.length > 0) {
    console.error(
      `[bundle-budget] FAIL — configured route manifest(s) were not resolved: ${routeMeasurements.missing.join(", ")}.`,
    );
    return 1;
  }

  if (refreshBaseline) {
    const baselineSource = resolveBaselineSource();
    if (!baselineSource) {
      console.error(
        "[bundle-budget] FAIL — could not resolve a 40-character source SHA for the baseline refresh. " +
          "Run inside a Git checkout or set BUNDLE_BUDGET_SOURCE_SHA / GITHUB_SHA.",
      );
      return 1;
    }

    const provenance = validateBaselineProvenance(baselineSource, {
      cwd: root,
      maxDistance,
    });

    if (!provenance.valid) {
      console.error(`[bundle-budget] FAIL — baseline provenance check failed: ${provenance.message}`);
      return 1;
    }

    const nowIso = new Date().toISOString();
    const prevProduction = budget?.production?.gzipBytes ?? null;
    const prevMockups = budget?.mockups?.gzipBytes ?? null;
    const prevTotal = budget?.totalGzipBytes ?? null;

    /**
     * The COMMITTED baseline's own provenance, captured before `next` overwrites
     * it. Two different baselines exist in every refresh run and the report has to
     * name which one produced the comparison: the committed comparator the
     * `previousGzipBytes` numbers came from, and the candidate this run measured
     * and proposes. Emitting only the candidate's SHA — which is what the response
     * used to do — reads as though the drift was measured against the commit it
     * was measured AT.
     *
     * Tolerances travel with it for the same reason the numbers do. The workflow
     * used to state "10% and 25%" as prose, which silently stops being true the
     * moment either value is edited in bundle-budget.json.
     */
    const comparator = {
      source: budget?.baselineSource ?? null,
      updatedAt: budget?.updatedAt ?? null,
      enforce: Boolean(budget?.enforce),
      totalGzipBytes: prevTotal,
      tolerancePct: {
        production: budget?.production?.tolerancePct ?? 10,
        mockups: budget?.mockups?.tolerancePct ?? 25,
      },
      warnTolerancePct: {
        production: budget?.production?.warnTolerancePct ?? 5,
        mockups: budget?.mockups?.warnTolerancePct ?? 15,
      },
      routes: Object.fromEntries(
        Object.entries(budget?.routes ?? {}).map(([route, config]) => [
          route,
          { gzipBytes: config?.gzipBytes ?? null, tolerancePct: config?.tolerancePct ?? 10 },
        ]),
      ),
    };

    const next = {
      ...budget,
      production: { ...(budget.production ?? {}), gzipBytes: productionGzipBytes },
      mockups: { ...(budget.mockups ?? {}), gzipBytes: mockupGzipBytes },
      routes: Object.fromEntries(
        Object.entries(budget.routes ?? {}).map(([route, config]) => [
          route,
          { ...config, gzipBytes: routeMeasurements.measured[route].gzipBytes },
        ]),
      ),
      totalGzipBytes: current.totalGzipBytes,
      updatedAt: nowIso,
      baselineSource,
    };
    delete next.routeBaselinesUpdatedAt;
    delete next.routeBaselinesSource;
    writeFileSync(BUDGET_PATH, JSON.stringify(next, null, 2) + "\n");

    const formatDiff = (currentBytes, prevBytes) => {
      if (prevBytes == null) return "initial baseline";
      const diff = currentBytes - prevBytes;
      const pct = prevBytes === 0 ? 0 : (diff / prevBytes) * 100;
      const sign = diff >= 0 ? "+" : "";
      return `${sign}${kb(diff)} (${sign}${pct.toFixed(1)}%)`;
    };

    if (asJson) {
      const response = {
        refreshed: true,
        updatedAt: nowIso,
        baselineSource,
        baselineCommitDistance: provenance.commitDistance,
        // The committed baseline the drift below was measured AGAINST, kept
        // distinct from `baselineSource`, which is the candidate this run
        // measured and proposes for adoption. Nothing here is adopted: the
        // refreshed file is an artifact, never a commit.
        comparator,
        measurement: {
          measuredSha: baselineSource,
          distanceFromCheckedOutHead: provenance.commitDistance,
          observedAt: nowIso,
          nodeVersion: process.version,
        },
        production: {
          gzipBytes: productionGzipBytes,
          previousGzipBytes: prevProduction,
          diffBytes: prevProduction != null ? productionGzipBytes - prevProduction : null,
          diffPct:
            prevProduction != null && prevProduction > 0
              ? ((productionGzipBytes - prevProduction) / prevProduction) * 100
              : 0,
          tolerancePct: comparator.tolerancePct.production,
        },
        mockups: {
          gzipBytes: mockupGzipBytes,
          previousGzipBytes: prevMockups,
          diffBytes: prevMockups != null ? mockupGzipBytes - prevMockups : null,
          diffPct: prevMockups != null && prevMockups > 0 ? ((mockupGzipBytes - prevMockups) / prevMockups) * 100 : 0,
          tolerancePct: comparator.tolerancePct.mockups,
          chunks: mockupExclusive.size,
          routes: mockupRouteCount,
        },
        routes: Object.fromEntries(
          Object.entries(routeMeasurements.measured).map(([route, measurement]) => {
            const prevRouteBytes = budget?.routes?.[route]?.gzipBytes ?? null;
            return [
              route,
              {
                ...measurement,
                previousGzipBytes: prevRouteBytes,
                diffBytes: prevRouteBytes != null ? measurement.gzipBytes - prevRouteBytes : null,
                diffPct:
                  prevRouteBytes != null && prevRouteBytes > 0
                    ? ((measurement.gzipBytes - prevRouteBytes) / prevRouteBytes) * 100
                    : 0,
                tolerancePct: comparator.routes[route]?.tolerancePct ?? 10,
              },
            ];
          }),
        ),
        totalGzipBytes: current.totalGzipBytes,
        totalRawBytes: current.totalRawBytes,
        files: current.files,
        ciGuidance: {
          command: "npm run check:bundle-budget -- --refresh-baseline",
          schedule: "nightly or post-merge",
          purpose:
            "Automated scheduled baseline refresh to record fresh production, route, and mockup baselines with verified git provenance, preventing gradual bundle accumulation from failing unrelated feature PRs.",
        },
      };
      console.log(JSON.stringify(response, null, 2));
    } else {
      const distLabel = provenance.commitDistance === 0 ? "HEAD" : `${provenance.commitDistance} commit(s) behind HEAD`;
      console.log("[bundle-budget] baseline refreshed successfully:");
      console.log(`  - Source commit: ${baselineSource.slice(0, 12)} (${distLabel})`);
      console.log(`  - Updated at: ${nowIso}`);
      console.log(
        `  - Production: ${kb(productionGzipBytes)} (was ${prevProduction != null ? kb(prevProduction) : "none"}, ${formatDiff(productionGzipBytes, prevProduction)})`,
      );
      console.log(
        `  - ${MOCKUP_ROUTE_SEGMENT} scratch: ${kb(mockupGzipBytes)} (was ${prevMockups != null ? kb(prevMockups) : "none"}, ${formatDiff(mockupGzipBytes, prevMockups)})`,
      );
      for (const [route, measurement] of Object.entries(routeMeasurements.measured)) {
        const prevRouteBytes = budget?.routes?.[route]?.gzipBytes ?? null;
        console.log(
          `  - Route ${route}: ${kb(measurement.gzipBytes)} (was ${prevRouteBytes != null ? kb(prevRouteBytes) : "none"}, ${formatDiff(measurement.gzipBytes, prevRouteBytes)})`,
        );
      }
      console.log(
        `  - Total: ${kb(current.totalGzipBytes)} gzip across ${current.files} chunk(s) (was ${prevTotal != null ? kb(prevTotal) : "none"}, ${formatDiff(current.totalGzipBytes, prevTotal)}).`,
      );
      console.log("");
      console.log("[bundle-budget] CI integration guidance:");
      console.log(
        "  Scheduled baseline refresh workflows (e.g. nightly or post-merge GitHub Actions / cron jobs) can run:",
      );
      console.log("    1. npm run build");
      console.log("    2. npm run check:bundle-budget -- --refresh-baseline");
      console.log(
        "  This automatically records fresh production, route, and mockup baselines with verified git provenance and timestamp, preventing gradual bundle accumulation from breaking unrelated feature PRs.",
      );
    }
    return 0;
  }

  if (update) {
    const baselineSource = resolveBaselineSource();
    if (!baselineSource) {
      console.error(
        "[bundle-budget] FAIL — could not resolve a 40-character source SHA for the baseline refresh. " +
          "Run inside a Git checkout or set BUNDLE_BUDGET_SOURCE_SHA.",
      );
      return 1;
    }
    const next = {
      ...budget,
      production: { ...(budget.production ?? {}), gzipBytes: productionGzipBytes },
      mockups: { ...(budget.mockups ?? {}), gzipBytes: mockupGzipBytes },
      routes: Object.fromEntries(
        Object.entries(budget.routes ?? {}).map(([route, config]) => [
          route,
          { ...config, gzipBytes: routeMeasurements.measured[route].gzipBytes },
        ]),
      ),
      totalGzipBytes: current.totalGzipBytes,
      updatedAt: new Date().toISOString(),
      baselineSource,
    };
    delete next.routeBaselinesUpdatedAt;
    delete next.routeBaselinesSource;
    writeFileSync(BUDGET_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `[bundle-budget] baselines updated — production ${kb(productionGzipBytes)}, ${Object.keys(routeMeasurements.measured).length} routes, ${MOCKUP_ROUTE_SEGMENT} ${kb(mockupGzipBytes)}, total ${kb(current.totalGzipBytes)} gzip (${current.files} chunks).`,
    );
    return 0;
  }

  const enforce = Boolean(budget?.enforce);
  const productionVerdict = compareToBudget(
    { totalGzipBytes: productionGzipBytes },
    {
      totalGzipBytes: budget?.production?.gzipBytes ?? null,
      tolerancePct: budget?.production?.tolerancePct ?? 10,
      warnTolerancePct: budget?.production?.warnTolerancePct ?? 5,
      enforce,
    },
  );
  // Scratch weight is a runaway detector, not a per-mockup gate: a ceiling tight
  // enough to fire on the next mockup would just be `--update`d reflexively,
  // which is worse than no gate. It is always reported, enforced only on a jump.
  const mockupVerdict = compareToBudget(
    { totalGzipBytes: mockupGzipBytes },
    {
      totalGzipBytes: budget?.mockups?.gzipBytes ?? null,
      tolerancePct: budget?.mockups?.tolerancePct ?? 25,
      warnTolerancePct: budget?.mockups?.warnTolerancePct ?? 15,
      enforce,
    },
  );
  const routeVerdicts = Object.fromEntries(
    Object.entries(routeMeasurements.measured).map(([route, measurement]) => [
      route,
      compareToBudget(
        { totalGzipBytes: measurement.gzipBytes },
        {
          totalGzipBytes: budget?.routes?.[route]?.gzipBytes ?? null,
          tolerancePct: budget?.routes?.[route]?.tolerancePct ?? 10,
          warnTolerancePct: budget?.routes?.[route]?.warnTolerancePct ?? 5,
          enforce,
        },
      ),
    ]),
  );

  const baselineSource = budget?.baselineSource ?? null;
  const baselineGitStatus = resolveBaselineGitStatus(baselineSource, root);
  const baselineSourceWarning = decideBaselineSourceWarning({ baselineSource, ...baselineGitStatus });
  const baselineCommitDistance = baselineSourceWarning ? null : resolveBaselineCommitDistance(baselineSource, root);
  const baselineDistanceText =
    baselineCommitDistance !== null ? `${baselineCommitDistance} commit(s) behind HEAD` : "distance unresolvable";

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          current: { ...current, measured: undefined },
          baselineSource,
          baselineCommitDistance,
          warnings: baselineSourceWarning ? [baselineSourceWarning] : [],
          production: { gzipBytes: productionGzipBytes, verdict: productionVerdict },
          mockups: {
            gzipBytes: mockupGzipBytes,
            chunks: mockupExclusive.size,
            routes: mockupRouteCount,
            verdict: mockupVerdict,
          },
          routes: Object.fromEntries(
            Object.entries(routeMeasurements.measured).map(([route, measurement]) => [
              route,
              { ...measurement, verdict: routeVerdicts[route] },
            ]),
          ),
          initialDashboardChunks: initialDashboardChunks.length,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `[bundle-budget] client chunks: ${current.files} files, ${kb(current.totalGzipBytes)} gzip (${kb(current.totalRawBytes)} raw) across ${routeCount} routes.` +
        (baselineSource ? ` Baseline commit: ${baselineSource.slice(0, 12)} (${baselineDistanceText}).` : ""),
    );
    // Say which question each number answers — the ambiguity these two lines
    // remove is the whole point of splitting the budget (`#013`/`#252`).
    console.log(
      `[bundle-budget] production (what users download, ${routeCount - mockupRouteCount} routes): ${kb(productionGzipBytes)} gzip` +
        (productionVerdict.baseline != null
          ? ` — baseline ${kb(productionVerdict.baseline)}, ${productionVerdict.reason}.`
          : " — no baseline recorded."),
    );
    console.log(
      `[bundle-budget] ${MOCKUP_ROUTE_SEGMENT} (design scratch, 404s in production, ${mockupRouteCount} routes, ${mockupExclusive.size} exclusive chunks): ${kb(mockupGzipBytes)} gzip` +
        (mockupVerdict.baseline != null
          ? ` — baseline ${kb(mockupVerdict.baseline)}, ${mockupVerdict.reason}.`
          : " — no baseline recorded."),
    );
    for (const [route, measurement] of Object.entries(routeMeasurements.measured)) {
      const verdict = routeVerdicts[route];
      console.log(
        `[bundle-budget] route ${route}: ${kb(measurement.gzipBytes)} gzip (${measurement.chunks} chunks)` +
          (verdict.baseline != null
            ? ` — baseline ${kb(verdict.baseline)}, ${verdict.reason}.`
            : " — no baseline recorded."),
      );
    }
    if (baselineSourceWarning) {
      console.warn(
        `[bundle-budget] WARN (${baselineSourceWarning.code.replaceAll("-", " ")}) — ${baselineSourceWarning.message} ${baselineSourceWarning.remediation}`,
      );
    }
    if (
      baselineSource &&
      baselineCommitDistance !== null &&
      baselineCommitDistance > STALE_BASELINE_COMMIT_DISTANCE_THRESHOLD
    ) {
      console.warn(
        `[bundle-budget] WARN (stale baseline) — baseline commit ${baselineSource.slice(0, 12)} is ${baselineCommitDistance} commits behind HEAD (staleness threshold: ${STALE_BASELINE_COMMIT_DISTANCE_THRESHOLD}). Consider refreshing with \`npm run check:bundle-budget -- --update\`.`,
      );
    }
    const serverHtmlMeasurements = measureServerHtmlPayloads(SERVER_APP_DIR, budget?.serverPages);
    for (const [route, measurement] of Object.entries(serverHtmlMeasurements)) {
      if (measurement.found) {
        console.log(
          `[bundle-budget] server page HTML ${route}: ${kb(measurement.gzipBytes)} gzip (${kb(measurement.rawBytes)} raw) — ceiling ${kb(measurement.gzipBytesCeiling)} gzip (${kb(measurement.rawBytesCeiling)} raw), ${measurement.reason}.`,
        );
      }
    }
    console.log("[bundle-budget] largest chunks (gzip):");
    for (const c of current.largest) console.log(`  ${kb(c.gzipBytes).padStart(12)}  ${c.name}`);
    console.log(
      `[bundle-budget] initial dashboard fixture assertion passed (${initialDashboardChunks.length} chunks).`,
    );
  }

  let failed = false;
  const serverHtmlMeasurements = measureServerHtmlPayloads(SERVER_APP_DIR, budget?.serverPages);
  for (const [route, measurement] of Object.entries(serverHtmlMeasurements)) {
    const config = budget?.serverPages?.[route];
    if (enforce && config?.required && measurement.status === "missing") {
      console.error(
        `[bundle-budget] FAIL — server page ${route} ${measurement.reason ?? "is missing required build output"}.`,
      );
      failed = true;
    } else if (measurement.found && enforce && measurement.status === "fail") {
      console.error(`[bundle-budget] FAIL — server page ${route} ${measurement.reason}.`);
      failed = true;
    }
  }

  if (productionVerdict.status === "fail") {
    console.error(
      `[bundle-budget] FAIL — production bundle ${productionVerdict.reason}. This is user-facing weight; find the regression before refreshing the baseline.`,
    );
    failed = true;
  }
  if (mockupVerdict.status === "fail") {
    console.error(
      `[bundle-budget] FAIL — ${MOCKUP_ROUTE_SEGMENT} scratch ${mockupVerdict.reason}. No user loads these chunks, so this is a hygiene ceiling: prune stale mockups, or refresh deliberately with \`npm run check:bundle-budget -- --update\` and say why in the PR.`,
    );
    failed = true;
  }
  for (const [route, verdict] of Object.entries(routeVerdicts)) {
    if (verdict.status !== "fail") continue;
    console.error(`[bundle-budget] FAIL — route ${route} client JavaScript ${verdict.reason}.`);
    failed = true;
  }
  if (failed) return 1;

  if (!asJson) {
    for (const [label, verdict] of [
      ["production bundle", productionVerdict],
      [`${MOCKUP_ROUTE_SEGMENT} scratch`, mockupVerdict],
      ...Object.entries(routeVerdicts).map(([route, verdict]) => [`route ${route}`, verdict]),
    ]) {
      if (verdict.status !== "warn") continue;
      if (verdict.baseline == null) {
        console.log(
          `[bundle-budget] warn-only: no ${label} baseline — capture one with --update after a known-good build, then set enforce:true.`,
        );
      } else if (verdict.isDriftWarning) {
        console.warn(`[bundle-budget] WARN (drift warning) — ${label} ${verdict.reason}.`);
      } else {
        console.warn(`[bundle-budget] WARN (not enforced) — ${label} ${verdict.reason}.`);
      }
    }
    console.log("[bundle-budget] done.");
  }
  return 0;
}

function main() {
  let code = 1;
  try {
    code = runBundleBudgetCheck(process.argv.slice(2));
  } catch (error) {
    // Unexpected throws must still hit exitProcess; otherwise a stray handle
    // after a partial run can recreate the CI "printed nothing / hung" mode.
    console.error("[bundle-budget] FAIL — unexpected error:", error);
    code = 1;
  }
  exitProcess(code);
}

if (isMainModule()) main();
