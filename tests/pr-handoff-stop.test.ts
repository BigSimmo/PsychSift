import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hook = join(process.cwd(), ".claude/hooks/pr-handoff-stop.sh");
const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function freshRepo(): { root: string; gitDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pr-handoff-"));
  scratchRoots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  // No empty commit: git rev-parse --absolute-git-dir works without user.identity.
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return { root, gitDir };
}

/** A marker as post-mode writes it. `ageSeconds` backdates its mtime, so a test
 * can prove CronCreate stays denied regardless of how old the marker is — there
 * is no age-based expiry any more. */
function writeMarker(gitDir: string, sessionId: string, ageSeconds = 0): string {
  const path = join(gitDir, `claude-pr-handoff-${sessionId}`);
  writeFileSync(path, "pr-opened 2026-08-19T00:00:00Z\n");
  if (ageSeconds > 0) {
    const then = Math.floor(Date.now() / 1000) - ageSeconds;
    utimesSync(path, then, then);
  }
  return path;
}

function runHook(
  mode: "post" | "pre",
  payload: Record<string, unknown> | string,
  cwd: string,
  options?: { pathWithoutJq?: boolean; env?: Record<string, string> },
): { status: number | null; stdout: string; markerExists: (sessionId: string) => boolean; gitDir: string } {
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const env = { ...process.env, ...(options?.env ?? {}) };
  if (options?.pathWithoutJq) {
    // Keep a minimal PATH that can run the hook's shell utilities but cannot
    // resolve jq, so the quote-naive fallback path is exercised.
    const bin = mkdtempSync(join(tmpdir(), "no-jq-path-"));
    scratchRoots.push(bin);
    for (const name of ["bash", "cat", "grep", "sed", "tr", "date", "find", "touch", "head", "git"]) {
      const resolved = execFileSync("bash", ["-lc", `command -v ${name}`], {
        encoding: "utf8",
      }).trim();
      execFileSync("ln", ["-s", resolved, join(bin, name)]);
    }
    env.PATH = bin;
  }
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const result = spawnSync("bash", [hook, mode], {
    cwd,
    input,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    gitDir,
    markerExists: (sessionId: string) => existsSync(join(gitDir, `claude-pr-handoff-${sessionId}`)),
  };
}

// The hook is a Bash contract exercised on Linux CI. Windows' `bash.exe` is a
// WSL launcher: it cannot execute the native absolute paths this fixture gives
// it and can retain NTFS directory handles after exit. That is neither the
// hook's runtime nor meaningful Windows coverage, so avoid false local reds.
describe.skipIf(process.platform === "win32")("pr-handoff-stop hook — CronCreate only", () => {
  describe("post — marking a session as having an open PR", () => {
    it("does not treat create_pull_request_review as opening a PR", () => {
      const { root } = freshRepo();
      const out = runHook(
        "post",
        {
          tool_name: "create_pull_request_review",
          session_id: "sess-review",
          tool_response: "https://github.com/BigSimmo/PsychSift/pull/1649#pullrequestreview-1",
        },
        root,
      );
      expect(out.status).toBe(0);
      expect(out.markerExists("sess-review")).toBe(false);
      expect(out.stdout).toBe("");
    });

    it("writes a marker for create_pull_request when the response has a PR URL", () => {
      const { root } = freshRepo();
      const out = runHook(
        "post",
        {
          tool_name: "create_pull_request",
          session_id: "sess-create",
          tool_response: "Opened https://github.com/BigSimmo/PsychSift/pull/1649",
        },
        root,
      );
      expect(out.status).toBe(0);
      expect(out.markerExists("sess-create")).toBe(true);
      expect(out.stdout).toContain("PostToolUse");
    });

    it("tells the model to hand over the PR and never park a cron on it", () => {
      const { root } = freshRepo();
      const out = runHook(
        "post",
        {
          tool_name: "create_pull_request",
          session_id: "sess-context",
          tool_response: "Opened https://github.com/BigSimmo/PsychSift/pull/1649",
        },
        root,
      );
      expect(out.stdout).toContain("hand over its URL");
      expect(out.stdout).toContain("Never park a cron job on this PR");
      // No budget language should survive the simplification.
      expect(out.stdout).not.toMatch(/\d+[- ]minute/);
    });

    it("fails open for unsafe session ids instead of sharing unknown-session", () => {
      const { root, gitDir } = freshRepo();
      const out = runHook(
        "post",
        {
          tool_name: "create_pull_request",
          session_id: "../evil",
          tool_response: "https://github.com/BigSimmo/PsychSift/pull/1",
        },
        root,
      );
      expect(out.status).toBe(0);
      expect(out.markerExists("unknown-session")).toBe(false);
      expect(existsSync(join(gitDir, "..", "claude-pr-handoff-evil"))).toBe(false);
      expect(out.stdout).toBe("");
    });

    it("does not touch sibling session markers from post-mode Bash", () => {
      const { root, gitDir } = freshRepo();
      const current = join(gitDir, "claude-pr-handoff-sess-keep");
      const other = join(gitDir, "claude-pr-handoff-other");
      writeFileSync(current, "old\n");
      writeFileSync(other, "old\n");
      const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
      utimesSync(current, twoDaysAgo, twoDaysAgo);
      utimesSync(other, twoDaysAgo, twoDaysAgo);

      const out = runHook(
        "post",
        {
          tool_name: "Bash",
          session_id: "sess-keep",
          tool_input: { command: "true" },
          tool_response: "ok",
        },
        root,
      );
      expect(out.status).toBe(0);
      expect(existsSync(current)).toBe(true);
      expect(existsSync(other)).toBe(true);
    });

    it("emits handoff context only when the marker file actually lands", () => {
      const { root, gitDir } = freshRepo();
      // A directory at the exact marker path makes shell redirection fail for
      // root and non-root users. Post must fail open with no additionalContext.
      const marker = join(gitDir, "claude-pr-handoff-sess-readonly");
      mkdirSync(marker);

      const out = runHook(
        "post",
        {
          tool_name: "create_pull_request",
          session_id: "sess-readonly",
          tool_response: "Opened https://github.com/BigSimmo/PsychSift/pull/1649",
        },
        root,
      );
      expect(out.status).toBe(0);
      expect(lstatSync(marker).isDirectory()).toBe(true);
      expect(out.stdout).toBe("");
    });

    it("still detects gh pr create after a quoted arg when jq is unavailable", () => {
      const { root } = freshRepo();
      const out = runHook(
        "post",
        {
          tool_name: "Bash",
          session_id: "sess-create-quoted",
          tool_input: { command: 'git commit -m "open pr" && gh pr create --fill' },
          tool_response: "https://github.com/BigSimmo/PsychSift/pull/1649",
        },
        root,
        { pathWithoutJq: true },
      );
      expect(out.status).toBe(0);
      expect(out.markerExists("sess-create-quoted")).toBe(true);
      expect(out.stdout).toContain("PostToolUse");
    });

    it("does not lock from a printed gh pr create token in tool_response when jq is unavailable", () => {
      const { root } = freshRepo();
      const out = runHook(
        "post",
        {
          tool_name: "Bash",
          session_id: "sess-print-docs",
          tool_input: { command: "cat AGENTS.md" },
          tool_response:
            "Documented handoff: run gh pr create then open https://github.com/BigSimmo/PsychSift/pull/1649",
        },
        root,
        { pathWithoutJq: true },
      );
      expect(out.status).toBe(0);
      expect(out.markerExists("sess-print-docs")).toBe(false);
      expect(out.stdout).toBe("");
    });

    it("ignores a tool_input URL after tool_response when jq is unavailable", () => {
      const { root } = freshRepo();
      // Key order matters for the jq-less suffix extractor: response first, then
      // an input field that happens to mention a PR URL must not write a marker.
      const payload =
        '{"tool_name":"Bash","session_id":"sess-order","tool_response":"create failed","tool_input":{"command":"gh pr create --fill","url":"https://github.com/BigSimmo/PsychSift/pull/1649"}}';
      const out = runHook("post", payload, root, { pathWithoutJq: true });
      expect(out.status).toBe(0);
      expect(out.markerExists("sess-order")).toBe(false);
      expect(out.stdout).toBe("");
    });
  });

  describe("pre — everything is allowed except CronCreate", () => {
    it.each([
      ["gh pr checks", { tool_name: "Bash", tool_input: { command: "gh pr checks" } }],
      ["gh run watch", { tool_name: "Bash", tool_input: { command: "gh run watch" } }],
      ["gh pr comment", { tool_name: "Bash", tool_input: { command: "gh pr comment 1 --body ok" } }],
      ["sync:pr-branches", { tool_name: "Bash", tool_input: { command: "npm run sync:pr-branches" } }],
      ["git push", { tool_name: "Bash", tool_input: { command: "git push -u origin HEAD" } }],
      ["a ledger append", { tool_name: "Bash", tool_input: { command: "npm run ledger:append -- --ref x" } }],
      ["gh pr merge", { tool_name: "Bash", tool_input: { command: "gh pr merge --squash" } }],
      ["a GitHub MCP PR tool", { tool_name: "mcp__github__get_pull_request" }],
      ["a workflow-run MCP tool", { tool_name: "mcp__github__list_workflow_run_jobs" }],
      ["create_pull_request", { tool_name: "create_pull_request" }],
      ["merge_pull_request", { tool_name: "merge_pull_request" }],
      ["ScheduleWakeup", { tool_name: "ScheduleWakeup" }],
      ["Monitor", { tool_name: "Monitor" }],
    ])("allows %s while a PR is open", (_label, payload) => {
      const { root, gitDir } = freshRepo();
      writeMarker(gitDir, "sess-open");
      const out = runHook("pre", { ...payload, session_id: "sess-open" }, root);
      expect(out.status).toBe(0);
      expect(out.stdout).toBe("");
    });

    it("denies CronCreate once a PR is open", () => {
      const { root, gitDir } = freshRepo();
      writeMarker(gitDir, "sess-cron");
      const out = runHook("pre", { tool_name: "CronCreate", session_id: "sess-cron" }, root);
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('"permissionDecision":"deny"');
      expect(out.stdout).toContain("outlives the session");
    });

    it("keeps denying CronCreate no matter how old the marker is", () => {
      // There is no budget any more: an old marker must deny exactly like a
      // fresh one. Guards against age-based expiry creeping back in.
      const { root, gitDir } = freshRepo();
      writeMarker(gitDir, "sess-cron-old", 30 * 24 * 60 * 60);
      const out = runHook("pre", { tool_name: "CronCreate", session_id: "sess-cron-old" }, root);
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('"permissionDecision":"deny"');
    });

    it("quotes shell syntax in the marker's checkout path when suggesting an unlock", () => {
      const { root: parent } = freshRepo();
      const root = join(parent, "repo $(touch injected-dollar) `touch injected-tick` 'quoted'");
      mkdirSync(root);
      execFileSync("git", ["init", "-q"], { cwd: root });
      const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: root, encoding: "utf8" }).trim();
      const marker = writeMarker(gitDir, "sess-quoted");
      const out = runHook("pre", { tool_name: "CronCreate", session_id: "sess-quoted" }, root);
      const reason = JSON.parse(out.stdout).hookSpecificOutput.permissionDecisionReason;
      const command = reason.split("deleting the marker in Bash: ")[1];
      expect(command).toBeDefined();
      const result = spawnSync("bash", ["-c", command], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(root, "injected-dollar"))).toBe(false);
      expect(existsSync(join(root, "injected-tick"))).toBe(false);
    });

    it("allows CronCreate when no PR was ever opened", () => {
      const { root } = freshRepo();
      const out = runHook("pre", { tool_name: "CronCreate", session_id: "sess-no-pr" }, root);
      expect(out.status).toBe(0);
      expect(out.stdout).toBe("");
    });

    it("does nothing at all for an ordinary tool when no PR was ever opened", () => {
      const { root } = freshRepo();
      const out = runHook(
        "pre",
        { tool_name: "Bash", session_id: "sess-no-pr-2", tool_input: { command: "gh pr checks" } },
        root,
      );
      expect(out.status).toBe(0);
      expect(out.stdout).toBe("");
    });

    it("honours GIT_CEILING_DIRECTORIES instead of walking into an excluded checkout", () => {
      // The builtin git-dir resolver added for hook latency must never find a repository
      // `git rev-parse --absolute-git-dir` would refuse to discover. From a ceiling-excluded
      // subdirectory git reports NO repository, so the marker belongs in TMPDIR — a naive
      // upward walk instead lands it in the excluded checkout's .git. A post/pre pair
      // straddling that disagreement is how the guard would silently stop firing.
      const { root, gitDir } = freshRepo();
      const sub = join(root, "sub");
      mkdirSync(sub);
      const tmp = mkdtempSync(join(tmpdir(), "pr-handoff-ceiling-"));
      scratchRoots.push(tmp);
      const env = { GIT_CEILING_DIRECTORIES: root, TMPDIR: tmp };

      const post = spawnSync("bash", [hook, "post"], {
        cwd: sub,
        input: JSON.stringify({
          tool_name: "create_pull_request",
          session_id: "sess-ceiling",
          tool_response: "Opened https://github.com/BigSimmo/PsychSift/pull/1649",
        }),
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      expect(post.status).toBe(0);
      expect(
        existsSync(join(gitDir, "claude-pr-handoff-sess-ceiling")),
        "must not write into a checkout git refuses to discover",
      ).toBe(false);
      expect(
        existsSync(join(tmp, "claude-pr-handoff-sess-ceiling")),
        "must fall back to TMPDIR exactly as `git rev-parse` finding nothing requires",
      ).toBe(true);

      // And pre-mode must read back the same location, so CronCreate is still denied.
      const pre = spawnSync("bash", [hook, "pre"], {
        cwd: sub,
        input: JSON.stringify({ tool_name: "CronCreate", session_id: "sess-ceiling" }),
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      expect(pre.status).toBe(0);
      expect(pre.stdout).toContain('"permissionDecision":"deny"');
    });
  });
});
