import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SUMMARY_MARKER,
  SUMMARY_SOURCES,
  assessSource,
  collectAssessments,
  overallStatus,
  perthDate,
  readDigestState,
  readMainCiOutstanding,
  renderDailyHealthSummary,
} from "../scripts/lib/daily-health-summary.mjs";
import { answerQualityLine, answerSpeedLine } from "../scripts/lib/daily-health-summary-answer-lines.mjs";
import { TREND_TITLE } from "../scripts/lib/eval-canary-trend.mjs";

const NOW = "2026-10-25T23:00:00Z"; // Monday 26 October 2026, 7 am in Perth
const source = (key: string) => SUMMARY_SOURCES.find((item) => item.key === key)!;
const run = (hoursAgo: number) => ({ updated_at: new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString() });
const issue = (fields: Record<string, unknown>) => ({
  number: 41,
  html_url: "https://github.com/BigSimmo/PsychSift/issues/41",
  state: "open",
  updated_at: NOW,
  ...fields,
});

describe("daily health summary: judging each check", () => {
  it("calls a check green when its workflow ran on time and its issue is closed", () => {
    const result = assessSource(source("live-site"), {
      latestRun: run(2),
      issue: issue({ state: "closed" }),
      now: NOW,
    });
    expect(result).toMatchObject({ status: "green" as const, detail: "all clear" });
  });

  it("calls a check red while its auto-closing failure issue is open, and links the issue", () => {
    const result = assessSource(source("data-separation"), { latestRun: run(3), issue: issue({}), now: NOW });
    expect(result.status).toBe("red");
    expect(result.link).toBe("[#41](https://github.com/BigSimmo/PsychSift/issues/41)");
  });

  it("never calls a monitor healthy when it has stopped running", () => {
    const silent = assessSource(source("live-site"), { latestRun: run(30), issue: null, now: NOW });
    expect(silent.status).toBe("red");
    expect(silent.detail).toContain("has not run for 30 hours");

    const never = assessSource(source("uploads"), { latestRun: null, issue: null, now: NOW });
    expect(never.status).toBe("red");
    expect(never.detail).toContain("no completed run on record");
  });

  it("keeps the last known problem when a check is also stale", () => {
    const result = assessSource(source("database"), { latestRun: run(24 * 9), issue: issue({}), now: NOW });
    expect(result.status).toBe("red");
    expect(result.detail).toContain("last known: the live database does not match");
  });

  it("does not treat CI on main as stale, because it runs on merges, not a schedule", () => {
    const result = assessSource(source("ci-main"), { latestRun: null, issue: null, now: NOW });
    expect(result.status).toBe("green");
  });

  // 22-24 Oct 2026: one flaky Safari tablet leg kept the summary red for three days while every
  // required check passed. Only a list made of browser legs or the advisory visual baselines is
  // amber; anything else, or anything unreadable, stays red.
  describe("CI on main: browser-only failures are amber", () => {
    const pending = (names: string[]) =>
      `<!-- main-ci-pending:v1:${encodeURIComponent(
        JSON.stringify(
          names.map((name) => ({ name, sha: "989565b0ad2c", runId: "39941788372", conclusion: "failure" })),
        ),
      )} -->`;
    const ciIssue = (body: string, login = "github-actions[bot]") => issue({ body, user: { login } });

    it("is amber when only cross-browser legs or advisory baselines are outstanding", () => {
      const result = assessSource(source("ci-main"), {
        issue: ciIssue(pending(["release-browser-matrix (webkit, tablet, 3, 4)", "Visual baselines (advisory)"])),
        now: NOW,
      });
      expect(result).toMatchObject({
        status: "amber",
        detail: "only the extra browser tests or the advisory screenshot checks are failing; the required checks pass",
      });
      expect(readMainCiOutstanding(ciIssue(pending(["release-browser-matrix (firefox, firefox, 1, 4)"])))).toEqual({
        advisoryOnly: true,
      });
    });

    it.each([
      ["a required job is outstanding", pending(["release-browser-matrix (webkit, tablet, 3, 4)", "PR required"])],
      ["an unidentified prior failure", pending(["Unidentified prior failure (manual review required)"])],
      [
        "the browser legs could not be listed",
        pending(["release-browser-matrix (unidentified checks; manual review required)"]),
      ],
      ["only the matrix aggregate is named", pending(["release-browser-matrix"])],
      ["the list is empty", pending([])],
      ["the marker is missing", "CI has unresolved failures on `main`."],
      ["the marker is unreadable", "<!-- main-ci-pending:v1:%7Bnot-json -->"],
    ])("stays red when %s", (_label, body) => {
      const result = assessSource(source("ci-main"), { issue: ciIssue(body), now: NOW });
      expect(result).toMatchObject({ status: "red", detail: "checks on main are failing" });
    });

    it("stays red when someone other than the workflow wrote the issue", () => {
      const body = pending(["release-browser-matrix (webkit, tablet, 3, 4)"]);
      const result = assessSource(source("ci-main"), { issue: ciIssue(body, "someone"), now: NOW });
      expect(result.status).toBe("red");
    });
  });

  it("counts recent Sentry reports as amber, and ignores an issue that has gone quiet", () => {
    const recent = assessSource(source("errors"), {
      latestRun: run(0.2),
      issue: issue({}),
      recentMarkers: 3,
      botActivityAt: NOW,
      now: NOW,
    });
    expect(recent).toMatchObject({ status: "amber", detail: "3 new error types in the last 24 hours" });

    const quiet = assessSource(source("errors"), {
      latestRun: run(0.2),
      issue: issue({}),
      botActivityAt: "2026-10-20T00:00:00Z",
      now: NOW,
    });
    expect(quiet.status).toBe("green");
  });

  it("clears a failed canary once a later run passes, but not while the failing run is the latest", () => {
    const failedAt = "2026-10-19T18:30:00Z";
    const recovered = assessSource(source("canary"), {
      latestRun: run(30),
      clearingRun: { ...run(30), conclusion: "success", event: "schedule" },
      issue: issue({}),
      botActivityAt: failedAt,
      now: NOW,
    });
    expect(recovered.status).toBe("green");

    // A manual run never posts on failure, so its pass proves nothing about the alert.
    const manual = assessSource(source("canary"), {
      latestRun: run(30),
      clearingRun: { ...run(30), conclusion: "success", event: "workflow_dispatch" },
      issue: issue({}),
      botActivityAt: failedAt,
      now: NOW,
    });
    expect(manual.status).toBe("red");

    const stillFailing = assessSource(source("canary"), {
      latestRun: { updated_at: "2026-10-19T18:35:00Z", conclusion: "failure" },
      issue: issue({}),
      botActivityAt: failedAt,
      now: NOW,
    });
    expect(stillFailing).toMatchObject({ status: "red", detail: "the last weekly canary failed" });
  });

  it("says too few answers were seen rather than 'within limits' on a quiet day (EM-N2)", () => {
    const quiet = assessSource(source("answers"), {
      latestRun: run(1),
      issue: issue({
        body: "**Service readiness:** 🟢 ok\n**Alert state:** none (0)\nFewer than 10 answers: source-gap, unsupported and latency-budget rates are not judged.",
      }),
      now: NOW,
    });
    expect(quiet).toMatchObject({ status: "green", detail: "service ok, too few answers to judge quality" });
  });

  it("reports the switched-off reindex probe as green, and its alert as amber once armed", () => {
    expect(assessSource(source("reindex"), { latestRun: null, issue: null, now: NOW }).status).toBe("green");
    const alerted = assessSource(source("reindex"), {
      latestRun: { updated_at: "2026-10-25T19:50:00Z", conclusion: "failure" },
      issue: issue({}),
      botActivityAt: "2026-10-25T19:49:00Z",
      now: NOW,
    });
    expect(alerted).toMatchObject({ status: "amber" });

    // A dispatched dry run exits 0 even with abandoned rows, so it must not clear the alert.
    const dryRun = assessSource(source("reindex"), {
      latestRun: { updated_at: "2026-10-25T21:00:00Z", conclusion: "success", event: "repository_dispatch" },
      clearingRun: { updated_at: "2026-10-25T19:50:00Z", conclusion: "failure", event: "schedule" },
      issue: issue({}),
      botActivityAt: "2026-10-25T19:49:00Z",
      now: NOW,
    });
    expect(dryRun.status).toBe("amber");

    // Once a scheduled pass has cleared it, a later dispatched run does not bring the alert back.
    const clearedThenDispatched = assessSource(source("reindex"), {
      latestRun: { updated_at: "2026-10-25T21:00:00Z", conclusion: "success", event: "repository_dispatch" },
      clearingRun: { updated_at: "2026-10-25T20:30:00Z", conclusion: "success", event: "schedule" },
      issue: issue({}),
      botActivityAt: "2026-10-25T19:49:00Z",
      now: NOW,
    });
    expect(clearedThenDispatched.status).toBe("green");
  });

  it("judges a reused issue by the workflow's own activity, not by anyone's comment moving updated_at", () => {
    // A human comment bumps updated_at to now, but the bot last posted six days ago.
    const commentedOn = assessSource(source("uploads"), {
      latestRun: run(1),
      issue: issue({ updated_at: NOW }),
      botActivityAt: "2026-10-19T23:00:00Z",
      now: NOW,
    });
    expect(commentedOn.status).toBe("green");
  });

  it("reads only allow-listed status words from the ops digest", () => {
    expect(readDigestState("**Service readiness:** 🟢 ok\n\n**Alert state:** none (0)")).toEqual({
      status: "ok",
      severity: "none",
      count: 0,
      lowVolume: false,
    });
    expect(readDigestState("**Service readiness:** 🔴 pwned\n**Alert state:** evil (1)")).toMatchObject({
      status: "unknown",
      severity: "unknown",
    });
  });

  it("grades the ops digest by its alert state", () => {
    const digest = (body: string) =>
      assessSource(source("answers"), { latestRun: run(5), issue: issue({ body }), now: NOW });
    expect(digest("**Service readiness:** 🟢 ok\n**Alert state:** none (0)").status).toBe("green");
    expect(digest("**Service readiness:** 🟢 ok\n**Alert state:** warning (1)").status).toBe("amber");
    expect(digest("**Service readiness:** 🟠 degraded\n**Alert state:** none (0)").status).toBe("amber");
    expect(digest("**Service readiness:** 🟢 ok\n**Alert state:** page (2)").status).toBe("red");
  });
});

describe("daily health summary: the issue it writes", () => {
  type Assessments = Parameters<typeof renderDailyHealthSummary>[0]["assessments"];
  const green: Assessments = SUMMARY_SOURCES.map((item) => ({
    key: item.key,
    name: item.name,
    status: "green",
    detail: "all clear",
    link: "",
  }));

  it("dates the summary in Perth time", () => {
    expect(perthDate(NOW)).toEqual({ label: "Monday 26 October 2026", weekday: "Monday" });
  });

  it("says nothing needs you when every check is green", () => {
    const { overall, body } = renderDailyHealthSummary({ now: NOW, assessments: green });
    expect(overall).toBe("green");
    expect(body).toContain("## 🟢 Green: Monday 26 October 2026");
    expect(body).toContain("Nothing needs you today.");
    expect(body).toContain(SUMMARY_MARKER);
  });

  it("leads with the checks that need a look, worst status first in the heading", () => {
    const assessments = green.map((item) =>
      item.key === "uploads"
        ? { ...item, status: "amber" as const, detail: "stuck uploads", link: "[#9](https://x/9)" }
        : item,
    );
    const { overall, body } = renderDailyHealthSummary({ now: NOW, assessments });
    expect(overall).toBe("amber");
    expect(body).toContain("One thing needs a look today:");
    expect(body).toContain("- **Upload queue:** stuck uploads ([#9](https://x/9))");
    expect(overallStatus([...assessments, { ...green[0]!, status: "red" as const }])).toBe("red");
  });

  it("holds a slot for the two answer lines, and keeps each to one line", () => {
    const empty = renderDailyHealthSummary({ now: NOW, assessments: green }).body;
    expect(empty).toContain("- **Answer quality:** Not measured yet");
    expect(empty).toContain("- **Answer speed:** Not measured yet");

    const filled = renderDailyHealthSummary({
      now: NOW,
      assessments: green,
      answerLines: { quality: "40 of 44 passing\nsteady 4 weeks", speed: "p95 9.1 s" },
    }).body;
    expect(filled).toContain("- **Answer quality:** 40 of 44 passing steady 4 weeks");
    expect(filled).toContain("- **Answer speed:** p95 9.1 s");
  });

  it("adds the weekly reports on Mondays only", () => {
    const reports = [{ name: "Dependency report", link: "[#7](https://x/7)" }];
    expect(renderDailyHealthSummary({ now: NOW, assessments: green, mondayReports: reports }).body).toContain(
      "### Monday reports",
    );
    const tuesday = "2026-10-26T23:00:00Z";
    expect(renderDailyHealthSummary({ now: tuesday, assessments: green, mondayReports: reports }).body).not.toContain(
      "### Monday reports",
    );
  });

  it("prints no answer lines when nothing is configured", async () => {
    expect(await answerQualityLine({ owner: "o", repo: "r", env: {}, now: NOW })).toBeNull();
    expect(await answerSpeedLine({ env: {} })).toBeNull();
  });

  it("hands the workflow's repository and ISO time to the quality line", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const body = url.includes("/issues?") ? [{ number: 7, title: TREND_TITLE }] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    await answerQualityLine({ owner: "o", repo: "r", env: { GITHUB_TOKEN: "t" }, now: NOW, fetchImpl });
    expect(urls[0]).toContain("/repos/o/r/issues?");
    expect(decodeURIComponent(urls[1] ?? "")).toContain("since=2026-09-25T23:00:00.000Z");
  });
});

describe("daily health summary: reading GitHub", () => {
  it("copies no issue title or body text into the summary", async () => {
    const github = {
      rest: {
        actions: {
          listWorkflowRuns: async () => ({ data: { workflow_runs: [run(1)] } }),
        },
        issues: {
          listForRepo: async () => ({
            data: [
              issue({
                title: "Patient John Citizen leaked",
                body: "**Service readiness:** 🟢 ok\n**Alert state:** none (0)\nsecret error text",
              }),
            ],
          }),
          listComments: async () => ({
            data: [
              {
                user: { login: "github-actions[bot]" },
                created_at: NOW,
                body: "<!-- sentry-issue:1 --> <!-- sentry-issue:2 -->",
              },
              { user: { login: "someone" }, created_at: NOW, body: "<!-- sentry-issue:3 --> forged" },
            ],
          }),
        },
      },
    };
    const assessments = await collectAssessments({ github, owner: "BigSimmo", repo: "PsychSift", now: NOW });
    expect(assessments).toHaveLength(SUMMARY_SOURCES.length);
    expect(assessments.find((item) => item.key === "errors")?.detail).toBe("2 new error types in the last 24 hours");
    const { body } = renderDailyHealthSummary({ now: NOW, assessments });
    expect(body).not.toContain("John Citizen");
    expect(body).not.toContain("secret error text");
  });

  it("marks a check red when GitHub cannot be read, rather than dropping it", async () => {
    const github = {
      rest: {
        actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: [] } }) },
        issues: {
          listForRepo: async () => {
            throw new Error("API rate limit");
          },
          listComments: async () => ({ data: [] }),
        },
      },
    };
    const assessments = await collectAssessments({ github, owner: "BigSimmo", repo: "PsychSift", now: NOW });
    expect(assessments.every((item) => item.status === "red")).toBe(true);
  });
});

describe("daily health summary: trial runs and second alert threads", () => {
  const failedAt = "2026-10-24T18:30:00Z";
  function canaryGithub({
    runs,
    issues,
  }: {
    runs: Array<Record<string, unknown>>;
    issues: Array<Record<string, unknown>>;
  }) {
    return {
      rest: {
        actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: runs } }) },
        issues: {
          listForRepo: async ({ labels, state }: { labels: string; state: string }) => ({
            data: labels === "eval-canary" && state === "open" ? issues : [],
          }),
          listComments: async ({ issue_number }: { issue_number: number }) => ({
            data:
              issue_number === 52 ? [{ user: { login: "github-actions[bot]" }, created_at: failedAt, body: "" }] : [],
          }),
        },
      },
    };
  }

  it("does not let a shortened trial run clear a failed canary (EM-N3)", async () => {
    const github = canaryGithub({
      runs: [
        {
          ...run(2),
          conclusion: "success",
          event: "repository_dispatch",
          display_title: "Eval Canary (trial run, does not clear alerts)",
        },
      ],
      issues: [issue({ number: 52 })],
    });
    const assessments = await collectAssessments({ github, owner: "BigSimmo", repo: "PsychSift", now: NOW });
    expect(assessments.find((item) => item.key === "canary")?.status).toBe("red");
  });

  it("finds the canary thread the bot posted on even when another thread was updated later (EM-N5)", async () => {
    const github = canaryGithub({
      runs: [{ ...run(30), conclusion: "failure", event: "schedule", display_title: "Eval Canary" }],
      issues: [issue({ number: 51, updated_at: NOW }), issue({ number: 52, updated_at: failedAt })],
    });
    const assessments = await collectAssessments({ github, owner: "BigSimmo", repo: "PsychSift", now: NOW });
    const canary = assessments.find((item) => item.key === "canary");
    expect(canary?.status).toBe("red");
    expect(canary?.link).toContain("#52");
  });

  it("marks only shortened or staged dispatches as trial runs", () => {
    const workflow = readFileSync(".github/workflows/eval-canary.yml", "utf8");
    expect(workflow).toContain("run-name: ${{ github.event_name == 'repository_dispatch' &&");
    expect(workflow).toContain("answer_case_limit < 44");
    expect(workflow).toContain("'Eval Canary (trial run, does not clear alerts)'");
  });
});

describe("daily health summary workflow", () => {
  const workflow = readFileSync(".github/workflows/daily-health-summary.yml", "utf8");

  it("runs at 7 am Perth time every day, and by hand", () => {
    expect(workflow).toContain('- cron: "0 23 * * *"');
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("can read runs and write issues, and nothing else", () => {
    expect(workflow).toMatch(/permissions:\n\s+actions: read\n\s+contents: read\n\s+issues: write/);
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("passes the answer lines what they need", () => {
    expect(workflow).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("PROD_HEALTH_URL: ${{ vars.PROD_HEALTH_URL }}");
    expect(workflow).toContain("HEALTH_DEEP_PROBE_SECRET: ${{ secrets.HEALTH_DEEP_PROBE_SECRET }}");
  });
});
