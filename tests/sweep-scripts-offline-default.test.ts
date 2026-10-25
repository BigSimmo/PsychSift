import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SWEEP_FETCH_COMMAND, sweepFetchRequested } from "../scripts/sweep-branch-ledger.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sweepMergedBranches = path.join(repositoryRoot, "scripts", "sweep-merged-branches.mjs");

// Both sweeps are report-only operator utilities. Under the API and provider confirmation
// boundary a GitHub round-trip needs an explicit ask, so the network is opt-in, not opt-out.
describe("report-only sweeps stay offline unless asked", () => {
  it("sweep-branch-ledger fetches only with --fetch and names the exact command", () => {
    expect(sweepFetchRequested([])).toBe(false);
    expect(sweepFetchRequested(["--json"])).toBe(false);
    expect(sweepFetchRequested(["--no-fetch"])).toBe(false);
    expect(sweepFetchRequested(["--fetch"])).toBe(true);
    expect(sweepFetchRequested(["--fetch", "--no-fetch"])).toBe(false);
    expect(SWEEP_FETCH_COMMAND).toBe("git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'");
    const source = readFileSync(path.join(repositoryRoot, "scripts", "sweep-branch-ledger.mjs"), "utf8");
    expect(source).toContain("if (!sweepFetchRequested(process.argv))");
    expect(source).not.toContain('if (!process.argv.includes("--no-fetch"))');
  });

  it("sweep-merged-branches prunes only with --prune", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sweep-merged-"));
    const git = (args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" });
    try {
      git(["init", "--quiet", "-b", "main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      writeFileSync(path.join(directory, "a.txt"), "a\n");
      git(["add", "a.txt"]);
      git(["commit", "--quiet", "-m", "fixture"]);
      // No `origin` remote exists here, so any prune attempt fails loudly.
      const offline = execFileSync(process.execPath, [sweepMergedBranches], { cwd: directory, encoding: "utf8" });
      expect(offline).toContain("Not contacting origin");
      expect(offline).toContain("No merged local branches to clean up.");

      let failure: { status?: number; stderr?: string } | null = null;
      try {
        execFileSync(process.execPath, [sweepMergedBranches, "--prune"], {
          cwd: directory,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        failure = error as { status?: number; stderr?: string };
      }
      expect(failure, "--prune must attempt the remote prune").not.toBeNull();
      expect(failure?.stderr).toMatch(/origin/);
    } finally {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("sweep-merged-branches lists clean branch names and skips branches checked out in a worktree", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sweep-merged-worktree-"));
    const worktree = `${directory}-other`;
    const git = (args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" });
    try {
      git(["init", "--quiet", "-b", "main"]);
      git(["config", "user.email", "test@example.com"]);
      git(["config", "user.name", "Test"]);
      writeFileSync(path.join(directory, "a.txt"), "a\n");
      git(["add", "a.txt"]);
      git(["commit", "--quiet", "-m", "fixture"]);
      git(["branch", "done"]);
      git(["branch", "busy"]);
      git(["worktree", "add", "--quiet", worktree, "busy"]);

      const dryRun = execFileSync(process.execPath, [sweepMergedBranches], { cwd: directory, encoding: "utf8" });
      expect(dryRun).toContain("- done\n");
      expect(dryRun).not.toContain("busy");
      expect(dryRun).not.toMatch(/^- [*+] /m);
      expect(dryRun).toContain("delete 1 local branch(es)");
    } finally {
      rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
