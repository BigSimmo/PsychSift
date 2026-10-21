import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Who pushes to the owner's phone.
 *
 * Audit EVAL-04 (2026-10-20) made every alert workflow @mention the owner, because GitHub mobile
 * pushes direct mentions (docs/decisions/2026-10-19-production-alerts-by-phone.md). On 2026-10-21
 * the owner replaced those pushes with one daily health summary at 7 am Perth time
 * (docs/decisions/2026-10-21-one-daily-health-summary.md). Exactly three places may mention the
 * owner now: the daily summary itself, the live domain monitor when it opens a failure issue
 * (the site is down), and the ops digest's attention comment (answers at page level).
 */
const PUSHING_WORKFLOWS = [
  ".github/workflows/daily-health-summary.yml",
  ".github/workflows/live-domain-monitor.yml",
  ".github/workflows/ops-digest.yml",
];

const QUIET_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/eval-canary.yml",
  ".github/workflows/ingestion-autopilot.yml",
  ".github/workflows/live-drift.yml",
  ".github/workflows/reindex-reaper.yml",
  ".github/workflows/sentry-alerts.yml",
  ".github/workflows/staging-tenancy.yml",
];

/** Every `issues.create(` / `issues.createComment(` call with its balanced argument text. */
function issueWrites(source: string) {
  const calls: Array<{ kind: string; text: string }> = [];
  for (const match of source.matchAll(/github\.rest\.issues\.(create|createComment)\(/g)) {
    let depth = 0;
    let end = match.index! + match[0].length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push({ kind: match[1]!, text: source.slice(match.index!, end + 1) });
  }
  return calls;
}

const MENTION = /\$\{alertMention\}|@\$\{alertAssignee\}/;

describe("phone pushes come from the daily summary and two instant alerts only (owner decision 2026-10-21)", () => {
  it.each(QUIET_WORKFLOWS)("%s keeps its issue but mentions and assigns nobody", (path) => {
    const source = readFileSync(path, "utf8");
    const writes = issueWrites(source);
    expect(writes.length, `${path} posts no issue for the summary to read`).toBeGreaterThan(0);
    for (const write of writes)
      expect(write.text, `${path}: ${write.kind} must not mention the owner`).not.toMatch(MENTION);
    expect(source).not.toContain("alertMention");
    expect(source).not.toContain("addAssignees(");
    expect(source).toContain("docs/decisions/2026-10-21-one-daily-health-summary.md");
  });

  it("the daily health summary mentions the owner once per run, in its comment", () => {
    const source = readFileSync(".github/workflows/daily-health-summary.yml", "utf8");
    const writes = issueWrites(source);
    expect(writes.filter((write) => MENTION.test(write.text))).toEqual([
      expect.objectContaining({ kind: "createComment" }),
    ]);
  });

  it("the live domain monitor mentions the owner only when it opens a failure issue", () => {
    const source = readFileSync(".github/workflows/live-domain-monitor.yml", "utf8");
    const mentioning = issueWrites(source).filter((write) => MENTION.test(write.text));
    expect(mentioning.map((write) => write.kind)).toEqual(["create"]);
  });

  it("the ops digest mentions the owner only in its page-level attention comment", () => {
    const source = readFileSync(".github/workflows/ops-digest.yml", "utf8");
    const mentioning = issueWrites(source).filter((write) => MENTION.test(write.text));
    expect(mentioning.map((write) => write.kind)).toEqual(["createComment"]);
    expect(source).toContain('(context.eventName === "schedule" && severity === "page")');
  });

  it("no longer claims that assignment alone pushes every later comment", () => {
    for (const path of [...PUSHING_WORKFLOWS, ...QUIET_WORKFLOWS, "tests/ops-digest.test.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/for every later comment/);
      expect(source, path).not.toMatch(/pushes an assignee's issue activity/);
    }
  });
});
