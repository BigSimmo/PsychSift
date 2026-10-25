import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { documentationCounts, routesCounts } from "@/lib/developer-area/repo-awareness-snapshot-counts";
import type { RepoAwarenessSnapshot } from "@/lib/developer-area/repo-awareness-types";

import { generate, OUTPUT_PATH } from "./generate-repo-awareness-snapshot";

const FIX = "npm run snapshot:repo-awareness";

/**
 * Content keys only.
 *
 * `captured_revision` is deliberately NOT compared. It is the sha of the last
 * commit touching this snapshot's inputs, so it changes as a *side effect* of
 * committing the snapshot: regenerate, commit, and that commit becomes the
 * newest change to `docs/` — so the next regeneration yields a different sha
 * with nothing stale. The gate would then fail on every docs change, and `main`
 * would go red after each squash merge that touched a document.
 *
 * `review_state` is also deliberately NOT compared in check gates. Review
 * records are dynamic and concurrent merges to `main` append new review records,
 * which would cause feature branch staleness check failures and merge conflicts.
 *
 * Excluding them fails safe: every deterministic content difference in routes,
 * documentation, and test health is still caught.
 *
 * Excluding a key from comparison was never enough on its own, though, and
 * `#EFETZT` is what that cost: the un-compared content still shipped in the
 * committed file, still changed on both sides of every append, and still
 * conflicted — which sets `mergeable_state=dirty`, suppresses
 * `refs/pull/<n>/merge`, and leaves the check list empty rather than red. So the
 * two excluded keys now carry only content that CAN merge: `captured_revision`
 * no longer moves for a review-record append (`REVISION_INPUTS` excludes the
 * review corpus), and `review_state` is ordered by `head` and stores no
 * aggregate totals. Anything added back here must satisfy the same rule — if it
 * is too volatile to compare, it is too volatile to commit in a conflicting
 * shape.
 */
const COMPARED_CONTENT_KEYS = ["routes", "documentation", "test_health"] as const;

/**
 * Resolve for comparison: follow symlinks, normalise separators, and case-fold
 * on the platforms whose paths are case-insensitive.
 *
 * `git rev-parse --show-toplevel` answers in git's own idiom — forward slashes
 * and a drive letter on Windows (`D:/Repos/Database`) where `process.cwd()`
 * gives backslashes — so a raw string comparison of the two would differ on
 * every Windows checkout and skip the gate for everyone on the workstation.
 *
 * `realpathSync` can throw on a path that has since gone; fall back to the
 * unresolved form rather than letting a comparison helper decide the gate.
 */
function comparablePath(value: string): string {
  let resolved: string;
  try {
    resolved = realpathSync(path.resolve(value));
  } catch {
    resolved = path.resolve(value);
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * True only when `cwd` is the ROOT OF ITS OWN repository — not merely somewhere
 * inside one.
 *
 * `--is-inside-work-tree` alone was not enough, and the difference is not
 * academic. Extract a `git archive` export into a directory that happens to sit
 * inside another checkout and git answers `true` for the OUTER repository. The
 * generator then runs `git ls-files --others` there, every document in the
 * export looks untracked to it, and the generator throws its
 * "Untracked Markdown documents" error — which is not a git-availability
 * message, so the skip below cannot recognise it. The gate exits 1 with a
 * six-hundred-path dump and no explanation of why (`#JFRCZ4`; reproduced by
 * extracting an export under a scratch repository).
 *
 * Comparing the toplevel to `cwd` is the exact question this gate needs, not an
 * approximation of it: every path it reads — `OUTPUT_PATH`, `docs/`, the review
 * corpus — is relative to `cwd`, so a repository rooted anywhere else is
 * describing different content by definition.
 *
 * It fails in the SAFE direction. A false negative skips a staleness check that
 * CI still runs against the real checkout; a false positive compares this
 * repository's snapshot against another repository's files, which is the
 * unexplained red the row was opened for.
 */
export function isGitRepository(cwd = process.cwd()): boolean {
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!topLevel) return false;
    return comparablePath(topLevel) === comparablePath(cwd);
  } catch {
    return false;
  }
}

export function compareSnapshots(committed: unknown, regenerated: RepoAwarenessSnapshot): string[] {
  const differences: string[] = [];
  const record =
    committed !== null && typeof committed === "object" && !Array.isArray(committed)
      ? (committed as Partial<RepoAwarenessSnapshot> & Record<string, unknown>)
      : {};

  if (record.version !== regenerated.version) {
    differences.push(`version: committed ${String(record.version)} vs regenerated ${regenerated.version}`);
  }

  for (const key of COMPARED_CONTENT_KEYS) {
    if (JSON.stringify(record[key]) !== JSON.stringify(regenerated[key])) {
      differences.push(`${key} differs from the repository`);
    }
  }

  // The union of both key sets, so a committed snapshot carrying a key the
  // generator no longer emits is caught rather than silently ignored.
  const topLevelKeys = new Set([...Object.keys(regenerated), ...Object.keys(record)]);
  for (const key of topLevelKeys) {
    if (!(key in regenerated)) differences.push(`unexpected key in the committed snapshot: ${key}`);
    else if (!(key in record)) differences.push(`missing key in the committed snapshot: ${key}`);
  }

  return differences;
}

export type CheckSnapshotOptions = {
  outputPath?: string;
  generateImpl?: () => RepoAwarenessSnapshot;
  readCommittedImpl?: (path: string) => unknown;
  isGitRepoImpl?: () => boolean;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  exit?: (code: number) => void;
};

export function checkRepoAwarenessSnapshot(options: CheckSnapshotOptions = {}): number {
  const {
    outputPath = OUTPUT_PATH,
    generateImpl = generate,
    readCommittedImpl = (p) => JSON.parse(readFileSync(p, "utf8")),
    isGitRepoImpl = isGitRepository,
    log = console.log,
    error = console.error,
    exit = (code) => process.exit(code),
  } = options;

  if (!isGitRepoImpl()) {
    // Reported on stdout with exit 0, so a reader must read the line rather
    // than the exit code to tell a skip from a pass. That is deliberate: the
    // gate compares a committed artefact against what git says the repository
    // contains, and without git there is no second opinion to compare against —
    // failing would turn every archive export and container build red for a
    // check that cannot run. CI always runs it against a real checkout, so the
    // coverage this skip gives up is recovered there.
    log(
      "[repo-awareness] Skipped: no git repository rooted here (a git archive export, or a checkout without git). " +
        "The staleness check needs git to say what the repository contains; CI runs it against a real checkout.",
    );
    return 0;
  }

  let regenerated: RepoAwarenessSnapshot;
  try {
    regenerated = generateImpl();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A bare "ENOENT" is not enough: a missing generator input (docs/README.md, the flake ledger)
    // also says ENOENT, and must fail the gate rather than skip it as if git were absent.
    if (
      message.includes("spawnSync git") ||
      message.includes("not a git repository") ||
      message.includes("git: not found") ||
      message.includes("git is not available")
    ) {
      log(`[repo-awareness] skipped: git is not available in this environment (${message}).`);
      return 0;
    }
    error(`[repo-awareness] generation failed: ${message}`);
    exit(1);
    return 1;
  }

  let committed: unknown = null;
  try {
    committed = readCommittedImpl(outputPath);
  } catch {
    error(`[repo-awareness] ${outputPath} is missing or unreadable. Run: ${FIX}`);
    exit(1);
    return 1;
  }

  const differences = compareSnapshots(committed, regenerated);
  if (differences.length > 0) {
    error("[repo-awareness] The committed snapshot is behind the repository:");
    for (const difference of differences) error(`  - ${difference}`);
    error(`[repo-awareness] Fix with: ${FIX}`);
    exit(1);
    return 1;
  }

  log(
    `[repo-awareness] in step with ${outputPath} (${routesCounts(regenerated.routes).pages} pages, ` +
      `${documentationCounts(regenerated.documentation).documents} documents, ` +
      `${regenerated.review_state.records.length} reviews)`,
  );
  return 0;
}

function main() {
  checkRepoAwarenessSnapshot();
}

if (isDirectEntrypoint(import.meta.url)) main();
