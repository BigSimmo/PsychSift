import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { assessDeploymentFreshness, matchesWatchPatterns } from "../scripts/check-live-deployment-freshness.mjs";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-14T10:00:00Z");

function commit(sha: string, isoDate: string) {
  return { sha, commit: { committer: { date: isoDate } } };
}

function compareAhead(commits: ReturnType<typeof commit>[]) {
  return { status: "ahead", ahead_by: commits.length, commits };
}

const assess = (
  compare: unknown,
  liveSha: string | null = "a".repeat(40),
  maxLagHours = 12,
  watchPatterns?: string[],
) => assessDeploymentFreshness({ liveSha, compare, nowMs: NOW, maxLagHours, watchPatterns } as never);

const LIVE = "a".repeat(40);
const APP_WATCH_PATTERNS: string[] = JSON.parse(readFileSync("railway.app.json", "utf8")).build.watchPatterns;

function linked(sha: string, isoDate: string, parents: string[]) {
  return { sha, parents: parents.map((parent) => ({ sha: parent })), commit: { committer: { date: isoDate } } };
}

describe("live deployment freshness", () => {
  it("is happy when production is at the branch head", () => {
    expect(assess({ status: "identical" }).ok).toBe(true);
  });

  it("tolerates ordinary deploy lag, which is minutes", () => {
    const result = assess(compareAhead([commit("b".repeat(40), "2026-09-14T09:50:00Z")]));

    expect(result.ok).toBe(true);
    expect(result.lagHours).toBeCloseTo(1 / 6, 5);
  });

  /**
   * The false negative that a previous version of this check shipped with, and the reason the
   * metric is the OLDEST unshipped commit rather than the age of the branch head.
   *
   * During the real incident (2026-09-11 to 2026-09-14) main moved every 0 to 57 minutes — never a
   * gap above one hour — while production stayed stranded for three days. Measuring `now - head
   * committed at` resets on every merge, so against a threshold of hours it reads well under an
   * hour and stays green for the entire outage. A busy repository is exactly when shipping matters
   * most, which makes that metric not merely weak but inverted.
   */
  it("still fires while main is advancing every few minutes, which is how the real outage looked", () => {
    // 72 hours of commits landing every 30 minutes, none of them deployed.
    const commits = Array.from({ length: 144 }, (_, i) =>
      commit(String(i).padStart(40, "0"), new Date(NOW - 72 * HOUR + i * 0.5 * HOUR).toISOString()),
    );
    // The newest commit is 30 minutes old, so any head-age metric reports ~0.5h and says nothing.
    const newestAgeHours = (NOW - Date.parse(commits.at(-1)!.commit.committer.date)) / HOUR;
    expect(newestAgeHours).toBeLessThan(1);

    const result = assess(compareAhead(commits));

    expect(result.ok, "a detector that is green during its own outage is not a detector").toBe(false);
    expect(result.code).toBe("stranded");
    expect(result.lagHours).toBeCloseTo(72, 1);
    expect(result.behindBy).toBe(144);
  });

  it("clears the moment a deploy lands, however far behind it had fallen", () => {
    expect(assess({ status: "identical" }).ok).toBe(true);
  });

  it("alarms when production is running something that is not on the branch at all", () => {
    for (const status of ["diverged", "behind", "unknown"]) {
      const result = assess({ status });
      expect(result.ok, status).toBe(false);
      expect(result.code).toBe("not_on_branch");
    }
  });

  it("fails closed when the deployment identity or the comparison is missing", () => {
    expect(assess({ status: "identical" }, null).code).toBe("no_deployment_sha");
    expect(assess(null).code).toBe("compare_unavailable");
    expect(assess({ status: "ahead", ahead_by: 3, commits: [] }).code).toBe("compare_unavailable");
  });

  it("falls back to the author date when a commit carries no committer date", () => {
    const result = assess({
      status: "ahead",
      ahead_by: 1,
      commits: [{ sha: "c".repeat(40), commit: { author: { date: "2026-09-10T10:00:00Z" } } }],
    });

    expect(result.ok).toBe(false);
    expect(result.lagHours).toBeCloseTo(96, 1);
  });

  /**
   * 2026-10-21 (#3685): a pull request whose branch commits were authored a day earlier merged
   * minutes before the probe. Dating the outage by the branch commit read as 24h stranded; the
   * change only landed on main ten minutes ago.
   */
  it("dates the outage from when a change landed on main, not when its branch commits were written", () => {
    const branchWork = linked("b".repeat(40), "2026-09-13T10:00:00Z", [LIVE]);
    const merge = linked("c".repeat(40), "2026-09-14T09:50:00Z", [LIVE, branchWork.sha]);
    const result = assess({ status: "ahead", ahead_by: 2, commits: [branchWork, merge] });

    expect(result.ok).toBe(true);
    expect(result.code).toBe("shipping");
    expect(result.lagHours).toBeCloseTo(1 / 6, 5);
    expect(result.behindBy).toBe(2);
  });

  it("still fires from the first landed change while later merges keep arriving", () => {
    const firstMerge = linked("d".repeat(40), "2026-09-13T08:00:00Z", [LIVE, "e".repeat(40)]);
    const branchWork = linked("e".repeat(40), "2026-09-10T08:00:00Z", [LIVE]);
    const laterMerge = linked("f".repeat(40), "2026-09-14T09:55:00Z", [firstMerge.sha]);
    const result = assess({ status: "ahead", ahead_by: 3, commits: [branchWork, firstMerge, laterMerge] });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("stranded");
    expect(result.lagHours).toBeCloseTo(26, 1);
  });

  it("falls back to the oldest listed commit when the comparison is truncated", () => {
    const listed = [linked("b".repeat(40), "2026-09-13T10:00:00Z", ["9".repeat(40)])];
    const result = assess({ status: "ahead", ahead_by: 400, commits: listed });

    expect(result.ok).toBe(false);
    expect(result.lagHours).toBeCloseTo(24, 1);
  });

  it("treats a gap of changes the app service never deploys as nothing to ship", () => {
    const compare = {
      ...compareAhead([commit("b".repeat(40), "2026-09-12T10:00:00Z")]),
      files: [{ filename: "docs/outstanding-issues.md" }, { filename: ".github/workflows/ci.yml" }],
    };
    const result = assess(compare, LIVE, 12, APP_WATCH_PATTERNS);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("nothing_to_ship");
  });

  it("does not excuse a gap that includes app code, or a file list that may be cut short", () => {
    const stale = compareAhead([commit("b".repeat(40), "2026-09-12T10:00:00Z")]);
    const withCode = { ...stale, files: [{ filename: "docs/a.md" }, { filename: "src/app/page.tsx" }] };
    expect(assess(withCode, LIVE, 12, APP_WATCH_PATTERNS).code).toBe("stranded");

    const capped = { ...stale, files: Array.from({ length: 300 }, (_, i) => ({ filename: `docs/${i}.md` })) };
    expect(assess(capped, LIVE, 12, APP_WATCH_PATTERNS).code).toBe("stranded");

    const docsOnly = { ...stale, files: [{ filename: "docs/a.md" }] };
    expect(assess(docsOnly, LIVE, 12, []).code, "no patterns means no filtering").toBe("stranded");
  });

  it("matches Railway watch patterns, including root anchors, globstars and exclusions", () => {
    expect(matchesWatchPatterns("src/app/page.tsx", APP_WATCH_PATTERNS)).toBe(true);
    expect(matchesWatchPatterns("Dockerfile", APP_WATCH_PATTERNS)).toBe(true);
    expect(matchesWatchPatterns("scripts/deploy/await-migrations.mjs", APP_WATCH_PATTERNS)).toBe(true);
    expect(matchesWatchPatterns("data/repo-awareness-snapshot.json", APP_WATCH_PATTERNS)).toBe(false);
    expect(matchesWatchPatterns("docs/deployment-architecture.md", APP_WATCH_PATTERNS)).toBe(false);
    expect(matchesWatchPatterns("worker/Dockerfile.src/x.ts", ["/src/**"])).toBe(false);
  });
});
