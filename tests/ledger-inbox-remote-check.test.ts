import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertSafeRemoteReconciliation, findUnmergedRemoteReconciliations } from "../scripts/ledger-inbox.mjs";

describe("ledger inbox pre-flight remote reconciliation check", () => {
  it("fails open and returns empty list when offline or runner throws", () => {
    const result = findUnmergedRemoteReconciliations({
      runner: () => {
        throw new Error("fatal: unable to access 'https://github.com/BigSimmo/PsychSift.git/': Could not resolve host");
      },
    });
    expect(result).toEqual([]);
  });

  it("returns empty list when remote heads only include main and current branch", () => {
    const lsRemoteOutput = [
      `${"a".repeat(40)}\trefs/heads/main`,
      `${"b".repeat(40)}\trefs/heads/gemini/safe-ledger-and-ui-swarm-batch`,
    ].join("\n");

    const result = findUnmergedRemoteReconciliations({
      lsRemoteOutput,
      currentBranch: "gemini/safe-ledger-and-ui-swarm-batch",
    });
    expect(result).toEqual([]);
  });

  it("detects remote reconcile branches when unfetched by branch name pattern", () => {
    const lsRemoteOutput = [
      `${"a".repeat(40)}\trefs/heads/main`,
      `${"1".repeat(40)}\trefs/heads/claude/issues-reconcile-20260818`,
      `${"2".repeat(40)}\trefs/heads/claude/ledger-reconcile-issues-c1trbj`,
      `${"3".repeat(40)}\trefs/heads/feature/ordinary-feature`,
    ].join("\n");

    const result = findUnmergedRemoteReconciliations({
      lsRemoteOutput,
      currentBranch: "feature/ordinary-feature",
    });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.branch)).toEqual([
      "claude/issues-reconcile-20260818",
      "claude/ledger-reconcile-issues-c1trbj",
    ]);
  });

  it("assertSafeRemoteReconciliation throws an error when unmerged reconcile branches exist", () => {
    const lsRemoteOutput = [
      `${"a".repeat(40)}\trefs/heads/main`,
      `${"1".repeat(40)}\trefs/heads/claude/issues-reconcile-20260818`,
    ].join("\n");

    expect(() =>
      assertSafeRemoteReconciliation([], {
        lsRemoteOutput,
        currentBranch: "my-branch",
      }),
    ).toThrow(/detected unmerged branch\(es\) on origin carrying pending inbox reconciliations/);
  });

  it("assertSafeRemoteReconciliation warns loudly instead of throwing when --allow-concurrent is passed", () => {
    const lsRemoteOutput = [
      `${"a".repeat(40)}\trefs/heads/main`,
      `${"1".repeat(40)}\trefs/heads/claude/issues-reconcile-20260818`,
    ].join("\n");

    const warnings: string[] = [];
    assertSafeRemoteReconciliation(["--allow-concurrent"], {
      lsRemoteOutput,
      currentBranch: "my-branch",
      warn: (msg: string) => warnings.push(msg),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("claude/issues-reconcile-20260818");
    expect(warnings[0]).toContain("warning: detected unmerged branch");
  });

  it("assertSafeRemoteReconciliation warns loudly when --force is passed", () => {
    const lsRemoteOutput = [
      `${"a".repeat(40)}\trefs/heads/main`,
      `${"1".repeat(40)}\trefs/heads/claude/issues-reconcile-20260818`,
    ].join("\n");

    const warnings: string[] = [];
    assertSafeRemoteReconciliation(["--force"], {
      lsRemoteOutput,
      currentBranch: "my-branch",
      warn: (msg: string) => warnings.push(msg),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("claude/issues-reconcile-20260818");
  });

  it("skips remote check when --skip-remote-check or --no-remote-check is provided", () => {
    const lsRemoteOutput = [
      `${"a".repeat(40)}\trefs/heads/main`,
      `${"1".repeat(40)}\trefs/heads/claude/issues-reconcile-20260818`,
    ].join("\n");

    let called = false;
    assertSafeRemoteReconciliation(["--skip-remote-check"], {
      get lsRemoteOutput() {
        called = true;
        return lsRemoteOutput;
      },
      currentBranch: "my-branch",
    });
    expect(called).toBe(false);
  });
});

const sourceSha = "1".repeat(40);
const sourceBranch = "claude/issues-reconcile-preserved";
const sourceArgs = ["--preserved-source-pr", "3509", "--preserved-source-sha", sourceSha];
const closedSource = () => ({
  number: 3509,
  state: "closed",
  merged: false,
  merged_at: null as string | null,
  closed_at: "2026-10-13T05:57:53Z",
  base: { ref: "main", repo: { id: 42, full_name: "BigSimmo/PsychSift" } },
  head: { ref: sourceBranch, sha: sourceSha, repo: { id: 42, full_name: "BigSimmo/PsychSift" } },
});

function sourceEvidence(
  overrides: {
    pr?: ReturnType<typeof closedSource>;
    finalPr?: ReturnType<typeof closedSource>;
    openPages?: unknown;
    remoteRef?: string;
    sourceType?: string;
    allHeads?: string;
    currentBranch?: string;
  } = {},
) {
  const pr = overrides.pr ?? closedSource();
  let prReads = 0;
  const calls: string[][] = [];
  return {
    lsRemoteOutput: overrides.allHeads ?? `${sourceSha}\trefs/heads/${sourceBranch}`,
    currentBranch: overrides.currentBranch ?? "codex/reconciliation-replacement",
    runner: (args: string[]) => {
      if (args[0] === "remote") return "https://github.com/BigSimmo/PsychSift.git";
      if (args[0] === "cat-file") return overrides.sourceType ?? "commit";
      if (args[0] === "ls-remote") return overrides.remoteRef ?? `${sourceSha}\trefs/heads/${sourceBranch}`;
      throw new Error(`unexpected test Git command: ${args[0]}`);
    },
    githubRunner: (args: string[]) => {
      calls.push(args);
      expect(args.slice(0, 3)).toEqual(["api", "--hostname", "github.com"]);
      if (args.includes("--paginate")) {
        expect(args).toContain("--slurp");
        expect(args.at(-1)).toContain("state=open&head=BigSimmo%3Aclaude%2Fissues-reconcile-preserved");
        return JSON.stringify(overrides.openPages ?? [[]]);
      }
      expect(args.at(-1)).toBe("repos/BigSimmo/PsychSift/pulls/3509");
      return JSON.stringify(prReads++ === 0 ? pr : (overrides.finalPr ?? pr));
    },
    calls,
  };
}

describe("pinned preserved-source admission", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOW_CONCURRENT_RECONCILE", "");
    vi.stubEnv("SKIP_REMOTE_CHECK", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("admits only the explicitly pinned closed/unmerged source and rechecks its status", () => {
    const evidence = sourceEvidence();
    expect(assertSafeRemoteReconciliation(sourceArgs, evidence)).toEqual({
      number: 3509,
      repository: "BigSimmo/PsychSift",
      branch: sourceBranch,
      sha: sourceSha,
    });
    expect(evidence.calls).toHaveLength(3);
  });

  it("keeps the default guard blocking the same preserved branch without a verified pin", () => {
    expect(() => assertSafeRemoteReconciliation([], sourceEvidence())).toThrow(/detected unmerged branch/);
  });

  it("still blocks a second competing reconciliation branch", () => {
    const allHeads = `${sourceSha}\trefs/heads/${sourceBranch}\n${"2".repeat(40)}\trefs/heads/claude/ledger-reconcile-active`;
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads }))).toThrow(
      /ledger-reconcile-active/,
    );
  });

  it.each([
    { name: "open", pr: { ...closedSource(), state: "open" } },
    { name: "merged", pr: { ...closedSource(), merged: true, merged_at: "2026-10-13T06:00:00Z" } },
    { name: "unknown state", pr: { ...closedSource(), state: "unknown" } },
    { name: "wrong PR", pr: { ...closedSource(), number: 3510 } },
    { name: "moved PR head", pr: { ...closedSource(), head: { ...closedSource().head, sha: "2".repeat(40) } } },
    { name: "wrong target", pr: { ...closedSource(), base: { ...closedSource().base, ref: "staging" } } },
    {
      name: "fork",
      pr: { ...closedSource(), head: { ...closedSource().head, repo: { id: 43, full_name: "other/PsychSift" } } },
    },
    {
      name: "ambiguous repository identity",
      pr: { ...closedSource(), head: { ...closedSource().head, repo: { id: 43, full_name: "BigSimmo/PsychSift" } } },
    },
    { name: "invalid close timestamp", pr: { ...closedSource(), closed_at: "unknown" } },
  ])("rejects $name source evidence", ({ pr }) => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ pr }))).toThrow(
      /verified closed, unmerged PR/,
    );
  });

  it("rejects a reopened source observed on the second read", () => {
    expect(() =>
      assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ finalPr: { ...closedSource(), state: "open" } })),
    ).toThrow(/verified closed, unmerged PR/);
  });

  it.each([
    { name: "an open same-head PR", openPages: [[{ number: 3516, state: "open" }]] },
    { name: "an open PR on a later page", openPages: [[], [{ number: 3516, state: "open" }]] },
    { name: "malformed pages", openPages: { message: "unavailable" } },
    { name: "an uncertain record", openPages: [[{}]] },
    { name: "empty response", openPages: [] },
  ])("rejects $name", ({ openPages }) => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ openPages }))).toThrow(
      /open or uncertain same-head PR/,
    );
  });

  it.each(["", `${"2".repeat(40)}\trefs/heads/${sourceBranch}`, `${sourceSha}\trefs/heads/other`])(
    "rejects a missing or changed remote source ref",
    (remoteRef) => {
      expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ remoteRef }))).toThrow(
        /missing or moved/,
      );
    },
  );

  it("requires the source commit to be preserved locally", () => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ sourceType: "blob" }))).toThrow(
      /cannot verify the preserved source commit/,
    );
  });

  it("does not turn the preserved source branch into the canonical writer", () => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ currentBranch: sourceBranch }))).toThrow(
      /separate branch/,
    );
  });

  it.each(["--allow-concurrent", "--force", "--skip-remote-check", "--no-remote-check"])(
    "rejects combining verified admission with %s",
    (override) => {
      expect(() => assertSafeRemoteReconciliation([...sourceArgs, override], sourceEvidence())).toThrow(
        /cannot be combined/,
      );
    },
  );

  it.each(["ALLOW_CONCURRENT_RECONCILE", "SKIP_REMOTE_CHECK"])("rejects inherited %s overrides", (key) => {
    vi.stubEnv(key, "true");
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence())).toThrow(/cannot be combined/);
  });

  it.each([
    { name: "missing SHA", argv: ["--preserved-source-pr", "3509"] },
    { name: "missing PR", argv: ["--preserved-source-sha", sourceSha] },
    { name: "duplicate selector", argv: [...sourceArgs, "--preserved-source-pr", "3509"] },
    { name: "abbreviated SHA", argv: ["--preserved-source-pr", "3509", "--preserved-source-sha", "123abc"] },
    { name: "invalid number", argv: ["--preserved-source-pr", "0", "--preserved-source-sha", sourceSha] },
    {
      name: "unsupported inline selector",
      argv: ["--preserved-source-pr=3509", `--preserved-source-sha=${sourceSha}`],
    },
  ])("rejects $name", ({ argv }) => {
    expect(() => assertSafeRemoteReconciliation(argv, sourceEvidence())).toThrow(/requires exactly one/);
  });

  it.each(["unavailable", "invalid JSON"])("fails closed on %s GitHub status", (failure) => {
    const evidence = sourceEvidence();
    evidence.githubRunner = () => {
      if (failure === "unavailable") throw new Error("offline");
      return "not JSON";
    };
    expect(() => assertSafeRemoteReconciliation(sourceArgs, evidence)).toThrow(
      /GitHub status is unavailable or invalid/,
    );
  });

  it.each(["", "malformed ref listing"])("fails closed on empty or malformed complete remote heads", (allHeads) => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads }))).toThrow(
      /remote branch status/,
    );
  });

  it.each([
    `${"a".repeat(40)}\trefs/heads/main`,
    `${"2".repeat(40)}\trefs/heads/${sourceBranch}`,
    `${sourceSha}\trefs/heads/${sourceBranch}\n${sourceSha}\trefs/heads/${sourceBranch}`,
  ])("rejects disappearance, movement or ambiguity between remote source snapshots", (allHeads) => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads }))).toThrow(
      /complete remote-head snapshot/,
    );
  });

  it("fails closed if the complete remote-head lookup fails after source verification", () => {
    const evidence = sourceEvidence();
    const { lsRemoteOutput: _listing, ...options } = evidence;
    const runner = options.runner;
    options.runner = (args) => {
      if (args[0] === "ls-remote" && args.length === 3) throw new Error("offline");
      return runner(args);
    };
    expect(() => assertSafeRemoteReconciliation(sourceArgs, options)).toThrow(/remote branch status is unavailable/);
  });
});
