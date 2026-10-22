import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TREND_LABEL,
  TREND_ISSUE_BODY,
  TREND_ROW_MARKER,
  TREND_TITLE,
  buildCanaryTrendRow,
  readCanaryTrendRow,
  renderCanaryTrendComment,
} from "../scripts/lib/eval-canary-trend.mjs";

// Audit EVAL-06 (2026-10-20): canary output expires with its 30-day artifact, and nothing after
// 4 Oct was recorded anywhere durable. Every run now leaves one small aggregate row.
const golden = {
  results: [{ id: "a" }, { id: "b" }],
  summary: {
    case_count: 36,
    document_recall_at_5: 1,
    content_recall_at_5: 0.9722,
    mrr_at_10: 0.8921,
    content_mrr_at_10: 0.9333,
    irrelevant_source_rate_at_10: 0.0917,
    p90_latency_ms: 32062,
    failed_cases: [{ id: "alcohol-ciwa-threshold", failures: ["content recall 0"], content: "never copied" }],
  },
};
const quality = {
  rag: {
    summary: {
      case_count: 44,
      grounded_supported_rate: 1,
      unsupported_correct_rate: 1,
      expected_hit_rate: 0.6364,
      citation_failure_rate: 0,
      estimated_cost_usd: 0.235936,
      failed_cases: [
        { id: "nocc-requirements", failures: ["expected content"], answer: "never copied" },
        { id: "clozapine-monitoring", failures: ["grounding"] },
      ],
    },
  },
};
const meta = {
  date: "2026-10-20T18:42:00.000Z",
  runId: "37226742946",
  runAttempt: "1",
  trigger: "schedule",
  sha: "ace8ea995aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  jobStatus: "failure",
  goldenOutcome: "success",
  answerOutcome: "failure",
};

describe("eval canary trend row", () => {
  it("keeps aggregate numbers and case IDs only, never case content", () => {
    const row = buildCanaryTrendRow({ golden, quality, meta });
    expect(row).toEqual({
      v: 1,
      date: "2026-10-20T18:42:00.000Z",
      run: "37226742946",
      attempt: "1",
      trigger: "schedule",
      sha: "ace8ea995aaa",
      job: "failure",
      steps: { golden: "success", answer: "failure" },
      retrieval: {
        cases: 36,
        failed: ["alcohol-ciwa-threshold"],
        doc_recall_at_5: 1,
        content_recall_at_5: 0.9722,
        mrr_at_10: 0.8921,
        content_mrr_at_10: 0.9333,
        irrelevant_at_10: 0.0917,
        p90_ms: 32062,
      },
      answer: {
        cases: 44,
        failed: ["clozapine-monitoring", "nocc-requirements"],
        grounded_supported_rate: 1,
        unsupported_correct_rate: 1,
        expected_hit_rate: 0.6364,
        citation_failure_rate: 0,
        estimated_cost_usd: 0.235936,
      },
    });
    expect(JSON.stringify(row)).not.toContain("never copied");
  });

  it("records a cancelled or timed-out run as cancelled, with no results", () => {
    const row = buildCanaryTrendRow({
      golden: null,
      quality: null,
      meta: { ...meta, jobStatus: "cancelled", goldenOutcome: "cancelled", answerOutcome: "skipped" },
    });
    expect(row).toMatchObject({ job: "cancelled", retrieval: null, answer: null });
    const comment = renderCanaryTrendComment(row, "https://github.com/BigSimmo/PsychSift/actions/runs/1");
    expect(comment).toContain("job cancelled");
    expect(comment).toContain("retrieval not recorded");
    expect(comment).toContain("answers not recorded");
  });

  it("drops case IDs that are not plain identifiers", () => {
    const row = buildCanaryTrendRow({
      golden: { summary: { failed_cases: [{ id: "ok-id" }, { id: "bad id\n<script>" }, { id: 7 }] } },
      quality: null,
      meta,
    });
    expect(row.retrieval?.failed).toEqual(["ok-id"]);
  });

  it("renders one readable line plus one machine-readable line, and mentions nobody", () => {
    const row = buildCanaryTrendRow({ golden, quality, meta });
    const comment = renderCanaryTrendComment(row, "https://github.com/BigSimmo/PsychSift/actions/runs/37226742946");
    const lines = comment.split("\n");
    expect(lines[0]).toBe(TREND_ROW_MARKER);
    expect(lines[1]).toBe(
      "2026-10-20 · scheduled · job failure · retrieval 36 cases, 1 failed (doc recall 1, content recall 0.9722) · answers 44 cases, 2 failed · [run](https://github.com/BigSimmo/PsychSift/actions/runs/37226742946)",
    );
    expect(JSON.parse(lines[2]!.replace(/^`|`$/g, ""))).toEqual(row);
    expect(comment).not.toContain("@");
  });

  it("reads the run's output files from the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "canary-trend-"));
    mkdirSync(join(dir, "quality-reports"));
    writeFileSync(join(dir, "golden-retrieval.json"), JSON.stringify(golden));
    writeFileSync(join(dir, "quality-reports", "retrieval-quality-2026-10-20.json"), JSON.stringify(quality));
    expect(readCanaryTrendRow(dir, meta)).toEqual(buildCanaryTrendRow({ golden, quality, meta }));
    expect(readCanaryTrendRow(join(dir, "missing"), meta)).toMatchObject({ retrieval: null, answer: null });
  });

  it("runs the workflow step's script: opens the trend issue once, then posts the row", async () => {
    const workflow = readFileSync(".github/workflows/eval-canary.yml", "utf8");
    const step = workflow.slice(workflow.indexOf("      - name: Record trend row"));
    const marker = "          script: |\n";
    const body: string[] = [];
    for (const line of step.slice(step.indexOf(marker) + marker.length).split("\n")) {
      if (line.length === 0) {
        body.push("");
        continue;
      }
      if (!line.startsWith("            ")) break;
      body.push(line.slice(12));
    }
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...args: string[]
    ) => (...values: unknown[]) => Promise<void>;
    const created: Array<{ title: string; labels: string[] }> = [];
    const comments: Array<{ issue_number: number; body: string }> = [];
    const github = {
      rest: {
        issues: {
          listForRepo: async () => ({ data: [] }),
          create: async (request: { title: string; labels: string[] }) => {
            created.push(request);
            return { data: { number: 77 } };
          },
          createComment: async (request: { issue_number: number; body: string }) => {
            comments.push(request);
          },
        },
      },
    };
    const context = {
      repo: { owner: "BigSimmo", repo: "PsychSift" },
      runId: 123,
      eventName: "schedule",
      sha: "0123456789abcdef0123456789abcdef01234567",
      serverUrl: "https://github.com",
    };
    const workspace = mkdtempSync(join(tmpdir(), "canary-ws-"));
    mkdirSync(join(workspace, "scripts", "lib"), { recursive: true });
    for (const file of [
      "scripts/lib/eval-canary-trend.mjs",
      "scripts/eval-canary-case-summary.mjs",
      "scripts/lib/is-entrypoint.mjs",
    ]) {
      writeFileSync(join(workspace, file), readFileSync(file, "utf8"));
    }
    const saved = { ...process.env };
    Object.assign(process.env, {
      GITHUB_WORKSPACE: workspace,
      JOB_STATUS: "cancelled",
      GOLDEN_OUTCOME: "cancelled",
      ANSWER_OUTCOME: "skipped",
      GITHUB_RUN_ATTEMPT: "1",
    });
    delete process.env.GITHUB_STEP_SUMMARY;
    try {
      const { createRequire } = await import("node:module");
      // Function-constructor code has no dynamic-import hook under Vitest, so the step's one
      // `import()` is routed through a parameter that performs the same import.
      const source = body.join("\n").replace("await import(", "await importModule(");
      await new AsyncFunction("github", "context", "core", "require", "importModule", source)(
        github,
        context,
        { info: () => undefined },
        createRequire(import.meta.url),
        (specifier: string) => import(specifier),
      );
    } finally {
      process.env = saved;
    }
    expect(created).toEqual([expect.objectContaining({ title: "Eval canary trend", labels: [TREND_LABEL] })]);
    expect(comments).toHaveLength(1);
    expect(comments[0]!.issue_number).toBe(77);
    expect(comments[0]!.body.startsWith(TREND_ROW_MARKER)).toBe(true);
    expect(comments[0]!.body).toContain("scheduled · job cancelled · retrieval not recorded");
  });

  it("still posts a row in the module's exact shape when checkout failed (fallback step)", async () => {
    const workflow = readFileSync(".github/workflows/eval-canary.yml", "utf8");
    const step = workflow.slice(workflow.indexOf("      - name: Record trend row (checkout failed)"));
    expect(step).toContain(
      "if: always() && steps.checkout.outcome != 'success' && (github.event_name == 'schedule' || github.event_name == 'repository_dispatch')",
    );
    expect(step).toContain("continue-on-error: true");
    // No repository code is available when checkout failed.
    expect(step).not.toContain("GITHUB_WORKSPACE");
    const marker = "          script: |\n";
    const body: string[] = [];
    for (const line of step.slice(step.indexOf(marker) + marker.length).split("\n")) {
      if (line.length === 0) {
        body.push("");
        continue;
      }
      if (!line.startsWith("            ")) break;
      body.push(line.slice(12));
    }
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...args: string[]
    ) => (...values: unknown[]) => Promise<void>;
    const created: Array<{ title: string; labels: string[]; body: string }> = [];
    const comments: Array<{ issue_number: number; body: string }> = [];
    const github = {
      rest: {
        issues: {
          listForRepo: async () => ({ data: [] }),
          create: async (request: { title: string; labels: string[]; body: string }) => {
            created.push(request);
            return { data: { number: 78 } };
          },
          createComment: async (request: { issue_number: number; body: string }) => {
            comments.push(request);
          },
        },
      },
    };
    const context = {
      repo: { owner: "BigSimmo", repo: "PsychSift" },
      runId: 124,
      eventName: "repository_dispatch",
      sha: "0123456789abcdef0123456789abcdef01234567",
      serverUrl: "https://github.com",
    };
    const saved = { ...process.env };
    Object.assign(process.env, {
      JOB_STATUS: "failure",
      GOLDEN_OUTCOME: "skipped",
      ANSWER_OUTCOME: "skipped",
      GITHUB_RUN_ATTEMPT: "2",
    });
    try {
      await new AsyncFunction("github", "context", "core", body.join("\n"))(github, context, { info: () => undefined });
    } finally {
      process.env = saved;
    }
    expect(created).toEqual([
      { owner: "BigSimmo", repo: "PsychSift", title: TREND_TITLE, labels: [TREND_LABEL], body: TREND_ISSUE_BODY },
    ]);
    expect(comments).toHaveLength(1);
    const row = JSON.parse(comments[0]!.body.split("\n")[2]!.slice(1, -1));
    const expected = buildCanaryTrendRow({
      golden: null,
      quality: null,
      meta: {
        date: row.date,
        runId: "124",
        runAttempt: "2",
        trigger: "repository_dispatch",
        sha: context.sha,
        jobStatus: "failure",
        goldenOutcome: "skipped",
        answerOutcome: "skipped",
      },
    });
    expect(row).toEqual(expected);
    expect(comments[0]!.body).toBe(
      renderCanaryTrendComment(expected, "https://github.com/BigSimmo/PsychSift/actions/runs/124"),
    );
  });

  it("is posted by the canary on every run, cancelled ones included, without failing the job", () => {
    const workflow = readFileSync(".github/workflows/eval-canary.yml", "utf8");
    const step = workflow.slice(workflow.indexOf("      - name: Record trend row"));
    expect(step).toContain(
      "if: always() && steps.checkout.outcome == 'success' && (github.event_name == 'schedule' || github.event_name == 'repository_dispatch')",
    );
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("JOB_STATUS: ${{ job.status }}");
    expect(step).toContain("scripts/lib/eval-canary-trend.mjs");
    expect(step).toContain("GITHUB_STEP_SUMMARY");
    expect(TREND_LABEL).toBe("eval-canary-trend");
    // Not a commit from CI to main: the row lives in an issue comment and the job summary.
    expect(step).not.toMatch(/git (commit|push)/);
  });
});
