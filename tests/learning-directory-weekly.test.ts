import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildLearningDirectoryReport, perthToday, REPORT_HEADING } from "../scripts/cme/learning-directory-weekly.mjs";

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "synthetic-event",
  title: "Synthetic event",
  provider: "Synthetic provider",
  kind: "event",
  datesConfirmed: true,
  startsOn: "2026-11-01",
  endsOn: null,
  mode: "online",
  location: null,
  costNote: null,
  url: "https://example.org/event",
  sourceUrl: "https://example.org/source",
  lastCheckedOn: "2026-10-20",
  ...overrides,
});

describe("WA learning directory weekly report", () => {
  it("starts with the heading the publish job checks and says when nothing needs a recheck", () => {
    const report = buildLearningDirectoryReport({
      directory: { lastCheckedOn: "2026-10-20", items: [entry()] },
      todayPerth: "2026-10-21",
      linkResults: new Map([
        ["https://example.org/event", { ok: true, detail: "answered 200" }],
        ["https://example.org/source", { ok: true, detail: "answered 200" }],
      ]),
    });
    expect(report.split("\n", 1)[0]).toBe(REPORT_HEADING);
    expect(report).toContain("Nothing needs a recheck this week.");
    expect(report).toContain("None. Every link answered.");
  });

  it("lists stale entries, dead links, cancellations, unconfirmed dates and long-finished events", () => {
    const report = buildLearningDirectoryReport({
      directory: {
        lastCheckedOn: "2026-08-01",
        items: [
          entry({ id: "stale", lastCheckedOn: "2026-09-01" }),
          entry({ id: "cancelled", cancelled: true }),
          entry({ id: "undated", datesConfirmed: false, startsOn: null }),
          entry({ id: "old", startsOn: "2026-06-01", lastCheckedOn: "2026-10-20" }),
          entry({ id: "recorded", kind: "recorded", startsOn: "2026-01-01" }),
        ],
      },
      todayPerth: "2026-10-21",
      linkResults: new Map([["https://example.org/event", { ok: false, detail: "answered 404" }]]),
    });
    expect(report).toContain("possibly out of date");
    expect(report).toMatch(/Not checked for more than 30 days\n\n- Synthetic event \(`stale`\)/);
    expect(report).toContain("details link answered 404");
    expect(report).toMatch(/Cancelled, still listed\n\n- Synthetic event \(`cancelled`\)/);
    expect(report).toMatch(/Dates not confirmed\n\n- Synthetic event \(`undated`\)/);
    expect(report).toContain("(`old`): finished 2026-06-01");
    expect(report).not.toContain("(`recorded`): finished");
  });

  it("says the link check was skipped rather than implying links are fine", () => {
    const report = buildLearningDirectoryReport({
      directory: { lastCheckedOn: "2026-10-20", items: [entry()] },
      todayPerth: "2026-10-21",
    });
    expect(report).toContain("Not checked this run (offline).");
  });

  it("uses the Perth calendar date", () => {
    expect(perthToday(new Date("2026-10-21T17:30:00Z"))).toBe("2026-10-22");
  });

  it("runs on main only, reports only, and keeps issue writes off the job that runs repository code", () => {
    const workflow = readFileSync(".github/workflows/learning-directory-weekly.yml", "utf8");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain('const HEADING = "# WA learning directory weekly report";');
    const [reportJob, publishJob] = workflow.split("\n  report:\n")[1]!.split("\n  publish:\n");
    expect(reportJob).not.toContain("issues: write");
    expect(publishJob).toContain("issues: write");
    expect(publishJob).not.toContain("actions/checkout");
    expect(workflow).not.toMatch(/git (commit|push)|pulls\.create|createPullRequest/);
  });
});
