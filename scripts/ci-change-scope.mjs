#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const zeroSha = /^0{40}$/;

const fullRunSentinelFiles = [
  "src/app/api/answer/__ci_full_run__.ts",
  // UI sentinel must stay outside src/app/api/** once API routes are excluded
  // from ui_changed (otherwise schedule/full-run would skip Production UI).
  "src/components/__ci_full_run__.tsx",
  "supabase/__ci_full_run__.sql",
  "Dockerfile",
  ".github/workflows/codex-autofix-review-comments.yml",
  // Ensures an unresolvable-base / scheduled full run also trips lockfile_changed
  // so the dependency audit runs in its blocking mode, not advisory.
  "package-lock.json",
  "worker/__ci_full_run__.ts",
];

const outputs = [
  "docs_only",
  "docs_changed",
  "source_changed",
  "static_heavy_changed",
  "coverage_changed",
  "ingestion_sast_changed",
  "ui_changed",
  "perf_changed",
  "advisory_ui_changed",
  "db_changed",
  "container_changed",
  "rag_eval_changed",
  "workflow_changed",
  "workflow_only",
  "codex_autofix_changed",
  "build_changed",
  "lockfile_changed",
  "pr_policy_body_changed",
];

function normalizePath(filePath) {
  return String(filePath ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/^github\//, ".github/");
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function runGitRaw(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function pathMatches(filePath, patterns) {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") return filePath === pattern || filePath.startsWith(`${pattern}/`);
    return pattern.test(filePath);
  });
}

/** App Router API handlers are not browser journeys — keep them out of ui_changed. */
function isUiChangedPath(filePath) {
  if (filePath === "src/app/api" || filePath.startsWith("src/app/api/")) return false;
  return pathMatches(filePath, uiPatterns);
}

/**
 * The advisory UI lane covers `@quarantine` plus `@mockup` journeys. With an
 * empty flake ledger and no `@quarantine` tag in the suite, it runs five mockup
 * tests — measured at ~3m14 on every UI pull request (#137).
 *
 * So it runs when there is something for it to cover: a mockup surface changed,
 * or the flake ledger is non-empty. Reading the ledger rather than hard-coding
 * "no quarantines exist" makes the gate self-correcting — the moment a test is
 * quarantined, the lane comes back on every UI PR without anyone remembering to
 * re-enable it.
 */
const mockupPatterns = [
  "src/app/mockups",
  "tests/ui-mockups.spec.ts",
  // Component filenames are both singular and plural (`task-directory-mockup.tsx`
  // next to `split-pane-refined-mockups.tsx`), and several live in `*-mockups/`
  // directories. Matching the directory as well as the filename keeps a mockup
  // component edited on its own — without its `src/app/mockups` route wrapper —
  // from losing the only lane that runs its `@mockup` journey.
  /^src\/components\/[^/]+-mockups?\//,
  /^src\/components\/.*-mockups?\.tsx$/,
  // ...and the NESTED form: `caring-contacts/mockups/` holds 12 components whose
  // filenames carry no `-mockup` suffix, so neither rule above reaches them. The
  // two rules above cover a top-level `*-mockups/` directory and a `*-mockups.tsx`
  // file at any depth; a plain `mockups/` segment one level down fell between them
  // and left those journeys unrun (found 2026-08-21).
  /^src\/components\/(?:[^/]+\/)+mockups?\//,
  // Three of the advisory specs carry `@mockup` without "mockup" in the
  // filename, so a name-based rule alone misses them. `assertMockupSpecParity`
  // below holds this list to `mockupSpecPattern` in playwright.config.ts.
  /^tests\/.*mockup.*\.spec\.ts$/,
  /^tests\/ui-tools(?:-collapse|-task-directory)?\.spec\.ts$/,
];

function quarantineLedgerHasEntries(readLedger) {
  try {
    const parsed = JSON.parse(readLedger());
    return Array.isArray(parsed?.flakes) && parsed.flakes.length > 0;
  } catch {
    // Fail OPEN: an unreadable or malformed ledger must not silently drop the
    // advisory lane. `npm run flake:ledger` is what validates its shape.
    return true;
  }
}

const docPatterns = [
  "docs",
  "mockups",
  /^.*\.md$/,
  /^.*\.mdx$/,
  /^README(?:\..*)?$/i,
  /^CHANGELOG(?:\..*)?$/i,
  /^LICENSE(?:\..*)?$/i,
];

// This Markdown file is generated from the medication interaction lexicon. A
// direct edit must run its freshness check; otherwise the ordinary docs-only
// classification would let a stale clinical-facing report through CI.
const generatedMedicationLexiconReport = "docs/medication-interaction-lexicon-review.md";

const workflowPatterns = [
  ".github/workflows",
  ".github/actions",
  ".agents/skills",
  ".claude/skills",
  ".cursor/skills",
  "plugins/clinical-kb/skills",
  ".github/pull_request_template.md",
  "AGENTS.md",
  "docs/codex-review-protocol.md",
  "docs/process-hardening.md",
  /^scripts\/(?:ci-change-scope|ci-triage|pr-policy|verify-pr-local|eval-rag-offline|run-gitleaks-pinned|check-github-action-pins|check-codex-autofix-workflow|list-database-skills|sync-skills|productivity-core|productivity-workflow|external-workflow)\.mjs$/,
];

const codexAutofixPatterns = [
  ".github/workflows/codex-autofix-review-comments.yml",
  "AGENTS.md",
  "docs/codex-review-protocol.md",
  "scripts/check-codex-autofix-workflow.mjs",
];

const uiPatterns = [
  "data",
  // A browser-environment action change must exercise the lane it controls,
  // while remaining light enough to avoid unrelated unit coverage.
  ".github/actions/setup-ui-e2e",
  "src/app",
  "src/components",
  "src/styles",
  "public",
  // Answer progress is a production Playwright journey even though its
  // historical filename does not start with `ui-`. Keep its CI trigger in
  // lockstep with playwright.config.ts so an edited assertion cannot evade
  // the required UI job (Vitest does not collect *.spec.ts files).
  "tests/answer-progress-ui-smoke.spec.ts",
  /^tests\/ui-.*\.spec\.ts$/,
  /^tests\/playwright-.*\.ts$/,
  // Shared Playwright fixtures. Three of the four files here back `ui-*.spec.ts`
  // journeys — `zero-touch.ts` alone backs six, including ui-smoke — and editing
  // one reported ui_changed=false, so `Production UI` skipped and the change
  // reached no browser. Matched at directory level rather than by filename: a
  // hand-list is what failed, and the only current non-UI file
  // (supabase-round-trip-counter.ts) costs one extra UI run when it changes,
  // against a miss that is silent.
  /^tests\/helpers\/.*\.ts$/,
  /^playwright(?:\..*)?\.config\.ts$/,
  // Playwright runner helpers (launch preflight, revision pin, PR shard list).
  // Without these, a main-only edit to the helpers reports ui_changed=false and
  // the narrowed release-browser-matrix backstop also skips, so a browser-launch
  // or shard-runner regression can pass Vitest alone.
  /^scripts\/(run-playwright|playwright-base-url|playwright-browser-preflight|playwright-pr-shards|check-playwright-browser-revision)\.(?:mjs|ts)$/,
  // Committed visual baselines. Without this a commit that changes only a golden
  // PNG reports ui_changed=false, the visual job is skipped, and an incorrect or
  // corrupted baseline is never compared against the app it claims to describe.
  /^tests\/__screenshots__\//,
  // Library modules that configure modes, shell routing, UI copy, navigation,
  // or rendering lists. Editing these directly alters what the browser shell
  // and mode homes render without touching a component or route file (#0HFDWD).
  /^src\/lib\/(?:app-modes|app-mode-icons|search-route-ownership|ui-copy|mode-home-composer|mode-secondary-navigation|category-identity(?:-icons)?|brand-mark|brand-image|search-command-surface|search-navigation-context|search-scope-filter-chips|search-shell-props|document-flow-routes|document-viewer-navigation|differentials-navigation|therapy-compass-navigation|therapies)\.tsx?$/,
  // The pre-merge Lighthouse budget and its inputs. Without these, enabling
  // enforcement, refreshing the baseline, or breaking the runner is not exercised
  // until some unrelated UI or build change happens to trigger the job.
  "lighthouse-budget.json",
  /^scripts\/(run|check)-lighthouse-budget\.mjs$/,
];

/**
 * perf_changed — surfaces that can plausibly move LCP / TBT / CLS on the five routes
 * `lighthouse-budget.json` measures. Deliberately NARROWER than the `ui_changed ||
 * build_changed` union the budget job used to key off: that union put a dev-dependency
 * lockfile bump (#1668, js-yaml) and every `worker/**` ingestion change through a ~7
 * minute isolated `next build --webpack` plus ten Lighthouse runs, with zero
 * render-path relevance.
 *
 * Direction of failure is deliberate: an UNRECOGNISED path under a listed root is IN
 * scope. Adding `src/features/` later over-triggers by one job rather than silently
 * dropping a render surface out of the perf gate.
 */
const perfPatterns = [
  // Every measured route is a segment of src/app, and the root layout, the
  // (search-app) group layout and both CSS entry points ship on all five. src/lib is
  // NOT split into server/client here: only 13 of ~256 files carry `import
  // "server-only"`, and src/lib/supabase/client.tsx is a browser provider in the
  // render tree, so a path-based split would fail open.
  "src",
  // Route payload, both forms: data/** is imported into route chunks and public/** is
  // fetched on the critical path (#117 therapies-home ~136 KB, #013 forms-catalog
  // ~132 KB).
  "data",
  "public",
  // These rewrite the emitted bundle/CSS for every route, so a change invalidates the
  // whole baseline rather than one route.
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  // The budget's own inputs. summarise-web-vitals.mjs is here because
  // check-lighthouse-budget.mjs imports summariseReport / hasUsableMetrics /
  // measuredRequestedPage from it — editing it changes the VERDICT, and before this
  // it matched no CI scope pattern at all.
  "lighthouse-budget.json",
  /^scripts\/(run-lighthouse-budget|check-lighthouse-budget|summarise-web-vitals|lighthouse-measurement-outcome|lighthouse-time-budget|child-process-result|test-environment)\.mjs$/,
  // Measuring and refreshing jobs MUST resolve the same Chromium. Editing this action
  // changes which browser grades the baseline, so it belongs in perf scope even when
  // no application source moved.
  ".github/actions/setup-lighthouse-chromium",
];

/**
 * App Router handlers that budgeted routes fetch during the initial Lighthouse
 * navigation. ClinicalDashboard always calls /api/setup-status on mount, and
 * readLocalProjectIdentity always calls /api/local-project-id before that. A bare
 * URL with no query string does NOT imply "no API on load".
 */
const perfInitialLoadApiPatterns = ["src/app/api/setup-status", "src/app/api/local-project-id"];

/**
 * Paths inside a `perfPatterns` root that cannot reach a measured route's render
 * path. Each is a deliberate loss of coverage; a path NOT listed here stays in scope.
 */
const perfExclusionPatterns = [
  // Most App Router API handlers are off the Lighthouse critical path. Initial-load
  // handlers in perfInitialLoadApiPatterns are carved out above and stay in scope.
  // assertBudgetRoutesAreQueryFree() still fails closed if a budget route gains a
  // query string — that is the usual signal that more handlers may need carving out.
  // Precedent: isUiChangedPath already excludes API routes from the UI lane.
  "src/app/api",
  // Separate route segments, 404 in production, and the runner sets
  // NEXT_PUBLIC_MOCKUPS_ENABLED=false. Tailwind does scan src/**, so a utility class
  // used only by a mockup adds bytes to the shared stylesheet — tens of bytes against
  // an lcpMs floor of +100ms, and check:bundle-budget still enforces gzip growth.
  "src/app/mockups",
  // Server/edge runtime only. src/instrumentation-client.ts is deliberately NOT here:
  // it executes in the browser and is a direct TBT contributor. src/proxy.ts is also
  // NOT here: its matcher runs before every budgeted page request (CSP/nonce and
  // optional session refresh), so added latency there moves TTFB/LCP directly.
  "src/instrumentation.ts",
  "src/sentry.server.config.ts",
  "src/sentry.edge.config.ts",
  // Developer-hub payload only. `src/lib/developer-area/ledger-snapshot.ts`
  // imports this JSON, and the only route importers are under
  // `src/app/mockups/development/` (already excluded; 404 in production). A
  // ledger reconcile that closes the last P1 must not pay a 7-minute
  // Lighthouse budget run, and must not fail merge on TBT noise from
  // `/documents/search`. Measured on PR #2302: this file alone flipped
  // perf_changed and the job failed mobile TBT +32.7% against a baseline
  // the same change cannot move.
  "data/outstanding-issues-snapshot.json",
];

function isPerfChangedPath(filePath) {
  if (pathMatches(filePath, perfInitialLoadApiPatterns)) return true;
  if (pathMatches(filePath, perfExclusionPatterns)) return false;
  return pathMatches(filePath, perfPatterns);
}

// Migration replay validates schema/SQL tooling, not every API handler. API
// route edits stay covered by unit/coverage (+ RAG offline when rag-scoped).
const dbPatterns = [
  "supabase",
  "src/lib/supabase",
  "docs/database-drift-detection.md",
  "docs/supabase-migration-reconciliation.md",
  /^scripts\/(check-drift|generate-drift-manifest|check-m13-migration|check-retrieval-owner-migration|check-supabase-project|audit-tables|reindex|reindex-health|cleanup-abandoned-reindex-generations)\.ts$/,
  /^tests\/(supabase|drift|private-rag|private-access|retrieval-owner).*\.test\.ts$/,
];

// rag_eval_changed selects the heavier offline RAG contract (eval:rag:offline).
// Fixture validation (check:rag:fixtures) still runs for every non-docs change
// in CI safety + verify:pr-local so a retrieval file outside these patterns
// cannot silently skip fixture checks.
const ragEvalPatterns = [
  "scripts/fixtures",
  "src/app/api/answer",
  "src/app/api/search",
  // #SDQSFD: the RAG stack moved into `src/lib/rag/` in #994, but the flat
  // `src/lib/rag-*.ts` regex below was never widened, so a PR touching only
  // `src/lib/rag/rag.ts` classified as rag_eval_changed=false and skipped both
  // `eval:rag:offline` and `eval:rag:adversarial:offline` in CI and
  // verify:pr-local. PR #2065 reached main that way; the live canary, not the
  // offline harness, caught it. Directory prefix (not `^src/lib/rag`) so the
  // whole extracted subtree is covered whatever a file is later named.
  /^src\/lib\/rag\//,
  /^src\/lib\/(?:rag(?:-[^/]+)?|smart-rag-api|clinical-search|clinical-query-mode|retrieval(?:-[^/]+)?|answer(?:-[^/]+)?|citations|cross-document-synthesis|evidence(?:-[^/]+)?|ranking-config|source(?:-[^/]+)?|chunking|document-index-units|query-privacy|owner-scope|corpus-grounding|indexed-source-formatting)\.ts$/,
  /^src\/components\/(?:.*\/)?(?:answer|source|citation)[^/]*\.tsx?$/i,
  /^scripts\/(?:check-rag-fixtures|check-rag-adversarial-fixtures|rag-adversarial-contract|test-rag-offline)\.mjs$/,
  /^scripts\/(eval-|run-eval-safe|compare-retrieval-eval|retrieval-health|profile-retrieval|warm-retrieval-cache|tune-search-weights)/,
  /^tests\/(?:helpers\/)?(rag|retrieval|answer|citations|evidence|eval|clinical-safety|source).*\.test\.ts$/,
  /^tests\/helpers\/rag-adversarial-assertions\.ts$/,
];

// Untrusted-document parsing and ingestion surfaces are guarded by a narrow,
// blocking Semgrep job in required CI. Keep scan targets aligned with that job,
// and keep the gate's executable workflow/selector self-selecting.
const ingestionSastPatterns = [
  ".github/workflows/ci.yml",
  "scripts/ci-change-scope.mjs",
  "worker",
  /^src\/lib\/ingestion[^/]*\.ts$/,
  "src/lib/extractors",
  "src/app/api/ingestion",
  "src/app/api/upload",
];

const containerPatterns = [
  "Dockerfile",
  "Dockerfile.worker",
  ".dockerignore",
  ".github/workflows/docker-image.yml",
  ".npmrc",
  ".nvmrc",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "package.json",
  "package-lock.json",
  "railway.app.json",
  "railway.worker.json",
  "tests/stubs/server-only.ts",
  /^worker\/.+/,
  "worker/python/requirements.in",
  "worker/python/requirements.txt",
  "scripts/app-container-smoke.mjs",
  "scripts/check-image-content-contract.mjs",
  "scripts/trivy-image-scan.mjs",
  "scripts/resolve-oci-image-digest.mjs",
  "scripts/generate-worker-python-lock.mjs",
  "scripts/check-worker-python-lock.mjs",
  "tests/container-ci-contract.test.ts",
  /^scripts\/(check-node-engine|check-upload-limit-parity|guard-next-build|build-worker|run-heavy|check-client-bundle-secrets|install-git-hooks|app-container-smoke|check-image-content-contract|trivy-image-scan|resolve-oci-image-digest|generate-worker-python-lock|check-worker-python-lock)\.(?:cjs|mjs)$/,
];

const sourcePatterns = ["data", "src", "tests", "scripts", "worker", "playwright", "public", "supabase"];

const buildPatterns = [
  "bundle-budget.json",
  "data",
  "src",
  "worker",
  "public",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "package.json",
  "package-lock.json",
  "scripts/check-bundle-budget.mjs",
  /^scripts\/(check-node-engine|check-upload-limit-parity|guard-next-build|dev-free-port|ensure-local-server)\.(?:cjs|mjs)$/,
];

const staticConfigPatterns = [
  "eslint.config.mjs",
  "playwright.config.ts",
  "playwright.visual.config.ts",
  "vitest.config.mts",
];

// Dependency lockfile / npm config changes are the only moment a PR can introduce
// a new (possibly-vulnerable) dependency for `npm ci`, so `npm audit` blocks the
// merge gate only then; otherwise the audit runs advisory. Scheduled/full-run
// passes resolve to the sentinel below, which includes package-lock.json.
// Script-only `package.json` edits do not trip blocking audit (no lock churn).
const lockfilePatterns = ["package-lock.json", ".npmrc"];

/** Executable helpers under otherwise-light workflow/policy surfaces. */
function isExecutableWorkflowSurfacePath(filePath) {
  return /\.(?:mjs|cjs|js|ts|tsx|sh|bash|py)$/i.test(filePath);
}

/**
 * Recognised light paths may skip the heavy static/coverage route. Markdown and
 * YAML/policy under workflow surfaces stay light; executable files there do not.
 */
function isRecognisedLightPath(filePath) {
  if (filePath === generatedMedicationLexiconReport) return false;
  if (pathMatches(filePath, docPatterns)) return true;
  if (!pathMatches(filePath, workflowPatterns)) return false;
  return !isExecutableWorkflowSurfacePath(filePath);
}

// The ledger read is injected so `classify` stays pure and the self-test can
// drive both the empty and non-empty cases without touching the real file.
const readFlakeLedger = () => readFileSync("tests/flake-ledger.json", "utf8");

function classify(files, { readLedger = readFlakeLedger } = {}) {
  const normalized = [...new Set(files.map(normalizePath).filter(Boolean))].sort();
  const docsChanged = normalized.some((file) => pathMatches(file, docPatterns));
  const sourceChanged = normalized.some((file) => pathMatches(file, [...sourcePatterns, ...staticConfigPatterns]));
  const uiChanged = normalized.some((file) => isUiChangedPath(file));
  const perfChanged = normalized.some((file) => isPerfChangedPath(file));
  const advisoryUiChanged =
    normalized.some((file) => pathMatches(file, mockupPatterns)) || quarantineLedgerHasEntries(readLedger);
  const dbChanged = normalized.some((file) => pathMatches(file, dbPatterns));
  const containerChanged = normalized.some((file) => pathMatches(file, containerPatterns));
  const ragEvalChanged = normalized.some((file) => pathMatches(file, ragEvalPatterns));
  const ingestionSastChanged = normalized.some((file) => pathMatches(file, ingestionSastPatterns));
  const workflowChanged = normalized.some((file) => pathMatches(file, workflowPatterns));
  const codexAutofixChanged = normalized.some((file) => pathMatches(file, codexAutofixPatterns));
  const lockfileChanged = normalized.some((file) => pathMatches(file, lockfilePatterns));
  const prPolicyBodyChanged = normalized.includes("PR_POLICY_BODY.md");
  const buildChanged = normalized.some((file) => pathMatches(file, buildPatterns)) || containerChanged;
  // Only two categories are allowed to take the lightweight path: recognised
  // documentation and recognised non-executable workflow/policy surfaces.
  // Unknown non-doc files fail closed to the heavy plan. Executable files that
  // also match a workflow pattern (for example `.agents/skills/**/scripts/*.mjs`
  // or a workflow helper under `scripts/`) remain heavy even when the directory
  // is otherwise treated as a light policy surface.
  const hasUnknownNonLightPath = normalized.some((file) => !isRecognisedLightPath(file));
  const staticHeavyChanged =
    sourceChanged || buildChanged || containerChanged || dbChanged || lockfileChanged || hasUnknownNonLightPath;
  // Pure workflow YAML/policy changes use focused workflow-contract tests in
  // static-pr. Product, test, build, database, dependency and unknown changes
  // retain the complete coverage lane.
  const coverageChanged = staticHeavyChanged;
  const docsOnly =
    normalized.length > 0 &&
    normalized.every((file) => pathMatches(file, docPatterns)) &&
    !normalized.includes(generatedMedicationLexiconReport) &&
    !sourceChanged &&
    !workflowChanged;
  const workflowOnly = workflowChanged && !staticHeavyChanged;

  return {
    files: normalized,
    docs_only: docsOnly,
    docs_changed: docsChanged,
    source_changed: sourceChanged,
    static_heavy_changed: staticHeavyChanged,
    coverage_changed: coverageChanged,
    ingestion_sast_changed: ingestionSastChanged,
    ui_changed: uiChanged,
    perf_changed: perfChanged,
    advisory_ui_changed: advisoryUiChanged,
    db_changed: dbChanged,
    container_changed: containerChanged,
    rag_eval_changed: ragEvalChanged,
    workflow_changed: workflowChanged,
    workflow_only: workflowOnly,
    codex_autofix_changed: codexAutofixChanged,
    build_changed: buildChanged,
    lockfile_changed: lockfileChanged,
    pr_policy_body_changed: prPolicyBodyChanged,
  };
}

function parseStatusPorcelain(raw) {
  if (!raw) return [];
  const fields = raw.split("\0").filter(Boolean);
  const files = [];

  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index];
    const status = entry.slice(0, 2);
    const pathPart = entry.slice(3);
    if (status.includes("R") || status.includes("C")) {
      const originalPath = fields[index + 1];
      files.push(pathPart);
      if (originalPath) {
        files.push(originalPath);
        index += 1;
      }
      continue;
    }
    files.push(pathPart);
  }

  return files;
}

function changedFilesFromStatus() {
  return parseStatusPorcelain(runGitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
}

function parseNameStatus(raw) {
  const fields = raw.split("\0").filter(Boolean);
  const files = [];

  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const firstPath = fields[index++];
    if (!status || !firstPath) break;

    files.push(firstPath);
    if (/^[RC]/.test(status)) {
      const secondPath = fields[index++];
      if (secondPath) files.push(secondPath);
    }
  }

  return files;
}

function changedFilesFromRange(base, head) {
  if (!base || !head || zeroSha.test(base) || zeroSha.test(head)) return null;
  try {
    return parseNameStatus(runGitRaw(["diff", "--name-status", "-z", "--find-renames", `${base}...${head}`]));
  } catch {
    try {
      return parseNameStatus(runGitRaw(["diff", "--name-status", "-z", "--find-renames", base, head]));
    } catch {
      // Unreachable base (e.g. force-push). Fall through to the full-run
      // sentinel rather than failing the whole changes job.
      return null;
    }
  }
}

function refExists(ref) {
  try {
    runGit(["rev-parse", "--verify", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isBaseBranchRef(ref) {
  return /(?:^|\/)(?:main|master|develop|release\/.+)$/.test(ref);
}

function resolveLocalBaseRef(args) {
  const explicit = getArgValue(args, "--base-ref") ?? process.env.PR_BASE_REF ?? process.env.GITHUB_BASE_REF ?? "";
  if (explicit) {
    if (!refExists(explicit)) throw new Error(`Local PR base ref does not exist: ${explicit}`);
    return explicit;
  }

  let upstream = "";
  try {
    upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (isBaseBranchRef(upstream)) return upstream;
  } catch {
    // A local-only feature branch can still resolve the remote default branch below.
  }

  try {
    const remoteHead = runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (remoteHead && refExists(remoteHead)) return remoteHead;
  } catch {
    // Fall through to conventional base names.
  }

  for (const candidate of ["origin/main", "origin/master", "origin/develop", "main", "master", "develop"]) {
    if (refExists(candidate)) return candidate;
  }

  return null;
}

function changedFilesFromLocal(args) {
  const statusFiles = changedFilesFromStatus();
  const baseRef = resolveLocalBaseRef(args);
  if (!baseRef) return [...fullRunSentinelFiles, ...statusFiles];

  try {
    const mergeBase = runGit(["merge-base", "HEAD", baseRef]);
    return [...(changedFilesFromRange(mergeBase, "HEAD") ?? []), ...statusFiles];
  } catch {
    return [...fullRunSentinelFiles, ...statusFiles];
  }
}

function resolveChangedFiles(args) {
  const filesArg = getArgValue(args, "--files");
  if (filesArg)
    return filesArg
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const separator = args.indexOf("--");
  if (separator >= 0) return args.slice(separator + 1);

  const base = getArgValue(args, "--base") ?? process.env.BASE_SHA ?? "";
  const head = getArgValue(args, "--head") ?? process.env.HEAD_SHA ?? "";
  const ranged = changedFilesFromRange(base, head);
  if (ranged) return ranged;

  if (process.env.GITHUB_ACTIONS === "true") {
    return fullRunSentinelFiles;
  }

  return changedFilesFromLocal(args);
}

function writeOutputs(result) {
  for (const key of outputs) {
    console.log(`${key}=${result[key]}`);
  }
  console.log(`changed_files=${result.files.join(",")}`);

  if (!process.env.GITHUB_OUTPUT) return;
  const lines = [...outputs.map((key) => `${key}=${result[key]}`), `changed_files=${result.files.join(",")}`];
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

const emptyLedger = () => '{"flakes":[]}';

function assertScope(name, files, expected, options = {}) {
  const result = classify(files, { readLedger: emptyLedger, prPolicyBodyPresent: false, ...options });
  for (const [key, value] of Object.entries(expected)) {
    if (result[key] !== value) {
      throw new Error(`${name}: expected ${key}=${value}, received ${result[key]} for ${files.join(", ")}`);
    }
  }
}

/**
 * `mockupPatterns` decides whether the advisory lane starts; `mockupSpecPattern`
 * in playwright.config.ts decides which specs that lane then contains. They are
 * two hand-maintained lists of the same set, so they drift — and the drift is
 * silent, because a mockup spec added to the config but missed here still shows
 * a green PR: the production projects `grepInvert` its `@mockup` tag and the
 * advisory lane never starts. The journey simply stops being run anywhere.
 *
 * Fails CLOSED on a lost anchor: a renamed constant is reported rather than
 * quietly turning this into a guard that checks nothing.
 */
function assertMockupSpecParity() {
  const source = readFileSync("playwright.config.ts", "utf8");
  const alternation = source.match(/const mockupSpecPattern\s*=\s*\/\.\*ui-\(([^)]+)\)\\\.spec\\\.ts\//);
  if (!alternation) {
    throw new Error(
      "mockup-spec-parity: could not read the `mockupSpecPattern` alternation from playwright.config.ts. " +
        "If that constant moved or changed shape, update this guard — do not delete it.",
    );
  }

  const specs = alternation[1]
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `tests/ui-${name}.spec.ts`);
  if (specs.length === 0) throw new Error("mockup-spec-parity: the `mockupSpecPattern` alternation is empty.");

  for (const spec of specs) {
    if (!pathMatches(spec, mockupPatterns)) {
      throw new Error(
        `mockup-spec-parity: playwright.config.ts runs ${spec} in the advisory project, but mockupPatterns ` +
          "does not match it, so editing that spec would leave advisory_ui_changed=false and the journey unrun.",
      );
    }
  }
  console.log(`Mockup spec parity: ${specs.length} advisory specs all match mockupPatterns.`);
}

/**
 * Budget routes stay query-free so a silent `?q=` addition cannot hide new
 * client-driven API traffic from review. This is a signal, not a complete proof that
 * no API runs on load — `/` already fetches /api/setup-status and
 * /api/local-project-id via ClinicalDashboard, and those handlers are carved into
 * perfInitialLoadApiPatterns. A new query-bearing route usually means more handlers
 * need the same carve-out. Fails CLOSED on an unreadable budget.
 */
function assertBudgetRoutesAreQueryFree() {
  let budget;
  try {
    budget = JSON.parse(readFileSync("lighthouse-budget.json", "utf8"));
  } catch (error) {
    throw new Error(
      `budget-routes-query-free: could not read lighthouse-budget.json (${
        error instanceof Error ? error.message : String(error)
      }). If that file moved, update this guard — do not delete it.`,
    );
  }

  const routes = Array.isArray(budget?.routes) ? budget.routes : null;
  if (!routes || routes.length === 0) {
    throw new Error(
      "budget-routes-query-free: lighthouse-budget.json lists no routes; this guard has nothing to check.",
    );
  }

  const withQuery = routes.filter((route) => typeof route === "string" && route.includes("?"));
  if (withQuery.length > 0) {
    throw new Error(
      `budget-routes-query-free: ${withQuery.join(", ")} carries a query string. A query-bearing budget route may ` +
        "fetch additional src/app/api/** handlers on load — extend perfInitialLoadApiPatterns or drop the route.",
    );
  }
  console.log(`Budget routes query-free: ${routes.length} routes carry no query string.`);
}

function selfTest() {
  // #137: the advisory lane runs only when it has something to cover. All four
  // directions matter — a lane that silently never runs is the failure mode.
  assertScope("advisory-off-when-nothing-to-cover", ["src/components/clinical-dashboard/dashboard-nav.tsx"], {
    ui_changed: true,
    advisory_ui_changed: false,
  });
  assertScope("advisory-on-for-mockup-source", ["src/app/mockups/page.tsx"], { advisory_ui_changed: true });
  assertScope("advisory-on-for-mockup-component", ["src/components/search-mockups.tsx"], {
    advisory_ui_changed: true,
  });
  // A mockup component in a NESTED `mockups/` directory whose own filename gives
  // no hint — the case the suffix-based rules miss. Both directions are pinned so
  // the added pattern cannot quietly widen to ordinary component directories.
  assertScope("advisory-on-for-nested-mockup-dir", ["src/components/caring-contacts/mockups/product-pages.tsx"], {
    advisory_ui_changed: true,
  });
  assertScope("advisory-off-for-ordinary-nested-component", ["src/components/caring-contacts/contact-card.tsx"], {
    advisory_ui_changed: false,
  });
  // A mockup component edited without its `src/app/mockups` route wrapper. The
  // filename is singular, and `ui-tools-task-directory.spec.ts` is its only
  // browser coverage — excluded from every production project by its `@mockup`
  // tag, so a missed match here means the journey runs nowhere.
  assertScope(
    "advisory-on-for-singular-mockup-component",
    ["src/components/tools-page-mockups/task-directory-mockup.tsx"],
    {
      ui_changed: true,
      advisory_ui_changed: true,
    },
  );
  assertScope(
    "advisory-on-for-mockup-component-directory",
    ["src/components/calculator-mockups/guided-flow-mockup.tsx"],
    {
      advisory_ui_changed: true,
    },
  );
  // Advisory specs whose filenames carry no "mockup" at all.
  assertScope("advisory-on-for-untagged-mockup-spec-names", ["tests/ui-tools-collapse.spec.ts"], {
    advisory_ui_changed: true,
  });
  assertScope("advisory-on-for-tools-task-directory-spec", ["tests/ui-tools-task-directory.spec.ts"], {
    advisory_ui_changed: true,
  });
  // The directory rule must not swallow ordinary component paths.
  assertScope("advisory-off-for-non-mockup-component-directory", ["src/components/clinical-dashboard/mode-nav.tsx"], {
    ui_changed: true,
    advisory_ui_changed: false,
  });
  assertScope(
    "advisory-on-when-a-test-is-quarantined",
    ["src/components/clinical-dashboard/dashboard-nav.tsx"],
    { advisory_ui_changed: true },
    { readLedger: () => '{"flakes":[{"id":"F-1"}]}' },
  );
  // Fail OPEN: an unreadable ledger must not quietly drop the lane.
  assertScope(
    "advisory-on-when-the-ledger-cannot-be-read",
    ["src/components/clinical-dashboard/dashboard-nav.tsx"],
    { advisory_ui_changed: true },
    {
      readLedger: () => {
        throw new Error("ENOENT");
      },
    },
  );

  assertScope("workflow-only-uses-focused-contracts", [".github/workflows/ci.yml"], {
    coverage_changed: false,
    workflow_changed: true,
    workflow_only: true,
    static_heavy_changed: false,
  });
  assertScope("composite-action-only-uses-focused-contracts", [".github/actions/setup-ui-e2e/action.yml"], {
    coverage_changed: false,
    ui_changed: true,
    workflow_changed: true,
    workflow_only: true,
    static_heavy_changed: false,
  });
  assertScope("runtime-config-keeps-coverage", ["lighthouse-budget.json"], {
    coverage_changed: true,
  });

  assertScope("unstaged-status", parseStatusPorcelain(" M scripts/ci-change-scope.mjs\0"), {
    source_changed: true,
    workflow_changed: true,
  });
  assertScope("docs-only", ["docs/process-note.md"], {
    docs_only: true,
    docs_changed: true,
    source_changed: false,
    static_heavy_changed: false,
    build_changed: false,
    lockfile_changed: false,
  });
  assertScope("generated-medication-lexicon-report-stays-heavy", [generatedMedicationLexiconReport], {
    docs_only: false,
    docs_changed: true,
    static_heavy_changed: true,
    coverage_changed: true,
  });
  assertScope("tests-only", ["tests/rag-routing.test.ts"], {
    source_changed: true,
    coverage_changed: true,
    build_changed: false,
    static_heavy_changed: true,
  });
  assertScope("coverage-config", ["vitest.config.mts"], {
    source_changed: true,
    coverage_changed: true,
  });
  assertScope("build-config-keeps-coverage", ["next.config.ts", "postcss.config.mjs", "tsconfig.json"], {
    coverage_changed: true,
    build_changed: true,
  });
  assertScope("worker-keeps-coverage", ["worker/index.ts"], {
    source_changed: true,
    coverage_changed: true,
    build_changed: true,
  });
  assertScope("test-runner", ["scripts/run-vitest.mjs", "scripts/run-playwright.mjs"], {
    source_changed: true,
    coverage_changed: true,
    ui_changed: true,
  });
  // Shared Playwright fixtures back required browser journeys; a miss here means
  // the change reaches no browser at all, silently, on a green pull request.
  assertScope("playwright-shared-fixtures", ["tests/helpers/phone-scroll.ts", "tests/helpers/zero-touch.ts"], {
    source_changed: true,
    coverage_changed: true,
    ui_changed: true,
  });
  assertScope("playwright-base-url-helper", ["scripts/playwright-base-url.ts"], {
    source_changed: true,
    coverage_changed: true,
    ui_changed: true,
  });
  // Direct Playwright runner helpers must trip ui_changed so PR Chromium jobs and
  // the post-merge release-browser-matrix backstop still run for launch/shard edits.
  assertScope(
    "playwright-runner-helpers",
    [
      "scripts/playwright-browser-preflight.mjs",
      "scripts/check-playwright-browser-revision.mjs",
      "scripts/playwright-pr-shards.mjs",
    ],
    {
      source_changed: true,
      coverage_changed: true,
      ui_changed: true,
    },
  );
  // A baseline-only commit must still run the visual job, or a corrupted golden is
  // never compared against the app it claims to describe.
  assertScope("visual-baseline-png", ["tests/__screenshots__/linux/dashboard-shell.png"], {
    coverage_changed: true,
    ui_changed: true,
  });
  // The Lighthouse budget's own inputs must trigger the job that consumes them.
  assertScope("lighthouse-budget-config", ["lighthouse-budget.json"], {
    coverage_changed: true,
    ui_changed: true,
  });
  assertScope(
    "lighthouse-budget-runner",
    ["scripts/run-lighthouse-budget.mjs", "scripts/check-lighthouse-budget.mjs"],
    {
      source_changed: true,
      coverage_changed: true,
      ui_changed: true,
    },
  );

  // ---- perf_changed: the narrow scope the Lighthouse budget job keys off. ----
  //
  // Both directions are load-bearing. A false negative means a render regression
  // reaches main unmeasured; a false positive is the ~7 minute build+measure this
  // scope exists to stop paying. Each `perf-off-*` case below is a deliberate,
  // argued loss of coverage, not an oversight — see perfExclusionPatterns.

  // #1668 (dependabot js-yaml, a devDependency) paid the full budget run. This
  // classifier only ever sees PATHS, never the lockfile diff, so it cannot tell a
  // devDependency bump from a React/Next bump. The PR arm therefore leaves
  // perf_changed=false for manifests; the push-to-main arm of the job's `if:`
  // re-runs when lockfile_changed is true, and the weekly schedule remains the
  // delayed backstop. Do NOT put the lockfile back into perfPatterns.
  assertScope("perf-off-for-dependency-manifests", ["package.json", "package-lock.json"], {
    build_changed: true,
    lockfile_changed: true,
    perf_changed: false,
  });
  assertScope("perf-off-for-worker", ["worker/main.ts", "worker/python/requirements.txt"], {
    build_changed: true,
    container_changed: true,
    perf_changed: false,
  });
  assertScope("perf-off-for-container-surfaces", ["Dockerfile.worker", "railway.worker.json"], {
    container_changed: true,
    perf_changed: false,
  });
  assertScope("perf-off-for-api-route", ["src/app/api/answer/route.ts"], {
    build_changed: true,
    ui_changed: false,
    perf_changed: false,
  });
  // Initial-load handlers the budgeted `/` dashboard always fetches on mount.
  assertScope("perf-on-for-initial-load-setup-status", ["src/app/api/setup-status/route.ts"], {
    build_changed: true,
    ui_changed: false,
    perf_changed: true,
  });
  assertScope("perf-on-for-initial-load-local-project-id", ["src/app/api/local-project-id/route.ts"], {
    build_changed: true,
    ui_changed: false,
    perf_changed: true,
  });
  // A spec, fixture, golden PNG or browser config cannot change a byte the production
  // server sends, and the Lighthouse runner builds and serves its own isolated app
  // without ever loading Playwright.
  assertScope(
    "perf-off-for-playwright-surfaces",
    [
      "tests/ui-smoke.spec.ts",
      "tests/helpers/zero-touch.ts",
      "tests/__screenshots__/linux/dashboard-shell.png",
      "playwright.config.ts",
      "scripts/run-playwright.mjs",
    ],
    { ui_changed: true, perf_changed: false },
  );
  assertScope("perf-off-for-mockup-route", ["src/app/mockups/page.tsx"], {
    ui_changed: true,
    advisory_ui_changed: true,
    perf_changed: false,
  });
  assertScope(
    "perf-off-for-server-runtime-entrypoints",
    ["src/instrumentation.ts", "src/sentry.server.config.ts", "src/sentry.edge.config.ts"],
    { build_changed: true, perf_changed: false },
  );
  // The request proxy runs before every budgeted navigation (CSP/nonce, optional
  // session refresh). Keeping it out of perf scope would miss TTFB/LCP regressions.
  assertScope("perf-on-for-request-proxy", ["src/proxy.ts"], {
    build_changed: true,
    perf_changed: true,
  });
  assertScope("perf-off-for-bundle-budget-config", ["bundle-budget.json"], {
    build_changed: true,
    perf_changed: false,
  });
  assertScope("perf-off-for-docs", ["docs/testing.md"], { docs_only: true, perf_changed: false });
  assertScope("perf-off-for-supabase", ["supabase/migrations/20260101000000_example.sql"], {
    db_changed: true,
    perf_changed: false,
  });

  assertScope("perf-on-for-route-page", ["src/app/(search-app)/dsm/page.tsx"], {
    ui_changed: true,
    perf_changed: true,
  });
  assertScope("perf-on-for-shared-component", ["src/components/clinical-dashboard/dashboard-nav.tsx"], {
    perf_changed: true,
  });
  // Pins the exclusion that was CONSIDERED AND REJECTED: src/lib is not split into
  // server/client by path, because this file is a browser Supabase provider that sits
  // in the render tree while its siblings are server-only.
  assertScope("perf-on-for-browser-supabase-client", ["src/lib/supabase/client.tsx"], { perf_changed: true });
  // The mirror image: instrumentation-client.ts runs in the browser and is a direct
  // TBT contributor, so the `src/instrumentation.ts` exclusion must not over-reach.
  assertScope("perf-on-for-client-instrumentation", ["src/instrumentation-client.ts"], { perf_changed: true });
  assertScope("perf-on-for-css-entrypoints", ["src/app/globals.css"], { perf_changed: true });
  assertScope(
    "perf-on-for-route-payload",
    ["public/therapy-compass-data/therapies-home.json", "data/medications-snapshot.json"],
    { perf_changed: true },
  );
  // Mockup-only ledger snapshot: same `data/` root as medications, but it
  // cannot reach a budgeted route. Closing the last P1 on PR #2302 otherwise
  // forced Lighthouse onto a docs/ledger reconcile.
  assertScope("perf-off-for-outstanding-issues-snapshot", ["data/outstanding-issues-snapshot.json"], {
    perf_changed: false,
  });
  assertScope("perf-on-for-build-config", ["next.config.ts", "postcss.config.mjs", "tsconfig.json"], {
    perf_changed: true,
  });
  assertScope("perf-on-for-budget-inputs", ["lighthouse-budget.json"], { ui_changed: true, perf_changed: true });
  // New coverage: the grader imports its completeness primitives from this file, so
  // editing it changes the verdict. Before perfPatterns it matched no scope at all.
  assertScope("perf-on-for-grader-dependency", ["scripts/summarise-web-vitals.mjs"], { perf_changed: true });
  assertScope("perf-on-for-retry-outcome-module", ["scripts/lighthouse-measurement-outcome.mjs"], {
    perf_changed: true,
  });
  assertScope(
    "perf-on-for-runner-dependencies",
    ["scripts/lighthouse-time-budget.mjs", "scripts/child-process-result.mjs", "scripts/test-environment.mjs"],
    { perf_changed: true },
  );
  // The Lighthouse script regex is intentionally anchored. A sibling script must
  // not turn every scripts/ edit into an unnecessary full budget measurement.
  assertScope("perf-off-for-unrelated-script", ["scripts/run-vitest.mjs"], { perf_changed: false });
  assertScope("perf-on-for-chromium-pin-action", [".github/actions/setup-lighthouse-chromium/action.yml"], {
    workflow_changed: true,
    perf_changed: true,
  });
  // Proves the unknown-path direction: a new top-level directory under src/ is IN
  // scope, so a future refactor over-triggers by one job rather than silently
  // dropping a render surface.
  assertScope("perf-on-for-unrecognised-src-path", ["src/features/new-thing/index.ts"], { perf_changed: true });
  assertScope("runtime-data", ["data/medications-snapshot.json"], {
    source_changed: true,
    coverage_changed: true,
    ui_changed: true,
    build_changed: true,
  });
  assertScope("ui", ["src/components/ClinicalDashboard.tsx", "tests/ui-smoke.spec.ts"], {
    docs_only: false,
    source_changed: true,
    ui_changed: true,
    build_changed: true,
  });
  assertScope("answer-progress-playwright", ["tests/answer-progress-ui-smoke.spec.ts"], {
    source_changed: true,
    coverage_changed: true,
    ui_changed: true,
    build_changed: false,
  });
  assertScope("db", ["supabase/migrations/20260710000000_example.sql"], {
    db_changed: true,
    source_changed: true,
    build_changed: false,
  });
  assertScope(
    "rag",
    [
      "src/app/api/answer/route.ts",
      "src/lib/corpus-grounding.ts",
      "src/components/clinical-dashboard/answer-content.tsx",
    ],
    {
      rag_eval_changed: true,
      source_changed: true,
      // API handlers alone must not pull Chromium or migration replay.
      ui_changed: true, // answer-content.tsx is UI
      db_changed: false,
    },
  );
  assertScope("api-only-skips-ui-and-db", ["src/app/api/answer/route.ts"], {
    source_changed: true,
    coverage_changed: true,
    rag_eval_changed: true,
    build_changed: true,
    ui_changed: false,
    db_changed: false,
  });
  assertScope("app-page-keeps-ui", ["src/app/(search-app)/page.tsx"], {
    source_changed: true,
    ui_changed: true,
    build_changed: true,
    db_changed: false,
  });
  // Mode configuration, routing, UI copy and therapies feed shell/home rendering (#0HFDWD)
  assertScope("mode-config-triggers-ui", ["src/lib/app-modes.ts"], {
    ui_changed: true,
    source_changed: true,
  });
  assertScope("search-route-ownership-triggers-ui", ["src/lib/search-route-ownership.ts"], {
    ui_changed: true,
    source_changed: true,
  });
  assertScope("ui-copy-triggers-ui", ["src/lib/ui-copy.ts"], {
    ui_changed: true,
    source_changed: true,
  });
  assertScope("therapies-lib-triggers-ui", ["src/lib/therapies.ts"], {
    ui_changed: true,
    source_changed: true,
  });
  assertScope("rag-fixture", ["src/lib/retrieval-selection.ts", "scripts/fixtures/rag-retrieval-golden.json"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  // #SDQSFD: the extracted `src/lib/rag/` subtree (#994). Each of these alone
  // must select the offline RAG contracts — `rag.ts` is the orchestrator and
  // `answer-composition.ts` carries no `rag-` filename prefix at all, so the
  // flat `src/lib/rag-*.ts` regex missed it entirely.
  assertScope("rag-directory-orchestrator", ["src/lib/rag/rag.ts"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  assertScope("rag-directory-answer-composition", ["src/lib/rag/answer-composition.ts"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  assertScope("rag-directory-claim-support", ["src/lib/rag/rag-claim-support.ts"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  // The other direction: the directory prefix must stay a directory prefix. An
  // unrelated `src/lib` module is still an executable change, but it must not
  // drag the offline RAG contracts onto every PR.
  assertScope("non-rag-lib-module-skips-rag-eval", ["src/lib/app-modes.ts"], {
    rag_eval_changed: false,
    source_changed: true,
  });
  assertScope("rag-fixture-checker", ["scripts/check-rag-fixtures.mjs"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  // Packet B2: the adversarial fixture validator, contract module, runner and harness
  // must all re-run the RAG-scoped offline gates when edited.
  assertScope("rag-adversarial-fixture-checker", ["scripts/check-rag-adversarial-fixtures.mjs"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  assertScope("rag-adversarial-contract-module", ["scripts/rag-adversarial-contract.mjs"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  assertScope("rag-adversarial-runner", ["scripts/eval-rag-adversarial-offline.mjs"], {
    rag_eval_changed: true,
    source_changed: true,
  });
  assertScope(
    "rag-adversarial-harness",
    ["tests/rag-adversarial-harness.test.ts", "tests/helpers/rag-adversarial-assertions.ts"],
    {
      rag_eval_changed: true,
      source_changed: true,
    },
  );
  assertScope("ingestion-sast-worker", ["worker/python/extract_pdf_assets.py"], {
    ingestion_sast_changed: true,
  });
  assertScope("ingestion-sast-api", ["src/app/api/upload/route.ts"], {
    ingestion_sast_changed: true,
  });
  assertScope("ingestion-sast-library", ["src/lib/ingestion-queue.ts", "src/lib/extractors/pdf.ts"], {
    ingestion_sast_changed: true,
  });
  assertScope("ingestion-sast-gate-contract", [".github/workflows/ci.yml", "scripts/ci-change-scope.mjs"], {
    ingestion_sast_changed: true,
  });
  assertScope("non-ingestion-source-skips-sast", ["src/lib/rag.ts"], {
    ingestion_sast_changed: false,
  });
  // A RAG-relevant lib file outside ragEvalPatterns must still be caught as a
  // source change (so static-pr and the non-docs safety job / verify:pr-local,
  // which run fixture validation, always execute). Guards the "silent
  // scope narrowing" gap.
  assertScope("rag-lib-outside-allowlist", ["src/lib/hybrid-reranker.ts"], {
    source_changed: true,
    coverage_changed: true,
    docs_only: false,
  });
  assertScope("database-access-api-no-longer-trips-migration", ["src/app/api/documents/route.ts"], {
    db_changed: false,
    source_changed: true,
    coverage_changed: true,
    build_changed: true,
  });
  assertScope(
    "database-schema-trips-migration",
    ["supabase/migrations/20260710000000_example.sql", "src/lib/supabase/server.ts"],
    {
      db_changed: true,
      source_changed: true,
    },
  );
  assertScope("workflow", [".github/workflows/ci.yml", "docs/process-hardening.md"], {
    workflow_changed: true,
    workflow_only: true,
    coverage_changed: false,
    static_heavy_changed: false,
    docs_only: false,
    build_changed: false,
  });
  assertScope("gitleaks-pin-script", ["scripts/run-gitleaks-pinned.mjs"], {
    workflow_changed: true,
    source_changed: true,
    docs_only: false,
    build_changed: false,
    static_heavy_changed: true,
  });
  assertScope("repo-skill", [".agents/skills/database-flightplan/SKILL.md"], {
    workflow_changed: true,
    source_changed: false,
    // Skill Markdown is documentation-like: static policy checks still run,
    // but unit coverage has no executable product surface to measure.
    coverage_changed: false,
    workflow_only: true,
    static_heavy_changed: false,
    docs_only: false,
    build_changed: false,
  });
  for (const file of [
    ".claude/skills/issues/SKILL.md",
    ".cursor/skills/security-review/SKILL.md",
    "plugins/clinical-kb/skills/clinical-kb-workflow/SKILL.md",
  ]) {
    assertScope(`repository-skill-surface:${file}`, [file], {
      workflow_changed: true,
      source_changed: false,
      coverage_changed: false,
      workflow_only: true,
      static_heavy_changed: false,
      docs_only: false,
      build_changed: false,
    });
  }
  assertScope(
    "executable-skill-script-stays-heavy",
    [".agents/skills/prompt-perfector/scripts/verify-repository-isolation.mjs"],
    {
      workflow_changed: true,
      source_changed: false,
      coverage_changed: true,
      workflow_only: false,
      static_heavy_changed: true,
      docs_only: false,
      build_changed: false,
    },
  );
  assertScope(
    "codex-autofix",
    [".github/workflows/codex-autofix-review-comments.yml", "AGENTS.md", "scripts/check-codex-autofix-workflow.mjs"],
    {
      workflow_changed: true,
      codex_autofix_changed: true,
      build_changed: false,
    },
  );
  assertScope("package", ["package.json"], {
    source_changed: false,
    coverage_changed: true,
    container_changed: true,
    workflow_changed: false,
    build_changed: true,
    static_heavy_changed: true,
    // Script/metadata edits to package.json alone do not introduce dependencies;
    // blocking audit still keys off package-lock.json / .npmrc.
    lockfile_changed: false,
  });
  assertScope("lockfile", ["package-lock.json"], {
    lockfile_changed: true,
    build_changed: true,
    container_changed: true,
  });
  assertScope("npmrc", [".npmrc"], {
    lockfile_changed: true,
    container_changed: true,
  });
  assertScope("source-only-no-lockfile", ["src/lib/rag.ts"], {
    source_changed: true,
    lockfile_changed: false,
  });
  assertScope("bundle-budget-config", ["bundle-budget.json"], {
    build_changed: true,
  });
  assertScope("bundle-budget-checker", ["scripts/check-bundle-budget.mjs"], {
    source_changed: true,
    build_changed: true,
  });
  assertScope("upload-limit-parity-input", ["scripts/check-upload-limit-parity.mjs"], {
    source_changed: true,
    coverage_changed: true,
    container_changed: true,
    build_changed: true,
  });
  assertScope(
    "container",
    [
      "Dockerfile.worker",
      ".github/workflows/docker-image.yml",
      "railway.app.json",
      "railway.worker.json",
      "worker/python/requirements.txt",
      "worker/python/extract_pdf_assets.py",
      "worker/index.ts",
      "scripts/build-worker.mjs",
      "scripts/run-heavy.mjs",
      "scripts/check-client-bundle-secrets.mjs",
      "scripts/check-upload-limit-parity.mjs",
      "scripts/install-git-hooks.mjs",
      "tests/stubs/server-only.ts",
      "tsconfig.json",
      "postcss.config.mjs",
    ],
    {
      container_changed: true,
      build_changed: true,
    },
  );
  assertScope("renamed-destination", parseStatusPorcelain("R  src/lib/rag-new.ts\0docs/rag-old.md\0"), {
    source_changed: true,
    rag_eval_changed: true,
    docs_only: false,
  });
  assertScope("ranged-rename", parseNameStatus("R100\0src/lib/rag-old.ts\0docs/rag-old.md\0"), {
    source_changed: true,
    rag_eval_changed: true,
    docs_only: false,
  });
  assertScope("unknown-base-full-run", fullRunSentinelFiles, {
    source_changed: true,
    static_heavy_changed: true,
    coverage_changed: true,
    ingestion_sast_changed: true,
    ui_changed: true,
    // The weekly schedule and any unresolvable base resolve to these sentinels, and
    // the perf gate's `if:` relies on that to keep measuring routes when no PR does.
    // Asserted so a future edit to fullRunSentinelFiles cannot silently retire it.
    perf_changed: true,
    db_changed: true,
    container_changed: true,
    rag_eval_changed: true,
    workflow_changed: true,
    codex_autofix_changed: true,
    build_changed: true,
    lockfile_changed: true,
  });
  assertScope("unknown-non-doc-fails-closed", ["custom.config"], {
    docs_only: false,
    workflow_only: false,
    static_heavy_changed: true,
    coverage_changed: true,
  });
  assertScope("pr-policy-body-change-is-routed-from-the-pr-diff", ["PR_POLICY_BODY.md"], {
    pr_policy_body_changed: true,
  });
  assertScope("inherited-pr-policy-body-does-not-sync", ["docs/testing.md"], {
    pr_policy_body_changed: false,
  });
  console.log("CI change scope self-test passed.");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  assertMockupSpecParity();
  assertBudgetRoutesAreQueryFree();
  selfTest();
  process.exit(0);
}

const result = classify(resolveChangedFiles(args));
if (args.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  writeOutputs(result);
}
