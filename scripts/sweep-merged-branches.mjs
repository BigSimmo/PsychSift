#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(stderr || `git ${args.join(" ")} failed with status ${result.status}`);
  }
  return (result.stdout || "").trim();
}

const PRUNE_COMMAND = "git remote prune origin";

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  // Network is opt-in: `git remote prune origin` contacts GitHub, and a dry-run report
  // must not do that unless the operator asks. `--no-prune` (the old opt-out) is still
  // accepted and means the default.
  const prune = argv.includes("--prune") && !argv.includes("--no-prune");
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: node scripts/sweep-merged-branches.mjs [--apply] [--prune]

Dry-run by default. Lists local branches already merged into main.
Pass --apply to delete those local branches with git branch -d.
Pass --prune to first run \`${PRUNE_COMMAND}\` (contacts origin; off by default).
Remote branches are never deleted.`);
    process.exit(0);
  }
  return { apply, prune };
}

function main() {
  const { apply, prune } = parseArgs(process.argv.slice(2));

  if (prune) {
    runGit(["remote", "prune", "origin"]);
  } else {
    console.log(`Not contacting origin (pass --prune to run \`${PRUNE_COMMAND}\` first).`);
  }

  const currentBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  // A format string instead of the human listing, which prefixes "* " (this worktree) and
  // "+ " (another worktree) to branch names. A branch checked out in any worktree cannot be
  // deleted with -d, so it is not a candidate.
  const mergedBranches = runGit(["branch", "--merged", "main", "--format=%(refname:short)\t%(worktreepath)"])
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([branch, worktreePath]) => branch && !worktreePath)
    .map(([branch]) => branch);

  const protectedBranches = new Set(["main", "master", "develop", currentBranch]);
  const branchesToDelete = mergedBranches.filter(
    (branch) => !protectedBranches.has(branch) && !branch.startsWith("release/"),
  );

  if (branchesToDelete.length === 0) {
    console.log("No merged local branches to clean up.");
    return;
  }

  if (!apply) {
    console.log("Dry-run only. Candidates that would be deleted with --apply:");
    for (const branch of branchesToDelete) console.log(`- ${branch}`);
    console.log(`\nRe-run with --apply to delete ${branchesToDelete.length} local branch(es).`);
    return;
  }

  const failed = [];
  for (const branch of branchesToDelete) {
    console.log(`Deleting merged branch: ${branch}`);
    try {
      runGit(["branch", "-d", branch]);
    } catch (error) {
      failed.push(branch);
      console.warn(`Failed to delete branch ${branch}: ${error.message}`);
    }
  }

  if (failed.length > 0) {
    console.error(`Branch cleanup incomplete: ${failed.length} branch(es) could not be deleted.`);
    process.exitCode = 1;
    return;
  }
  console.log("Branch cleanup complete.");
}

try {
  main();
} catch (error) {
  console.error(`Error cleaning up branches: ${error.message}`);
  process.exit(1);
}
