import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import fullConfig from "../vitest.config.mjs";
import shardConfig from "../vitest.coverage-shard.config.mjs";

import { selectedScripts } from "../scripts/verify-pr-local.mjs";
import { sourceFrom, sourceSegment } from "./helpers/source-contract";

const nodeSetup = readFileSync(new URL("../.github/actions/setup-node-cached/action.yml", import.meta.url), "utf8");
const uiSetup = readFileSync(new URL("../.github/actions/setup-ui-e2e/action.yml", import.meta.url), "utf8");
const lighthouseChromiumSetup = readFileSync(
  new URL("../.github/actions/setup-lighthouse-chromium/action.yml", import.meta.url),
  "utf8",
);
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const prShardRunner = readFileSync(new URL("../scripts/playwright-pr-shards.mjs", import.meta.url), "utf8");
const liveWebVitalsWorkflow = readFileSync(
  new URL("../.github/workflows/live-web-vitals.yml", import.meta.url),
  "utf8",
);
const opsDigestWorkflow = readFileSync(new URL("../.github/workflows/ops-digest.yml", import.meta.url), "utf8");

describe("partitioned unit coverage verdict", () => {
  const workflow = createRequire(import.meta.url)("js-yaml").load(
    readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  );
  const partitions = workflow.jobs["coverage-shards"];
  const aggregate = workflow.jobs.coverage;

  it("keeps the full test inventory and defers only coverage reporting and thresholds", () => {
    expect(shardConfig).toEqual({
      ...fullConfig,
      test: { ...fullConfig.test, coverage: { ...fullConfig.test.coverage, reporter: [], thresholds: undefined } },
    });
    expect(fullConfig.test.coverage.thresholds).toBeDefined();
    expect(partitions.strategy.matrix.shard).toEqual([1, 2]);
    expect(partitions.strategy["fail-fast"]).toBe(false);
    expect(partitions["continue-on-error"]).toBeUndefined();
    const run = partitions.steps.find((step: { run?: string }) => step.run?.includes("--shard="));
    expect(run.run).toContain("--shard=${{ matrix.shard }}/2");
    expect(run.run).toContain("--reporter=blob");
    expect(run["continue-on-error"]).toBeUndefined();
  });

  it("fails the required aggregate on unsuccessful or missing partitions", () => {
    expect(aggregate.needs).toContain("coverage-shards");
    // Runs on a failed partition (to report it) but not on a cancelled run; the required
    // aggregate keeps `always()` and fails an in-scope `skipped` coverage result.
    expect(aggregate.if).toContain("!cancelled()");
    expect(aggregate.if).not.toContain("always()");
    expect(workflow.jobs["pr-required"].if).toBe("always()");
    expect(aggregate.steps[0].env.SHARD_RESULT).toBe("${{ needs.coverage-shards.result }}");
    expect(aggregate.steps[0].run).toBe('test "$SHARD_RESULT" = success');
    expect(aggregate.steps[0]["continue-on-error"]).toBeUndefined();
    const merge = aggregate.steps.find((step: { run?: string }) => step.run?.includes("--merge-reports="));
    const presence = aggregate.steps.find((step: { name: string }) => step.name === "Require both coverage reports");
    for (const shard of [1, 2]) expect(presence.run).toContain(`test -s .vitest-ci/coverage-${shard}.json`);
    expect(aggregate.steps.indexOf(presence)).toBeLessThan(aggregate.steps.indexOf(merge));
    expect(presence["continue-on-error"]).toBeUndefined();
    expect(merge.run).toContain("npm run test:coverage -- --merge-reports=.vitest-ci --reporter=default");
    expect(merge.run).not.toContain("--config");
    expect(merge["continue-on-error"]).toBeUndefined();
    expect(workflow.jobs["pr-required"].needs).toContain("coverage");
  });
});

describe("CI cache safety", () => {
  it("supports job reruns without artifact collisions or losing prior diagnostics", () => {
    const parsed = createRequire(import.meta.url)("js-yaml").load(workflow);
    let uploads = 0;
    for (const [jobId, job] of Object.entries(parsed.jobs)) {
      for (const step of (job as { steps?: Array<{ uses?: string; with?: Record<string, unknown> }> }).steps ?? []) {
        if (!step.uses?.startsWith("actions/upload-artifact@")) continue;
        uploads += 1;
        const inputs = step.with!;
        if (!/(?:diagnostics|timings)-/.test(String(inputs.name))) {
          // Keep download contracts stable for downstream jobs and operator
          // tools such as adopt-visual-baselines, including failed-job reruns.
          expect(inputs.overwrite, jobId).toBe(true);
          expect(inputs.name, jobId).not.toContain("github.run_attempt");
        } else {
          // Diagnostic/timing reports retain each attempt's proof.
          expect(inputs.name, jobId).toContain("${{ github.run_attempt }}");
          expect(inputs.overwrite, jobId).not.toBe(true);
        }
      }
    }
    expect(uploads).toBeGreaterThan(0);
  });

  it("preserves successful production shard reports for measured rebalancing", () => {
    const timingStep = sourceSegment(workflow, "name: Preserve production shard timings", "  ui-advisory:");
    expect(timingStep).toContain("if: always()");
    expect(timingStep).toContain("production-ui-timings-${{ github.run_id }}-${{ matrix.shard }}");
    expect(timingStep).toContain("path: test-results/playwright-results.json");
    expect(timingStep).toContain("retention-days: 7");
  });
  it("does not add a PR workflow that changes user-owned auto-merge state", () => {
    expect(existsSync(new URL("../.github/workflows/keep-pr-auto-merge.yml", import.meta.url))).toBe(false);
  });

  it("carries only ESLint and tsc incremental caches into static-pr, keyed so rule code cannot go stale", () => {
    const staticJob = sourceSegment(workflow, "\n  static-pr:\n", "\n  safety:\n");
    const restore = sourceSegment(
      staticJob,
      "name: Restore incremental lint and typecheck caches",
      "- name: Runtime alignment",
    );
    expect(restore).toContain("node_modules/.cache/eslint");
    expect(restore).toContain("${{ steps.static-cache.outputs.tsc }}");
    // Never the gate-receipt store (node_modules/.cache/database-gate-receipts.json) or the
    // whole .cache directory: a restored receipt could let a gate skip itself.
    expect(restore).not.toMatch(/node_modules\/\.cache\s*$/m);
    expect(restore).not.toContain("gate-receipts");
    for (const input of ["eslint.config.mjs", "eslint-rules/**", "package-lock.json", "tsconfig.typecheck.json"]) {
      expect(restore).toContain(`'${input}'`);
    }
    expect(staticJob).toMatch(/\n\s+run: npm run lint -- --concurrency=4\n/);
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts["lint:internal"]).toContain("--cache-strategy content");
  });

  it("builds the shared Playwright app without installing a browser it never launches", () => {
    const producer = /\n  ui-playwright-build:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    expect(producer).toContain("uses: ./.github/actions/setup-node-cached");
    expect(producer).not.toContain("uses: ./.github/actions/setup-ui-e2e");
    expect(producer).toContain('PLAYWRIGHT_BUILD_ONLY: "true"');
    // Every lane that launches a browser keeps the full UI setup.
    for (const job of ["ui-critical-fast", "ui-critical"]) {
      const segment = new RegExp(`\\n  ${job}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n)`).exec(workflow)?.[1] ?? "";
      expect(segment, job).toContain("uses: ./.github/actions/setup-ui-e2e");
    }
    const runner = readFileSync(new URL("../scripts/run-playwright.mjs", import.meta.url), "utf8");
    expect(runner).toMatch(
      /process\.env\.PLAYWRIGHT_BUILD_ONLY\?\.trim\(\) === "true"\s*\?\s*\{ checked: \[\] \}\s*:\s*assertPlaywrightBrowsersReady\(playwrightArgs\);/,
    );
  });

  it("never lets a later main push cancel the secret scan of an earlier merged commit", () => {
    const secretScan = readFileSync(new URL("../.github/workflows/secret-scan.yml", import.meta.url), "utf8");
    expect(secretScan).toContain(
      "group: ${{ github.workflow }}-${{ github.event_name == 'push' && github.run_id || github.ref }}",
    );
    expect(secretScan).toContain("cancel-in-progress: ${{ github.event_name != 'push' }}");
  });

  it("skips Next's post-build type pass only for CI's isolated offline builds", () => {
    const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(nextConfig).toContain(
      'Boolean(requestedTsConfigPath) && process.env.PLAYWRIGHT_OFFLINE_MODE === "true" && process.env.CI === "true"',
    );
    expect(nextConfig).toContain("...(skipIsolatedCiTypecheck ? { ignoreBuildErrors: true } : {})");
    expect(nextConfig.match(/ignoreBuildErrors/g)).toHaveLength(1);
    // The type pass it skips is repeated by the required static job, which still runs it.
    const staticJob = sourceSegment(workflow, "\n  static-pr:\n", "\n  safety:\n");
    expect(staticJob).toMatch(/\n\s+run: npm run typecheck\n/);
  });

  it("uses npm's download cache but recreates node_modules on every job", () => {
    expect(nodeSetup).toContain("cache: npm");
    expect(nodeSetup).toContain("run: npm ci --include=dev");
    expect(nodeSetup).not.toContain("path: node_modules");
    expect(nodeSetup).not.toContain("cache-hit");
  });

  it("keys the npm download cache apart from setup-node's automatic package-manager cache", () => {
    // package.json declares "packageManager", so every bare actions/setup-node step (for
    // example CI's Change scope job) also saves ~/.npm under node-cache-…-npm-<lock hash>
    // without ever running npm ci. Change scope finishes first, so that key held an empty
    // 686-byte entry, and a primary-key hit is never re-saved. Hashing .nvmrc as well gives
    // this action a key only a job that has just run npm ci can write.
    expect(nodeSetup).toMatch(/cache-dependency-path: \|\n\s+package-lock\.json\n\s+\.nvmrc\n/);
    const installStep = nodeSetup.indexOf("run: npm ci --include=dev");
    expect(installStep).toBeGreaterThan(nodeSetup.indexOf("cache: npm"));
  });

  it("keeps quarantined and mockup UI specs in one advisory lane", () => {
    expect(workflow).toContain("ui-advisory:");
    expect(workflow).toContain("uses: ./.github/actions/setup-ui-e2e");
    expect(workflow).toContain("run: npm run test:e2e:advisory");
    expect(workflow).not.toContain("ui-quarantine:");
    expect(workflow).not.toContain("ui-mockups:");
  });

  it("keeps the critical fail-fast subset disjoint from required PR shards", () => {
    expect(workflow).toContain("npm run test:e2e:critical");
    expect(workflow).toContain("--exclude-critical");
    expect(prShardRunner).toContain('"@critical|@quarantine|@mockup"');
    expect(prShardRunner).toContain('"@quarantine|@mockup"');
  });

  it("starts the critical subset and required shards concurrently after the shared Next build", () => {
    // Both lanes wait on ui-playwright-build, then fan out together — they must not
    // serialize on each other (critical must not need the shard job or vice versa).
    const uiJob = /\n  ui-critical:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    const uiFast = /\n  ui-critical-fast:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    expect(uiJob).toContain("needs: [changes, static-pr, ui-playwright-build]");
    expect(uiFast).toContain("needs: [changes, static-pr, ui-playwright-build]");
    expect(uiJob).not.toContain("ui-critical-fast");
    expect(uiFast).not.toContain("ui-critical:");
  });

  it("skips the browser lanes when static-pr fails, instead of running them on a head that must be re-pushed", () => {
    // static-pr and the Playwright build finish within seconds of each other on hosted runs,
    // so waiting on static-pr costs a green run nothing and saves ~30 runner-minutes on a red
    // one. Both browser lanes must carry it, or a static failure still books that lane.
    for (const lane of ["ui-critical", "ui-critical-fast"]) {
      const job = new RegExp(`\\n  ${lane}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n)`).exec(workflow)?.[1] ?? "";
      expect(job, lane).toContain("needs: [changes, static-pr, ui-playwright-build]");
    }
    // The producer must NOT wait on static-pr: that would serialise the build behind it and
    // add ~5 minutes to every green UI run.
    const producer = /\n  ui-playwright-build:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    expect(producer).toMatch(/\n    needs: changes\n/);
  });

  it("routes the blocking ingestion scan through the required aggregate", () => {
    expect(workflow).toMatch(/^  merge_group:\s*$/m);
    expect(workflow).toContain("ingestion_sast_changed: ${{ steps.scope.outputs.ingestion_sast_changed }}");
    expect(workflow).toMatch(/ingestion-sast:\n[\s\S]*?needs: changes/);
    expect(workflow).toContain("needs.changes.outputs.ingestion_sast_changed == 'true'");
    expect(workflow).toContain('if [ "$status" -ne 2 ] || [ "$attempt" -eq 3 ]');
    expect(workflow).toContain('exit "$status"');
    const requiredNeeds = /\n  pr-required:\n[\s\S]*?needs:\s*\n?\s*\[([\s\S]*?)\]/.exec(workflow)?.[1] ?? "";
    expect(requiredNeeds).toContain("ingestion-sast");
  });

  it("does not transport the cross-job Next cache after hosted evidence showed a net loss", () => {
    expect(workflow).not.toContain("playwright-next-build-cache-");
    expect(workflow).not.toContain("Publish isolated Next.js build cache");
    expect(workflow).not.toContain("Restore isolated Next.js build cache");
  });

  it("checks out full history on Safety so privacy reviewedCommit is in the object graph", () => {
    const safety = sourceSegment(workflow, "name: Safety and config checks", "name: Unit coverage");
    expect(safety).toContain("fetch-depth: 0");
  });

  it("installs Playwright system dependencies when browser caches hit", () => {
    expect(uiSetup).toMatch(/cache-hit.*?install-deps chromium.*?install chromium/s);
    expect(lighthouseChromiumSetup).toMatch(/cache-hit.*?install-deps chromium.*?install chromium/s);
    expect(workflow).toMatch(
      /cache-hit.*?install-deps "\$BROWSER_ENGINE"\n\s+npx playwright install "\$BROWSER_ENGINE"/s,
    );
  });

  it("hardens Playwright browser and dependency installation against flaky Ubuntu mirrors and apt hangs", () => {
    expect(lighthouseChromiumSetup).toContain("azure\\.archive\\.ubuntu\\.com/archive.ubuntu.com");
    expect(lighthouseChromiumSetup).toContain("timeout 180");
    expect(lighthouseChromiumSetup).toContain("Acquire::Retries");
    expect(uiSetup).toContain("azure\\.archive\\.ubuntu\\.com/archive.ubuntu.com");
    expect(uiSetup).toContain("timeout 180");
    expect(uiSetup).toContain("Acquire::Retries");
    expect(workflow).toContain("azure\\.archive\\.ubuntu\\.com/archive.ubuntu.com");
    expect(workflow).toContain("timeout 180");
    expect(workflow).toContain("Acquire::Retries");
  });

  it("rejects a refreshed Lighthouse baseline that has zero or mixed browser identities", () => {
    // Shared validator owns the single-Chrome-identity gate; keep the weaker
    // ad-hoc inline node -e check out of ci.yml so refresh and grade use one path.
    expect(workflow).toContain("node scripts/check-lighthouse-budget.mjs --validate-baseline");
    expect(workflow).not.toContain("versions.length!==1");
    expect(workflow).not.toContain("Expected exactly one baseline Chrome version");
  });

  it("exports the pinned browser through both Lighthouse environment contracts", () => {
    expect(lighthouseChromiumSetup).toContain("CHROME_PATH=$chromium_path");
    expect(lighthouseChromiumSetup).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$chromium_path");
  });

  it("caps the dispatch-only live Lighthouse matrix and each child process", () => {
    expect(liveWebVitalsWorkflow).toContain("timeout-minutes: 45");
    expect(liveWebVitalsWorkflow).toContain("node scripts/live-web-vitals-inputs.mjs");
    expect(liveWebVitalsWorkflow).toContain('timeout --signal=TERM --kill-after=10s "${run_timeout}s"');
    expect(liveWebVitalsWorkflow).toContain("LIVE_WEB_VITALS_PROCESS_TIMEOUT_SEC");
    expect(liveWebVitalsWorkflow).toContain("LIVE_WEB_VITALS_MEASUREMENT_SUITE_SECONDS");
  });

  it("routes recognised workflow-only changes through focused contracts", () => {
    expect(workflow).toContain("static_heavy_changed: ${{ steps.scope.outputs.static_heavy_changed }}");
    expect(workflow).toContain("workflow_changed: ${{ steps.scope.outputs.workflow_changed }}");
    expect(workflow).toContain("if: needs.changes.outputs.static_heavy_changed == 'true'");
    expect(workflow).toContain("run: npm run test:ci-workflows");
    expect(workflow).toContain("run: npm run check:verification-plan");
  });

  /**
   * `verify:pr-local` is documented as the risk-routed PR mirror, yet until audit M24
   * its heavy plan selected only lint/typecheck/test: the migration-role,
   * function-grant and owner-scope guards — the three built to stop the incident
   * shapes that reach the live clinical database on merge — ran only in CI after
   * push. Pin the mirror the other way round from `check:gate-manifest` (which
   * holds CI to the local verify:cheap chain): every static-pr step gated on
   * `static_heavy_changed` must also be in the local heavy plan.
   */
  it("mirrors every static-heavy static-pr step in the verify:pr-local heavy plan (M24)", () => {
    const staticPr = /\n  static-pr:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    expect(staticPr, "static-pr job not found in ci.yml").not.toBe("");
    const heavySteps: string[] = [];
    for (const step of staticPr.split(/\n\s+- name: /).slice(1)) {
      const condition = /\n\s+if: ([^\n]+)/.exec(step)?.[1] ?? "";
      const script = /\n\s+run: npm run ([\w:.-]+)\s*$/m.exec(step)?.[1];
      if (script && condition.includes("static_heavy_changed == 'true'")) heavySteps.push(script);
    }
    expect(heavySteps).toEqual(
      expect.arrayContaining(["check:migration-role", "check:function-grants", "check:owner-scope"]),
    );

    const heavyPlan = selectedScripts({ static_heavy_changed: true }, false) as string[];
    const missing = heavySteps.filter((script) => !heavyPlan.includes(script));
    expect(
      missing,
      `static-pr runs these for static_heavy scope but verify:pr-local does not: ${missing.join(", ")}`,
    ).toEqual([]);

    // Docs-only scope stays focused: the tenancy/database guards are heavy-scope steps.
    const docsPlan = selectedScripts({ docs_changed: true }, false) as string[];
    for (const guard of ["check:migration-role", "check:function-grants", "check:owner-scope"]) {
      expect(docsPlan, `${guard} leaked into the docs-only plan`).not.toContain(guard);
    }
  });

  it("runs the generated medication lexicon freshness check through static-heavy scope", () => {
    expect(workflow).toMatch(
      /name: Medication lexicon report freshness\n\s+if: needs\.changes\.outputs\.static_heavy_changed == 'true'\n\s+run: npm run check:medication-lexicon-report/,
    );
  });

  // The interaction index is the artefact the UI reads to decide whether a drug can be
  // shown as clear. Its freshness gate was local-only until audit M30, so a snapshot-only
  // merge through the bare-PR route shipped a stale index with every check green.
  it("runs the medication interaction index drift check through static-heavy scope (M30)", () => {
    expect(workflow).toMatch(
      /name: Medication interaction index drift\n\s+if: needs\.changes\.outputs\.static_heavy_changed == 'true'\n\s+run: npm run check:medication-interactions/,
    );
  });

  // Until 2026-09-16 this step compared only the top-level schema_sha256 field
  // between the committed manifest and a fresh regeneration. An agent could
  // hand-set that hash while leaving a stale nested snapshot.functions[].def_hash,
  // pass this check, and only have live-drift (post-merge) catch the real
  // divergence red on main. The replacement deep-compares the whole manifest
  // (except the two fields expected to change every run) through a dedicated,
  // unit-tested script rather than a narrow inline field comparison.
  it("deep-compares the whole drift manifest for freshness, not just schema_sha256", () => {
    const migrationReplayJob = /\n  db-reset-verify:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    const freshnessStep =
      /- name: Regenerate and verify drift manifest freshness\n([\s\S]*?)(?=\n {6}- name: )/.exec(
        migrationReplayJob,
      )?.[1] ?? "";
    expect(freshnessStep, "drift manifest freshness step not found in db-reset-verify").not.toBe("");
    expect(freshnessStep).toContain("npm run drift:manifest");
    expect(freshnessStep).toContain("npm run check:drift-manifest-freshness --");
    expect(freshnessStep).toContain("--committed /tmp/committed-drift-manifest.json");
    expect(freshnessStep).toContain("--generated supabase/drift-manifest.json");
    // The narrow single-field compare this replaced must not come back.
    expect(freshnessStep).not.toContain("schema_sha256 !== generated.schema_sha256");

    // The artifact upload stays unchanged so a stale manifest can still be
    // downloaded and committed from the failed job.
    expect(migrationReplayJob).toContain("name: Upload regenerated drift manifest");
    expect(migrationReplayJob).toContain("name: drift-manifest-${{ github.run_id }}");
    expect(migrationReplayJob).toContain("path: supabase/drift-manifest.json");
  });

  // The hazard register validator ran only in the provider-backed governance:release chain
  // until audit M33; it needs the full-history checkout for its reviewedCommit checks.
  it("runs the clinical hazard-controls register check in static-pr with full history (M33)", () => {
    const staticPr = /\n  static-pr:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
    expect(staticPr).toContain("fetch-depth: 0");
    expect(staticPr).toMatch(
      /name: Clinical hazard-controls register\n\s+if: needs\.changes\.outputs\.docs_changed == 'true' \|\| needs\.changes\.outputs\.static_heavy_changed == 'true'\n\s+run: npm run check:clinical-hazard-controls/,
    );
  });

  it("does not repeat focused workflow contracts inside the full coverage run", () => {
    expect(workflow).toContain(
      "if: needs.changes.outputs.workflow_changed == 'true' && needs.changes.outputs.coverage_changed != 'true'",
    );
  });

  it("keeps every workflow-reading unit contract in the focused suite", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const focusedScript = packageJson.scripts["test:ci-workflows"] ?? "";
    const testsDirectory = new URL("./", import.meta.url);
    const readers: string[] = [];
    for (const name of readdirSync(testsDirectory).filter((entry) => entry.endsWith(".test.ts"))) {
      const text = readFileSync(new URL(name, testsDirectory), "utf8");
      // Only count suites that load a committed workflow file — not incidental
      // string mentions such as mock run paths in sync helpers.
      const loadsWorkflow =
        /new URL\(\s*["']\.\.\/\.github\/workflows\//.test(text) ||
        /read(?:FileSync)?\(\s*["']\.github\/workflows\//.test(text) ||
        /path\.resolve\(\s*["']\.github\/workflows\//.test(text) ||
        (/\.github["']\s*,\s*["']workflows["']/.test(text) && /readFileSync\(/.test(text));
      if (!loadsWorkflow) continue;
      readers.push(`tests/${name}`);
    }
    const missing = readers.filter((file) => !focusedScript.includes(file));
    expect(missing, `add workflow-reading suites to test:ci-workflows: ${missing.join(", ")}`).toEqual([]);
  });

  it("runs ledger integrity checks when docs or heavy static scope changes", () => {
    expect(workflow).toContain(
      "if: needs.changes.outputs.docs_changed == 'true' || needs.changes.outputs.static_heavy_changed == 'true'",
    );
    expect(workflow).toMatch(
      /name: Branch review ledger integrity\n\s+(?:#[^\n]*\n\s+)*if: needs\.changes\.outputs\.docs_changed == 'true' \|\| needs\.changes\.outputs\.static_heavy_changed == 'true'/,
    );
    expect(workflow).toMatch(
      /name: Outstanding-issues ledger integrity\n\s+if: needs\.changes\.outputs\.docs_changed == 'true' \|\| needs\.changes\.outputs\.static_heavy_changed == 'true'/,
    );
  });

  it("forwards stale eval-canary status into the Ops Digest alert path", () => {
    expect(opsDigestWorkflow).toContain("id: liveness");
    expect(opsDigestWorkflow).toContain('core.setOutput("stale"');
    expect(opsDigestWorkflow).toContain("needs: eval-canary-liveness");
    expect(opsDigestWorkflow).toContain("EVAL_CANARY_STALE");
    expect(opsDigestWorkflow).toContain("canaryStale");
  });

  it("avoids unrelated network and checkout work on ordinary pull requests", () => {
    expect(workflow).not.toContain("Dependency audit (advisory)");
    expect(workflow).not.toContain("github.rest.actions.listWorkflowRuns");
    expect(opsDigestWorkflow).toContain("eval-canary-liveness:");
    expect(opsDigestWorkflow).toContain("github.rest.actions.listWorkflowRuns");
    expect(workflow).toContain(
      "if: github.event_name == 'pull_request' && needs.changes.outputs.pr_policy_body_changed == 'true'",
    );
  });

  it("checks formatting only on the changed range in pull-request CI", () => {
    expect(workflow).toContain("name: Changed-file format check");
    expect(workflow).toContain("if: github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'");
    expect(workflow).toContain("run: npm run format:changed");
    expect(workflow).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha");
    expect(workflow).toMatch(
      /name: Scheduled full-tree format drift\s+if: github\.event_name == 'schedule' \|\| \(github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.refresh_lighthouse_baseline != 'true'\)\s+run: npm run format:check/,
    );
  });

  it("keeps a Lighthouse baseline refresh focused on measurement contracts", () => {
    expect(workflow).toContain(
      "node scripts/ci-change-scope.mjs --files .github/actions/setup-lighthouse-chromium/action.yml",
    );
    expect(workflow).toContain(
      "(github.event_name == 'workflow_dispatch' && github.event.inputs.refresh_lighthouse_baseline != 'true')",
    );
  });

  it("lets the release Playwright wrapper own its build and skips proven production Chromium", () => {
    const releaseJob = sourceFrom(workflow, "  release-browser-matrix:", {
      label: "release-browser-matrix job definition",
    });
    expect(releaseJob).not.toContain("path: .next/cache");
    expect(releaseJob).not.toContain("run: npm run build");
    expect(releaseJob).toContain("npm run test:e2e");

    // Until 2026-09-07 this pinned the single-job command
    // `npm run test:e2e -- --project=chromium-mockups --project=firefox --project=webkit`.
    // That job stopped finishing — 70m23s and 70m20s on two consecutive main
    // runs, both exactly on the old 70-minute cap — so the engines now run as
    // sibling matrix jobs and the flags are assembled per engine in the step.
    // The property this case still owns is the one it always owned: the primary
    // path does not re-run production Chromium that ui-critical already proved.
    // Full engine/project coverage is proven in
    // tests/ci-browser-matrix-coverage.test.ts, which fails closed when a
    // playwright.config.ts project is not assigned to an engine.
    expect(releaseJob).toContain('chromium) PROJECTS="--project=chromium-mockups"');
    expect(releaseJob).toContain('firefox)  PROJECTS="--project=firefox"');
    expect(releaseJob).toContain('webkit)   PROJECTS="--project=$BROWSER_PROJECT"');
  });

  it("scopes the main-branch release backstop to UI, performance, or lockfile risk", () => {
    const releaseHeader = sourceSegment(workflow, "  release-browser-matrix:", "    steps:", {
      label: "release-browser-matrix job header",
    });
    expect(releaseHeader).toContain("github.ref == 'refs/heads/main'");
    expect(releaseHeader).toContain("needs.changes.outputs.ui_changed == 'true'");
    expect(releaseHeader).toContain("needs.changes.outputs.perf_changed == 'true'");
    expect(releaseHeader).toContain("needs.changes.outputs.lockfile_changed == 'true'");
    expect(releaseHeader).toContain("startsWith(github.ref, 'refs/heads/release/')");
  });

  /*
   * Base-branch pushes must never be cancelled by a later merge.
   *
   * `cancel-in-progress: true` is correct for a PR branch, where a newer head genuinely
   * supersedes the work in flight. It is wrong for `main`: that commit is already merged and
   * nothing supersedes it, so cancelling does not skip redundant work — it throws away the only
   * verification `main` receives. Measured 2026-08-18 across the last 30 pushes to main, 23 were
   * cancelled (77%) and only 6 completed, which is how a ~163ms Lighthouse drift on
   * desktop /therapy-compass and two broken @mockup assertions both reached feature branches as
   * first detection, and why ci-triage kept reporting a cancelled main run as its baseline.
   *
   * A blanket `true` here reads as a harmless cost control and is not one, so it is pinned with
   * its own case rather than left to review.
   */
  it("never cancels an in-flight run for a base-branch push", () => {
    const concurrency = sourceSegment(workflow, "concurrency:", "permissions:", {
      label: "workflow concurrency block",
    });

    expect(concurrency).toContain("cancel-in-progress: ${{ github.event_name != 'push' }}");
    expect(concurrency).not.toContain("cancel-in-progress: true");

    // `cancel-in-progress: false` is necessary and NOT sufficient. GitHub keeps at most one
    // PENDING run per concurrency group, so a queued main run is cancelled the moment a newer
    // merge queues behind the same group — no supersession involved, and the exemption above
    // never sees it. Observed 2026-08-20: four consecutive main pushes cancelled while a
    // ~70-minute release-browser-matrix held `CI-refs/heads/main`. A per-run group for pushes
    // is the part that actually keeps every merged commit verified.
    expect(concurrency).toContain("github.event_name == 'push'");
    expect(
      concurrency,
      "base-branch pushes must key concurrency on github.run_id, or a later merge evicts the pending run",
    ).toMatch(/group:.*github\.event_name == 'push'.*github\.run_id/s);

    // `on.push.branches` is what makes `event_name == 'push'` mean "base branch" — if a push
    // trigger is ever widened to feature branches, this exemption silently stops being scoped
    // and every branch keeps its superseded runs alive.
    const pushTrigger = sourceSegment(workflow, "  push:", "  pull_request:", {
      label: "workflow push trigger",
    });
    expect(pushTrigger).toContain('branches: [main, "release/**"]');
  });

  it("guards against in-flight CI cancellation churn during PR branch sync (#TF6TPJ)", async () => {
    const { classifyPr, hasRequiredCiInFlight } = await import("../scripts/sync-pr-branches.mjs");
    expect(hasRequiredCiInFlight({ workflow_runs: [{ name: "CI", status: "in_progress" }] })).toBe(true);
    expect(hasRequiredCiInFlight({ workflow_runs: [{ name: "CI", status: "queued" }] })).toBe(true);
    expect(hasRequiredCiInFlight({ workflow_runs: [{ name: "CI", status: "pending" }] })).toBe(true);
    expect(hasRequiredCiInFlight({ workflow_runs: [{ name: "CI", status: "completed" }] })).toBe(false);
    expect(classifyPr({ title: "feature", labels: [], requiredCiInFlight: true }, 5)).toEqual({
      action: "skip",
      reason: "required-ci-in-flight",
    });
  });

  it("guards PR branches against in-flight CI cancellation during push (#HSSHRG)", async () => {
    const { inFlightCiVerdict, findInFlightCiRuns } = await import("../scripts/guard-push.mjs");
    const activeRuns = [{ name: "CI", status: "in_progress", conclusion: null }];
    expect(findInFlightCiRuns(activeRuns)).toHaveLength(1);
    expect(inFlightCiVerdict("claude/my-branch", { state: "OPEN", number: 99 }, activeRuns)).toEqual({
      block: true,
      reason: "required-ci-in-flight",
      number: 99,
      runs: activeRuns,
    });
    const prePushHook = readFileSync(new URL("../.githooks/pre-push", import.meta.url), "utf8");
    expect(prePushHook).toContain("SKIP_IN_FLIGHT_CI_GUARD=1");
  });
});

/*
 * #095: `cancel-in-progress` supersedes an in-flight run on every push, and the aggregate's
 * `require_*` helpers lumped the resulting `cancelled` in with a genuine `failure`. One
 * 2026-07-30 session burned four separate investigations on `::error::changes result was
 * cancelled` before recognising it, while a docs-only PR merged straight through a red the
 * repo had learned to ignore. Both halves of the contract matter and pull against each other:
 * a cancelled run must stay RED (it verified nothing, and a skipped required check counts as
 * PASSING on GitHub, so skipping the aggregate would make a hand-cancelled run mergeable),
 * while its message must be unmistakably distinct from a real failure.
 *
 * These cases execute the aggregate's real shell rather than grepping the YAML for strings,
 * because the defect was in the script's behaviour and a structural assertion would have
 * passed against it (see #094 on gates asserting structure over rendered effect).
 */
describe.skipIf(process.platform === "win32")("PR required aggregate — cancelled vs failed (#095)", () => {
  const script = (() => {
    const lines = workflow.split("\n");
    const stepIndex = lines.findIndex((line) => line.includes("name: Verify required in-scope jobs"));
    const runIndex = lines.findIndex((line, index) => index > stepIndex && /^\s+run: \|\s*$/.test(line));
    const runIndent = lines[runIndex].search(/\S/);
    const body: string[] = [];
    for (let index = runIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && line.search(/\S/) <= runIndent) break;
      body.push(line);
    }
    const bodyIndent = body.find((line) => line.trim())?.search(/\S/) ?? 0;
    return body.map((line) => line.slice(bodyIndent)).join("\n");
  })();

  const allGreen = {
    STATIC_HEAVY_CHANGED: "false",
    COVERAGE_CHANGED: "false",
    INGESTION_SAST_CHANGED: "false",
    UI_CHANGED: "false",
    DB_CHANGED: "false",
    BUILD_CHANGED: "false",
    PERF_CHANGED: "false",
    /*
     * Read only by the draft report at the end of the script, which decides whether
     * `lighthouse-budget` belongs in the list of jobs a draft did not run. Added to `ci.yml` and
     * to this fixture in one commit, because the script runs under `set -u` and an unbound
     * variable exits 1.
     *
     * When that red appears, fix it HERE, by binding the new variable in this fixture - not in
     * `ci.yml` by defaulting the read to `${VAR:-false}`. In the real workflow these variables
     * are always bound, by the step `env:` block, so `set -u` firing means that binding is
     * genuinely missing and the step should stop loudly. A default turns that into silence: the
     * warning would simply stop naming `lighthouse-budget`, with nothing red to say so - which
     * is the same "absence read as coverage" defect this draft report was added to close.
     * `runAggregate` spreads `allGreen` before any override, so every case in this block
     * inherits these bindings and no test can construct an env without them.
     *
     * `"false"` is faithful to this fixture: a light, non-draft scope carrying no labels.
     */
    LIGHTHOUSE_LABEL: "false",
    SKIP_LIGHTHOUSE_LABEL: "false",
    REFRESH_LIGHTHOUSE_BASELINE: "false",
    CONTAINER_CHANGED: "false",
    PR_DRAFT: "false",
    EVENT_NAME: "pull_request",
    CHANGES_RESULT: "success",
    STATIC_RESULT: "success",
    // Recognised documentation/workflow-only scopes skip the heavy safety job.
    SAFETY_RESULT: "skipped",
    COVERAGE_RESULT: "skipped",
    INGESTION_SAST_RESULT: "skipped",
    BUILD_RESULT: "skipped",
    CONTAINER_RESULT: "skipped",
    // Critical-first UI job (this PR); skipped when ui_changed is false.
    // Shared Playwright Next build producer — same UI_CHANGED gate; bind with the consumers.
    UI_BUILD_RESULT: "skipped",
    UI_FAST_RESULT: "skipped",
    UI_RESULT: "skipped",
    LIGHTHOUSE_RESULT: "skipped",
    DB_RESULT: "skipped",
    // Main tree proof outputs: empty on every event except a proven main push. Bound here for
    // the same `set -u` reason as the Lighthouse labels above.
    TREE_PROVEN_COVERAGE: "",
    TREE_PROVEN_UI: "",
    TREE_PROVEN_LIGHTHOUSE: "",
  };

  function runAggregate(overrides: Record<string, string> = {}) {
    const variables = { ...allGreen, ...overrides };
    const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
    const assignments = Object.entries(variables)
      .map(([name, value]) => `${name}=${shellQuote(value)}`)
      .join("\n");

    // Feed the workflow body over stdin instead of a `bash -c` command-line
    // argument. MSYS bash on Windows reparses backticks in that argument before
    // preserving the embedded newlines, so explanatory shell comments can be
    // executed as command substitutions and make this contract false-green. The
    // fixed test variables are prepended as assignments because WSL bash does not
    // inherit arbitrary Windows environment variables unless WSLENV names them.
    const result = spawnSync("bash", [], {
      env: process.env,
      encoding: "utf8",
      input: `${assignments}\n${script}`,
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  }

  it("extracted the real aggregate script, not an empty string", () => {
    // Without this the whole describe would vacuously pass on a YAML restructure.
    expect(script).toContain("require_success");
    expect(script).toContain("Required in-scope PR checks passed.");
  });

  it("passes when every in-scope job succeeded", () => {
    expect(runAggregate().status).toBe(0);
  });

  it("accepts a main-push skip only for jobs the merged PR proved on the identical tree", () => {
    const heavyMainPush = {
      EVENT_NAME: "push",
      COVERAGE_CHANGED: "true",
      UI_CHANGED: "true",
      PERF_CHANGED: "true",
      UI_BUILD_RESULT: "success",
      UI_FAST_RESULT: "skipped",
      COVERAGE_RESULT: "skipped",
      UI_RESULT: "skipped",
      LIGHTHOUSE_RESULT: "skipped",
    };
    const proven = runAggregate({
      ...heavyMainPush,
      TREE_PROVEN_COVERAGE: "true",
      TREE_PROVEN_UI: "true",
      TREE_PROVEN_LIGHTHOUSE: "true",
    });
    expect(proven.status).toBe(0);
    expect(proven.output).toContain("Proven on the identical tree");
    expect(proven.output).toContain("coverage production-ui lighthouse-budget");

    // Without proof the same skips stay red - one group at a time, so no proof leaks across jobs.
    expect(runAggregate(heavyMainPush).status).not.toBe(0);
    expect(runAggregate({ ...heavyMainPush, TREE_PROVEN_UI: "true", TREE_PROVEN_LIGHTHOUSE: "true" }).output).toContain(
      "coverage result was skipped",
    );
    expect(
      runAggregate({ ...heavyMainPush, TREE_PROVEN_COVERAGE: "true", TREE_PROVEN_LIGHTHOUSE: "true" }).status,
    ).not.toBe(0);
    expect(runAggregate({ ...heavyMainPush, TREE_PROVEN_COVERAGE: "true", TREE_PROVEN_UI: "true" }).status).not.toBe(0);

    // Proof never excuses a failure: a proven job that somehow ran and failed is still red.
    expect(
      runAggregate({
        ...heavyMainPush,
        TREE_PROVEN_COVERAGE: "true",
        TREE_PROVEN_UI: "true",
        TREE_PROVEN_LIGHTHOUSE: "true",
        UI_RESULT: "failure",
      }).status,
    ).not.toBe(0);
    // The shared Next build is never proof-skipped, so it stays required.
    expect(
      runAggregate({
        ...heavyMainPush,
        TREE_PROVEN_COVERAGE: "true",
        TREE_PROVEN_UI: "true",
        TREE_PROVEN_LIGHTHOUSE: "true",
        UI_BUILD_RESULT: "skipped",
      }).status,
    ).not.toBe(0);
  });

  it("requires safety for heavy scope and accepts a skip only for recognised light scope", () => {
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "true", SAFETY_RESULT: "success" }).status).toBe(0);
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "true", SAFETY_RESULT: "skipped" }).status).not.toBe(0);
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "false", SAFETY_RESULT: "skipped" }).status).toBe(0);
  });

  it("skips heavy jobs on a draft PR instead of reporting them as a failed skip", () => {
    // Without PR_DRAFT, a heavy-scope draft push would call require_success on a job the
    // job's own `if:` intentionally skipped, turning "draft, don't book a runner" into a
    // false-red required check. PR_DRAFT folds draft into the same in-scope check as the
    // *_CHANGED flags so the aggregate reads it as skipped-and-fine instead.
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "true", PR_DRAFT: "true", SAFETY_RESULT: "skipped" }).status).toBe(0);
    expect(runAggregate({ COVERAGE_CHANGED: "true", PR_DRAFT: "true", COVERAGE_RESULT: "skipped" }).status).toBe(0);
    expect(runAggregate({ BUILD_CHANGED: "true", PR_DRAFT: "true", BUILD_RESULT: "skipped" }).status).toBe(0);
    expect(
      runAggregate({
        UI_CHANGED: "true",
        UI_BUILD_RESULT: "skipped",
        PR_DRAFT: "true",
        UI_FAST_RESULT: "skipped",
        UI_RESULT: "skipped",
      }).status,
    ).toBe(0);
    expect(runAggregate({ DB_CHANGED: "true", PR_DRAFT: "true", DB_RESULT: "skipped" }).status).toBe(0);
  });

  it("names lighthouse-budget among draft-suppressed jobs when perf scope is in play", () => {
    // The draft warning must list Lighthouse when PERF_CHANGED is true; previously the
    // warning never received PERF_CHANGED and silently omitted that required job.
    const draftPerf = runAggregate({
      PERF_CHANGED: "true",
      PR_DRAFT: "true",
      LIGHTHOUSE_RESULT: "skipped",
    });
    expect(draftPerf.status).toBe(0);
    expect(draftPerf.output).toMatch(/lighthouse-budget/);
    expect(draftPerf.output).toMatch(/Draft PR/);
  });

  it("does not name lighthouse-budget when a label ran it, or skipped it for another reason", () => {
    // The other half of the same defect, pointing the opposite way. Naming a job that actually
    // ran is a false alarm, and a warning that is sometimes wrong stops being read at all -
    // which costs exactly what the warning was added to buy. `lighthouse-budget`'s own `if:` is
    // decided by labels as well as scope, so the report has to read them too.
    const labelled = runAggregate({
      PR_DRAFT: "true",
      PERF_CHANGED: "true",
      LIGHTHOUSE_LABEL: "true",
      // The label runs the job on a draft anyway, so it reports success - not the fixture
      // default of `skipped`, which would describe a state this case cannot be in.
      LIGHTHOUSE_RESULT: "success",
    });
    expect(labelled.status).toBe(0);
    expect(labelled.output).not.toContain("lighthouse-budget");

    // `skip-lighthouse-budget` skips it for a reason that is not the draft.
    const skipped = runAggregate({
      PR_DRAFT: "true",
      PERF_CHANGED: "true",
      SKIP_LIGHTHOUSE_LABEL: "true",
      LIGHTHOUSE_RESULT: "skipped",
    });
    expect(skipped.status).toBe(0);
    expect(skipped.output).not.toContain("lighthouse-budget");

    // A draft with nothing heavy in scope stays silent, and does not exit under `set -u`.
    const lightDraft = runAggregate({ PR_DRAFT: "true" });
    expect(lightDraft.status).toBe(0);
    expect(lightDraft.output).not.toContain("heavy scope did not run");
  });

  it("accepts lighthouse-budget skip during baseline-refresh dispatch", () => {
    // refresh_lighthouse_baseline forces PERF_CHANGED=true in classify while the
    // lighthouse-budget job itself skips; requiring success would false-red every
    // dedicated refresh run even when lighthouse-baseline-refresh succeeded.
    expect(
      runAggregate({
        PERF_CHANGED: "true",
        REFRESH_LIGHTHOUSE_BASELINE: "true",
        EVENT_NAME: "workflow_dispatch",
        LIGHTHOUSE_RESULT: "skipped",
      }).status,
    ).toBe(0);
    expect(
      runAggregate({
        PERF_CHANGED: "true",
        REFRESH_LIGHTHOUSE_BASELINE: "false",
        LIGHTHOUSE_RESULT: "skipped",
      }).status,
    ).not.toBe(0);
  });

  it("still requires heavy jobs on a ready-for-review PR even though it once was a draft", () => {
    // PR_DRAFT reflects the *current* event's draft state, not history — `ready_for_review`
    // reruns the whole workflow fresh, so a stale skip must never carry forward.
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "true", PR_DRAFT: "false", SAFETY_RESULT: "skipped" }).status).not.toBe(
      0,
    );
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "true", PR_DRAFT: "false", SAFETY_RESULT: "success" }).status).toBe(0);
  });

  it("requires ingestion SAST only for its path-scoped surface", () => {
    expect(runAggregate({ INGESTION_SAST_CHANGED: "true", INGESTION_SAST_RESULT: "success" }).status).toBe(0);
    expect(runAggregate({ INGESTION_SAST_CHANGED: "true", INGESTION_SAST_RESULT: "skipped" }).status).not.toBe(0);
    expect(runAggregate({ INGESTION_SAST_CHANGED: "false", INGESTION_SAST_RESULT: "skipped" }).status).toBe(0);
  });

  it("reports a superseded run as CANCELLED rather than describing a failure", () => {
    // A supersession cancels the upstream jobs, so this is what a real one looks like.
    const { status, output } = runAggregate({ CHANGES_RESULT: "cancelled", STATIC_RESULT: "cancelled" });
    expect(status).toBe(1);
    expect(output).toContain("CANCELLED with no failing job");
    expect(output).toContain("not a broken change");
    // Names every cancelled job, not just the first one it tripped over.
    expect(output).toContain("changes");
    expect(output).toContain("static-pr");
    // The actionable part: point the reader at the run that does describe the head.
    expect(output).toMatch(/newer .*run/i);
    // Hedged, not asserted — a hand-cancelled run has no newer run to look at.
    expect(output).toContain("Usually");
    expect(output).toContain("cancelled by hand");
  });

  it("labels a single cancelled job distinctly instead of as a plain failure", () => {
    const { status, output } = runAggregate({ CHANGES_RESULT: "cancelled" });
    expect(status).toBe(1);
    expect(output).toContain("CANCELLED with no failing job");
    expect(output).not.toContain("changes result was cancelled");
  });

  it("still reports a genuine failure plainly, with no cancellation excuse attached", () => {
    const { status, output } = runAggregate({ STATIC_RESULT: "failure" });
    expect(status).toBe(1);
    expect(output).toContain("static-pr result was failure");
    expect(output).not.toContain("CANCELLED with no failing job");
  });

  it("headlines a genuine failure even when another job was cancelled in the same run", () => {
    /*
     * The mixed case, reported by Codex on PR #1409. An earlier revision exited on the first
     * non-success, so `safety` cancelled + `build` failed announced "not a real failure" and
     * hid the break entirely — worse than the ambiguity the change set out to remove. Genuine
     * failures must win, and a concurrent cancellation may only appear as context.
     */
    const { status, output } = runAggregate({
      STATIC_HEAVY_CHANGED: "true",
      SAFETY_RESULT: "cancelled",
      BUILD_CHANGED: "true",
      BUILD_RESULT: "failure",
    });
    expect(status).toBe(1);
    expect(output).toContain("build result was failure");
    // The cancellation must not be the headline, and must not excuse the failure.
    expect(output).not.toContain("CANCELLED with no failing job");
    expect(output).not.toContain("not a broken change");
    // It may still be mentioned, but only as a warning alongside the real failure.
    expect(output).toMatch(/also cancelled: .*safety/);
  });

  it("lists every failing job rather than stopping at the first", () => {
    // Collecting before reporting also fixes the older annoyance of one failure per run.
    const { output } = runAggregate({
      STATIC_RESULT: "failure",
      COVERAGE_CHANGED: "true",
      COVERAGE_RESULT: "failure",
    });
    expect(output).toContain("static-pr result was failure");
    expect(output).toContain("coverage result was failure");
  });

  it("NEVER passes on a cancelled required job — #095's stop rule", () => {
    /*
     * The tempting fix was to treat cancelled as neutral so the red would disappear. That is
     * the one change this must not permit: a cancelled job proved nothing, so green here would
     * assert verification that never happened.
     */
    for (const key of ["CHANGES_RESULT", "STATIC_RESULT"]) {
      expect(runAggregate({ [key]: "cancelled" }).status).not.toBe(0);
    }
    expect(runAggregate({ STATIC_HEAVY_CHANGED: "true", SAFETY_RESULT: "cancelled" }).status).not.toBe(0);
    expect(runAggregate({ COVERAGE_CHANGED: "true", COVERAGE_RESULT: "cancelled" }).status).not.toBe(0);
    expect(runAggregate({ INGESTION_SAST_CHANGED: "true", INGESTION_SAST_RESULT: "cancelled" }).status).not.toBe(0);
    expect(
      runAggregate({
        UI_CHANGED: "true",
        UI_BUILD_RESULT: "success",
        UI_FAST_RESULT: "success",
        UI_RESULT: "cancelled",
      }).status,
    ).not.toBe(0);
    expect(
      runAggregate({
        UI_CHANGED: "true",
        UI_BUILD_RESULT: "success",
        UI_FAST_RESULT: "cancelled",
        UI_RESULT: "success",
      }).status,
    ).not.toBe(0);
  });

  it("keeps `if: always()`, since a skipped required check counts as passing", () => {
    // Guards the unsafe "fix": `if: !cancelled()` would skip this job on cancellation, and
    // GitHub treats a skipped required check as PASSING — mergeable with nothing verified.
    expect(workflow).toMatch(/pr-required:[\s\S]*?if: always\(\)/);
  });

  it("stays red on a static failure and reports the browser lanes it skipped as deferred, not failed", () => {
    // The browser lanes need static-pr, so a static failure skips them. The aggregate must stay
    // red on the static failure itself, and must not add two "result was skipped" lines that
    // say nothing about the diff.
    const staticRed = {
      UI_CHANGED: "true",
      STATIC_RESULT: "failure",
      UI_BUILD_RESULT: "success",
      UI_FAST_RESULT: "skipped",
      UI_RESULT: "skipped",
    } as const;
    const red = runAggregate(staticRed);
    expect(red.status).not.toBe(0);
    expect(red.output).toContain("static-pr result was failure");
    expect(red.output).not.toContain("production-ui result was skipped");
    expect(red.output).not.toContain("production-ui-critical result was skipped");
    expect(red.output).toContain("Browser tests deferred");
    // A lane that somehow ran and failed is still reported as a failure.
    expect(runAggregate({ ...staticRed, UI_RESULT: "failure" }).output).toContain("production-ui result was failure");
    // With static green, a skipped browser lane is still a failure — the deferral is only for a red static-pr.
    expect(runAggregate({ ...staticRed, STATIC_RESULT: "success" }).status).not.toBe(0);
    expect(runAggregate({ ...staticRed, STATIC_RESULT: "success" }).output).toContain(
      "production-ui result was skipped",
    );
  });

  it("never puts a status-check function anywhere but an `if:` condition", () => {
    /*
     * GitHub allows success()/failure()/cancelled()/always() ONLY in `if:` conditions. Using
     * one elsewhere is valid YAML and an invalid Actions schema, so the whole file fails to
     * parse: the run is named after the file path instead of the workflow, creates ZERO jobs,
     * and reports a bare failure. Nothing local catches it — prettier, lint, typecheck,
     * check:github-actions and the full unit suite all passed the broken version, and it was
     * only visible on hosted CI. Measured 2026-07-30 on PR #1409, from
     * `RUN_CANCELLED: ${{ cancelled() }}` in an env block.
     */
    const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
    const offenders: string[] = [];
    for (const file of readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name))) {
      const text = readFileSync(new URL(file, workflowDirectory), "utf8");
      text.split("\n").forEach((line, index) => {
        if (!/\$\{\{[^}]*\b(success|failure|cancelled|always)\s*\(/.test(line)) return;
        // `if:` may be the key on this line, or the expression may continue a multi-line if.
        if (/^\s*(-\s+)?if\s*:/.test(line)) return;
        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("Visual baseline routing", () => {
  /** The `visual-baseline:` block, up to the next top-level job key. */
  const visualBaselineJob = /\n  visual-baseline:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";

  it("finds the visual-baseline job", () => {
    expect(visualBaselineJob, "visual-baseline job not found in ci.yml").not.toBe("");
  });

  it("stays off pull_request and merge_group; only post-land/manual events run it", () => {
    // Owner decision (PR #1755 / #118): pre-merge UI churn is the wrong place for
    // an unavoidably-red pixel gate. merge_group is still pre-merge.
    expect(visualBaselineJob).toContain('["push","schedule","workflow_dispatch"]');
    const prRequiredNeeds = /\n  pr-required:\n[\s\S]*?needs:\s*\n?\s*\[([\s\S]*?)\]/.exec(workflow)?.[1] ?? "";
    expect(prRequiredNeeds, "could not read pr-required's needs list from ci.yml").not.toBe("");
    expect(prRequiredNeeds).not.toMatch(/\bvisual-baseline\b/);
  });

  it("soft-fails only the pixel-comparison step, not the whole advisory job", () => {
    // Job-level continue-on-error would also swallow setup / upload failures.
    // Job keys in the captured block are indented four spaces; step keys are deeper.
    expect(visualBaselineJob).not.toMatch(/^ {4}continue-on-error:\s*true\s*$/m);
    expect(visualBaselineJob).toMatch(
      /name: Chromium visual baselines\n\s+id: visual-comparison\n(?:\s+#.*\n)*\s+continue-on-error: true/,
    );
  });

  it("reports pixel drift as a warning while preserving review artifacts", () => {
    expect(visualBaselineJob).toContain("if: steps.visual-comparison.outcome == 'failure'");
    expect(visualBaselineJob).toContain("scripts/classify-visual-baseline-outcome.mjs");
    expect(visualBaselineJob).toContain("::warning title=Visual baseline drift::");
    expect(visualBaselineJob).toContain("$GITHUB_STEP_SUMMARY");
    expect(visualBaselineJob).toMatch(/name: Upload visual diffs\n\s+if: always\(\)/);
  });
});

describe("Lighthouse budget routing", () => {
  /** The `lighthouse-budget:` block, up to the next top-level job key. */
  const lighthouseJob = /\n  lighthouse-budget:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";
  const refreshJob = /\n  lighthouse-baseline-refresh:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/.exec(workflow)?.[1] ?? "";

  it("finds both Lighthouse jobs", () => {
    // Fails closed on a rename rather than turning every assertion below into a
    // vacuous match against an empty string.
    expect(lighthouseJob, "lighthouse-budget job not found in ci.yml").not.toBe("");
    expect(refreshJob, "lighthouse-baseline-refresh job not found in ci.yml").not.toBe("");
  });

  it("exports perf_changed from the change-scope job", () => {
    expect(workflow).toContain("perf_changed: ${{ steps.scope.outputs.perf_changed }}");
  });

  it("keys the budget off perf scope, not the old ui/build union", () => {
    // `ui_changed || build_changed` put every dependabot lockfile bump and every
    // worker/** change through a ~7 minute build plus ten Lighthouse runs.
    expect(lighthouseJob).toContain("needs.changes.outputs.perf_changed == 'true'");
    expect(lighthouseJob).not.toContain("needs.changes.outputs.ui_changed");
    expect(lighthouseJob).not.toContain("needs.changes.outputs.build_changed");
  });

  it("re-runs Lighthouse on push when the lockfile changed", () => {
    // perf_changed deliberately stays false for package.json / package-lock.json
    // (paths cannot distinguish a React bump from a js-yaml bump). Without this
    // push arm, a lockfile-only merge would skip Lighthouse on the PR and again
    // on the push to main, leaving only the weekly schedule.
    expect(lighthouseJob).toContain("github.event_name == 'push'");
    expect(lighthouseJob).toContain("needs.changes.outputs.lockfile_changed == 'true'");
  });

  it("tests draft with `!= true`, so push and schedule runs survive", () => {
    // `github.event.pull_request` is null on push/schedule/merge_group, so
    // `draft == false` is FALSE there and would silently kill both arms.
    expect(lighthouseJob).toContain("github.event.pull_request.draft != true");
    expect(lighthouseJob).not.toContain("github.event.pull_request.draft == false");
  });

  it("reads the dispatch input through github.event.inputs, which is null off-dispatch", () => {
    // The `inputs` context only exists for workflow_dispatch/workflow_call; the
    // github.event.inputs form is a string and is safely null everywhere else.
    expect(lighthouseJob).toContain("github.event.inputs.refresh_lighthouse_baseline != 'true'");
    expect(refreshJob).toContain("github.event.inputs.refresh_lighthouse_baseline == 'true'");
    expect(workflow).toMatch(/workflow_dispatch:\n\s+inputs:\n\s+refresh_lighthouse_baseline:/);
  });

  it("does not interpolate the lighthouse refresh dispatch input into a run script", () => {
    // github.event.inputs is untrusted in `run:` (shell injection). Bind it through
    // env and quote the variable. Job-level `if:` expressions may still read the
    // input context directly — those are not a shell.
    const classifyStep = sourceSegment(workflow, "name: Classify changed files", "sync-pr-policy-body:", {
      label: "CI change-scope classify step",
    });
    // Stop at the next step: its env expressions are not shell interpolation.
    const runScript = (classifyStep.split(/\n\s+run:\s*\|\n/)[1] ?? "").split(/\n      - name:/)[0];
    expect(runScript, "could not read the classify step run script").not.toBe("");
    expect(classifyStep).toMatch(
      /REFRESH_LIGHTHOUSE_BASELINE:\s*\$\{\{\s*github\.event\.inputs\.refresh_lighthouse_baseline\s*\}\}/,
    );
    expect(runScript).toContain('"$REFRESH_LIGHTHOUSE_BASELINE"');
    expect(runScript).not.toContain("github.event.inputs.refresh_lighthouse_baseline");
    expect(runScript).not.toMatch(/\$\{\{[\s\S]*?\}\}/);
  });

  it("pairs promotion to pr-required with merge_group coverage", () => {
    // The budget skips merge_group ONLY because it is advisory and outside
    // pr-required, where it could add ~7 minutes of merge latency without ever
    // changing the outcome. Promoting it (#118) without restoring merge_group would
    // leave the queue running a required check the PR never re-verified.
    const prRequiredNeeds = /\n  pr-required:\n[\s\S]*?needs:\s*\n?\s*\[([\s\S]*?)\]/.exec(workflow)?.[1] ?? "";
    // Fail closed on a lost anchor: an empty match would silently make this guard
    // conclude "not required" forever, which is the branch that checks the least.
    expect(prRequiredNeeds, "could not read pr-required's needs list from ci.yml").not.toBe("");
    expect(prRequiredNeeds).toContain("static-pr");
    const isRequired = /\blighthouse-budget\b/.test(prRequiredNeeds);

    if (isRequired) {
      expect(lighthouseJob, "lighthouse-budget is required — it must also run in merge_group").toContain("merge_group");
      expect(lighthouseJob, "a required check must not be continue-on-error").not.toContain("continue-on-error: true");
    } else {
      expect(lighthouseJob).toContain("continue-on-error: true");
    }
  });

  it("keeps the baseline refresh dispatch-only, red on failure, and unable to push", () => {
    // A workflow that can rewrite a gate's own baseline is a gate that can green
    // itself, so this job only ever produces an artifact for a human to commit.
    expect(refreshJob).toContain("github.event_name == 'workflow_dispatch'");
    expect(refreshJob).not.toContain("continue-on-error");
    expect(refreshJob).not.toContain("git push");
    expect(refreshJob).not.toContain("persist-credentials: true");
    // An empty artifact would look like a successful refresh that recorded nothing.
    expect(refreshJob).toContain("if-no-files-found: error");
    expect(refreshJob).toContain("--update");
  });

  it("pins Chromium through one shared action in both jobs", () => {
    // If the measuring and refreshing jobs resolve different browsers, the refreshed
    // baseline records a browser other than the one grading against it and the gate
    // goes permanently red — the exact failure this action was extracted to end.
    expect(lighthouseJob).toContain("uses: ./.github/actions/setup-lighthouse-chromium");
    expect(refreshJob).toContain("uses: ./.github/actions/setup-lighthouse-chromium");
    expect(lighthouseJob).not.toContain("playwright install");
    expect(refreshJob).not.toContain("playwright install");
  });
});
