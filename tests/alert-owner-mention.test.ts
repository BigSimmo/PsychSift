import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Audit EVAL-04 (2026-10-20): only the ops digest @mentioned the owner. The other alert
 * workflows relied on issue assignment, which GitHub mobile pushes once, when the assignment
 * happens; a repeat alert posted as a comment on the same reused issue pushes nothing by itself.
 * The repository also said both things at once ("assignee ... for every later comment" next to
 * "assignment alone would push only the first alert"). Every alert workflow now names the owner
 * in each new alert issue and each repeat comment, the delivery path the owner chose on
 * 2026-10-19 (docs/decisions/2026-10-19-production-alerts-by-phone.md).
 */
const ALERT_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/eval-canary.yml",
  ".github/workflows/ingestion-autopilot.yml",
  ".github/workflows/live-domain-monitor.yml",
  ".github/workflows/live-drift.yml",
  ".github/workflows/ops-digest.yml",
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

describe("alert workflows mention the owner (audit EVAL-04)", () => {
  it.each(ALERT_WORKFLOWS)("%s names the owner in every new alert and repeat comment", (path) => {
    const source = readFileSync(path, "utf8");
    const writes = issueWrites(source);
    expect(writes.length, `${path} posts no issue alert`).toBeGreaterThan(0);
    for (const write of writes) {
      // A green-run "Resolved" note is good news, not an alert, and need not push.
      if (/Resolved —/.test(write.text)) continue;
      // The ops digest's rolling issue is a snapshot, not an alert; its attention comment is.
      // Sentry's issue is an empty container: the alert is the mentioned comment posted into it
      // straight away, so mentioning both would push the first alert twice.
      if ((path.endsWith("ops-digest.yml") || path.endsWith("sentry-alerts.yml")) && write.kind === "create") continue;
      // The canary's weekly trend row (audit EVAL-06) is a record, not an alert, and must not
      // push to the phone every week.
      if (path.endsWith("eval-canary.yml") && /trend\.TREND_|issue_number: issueNumber,\n\s+body,\n/.test(write.text))
        continue;
      expect(write.text, `${path}: ${write.kind} must mention the owner`).toMatch(
        /\$\{alertMention\}|@\$\{alertAssignee\}/,
      );
    }
    if (!path.endsWith("ops-digest.yml")) {
      expect(source).toContain("const alertMention = `@${alertAssignee}`;");
    }
  });

  it("no longer claims that assignment alone pushes every later comment", () => {
    for (const path of [...ALERT_WORKFLOWS, "tests/ops-digest.test.ts"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(/for every later comment/);
      expect(source, path).not.toMatch(/pushes an assignee's issue activity/);
    }
  });
});
