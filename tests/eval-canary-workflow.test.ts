import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/eval-canary.yml", import.meta.url), "utf8");

describe("eval canary workflow input", () => {
  it("runs weekly on Monday morning in Australia/Perth", () => {
    expect(workflow).toContain('- cron: "0 18 * * 0"');
    expect(workflow).not.toContain('- cron: "0 18 * * *"');
    expect(workflow).toContain("Sunday 18:00 UTC = Monday 02:00 Australia/Perth");
  });

  it("validates the dispatch limit outside shell source and passes it as one quoted argument", () => {
    expect(workflow).toContain("ANSWER_CASE_LIMIT: ${{ github.event.client_payload.answer_case_limit || '44' }}");
    expect(workflow).toContain('[[ ! "$ANSWER_CASE_LIMIT" =~ ^[0-9]+$ ]]');
    expect(workflow).toContain("ANSWER_CASE_LIMIT < 1 || ANSWER_CASE_LIMIT > 100");
    expect(workflow).toContain('--limit "$ANSWER_CASE_LIMIT"');
    expect(workflow).not.toMatch(/run:.*github\.event\.client_payload\.answer_case_limit/);
  });

  it("loads on-demand evaluations from the trusted default branch", () => {
    expect(workflow).not.toMatch(/^  workflow_dispatch:/m);
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("types: [eval-canary]");
    expect(workflow).not.toMatch(/^\s+ref:\s+\$\{\{/m);
    expect(workflow).toContain('echo "EVAL_GIT_SHA=$(git rev-parse HEAD)" >> "$GITHUB_ENV"');
  });

  it("scopes production provider secrets to the live steps", () => {
    expect(workflow).not.toMatch(
      /^(?: {0,6})env:\n(?: {2,8}[^\n]+\n)* {2,8}(?:SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY):/m,
    );

    const installStart = workflow.indexOf("      - name: Install dependencies");
    const projectGuardStart = workflow.indexOf("      - name: Guard Supabase project identity");
    expect(installStart).toBeGreaterThan(-1);
    expect(projectGuardStart).toBeGreaterThan(installStart);
    expect(workflow.slice(installStart, projectGuardStart)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow.slice(installStart, projectGuardStart)).not.toContain("OPENAI_API_KEY");
    // Audit F-21: the service-role key comes from the main-only production-secrets environment.
    expect(workflow).toContain("  eval-canary:\n    # Holds SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow.match(/^\s+environment:.*$/gm)?.map((line) => line.trim())).toEqual([
      "environment: production-secrets",
    ]);
  });

  it("opens the failure issue for scheduled AND dispatched runs", () => {
    // A red dispatch is usually half of a canary pair gating a behaviour change — it must
    // not fail silently while only weekly runs get an issue.
    // Audit EVAL-08 (2026-10-20): `failure()` alone skipped a run that timed out or was
    // cancelled, so it opened no issue. The old line pinned that gap.
    expect(workflow).toContain(
      "if: (failure() || cancelled()) && (github.event_name == 'schedule' || github.event_name == 'repository_dispatch')",
    );
    expect(workflow).toContain('context.eventName === "schedule" ? "Weekly (scheduled)" : "Dispatched"');
  });

  it("never titles a cancelled or timed-out run as a completed evaluation", () => {
    expect(workflow).toContain('const runCancelled = "${{ job.status }}" === "cancelled";');
    expect(workflow).toContain('const completed = diagnosis.category === "probable-regression" && !runCancelled;');
    expect(workflow).toContain("The run was cancelled or timed out before it finished");
  });

  it("feeds every eval log and live step outcome into the failure issue", () => {
    expect(workflow).toContain('".local/eval-canary/answer-targeting.log"');
    expect(workflow).toContain('validate_override: "${{ steps.validate_override.outcome }}"');
    expect(workflow).toContain('answer_targeting: "${{ steps.answer_targeting.outcome }}"');
  });

  it("distinguishes provider outages from retrieval regressions in the failure issue", () => {
    expect(workflow).toContain('"Eval canary failure: evaluation did not complete"');
    expect(workflow).toContain("Resolve provider quota/auth/config failures before rerunning");
    expect(workflow).toContain(
      "Do not bisect or revert code until provider health and the failure class are confirmed",
    );
    // PR #629 removed this wording because provider quota and auth failures were being filed as
    // retrieval regressions. Titles derived from the failure class must not reintroduce it.
    expect(workflow).not.toContain("Eval canary regression:");
  });

  /**
   * TWO OUTCOMES, NOT ONE (ledger #SXPQ0A). `failure()` already covered a run that COMPLETED and
   * then missed a blocking threshold: `eval:quality --fail-on-threshold` sets exit code 1
   * (scripts/eval-quality.ts), `run-eval-safe.mjs` propagates it, and the step runs under
   * `set -o pipefail`. What was missing is that the issue then said "evaluation did not complete"
   * about an evaluation that completed and returned a real quality verdict — so the answer-quality
   * subset failed the same three cases on every run from 2026-08-23 and read as an outage.
   */
  it("titles a completed-but-failing evaluation as a verdict, not an outage", () => {
    expect(workflow).toContain('const completed = diagnosis.category === "probable-regression"');
    expect(workflow).toContain('"Eval canary failure: a completed evaluation missed its blocking threshold"');
    expect(workflow).toContain("**The evaluation completed.** This is a quality verdict, not an outage");
  });

  // Golden retrieval and the answer-quality subset have different owners and different stop rules.
  // A red canary that does not say which half failed reads as "retrieval has regressed" while
  // retrieval is passing every case.
  it("names which half of the canary failed and which cases blocked", () => {
    expect(workflow).toContain('stepOutcomes.golden_retrieval === "failure"');
    expect(workflow).toContain('stepOutcomes.answer_quality === "failure"');
    expect(workflow).toContain("Blocking threshold failures");
    expect(workflow).toContain("`Failing half: ${half}`");
  });

  /**
   * The two classes are separate threads on purpose: appending a completed-evaluation verdict to a
   * thread titled "did not complete" is how three answer-quality cases stayed untracked for three
   * weeks. Matching on `existing[0]` is what produced that.
   */
  it("keeps the two failure classes in separate threads", () => {
    expect(workflow).toContain("const thread = existing.find((issue) => issue.title === title)");
    expect(workflow).not.toContain("issue_number: existing[0].number");
  });

  /**
   * The canary is the pair-comparison instrument for every protected RAG change. An issue that
   * invites the reader to make the threshold green is worse than no issue, so the stop rule
   * travels with the alert rather than living only in AGENTS.md.
   */
  it("carries the protected-surface stop rule into the issue body", () => {
    expect(workflow).toContain("do not relax the threshold, add `acceptSourceOnly` to the failing cases");
    expect(workflow).toContain("needs a paid live canary pair and explicit owner approval");
  });

  it("captures eval logs and adds deterministic failure classification to the issue", () => {
    expect(workflow).toContain("set -o pipefail");
    expect(workflow).toContain("tee .local/eval-canary/golden-retrieval.log");
    expect(workflow).toContain("tee .local/eval-canary/answer-quality.log");
    expect(workflow).toContain("--output-dir .local/eval-canary/quality-reports");
    expect(workflow).toContain("--source-governance-results .local/eval-canary/golden-retrieval.json");
    expect(workflow).toContain(
      "await import(pathToFileURL(`${process.env.GITHUB_WORKSPACE}/scripts/productivity-core.mjs`).href)",
    );
    expect(workflow).toContain("analyzeFailureText(failureText)");
    expect(workflow).toContain("`Failure class: ${diagnosis.category} (${diagnosis.confidence})`");
    expect(workflow).toContain("`Step outcomes: ${JSON.stringify(stepOutcomes)}`");
  });
});
