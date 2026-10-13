import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const fetchedMainSha = "a".repeat(40);
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
    unavailableShas?: string[];
    batchOutput?: string;
    unreadableTree?: string;
    remoteMain?: string | null;
    origin?: string;
  } = {},
) {
  const pr = overrides.pr ?? closedSource();
  let prReads = 0;
  const calls: string[][] = [];
  return {
    lsRemoteOutput: [
      overrides.remoteMain === null ? undefined : `${overrides.remoteMain ?? fetchedMainSha}\trefs/heads/main`,
      overrides.allHeads ?? `${sourceSha}\trefs/heads/${sourceBranch}`,
    ]
      .filter(Boolean)
      .join("\n"),
    currentBranch: overrides.currentBranch ?? "codex/reconciliation-replacement",
    runner: (args: string[], executionOptions: { input?: string } = {}) => {
      if (args[0] === "remote") return overrides.origin ?? "https://github.com/BigSimmo/PsychSift.git";
      if (args[0] === "rev-parse") return fetchedMainSha;
      if (args[0] === "cat-file") {
        if (args[1] === "-t") return overrides.sourceType ?? "commit";
        return (
          overrides.batchOutput ??
          (executionOptions.input ?? "")
            .trim()
            .split("\n")
            .map((sha) => `${sha} ${overrides.unavailableShas?.includes(sha) ? "missing" : "commit"}`)
            .join("\n")
        );
      }
      if (args[0] === "ls-tree") {
        if (args[3] === overrides.unreadableTree) throw new Error("unreadable tree");
        const applied = "docs/outstanding-issues-inbox/applied/";
        if (args[3] === "refs/remotes/origin/main") return `${applied}landed.json`;
        return `${applied}landed.json\n${applied}${args[3] === sourceSha ? "preserved" : "competing"}.json`;
      }
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

  it("rejects a remote main that moved since the last fetch, or is missing", () => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ remoteMain: "b".repeat(40) }))).toThrow(
      /remote main has moved/,
    );
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ remoteMain: null }))).toThrow(
      /remote main has moved/,
    );
  });

  it.each([
    "ssh://git@github.com/BigSimmo/PsychSift.git",
    "https://x-access-token:abc@github.com/BigSimmo/PsychSift.git",
    "git@github.com:BigSimmo/PsychSift.git",
  ])("accepts the supported origin form %s", (origin) => {
    expect(assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ origin }))).toMatchObject({ number: 3509 });
  });

  it("rejects a non-github origin", () => {
    expect(() =>
      assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ origin: "https://github.com.evil.example/a/b.git" })),
    ).toThrow(/unambiguous github.com origin/);
  });

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

  it("fails closed for an unfetched ordinary branch even when cat-file succeeds", () => {
    const otherSha = "2".repeat(40);
    const allHeads = `${sourceSha}\trefs/heads/${sourceBranch}\n${otherSha}\trefs/heads/chore/batch-20261013`;
    expect(() =>
      assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads, unavailableShas: [otherSha] })),
    ).toThrow(/cannot inspect every remote candidate commit.*chore\/batch-20261013/);
  });

  it("checks master as a competing branch when main is the verified canonical base", () => {
    const allHeads = `${sourceSha}\trefs/heads/${sourceBranch}\n${"2".repeat(40)}\trefs/heads/master`;
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads }))).toThrow(/master/);
  });

  it.each([
    `${sourceSha} missing`,
    `${sourceSha} blob`,
    "",
    `${sourceSha} commit\n${sourceSha} commit`,
    `${"2".repeat(40)} commit`,
    "malformed availability",
  ])("rejects incomplete or invalid successful commit-availability output", (batchOutput) => {
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ batchOutput }))).toThrow(
      /cannot inspect every remote candidate commit/,
    );
  });

  it.each(["refs/remotes/origin/main", sourceSha])(
    "fails closed for an unreadable applied tree %s",
    (unreadableTree) => {
      expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ unreadableTree }))).toThrow(
        /cannot inspect.*applied inbox/,
      );
    },
  );

  it("accepts shared candidate tips without mistaking repeated SHAs for missing objects", () => {
    const allHeads = `${sourceSha}\trefs/heads/${sourceBranch}\n${sourceSha}\trefs/heads/chore/another-preserved-copy`;
    // The second branch still carries unmerged applied records and is not exempt.
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads }))).toThrow(
      /another-preserved-copy/,
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
    expect(() => assertSafeRemoteReconciliation(sourceArgs, sourceEvidence({ allHeads, remoteMain: null }))).toThrow(
      /remote branch status/,
    );
  });

  it.each([
    `${"a".repeat(40)}\trefs/heads/main`,
    `${"2".repeat(40)}\trefs/heads/${sourceBranch}`,
    `${sourceSha}\trefs/heads/${sourceBranch}\n${sourceSha}\trefs/heads/${sourceBranch}`,
  ])("rejects disappearance, movement or ambiguity between remote source snapshots", (allHeads) => {
    expect(() =>
      assertSafeRemoteReconciliation(
        sourceArgs,
        sourceEvidence({ allHeads, remoteMain: allHeads.includes("refs/heads/main") ? null : undefined }),
      ),
    ).toThrow(/complete remote-head snapshot/);
  });

  it("fails closed if the complete remote-head lookup fails after source verification", () => {
    const evidence = sourceEvidence();
    const options = { ...evidence, lsRemoteOutput: undefined };
    const runner = options.runner;
    options.runner = (args, executionOptions) => {
      if (args[0] === "ls-remote" && args.length === 3) throw new Error("offline");
      return runner(args, executionOptions);
    };
    expect(() => assertSafeRemoteReconciliation(sourceArgs, options)).toThrow(/remote branch status is unavailable/);
  });
});

describe("strict candidate history regression", () => {
  it("blocks an earlier unmerged record when a later commit only edits a landed record", () => {
    const fixture = mkdtempSync(join(tmpdir(), "ledger-remote-history-"));
    const runGit = (args: string[], executionOptions: { input?: string } = {}) =>
      execFileSync("git", args, {
        cwd: fixture,
        encoding: "utf8",
        stdio: [executionOptions.input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
        ...executionOptions,
      }).trim();
    try {
      runGit(["init", "--quiet"]);
      runGit(["config", "user.name", "Ledger regression fixture"]);
      runGit(["config", "user.email", "ledger-fixture@example.invalid"]);
      runGit(["config", "commit.gpgsign", "false"]);
      const applied = "docs/outstanding-issues-inbox/applied";
      mkdirSync(join(fixture, applied), { recursive: true });
      writeFileSync(join(fixture, applied, "landed.json"), "{}\n");
      runGit(["add", "."]);
      runGit(["commit", "--quiet", "-m", "Main already contains landed record Y"]);
      const mainSha = runGit(["rev-parse", "HEAD"]);
      writeFileSync(join(fixture, applied, "unmerged.json"), "{}\n");
      runGit(["add", "."]);
      runGit(["commit", "--quiet", "-m", "Earlier commit adds unmerged record X"]);
      writeFileSync(join(fixture, applied, "landed.json"), '{"updated":true}\n');
      runGit(["add", "."]);
      runGit(["commit", "--quiet", "-m", "Latest commit only touches already-landed record Y"]);
      const tip = runGit(["rev-parse", "HEAD"]);

      const detected = findUnmergedRemoteReconciliations({
        lsRemoteOutput: `${mainSha}\trefs/heads/main\n${tip}\trefs/heads/chore/batch-20261013`,
        currentBranch: "codex/reconciliation-writer",
        originRef: mainSha,
        strictRemote: true,
        runner: runGit,
      });
      expect(detected).toEqual([
        {
          branch: "chore/batch-20261013",
          sha: tip,
          unmergedCount: 1,
          reason: `carries 1 unmerged applied inbox record(s) under ${applied}`,
        },
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});
