import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { decide } from "../.claude/hooks/github-read-allow.mjs";

const wrapper = join(process.cwd(), ".claude/hooks/github-read-allow.sh");

function runHook(payload: unknown): string {
  const result = spawnSync("bash", [wrapper], { input: JSON.stringify(payload), encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout;
}

// Read-only lookups threads in this project actually run while waiting on CI and review.
const reads = [
  "gh api repos/BigSimmo/PsychSift/pulls/3433",
  "gh api repos/BigSimmo/PsychSift/pulls/3433 --jq '.merged, .state, .mergeable_state'",
  "gh api repos/BigSimmo/PsychSift/commits/b6dbf32eb/check-runs --paginate --jq '.check_runs[] | {name, status, conclusion}'",
  "gh api repos/BigSimmo/PsychSift/actions/runs/123456/jobs",
  "gh api repos/BigSimmo/PsychSift/actions/jobs/987654/logs | tail -n 200",
  "gh api repos/BigSimmo/PsychSift/pulls/3433/comments?per_page=100",
  "gh api 'repos/BigSimmo/PsychSift/pulls?state=open&per_page=50' --jq '.[].number'",
  "gh api repos/BigSimmo/PsychSift/pulls/3433/reviews -H 'Accept: application/vnd.github+json'",
  "gh api -X GET repos/BigSimmo/PsychSift/issues/3433/comments",
  "gh api --method=GET /repos/bigsimmo/psychsift/commits/main/status",
  "gh api repos/BigSimmo/PsychSift/pulls/3433/files --paginate",
  "gh api repos/BigSimmo/PsychSift/pulls/3433 2>/dev/null | jq -r .state",
  "cd /home/claude/PsychSift && gh api repos/BigSimmo/PsychSift/pulls/3433 --jq .mergeable",
  "gh pr view 3433 --json state,mergedAt,statusCheckRollup",
  "gh pr view 3433 --json statusCheckRollup | jq '.statusCheckRollup[] | select(.conclusion != \"SUCCESS\")'",
  "gh pr checks 3433",
  "gh run view 123456 --log-failed | grep -n Error | head -40",
  "gh run list --branch claude/x --limit 5",
  "gh pr view 3433 --comments 2>&1 | head -100",
];

// Anything that can change GitHub state must still prompt, or at least never be pre-approved.
const writes = [
  "gh api repos/BigSimmo/PsychSift/pulls/3433/merge -X PUT",
  "gh api -XPOST repos/BigSimmo/PsychSift/issues/3433/comments -f body=hi",
  "gh api --method POST repos/BigSimmo/PsychSift/pulls/3433/requested_reviewers -f 'reviewers[]=x'",
  "gh api --method=PATCH repos/BigSimmo/PsychSift/pulls/3433 -f state=closed",
  "gh api -X DELETE repos/BigSimmo/PsychSift/git/refs/heads/feature",
  "gh api repos/BigSimmo/PsychSift/issues/3433/comments -f body=hello",
  "gh api repos/BigSimmo/PsychSift/issues/3433/comments -F body=@note.md",
  "gh api repos/BigSimmo/PsychSift/issues/3433/comments --field body=x",
  "gh api repos/BigSimmo/PsychSift/issues/3433/comments --raw-field body=x",
  "gh api repos/BigSimmo/PsychSift/issues/3433/comments --input body.json",
  "gh api -X GET repos/BigSimmo/PsychSift/issues -f state=all",
  "gh api repos/BigSimmo/PsychSift/actions/workflows/ci.yml/dispatches -f ref=main",
  "gh api repos/BigSimmo/PsychSift/dispatches -X POST --input payload.json",
  "gh api graphql -f query='mutation { mergePullRequest(input: {}) { clientMutationId } }'",
  "gh api repos/BigSimmo/PsychSift/pulls/1 -H 'X-HTTP-Method-Override: PUT'",
  "gh api repos/BigSimmo/PsychSift/pulls/1 && gh api -X PUT repos/BigSimmo/PsychSift/pulls/1/merge",
  "gh api repos/BigSimmo/PsychSift/pulls/1 > pr.json",
  "gh api repos/BigSimmo/PsychSift/pulls/$(cat n)",
  "gh api repos/BigSimmo/PsychSift/pulls/1 & rm -rf x",
  "FOO=1 gh api repos/BigSimmo/PsychSift/pulls/1",
  "timeout 30 gh api -X POST repos/BigSimmo/PsychSift/issues/1/comments -f body=x",
  "bash -c 'gh api -X POST repos/BigSimmo/PsychSift/issues/1/comments -f body=x'",
  "gh api repos/other/repo/pulls/1",
  "gh api repos/BigSimmo/PsychSift/pulls/1 | head -n 5 .env.local",
  "gh api repos/BigSimmo/PsychSift/pulls/1 && grep '' .env.local",
  "cd /tmp && gh api repos/other/repo/pulls/1",
];

const sensitiveReads = [
  "gh auth status --show-token",
  "gh auth status -t",
];

// Writes that are not `gh api`: the hook leaves them to the normal permission flow.
const untouchedWrites = [
  "gh pr merge 3433 --squash",
  "gh pr create --title x --body y",
  "gh pr edit 3433 --add-label x",
  "gh pr comment 3433 --body hi",
  "gh pr review 3433 --approve",
  "gh pr ready 3433",
  "gh workflow run ci.yml --ref main",
  "gh run rerun 123456",
  "gh issue comment 1 --body x",
  "gh pr view 3433 && gh pr merge 3433",
  "gh pr view 3433 | tee out.txt",
  "git push -u origin claude/x",
  "git push --no-verify origin claude/x",
];

describe("github-read-allow hook", () => {
  it.each(reads)("allows read: %s", (command) => {
    expect(decide(command)).toBe("allow");
  });

  it.each(writes)("prompts for gh api write: %s", (command) => {
    expect(decide(command)).toBe("ask");
  });

  it.each(sensitiveReads)("does not pre-approve sensitive reads: %s", (command) => {
    expect(decide(command)).not.toBe("allow");
  });

  it.each(untouchedWrites)("does not pre-approve: %s", (command) => {
    expect(decide(command)).toBeNull();
  });

  it("ignores commands that never mention gh", () => {
    expect(decide("npm run test")).toBeNull();
    expect(decide("ls -la")).toBeNull();
  });

  it("emits a PreToolUse allow through the shell wrapper", () => {
    const out = JSON.parse(
      runHook({ tool_name: "Bash", tool_input: { command: "gh api repos/BigSimmo/PsychSift/pulls/1" } }),
    );
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "allow" });
  });

  it("emits ask for a write through the shell wrapper", () => {
    const out = JSON.parse(
      runHook({ tool_name: "Bash", tool_input: { command: "gh api -X PUT repos/BigSimmo/PsychSift/pulls/1/merge" } }),
    );
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("stays silent on non-gh commands, other tools and malformed payloads", () => {
    expect(runHook({ tool_name: "Bash", tool_input: { command: "npm test" } })).toBe("");
    expect(
      runHook({ tool_name: "PowerShell", tool_input: { command: "gh api repos/BigSimmo/PsychSift/pulls/1" } }),
    ).toBe("");
    const raw = spawnSync("bash", [wrapper], { input: "{not json gh", encoding: "utf8" });
    expect(raw.status).toBe(0);
    expect(raw.stdout).toBe("");
  });

  it("replaces the Bash gh api ask rule rather than sitting beside it", () => {
    // Ask rules win over a hook's allow, so the hook only works if the rule is gone.
    const settings = JSON.parse(readFileSync(join(process.cwd(), ".claude/settings.json"), "utf8"));
    expect(settings.permissions.ask).not.toContain("Bash(gh api:*)");
    const registered = JSON.stringify(settings.hooks.PreToolUse);
    expect(registered).toContain(".claude/hooks/github-read-allow.sh");
  });
});
