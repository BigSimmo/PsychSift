#!/usr/bin/env node
/**
 * Read-only measurement: how often did a "hot file" (default
 * `src/data/source-acquisitions.json`) actually produce merge conflicts
 * between consecutive merged PRs in a date window, and how many merge/resolve
 * commits did that cost?
 *
 * This does not fix anything and is not wired into CI or any gate. It exists
 * to measure whether the sha1(id)-ordering fix (see
 * `scripts/merge-source-acquisitions.ts`) is worth doing, and later, whether
 * it worked.
 *
 * Usage: node scripts/measure-hot-file-conflicts.mjs --since 2026-08-01 --allow-github [--file <path>]
 *
 * Talks to GitHub via `gh pr list` and to local git via `git merge-tree`. GitHub is a
 * provider, so the CLI refuses to run without the explicit `--allow-github` flag (the
 * repository's provider-confirmation boundary). The counting logic itself (exported) takes
 * plain data and is unit-testable without either.
 *
 * What it compares: each PR's PRE-RESOLUTION head — the last commit before the PR first merged
 * a base branch in — because a PR's final head already contains any conflict resolution and
 * would merge cleanly against its predecessor, undercounting exactly the work being measured.
 * PRs are paired in merge order (sorted by `mergedAt`). A head that is not in the local object
 * database is reported as unavailable, never counted as a clean merge.
 */
import { execFileSync } from "node:child_process";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const DEFAULT_FILE_PATH = "src/data/source-acquisitions.json";

// ---------------------------------------------------------------------------
// Pure counting logic — no network, no git
// ---------------------------------------------------------------------------

/** PRs whose changed-file list includes `filePath`. */
export function prsTouchingFile(prs, filePath) {
  return prs.filter((pr) => Array.isArray(pr.files) && pr.files.some((file) => file.path === filePath));
}

/** Merged PRs in merge order: ascending `mergedAt`, ties by PR number. `gh pr list` guarantees no order. */
export function sortByMergedAt(prs) {
  return [...prs].sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number);
}

/**
 * The commit to compare for a PR: the last commit before its first merge-in commit (a headline
 * starting "Merge"), i.e. the head before any base sync or conflict resolution. Falls back to
 * `headRefOid` when the PR has no merge-in commit or no commit list.
 */
export function preResolutionHead(pr) {
  const commits = Array.isArray(pr.commits) ? pr.commits : [];
  const firstMerge = commits.findIndex((commit) => /^merge/i.test(commit.messageHeadline ?? ""));
  if (firstMerge > 0 && commits[firstMerge - 1]?.oid) return commits[firstMerge - 1].oid;
  return pr.headRefOid;
}

/** Throws unless the caller explicitly authorised GitHub access. */
export function assertGithubAllowed(flags) {
  if (!flags.allowGithub) {
    throw new Error(
      "Refusing to query GitHub without --allow-github: gh pr list is a provider call and needs explicit confirmation.",
    );
  }
}

/** Consecutive (adjacent, in list order) pairs — the order the caller supplies is the order compared. */
export function consecutivePairs(items) {
  const pairs = [];
  for (let i = 0; i + 1 < items.length; i++) {
    pairs.push([items[i], items[i + 1]]);
  }
  return pairs;
}

/**
 * `git merge-tree --write-tree --name-only <A> <B>` prints the resulting
 * tree's OID on the first line, and — only when there is a conflict — the
 * conflicted paths one per line immediately after, terminated by a blank
 * line and then human-readable messages. No blank line at all means no
 * conflicts. This parses exactly that shape; it takes the already-captured
 * stdout, not a live process, so it needs neither network nor git to test.
 */
export function parseMergeTreeConflicts(output) {
  const lines = output.split("\n");
  const paths = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "") break;
    paths.push(lines[i]);
  }
  return paths;
}

/**
 * Counts how many of `pairs` conflict on `filePath`, per `mergeTreeConflicts` — an injected
 * `(headA, headB) => string[] | null` so this stays pure for tests. `null` means the merge could
 * not be computed (for example a head missing locally); such pairs are counted as unavailable,
 * never as clean.
 */
export function countHotFileConflicts(pairs, filePath, mergeTreeConflicts) {
  const details = pairs.map(([a, b]) => {
    const conflicts = mergeTreeConflicts(preResolutionHead(a), preResolutionHead(b));
    if (conflicts === null) {
      return { a: a.number, b: b.number, conflictedFiles: [], conflict: false, unavailable: true };
    }
    return {
      a: a.number,
      b: b.number,
      conflictedFiles: conflicts,
      conflict: conflicts.includes(filePath),
      unavailable: false,
    };
  });
  return {
    total: pairs.length,
    conflicting: details.filter((entry) => entry.conflict).length,
    unavailable: details.filter((entry) => entry.unavailable).length,
    details,
  };
}

/** A commit headline that looks like a merge or a conflict-resolution commit. */
export function isMergeOrResolveHeadline(headline) {
  return /^merge|resolv/i.test(headline ?? "");
}

export function countMergeCommits(pr) {
  const commits = Array.isArray(pr.commits) ? pr.commits : [];
  return commits.filter((commit) => isMergeOrResolveHeadline(commit.messageHeadline)).length;
}

export function countMergeCommitsAcrossPRs(prs) {
  const perPr = prs.map((pr) => ({ number: pr.number, mergeCommits: countMergeCommits(pr) }));
  return {
    total: perPr.reduce((sum, entry) => sum + entry.mergeCommits, 0),
    perPr,
  };
}

// ---------------------------------------------------------------------------
// CLI — provider-backed, kept out of the pure functions above
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { file: DEFAULT_FILE_PATH };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--since") flags.since = argv[++i];
    else if (arg === "--file") flags.file = argv[++i];
    else if (arg === "--allow-github") flags.allowGithub = true;
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!flags.since)
    throw new Error("Usage: measure-hot-file-conflicts.mjs --since YYYY-MM-DD --allow-github [--file <path>]");
  return flags;
}

function fetchMergedPRs(since) {
  const raw = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--search",
      `merged:>=${since}`,
      "--json",
      "number,headRefOid,mergedAt,files,commits",
      "--limit",
      "500",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(raw);
}

/** Conflicted paths, or `null` when the merge cannot be computed (missing commit or git failure). */
function gitMergeTreeConflicts(headA, headB) {
  for (const head of [headA, headB]) {
    try {
      execFileSync("git", ["cat-file", "-e", `${head}^{commit}`], { stdio: "ignore" });
    } catch {
      return null;
    }
  }
  try {
    execFileSync("git", ["merge-tree", "--write-tree", "--name-only", headA, headB], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [];
  } catch (error) {
    // Exit status 1 means "merged with conflicts"; anything else is an operational failure.
    if (error.status !== 1) return null;
    const output = typeof error.stdout === "string" ? error.stdout : (error.stdout?.toString() ?? "");
    return parseMergeTreeConflicts(output);
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  assertGithubAllowed(flags);
  const allMerged = fetchMergedPRs(flags.since);
  const touching = sortByMergedAt(prsTouchingFile(allMerged, flags.file));
  const pairs = consecutivePairs(touching);
  const conflicts = countHotFileConflicts(pairs, flags.file, gitMergeTreeConflicts);
  const mergeCommits = countMergeCommitsAcrossPRs(touching);

  console.log(`Merged PRs since ${flags.since}: ${allMerged.length}`);
  console.log(`Merged PRs touching ${flags.file}: ${touching.length}`);
  console.log(`Consecutive pairs both touching it: ${conflicts.total}`);
  console.log(`Pairs that actually conflict on it: ${conflicts.conflicting}`);
  if (conflicts.unavailable > 0) {
    console.log(`Pairs not measurable (a head missing locally — fetch it and rerun): ${conflicts.unavailable}`);
  }
  console.log(`Merge/resolve-headline commits across those PRs: ${mergeCommits.total}`);
  if (mergeCommits.total > 0) {
    for (const entry of mergeCommits.perPr) {
      if (entry.mergeCommits > 0) console.log(`  - PR #${entry.number}: ${entry.mergeCommits}`);
    }
  }
}

const isMainModule = isDirectEntrypoint(import.meta.url);
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
