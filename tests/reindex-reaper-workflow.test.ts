import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { yamlBlock } from "../scripts/yaml-contract.mjs";

// Raw-text assertions, matching tests/ingestion-autopilot-workflow.test.ts and
// tests/live-drift-workflow.test.ts. A YAML parser would normalise away the exact
// shell text these guards depend on (which branch runs first, what `--apply` sits
// behind), and this repo declares no YAML dependency for tests.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "reindex-reaper.yml");

describe("reindex reaper workflow", () => {
  it("exists and has the expected top-level structure", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    for (const key of ["name:", "on:", "concurrency:", "permissions:", "env:", "jobs:"]) {
      expect(workflow).toMatch(new RegExp(`^${key}`, "m"));
    }
    expect(yamlBlock(workflow, "reindex-reaper:", 2)).not.toBe("");
  });

  it("states the blast radius and the inert posture in its opening comment", () => {
    const header = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n").split("\n").slice(0, 5).join("\n");
    expect(header).toMatch(/seven artifact tables/);
    expect(header).toMatch(/EVERY tenant/);
    expect(header).toMatch(/INERT/);
    expect(header).toMatch(/repository owner's decision/);
  });

  it("is reachable only from a trusted dispatch or the schedule", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    expect(workflow).toMatch(/^  repository_dispatch:$/m);
    expect(workflow).toContain("types: [reindex-reaper]");
    expect(workflow).toMatch(/^  schedule:$/m);
    expect(workflow).toMatch(/^    - cron: "[^"]+"$/m);

    // A manual branch-selectable trigger would let a same-repository writer point a
    // secret-bearing, destructive workflow at their own definition.
    for (const trigger of ["workflow_dispatch", "push", "pull_request", "pull_request_target"]) {
      expect(workflow).not.toMatch(new RegExp(`^  ${trigger}:`, "m"));
    }
  });

  it("gates the whole job on the (deliberately unset) enable variable", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const job: string = yamlBlock(workflow, "reindex-reaper:", 2);
    expect(job).toMatch(/^    if: vars\.REINDEX_REAPER_ENABLED == 'true'$/m);
  });

  it("double-gates the apply path and never lets the schedule reach it", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const runStep: string = yamlBlock(
      yamlBlock(workflow, "reindex-reaper:", 2),
      "- name: Reap abandoned reindex generations",
      6,
    );
    expect(runStep).toContain("APPLY_REQUESTED: ${{ github.event.client_payload.apply || 'false' }}");
    expect(runStep).toContain("APPLY_ALLOWED: ${{ vars.REINDEX_REAPER_APPLY }}");
    expect(runStep).toContain('elif is_true "$APPLY_REQUESTED" && is_true "$APPLY_ALLOWED"; then');

    // Comments describing the gates are not gates, so compare executable lines only.
    const executable = runStep
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

    // Exactly one --apply invocation, and it sits behind the elif above.
    const applyLines = executable.split("\n").filter((line) => line.includes("--apply"));
    expect(applyLines).toHaveLength(1);
    expect(applyLines[0]).toContain("npm run reindex:cleanup-staged -- --apply --yes");

    // The scheduled branch is evaluated first and does not fall through, so cron
    // can only ever reach the read-only alert probe.
    const scheduleBranchIndex = executable.indexOf('if [ "$GITHUB_EVENT_NAME" = "schedule" ]; then');
    const applyIndex = executable.indexOf("--apply");
    expect(scheduleBranchIndex).toBeGreaterThan(-1);
    expect(applyIndex).toBeGreaterThan(scheduleBranchIndex);
    expect(executable).toContain("npm run reindex:cleanup-staged -- --alert-on-abandoned");
  });

  it("defaults to a dry run on every path", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const runStep: string = yamlBlock(
      yamlBlock(workflow, "reindex-reaper:", 2),
      "- name: Reap abandoned reindex generations",
      6,
    );
    // The fall-through branch runs the script with no flags, and the script itself
    // is dry-run unless --apply is passed.
    expect(runStep).toMatch(/^\s+npm run reindex:cleanup-staged$/m);
    const invocations = runStep
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#") && line.includes("npm run reindex:cleanup-staged"));
    expect(invocations).toHaveLength(3);
  });

  it("compares both apply gates case-insensitively and says so when a value is neither true nor false", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const runStep: string = yamlBlock(
      yamlBlock(workflow, "reindex-reaper:", 2),
      "- name: Reap abandoned reindex generations",
      6,
    );

    // Gate 1 is a GitHub expression, which compares case-insensitively, so `TRUE`
    // arms it. Gates 2 and 3 are shell compares and must not disagree: an operator
    // who arms with `TRUE` would otherwise get a silent dry run.
    expect(runStep).toContain("[Tt][Rr][Uu][Ee]) return 0 ;;");
    expect(runStep).toMatch(/^\s+is_true\(\) \{$/m);

    // And a value that is neither true nor false is reported rather than swallowed.
    expect(runStep).toContain('warn_gate APPLY_REQUESTED "$APPLY_REQUESTED"');
    expect(runStep).toContain('warn_gate APPLY_ALLOWED "$APPLY_ALLOWED"');
    expect(runStep).toContain("::warning::$1 is set to '$2', which is neither true nor false.");
  });

  it('separates "rows were detected" from "the probe could not run"', () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const job: string = yamlBlock(workflow, "reindex-reaper:", 2);
    const runStep: string = yamlBlock(job, "- name: Reap abandoned reindex generations", 6);

    // The probe's own exit code carries the distinction: 2 is detection
    // (abandonedReindexGenerationAlertExitCode), anything else non-zero is a real
    // failure, and an empty code means the probe never ran.
    expect(runStep).toContain("continue-on-error: true");
    expect(runStep).toContain("code=$?");
    expect(runStep).toContain('echo "code=$code" >> "$GITHUB_OUTPUT"');
    expect(runStep).toContain('exit "$code"');

    const alertStep: string = yamlBlock(job, "- name: Open or update alert issue", 6);
    expect(alertStep).toContain("PROBE_EXIT_CODE: ${{ steps.reaper.outputs.code }}");
    expect(alertStep).toContain('const detected = probeExitCode === "2";');
    expect(alertStep).toContain("ABANDONED ROWS DETECTED.");
    expect(alertStep).toContain("THE PROBE COULD NOT RUN");
    // The two bodies must actually differ, not just be selected between.
    expect(alertStep).toContain("const detail = detected");

    // continue-on-error must not turn a broken probe into a green run.
    const reRaise: string = yamlBlock(job, "- name: Re-raise the probe outcome", 6);
    expect(reRaise).toContain("if: ${{ !cancelled() && steps.reaper.outputs.code != '0' }}");
    expect(reRaise).toContain("exit 1");
  });

  it("documents the gate semantics it actually implements, and the limits it does not fix", () => {
    const header = readFileSync(workflowPath, "utf8")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => line.startsWith("#"))
      .join("\n");

    // The implementation is a shell string compare on a rendered env var, not the
    // GitHub expression `== 'true'` an earlier header claimed. A JSON boolean true
    // renders as "true" and arms the gate; the prose must not be stricter than that.
    expect(header).toContain("NOT the GitHub expression");
    expect(header).toMatch(/renders as the\n#\s+string "true" and arms the gate/);

    // Standing repo state vs per-run consent, and the environment that would fix it.
    expect(header).toMatch(/only ONE of them is per-run/);
    expect(header).toMatch(/REQUIRED\n#\s+REVIEWERS/);
    expect(header).toMatch(/auto-create it UNPROTECTED/);
    // Naming an environment that does not exist yet would create it unprotected. The only
    // environment the reaper may name is the owner-created, main-only secret scope
    // (`production-secrets`, audit F-21); it is not the apply-approval gate, and the header
    // must say so rather than let it read as one.
    const environments = readFileSync(workflowPath, "utf8").match(/^\s+environment:.*$/gm) ?? [];
    expect(environments.map((line) => line.trim())).toEqual(["environment: production-secrets"]);
    expect(header).toMatch(/`production-secrets`, and it is not that approval\n#\s+gate/);
    expect(header).toMatch(/no required\n#\s+reviewers, so it approves nothing/);

    // The probe's known permanent-red risk, the missing row ceiling, and the
    // reindex-overlap window are recorded rather than coded around.
    expect(header).toMatch(/permanently red/);
    expect(header).toMatch(/index_generation_id` is\n#\s+absent/);
    expect(header).toMatch(/row ceiling/);
    expect(header).toMatch(/serialises reaper against reaper only/);
  });

  it("pins the production Supabase identity and never names the stale project ref", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    expect(workflow).toContain("NEXT_PUBLIC_SUPABASE_URL: https://sjrfecxgysukkwxsowpy.supabase.co");
    expect(workflow).toContain("SUPABASE_PROJECT_REF: sjrfecxgysukkwxsowpy");
    expect(workflow).toContain("SUPABASE_PROJECT_NAME: PsychSift Production");
    expect(workflow).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: placeholder-ci-anon-key");
    expect(workflow).not.toContain("qjgitjyhxrwxsrydablr");
    expect(workflow).toContain("npm run check:supabase-project");
  });

  it("keeps the service-role secret step-scoped and preflights it", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const secretLines = workflow.split("\n").filter((line) => line.includes("SUPABASE_SERVICE_ROLE_KEY:"));
    expect(secretLines).toEqual([
      "          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
      "          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}",
    ]);
    expect(workflow).toContain(
      "::error::Reindex reaper cannot run — missing secret SUPABASE_SERVICE_ROLE_KEY (production-secrets environment)",
    );
  });

  it("serialises runs and can raise an alert issue", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const concurrency: string = yamlBlock(workflow, "concurrency:", 0);
    expect(concurrency).toContain("group: reindex-reaper");
    expect(concurrency).toContain("cancel-in-progress: false");

    const permissions: string = yamlBlock(workflow, "permissions:", 0);
    expect(permissions).toContain("contents: read");
    expect(permissions).toContain("issues: write");

    expect(workflow).toContain(
      "if: ${{ !cancelled() && github.event_name == 'schedule' && steps.reaper.outputs.code != '0' }}",
    );
    expect(workflow).toContain("npm run reindex:cleanup-staged");
  });
});
