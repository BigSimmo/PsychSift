import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildWeeklySummaryPlan,
  runFeedbackReport,
  summariseWeeklyFeedback,
  weeklySummaryMarkdown,
  type FeedbackReadClient,
  type FeedbackReportDependencies,
} from "../scripts/report-answer-feedback";
import { expectedSupabaseProject } from "../src/lib/supabase/project";

const now = Date.parse("2026-10-18T12:00:00.000Z");
const project = expectedSupabaseProject.ref;
const args = ["--weekly-summary", "--project-ref", project, "--confirm-project-ref", project];
const config = {
  NEXT_PUBLIC_SUPABASE_URL: expectedSupabaseProject.url,
  SUPABASE_PROJECT_REF: project,
  SUPABASE_PROJECT_NAME: expectedSupabaseProject.name,
};

function mockClient(pages: Array<{ data: unknown; count?: number; error?: unknown }>) {
  const calls: Array<Array<[string, ...unknown[]]>> = [];
  const client = {
    from() {
      const operations: Array<[string, ...unknown[]]> = [];
      calls.push(operations);
      const result = pages.shift() ?? { data: [] };
      const query: Record<string, unknown> = {};
      for (const method of ["select", "gte", "lt", "eq", "in", "order", "range", "limit", "abortSignal", "retry"]) {
        query[method] = (...values: unknown[]) => {
          operations.push([method, ...values]);
          return query;
        };
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve({ error: null, count: Array.isArray(result.data) ? result.data.length : null, ...result }).then(
          resolve,
          reject,
        );
      return query;
    },
  } as unknown as FeedbackReadClient;
  const dependencies = {
    readJson: vi.fn(async () => {
      throw new Error("must not read a file");
    }),
    loadConfig: vi.fn(async () => config),
    createClient: vi.fn(async () => client),
    now: () => now,
  } satisfies FeedbackReportDependencies;
  return { calls, dependencies };
}

describe("answer feedback weekly summary", () => {
  it("counts by category and by page, and never selects the note", async () => {
    const { calls, dependencies } = mockClient([
      {
        data: [
          { feedback_category: "numeric_error", record_type: "answer", record_id: null },
          { feedback_category: "numeric_error", record_type: "medication", record_id: "lithium" },
          { feedback_category: "outdated_guidance", record_type: "medication", record_id: "lithium" },
          { feedback_category: "wrong_source", record_type: "therapy", record_id: "cbt-i" },
        ],
      },
    ]);
    const result = await runFeedbackReport(args, dependencies);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      version: "answer-feedback-weekly-summary-v1",
      totalReports: 4,
      categoryCounts: { numeric_error: 2, outdated_guidance: 1, wrong_source: 1 },
      pageCounts: { medication: 2, answer: 1, therapy: 1 },
      freeText: "excluded",
      window: { from: "2026-10-11T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z" },
    });
    const select = calls[0]!.find(([method]) => method === "select")!;
    expect(select[1]).toBe("feedback_category,record_type");
    expect(String(select[1])).not.toMatch(/note|owner|hash|interaction|record_id/);
    expect(dependencies.readJson).not.toHaveBeenCalled();
  });

  it("never prints a record id, even one that arrives in a row", () => {
    const summary = summariseWeeklyFeedback(
      [{ feedback_category: "numeric_error", record_type: "medication", record_id: "jane-citizen-1960" }],
      { from: "a", to: "b" },
    );
    const text = JSON.stringify(summary) + weeklySummaryMarkdown(summary);
    expect(text).not.toContain("jane");
    expect(summary.pageCounts).toEqual({ medication: 1 });
  });

  it("does not echo unexpected values or text from rows", () => {
    const summary = summariseWeeklyFeedback(
      [
        { feedback_category: "Mr Smith is wrong", record_type: "pharmacy", record_id: "x", note: "synthetic note" },
        { feedback_category: "verified", record_type: "medication", record_id: "Not A Slug!" },
      ],
      { from: "a", to: "b" },
    );
    const text = JSON.stringify(summary) + weeklySummaryMarkdown(summary);
    expect(text).not.toContain("Smith");
    expect(text).not.toContain("synthetic note");
    expect(text).not.toContain("Not A Slug");
    expect(summary.categoryCounts).toEqual({ unknown: 1, verified: 1 });
    expect(summary.pageCounts).toEqual({ medication: 1, unknown: 1 });
  });

  it("refuses a mismatched project before configuration or a client", async () => {
    const { dependencies } = mockClient([]);
    const result = await runFeedbackReport(
      ["--weekly-summary", "--project-ref", project, "--confirm-project-ref", "other"],
      dependencies,
    );
    expect(result).toMatchObject({ exitCode: 1, output: { status: "refused" } });
    expect(dependencies.loadConfig).not.toHaveBeenCalled();
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(() => buildWeeklySummaryPlan({ projectRef: "other" }, now)).toThrow();
  });

  it("refuses a non-production identity before any read", async () => {
    const { dependencies } = mockClient([]);
    dependencies.loadConfig.mockResolvedValue({
      ...config,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    } as unknown as typeof config);
    const result = await runFeedbackReport(args, dependencies);
    expect(result).toMatchObject({ exitCode: 1, output: { reasonCode: "FEEDBACK_IDENTITY_INVALID" } });
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it("suppresses provider errors and renders a failure summary without text", async () => {
    const { dependencies } = mockClient([{ data: null, error: { message: "private provider detail" } }]);
    const result = await runFeedbackReport(args, dependencies);
    expect(result).toMatchObject({ exitCode: 1, output: { status: "failed", reasonCode: "FEEDBACK_READ_FAILED" } });
    const markdown = weeklySummaryMarkdown(result.output);
    expect(markdown).toContain("could not be built (FEEDBACK_READ_FAILED)");
    expect(markdown).not.toContain("private provider detail");
  });

  it("is scheduled weekly on main only, with the service-role secret scoped to the report step", () => {
    const workflow = readFileSync(".github/workflows/answer-feedback-weekly.yml", "utf8");
    expect(workflow).toMatch(/schedule:\n(?:\s+#[^\n]*\n)*\s+- cron: "\d+ \d+ \* \* \d"/);
    expect(workflow).toContain("if: ${{ github.ref == 'refs/heads/main' }}");
    expect(workflow).toContain("--weekly-summary");
    expect(workflow).toContain('"$GITHUB_STEP_SUMMARY"');
    expect(workflow).not.toMatch(/issues: write|pull-requests: write|contents: write/);
    const secretLines = workflow.split("\n").filter((line) => line.includes("secrets."));
    expect(secretLines).toEqual(["          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"]);
  });
});
