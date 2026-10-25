#!/usr/bin/env node
/**
 * sweep-branch-ledger — build the branch inventory that docs/branch-cleanup-guide.md
 * mandates, and flag deletion candidates. REPORT ONLY: it never deletes, renames, or
 * pushes anything, and it edits no files.
 *
 * With ~40 worktrees and a squash-merge flow, ancestry-based `--merged` misses
 * squash-absorbed branches, so this uses the cherry-pick-aware check from the guide
 * (`git log --right-only --cherry-pick`) to decide whether a branch still has unique
 * patch content. Branches already recorded in docs/branch-review-ledger.md are noted
 * so a follow-up review can skip them.
 *
 * Flags: --fetch (contact origin and refresh every remote head; off by default, because a
 *        report-only tool must not reach GitHub without the operator asking — see the
 *        "API and provider confirmation boundary" in AGENTS.md), --json (machine-readable
 *        output). `--no-fetch` is accepted for compatibility and is the default.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLedgerCorpus } from "./branch-review-ledger.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

/** Like tryGit, but null on failure so a failed command is not mistaken for empty output. */
function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/**
 * Ahead/behind and unique-commit counts for one branch, from the raw `rev-list --count` and
 * cherry-pick `log` output. A failed git command (null) makes the branch indeterminate rather than
 * "0 unique commits", so a broken comparison never turns unmerged work into a deletion candidate.
 */
export function branchComparison(countsOutput, uniqueLogOutput) {
  if (countsOutput === null || uniqueLogOutput === null) {
    return { ahead: null, behind: null, uniqueCommits: null, deletionCandidate: false };
  }
  const [behind, ahead] = countsOutput ? countsOutput.split(/\s+/).map((n) => Number.parseInt(n, 10) || 0) : [0, 0];
  const uniqueCommits = uniqueLogOutput ? uniqueLogOutput.split("\n").filter(Boolean).length : 0;
  return { ahead, behind, uniqueCommits, deletionCandidate: uniqueCommits === 0 };
}

/**
 * Extract branch short-names from a ledger branch/ref cell. A ref token is
 * "<namespace>/<name>" with no surrounding whitespace, so the "PR #N / " prefix and
 * prose do not produce false matches; a leading "origin/" is stripped so
 * remote-tracking rows normalize to the same short name the sweep compares against.
 */
function refTokensFromCell(cell) {
  const out = [];
  for (const m of cell.matchAll(/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/g)) {
    out.push(m[0].replace(/^origin\//, ""));
  }
  return out;
}

/**
 * Split a ledger row into cells. Prose pipes are escaped as `\|` and must not be
 * treated as separators, or every column after them shifts and the cleanup lookup
 * reads the wrong cell.
 */
const CELL_SPLIT = /(?<!\\)\|/;

/**
 * Every branch name referenced anywhere in the review ledger (any scope, any HEAD),
 * across every namespace — claude/, codex/, copilot/, cursor/, fix/, and future ones.
 */
export function parseLedgerBranches(markdown) {
  const names = new Set();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    // | date | branch/ref | head | scope | outcome | checks |  -> column index 2
    const cell = (line.split(CELL_SPLIT)[2] ?? "").trim();
    if (!cell) continue;
    for (const name of refTokensFromCell(cell)) names.add(name);
  }
  return names;
}

/**
 * Whether the ledger records a COMPLETED cleanup review that authorizes skipping this
 * branch, per docs/branch-cleanup-guide.md: a row match on branch name, current HEAD, and
 * scope `branch-cleanup`. Deliberately excludes `branch-cleanup-deletion-pending` (and any
 * other scope) and stale-HEAD rows, so a pending deletion or a moved HEAD is surfaced for
 * re-evaluation rather than reported as already handled.
 *
 * Historical rows recorded abbreviated SHAs, so an abbreviation of at least 7 characters
 * that prefixes the current HEAD counts as the same commit. Anything shorter, or prose such
 * as `see PR head`, matches nothing and forces a re-review.
 */
export function hasCompletedCleanupReview(markdown, shortName, headSha) {
  if (!shortName || !headSha) return false;
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cols = line.split(CELL_SPLIT);
    if ((cols[4] ?? "").trim() !== "branch-cleanup") continue;
    const recorded = (cols[3] ?? "").trim().replace(/`/g, "");
    const sameCommit = recorded === headSha || (/^[0-9a-f]{7,40}$/.test(recorded) && headSha.startsWith(recorded));
    if (!sameCommit) continue;
    if (refTokensFromCell((cols[2] ?? "").trim()).includes(shortName)) return true;
  }
  return false;
}

/**
 * Refusal message for a shallow clone, or "" when the history is complete.
 *
 * Every signal this sweep reports — ahead/behind, `--cherry-pick` patch-uniqueness,
 * and therefore `deletionCandidate` — is computed from merge-bases. A shallow clone has
 * a grafted root, so merge-bases are missing or wrong and those numbers are silently
 * fiction rather than an error. On 2026-07-29 a remote session swept this repo with 74
 * of 2829 commits present and got `90 of 91` branches reported as carrying unmerged
 * work, while a stale local `main` read as `ahead 52` with "unrelated histories"
 * (ledger `#109`). Acting on that meant either deleting live branches or abandoning
 * cleanup as impossible, so this fails closed: no inventory is printed at all, because a
 * partial inventory is what invites someone to act on it.
 *
 * Takes the raw `git rev-parse --is-shallow-repository` output rather than a boolean, because
 * the decision is three-way and only ONE branch may proceed:
 *
 *   "false" -> complete history, sweep is trustworthy, return ""
 *   "true"  -> shallow, refuse
 *   anything else (including "" from a failed `tryGit`) -> INDETERMINATE, refuse
 *
 * The third case is the subtle one. `tryGit` swallows every error into "", so an unverifiable
 * precondition is indistinguishable from a healthy one unless it is treated as its own
 * failure. Proceeding there would emit merge-base-derived numbers while unable to establish
 * that the merge-bases are real, which is precisely the #109 defect wearing a different hat.
 * Note that "false" is a truthy string, so this must compare the exact value both ways —
 * coercing on truthiness would refuse on every healthy clone instead.
 */
export function shallowCloneRefusal(isShallowOutput) {
  const status = String(isShallowOutput ?? "").trim();
  if (status === "false") return "";
  const why =
    status === "true"
      ? "this is a SHALLOW clone, so every merge-base is unreliable."
      : `could not determine whether this clone is shallow (git reported ${JSON.stringify(status)}).`;
  return [
    `refusing to report: ${why}`,
    "",
    "Branch signals — ahead/behind, --cherry-pick patch-uniqueness, deletion candidates —",
    "are all derived from merge-bases. With a grafted root they are wrong without erroring:",
    "see ledger #109, where a shallow sweep reported 90 of 91 branches as unmerged.",
    "",
    "Fix: git fetch --unshallow --tags origin",
    "Then re-run, from a real git checkout, and confirm `git rev-parse",
    "--is-shallow-repository` prints false. Never delete a branch, or report one as",
    "unmerged, without that confirmation.",
  ].join("\n");
}

/**
 * Whether `remote.origin.fetch` maps EVERY remote head into `refs/remotes/origin`.
 *
 * Takes the raw `git config --get-all remote.origin.fetch` output (one refspec per line).
 * BOTH halves have to hold, because the sweep enumerates `refs/remotes/origin/<branch>` and nothing else:
 *
 *   source `refs/heads/*`              — otherwise only the named branch is fetched
 *   destination `refs/remotes/origin/*` — otherwise the heads land somewhere this never reads
 *
 * Checking the source alone was wrong, and wrong in the dangerous direction. Git's `<dst>` decides
 * which local ref is updated, so `+refs/*:refs/*` (a mirror) or `+refs/heads/*:refs/remotes/upstream/*`
 * fetches every branch and leaves `refs/remotes/origin` empty. Measured with the upstream refspec
 * above: `refs/remotes/upstream` held `upstream/main` and `upstream/feature` while the sweep exited
 * **0** reporting `"branches": []`. Codex raised this on PR #1398.
 *
 * `refs/*` as the source is also rejected even when the destination is `refs/remotes/origin/*`.
 * Git's wildcard substitution puts the matched suffix into `<dst>`: fetching `refs/heads/main`
 * against `+refs/*:refs/remotes/origin/*` writes `refs/remotes/origin/heads/main`, not
 * `refs/remotes/origin/main`. Measured in a two-branch fixture: the sweep enumerated
 * `heads/main` and `heads/feature`, failed to resolve its `origin/main` comparison base,
 * swallowed both comparison failures as zeroes, and exited 0 marking both as deletion
 * candidates. Codex raised this on PR #1398.
 *
 * A `^`-prefixed NEGATIVE refspec excludes branches from an otherwise-wildcard config, so its
 * presence means coverage cannot be established from the config at all. Measured on git 2.43.0
 * with `+refs/heads/*:refs/remotes/origin/*` plus `^refs/heads/feature`: an ordinary
 * `git fetch --prune origin` honoured the exclusion and left `origin/feature` absent. Passing an
 * explicit `+refs/heads/*:…` on the command line overrode it and restored the ref, which is why
 * this returning `false` does not by itself block the sweep — see `branchCoverageRefusal`.
 */
export function fetchRefspecCoversAllBranches(configOutput) {
  const specs = String(configOutput ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (specs.some((spec) => spec.startsWith("^"))) return false;
  return specs.some((spec) => {
    const [source, destination] = spec.replace(/^\+/, "").split(":");
    // Only refs/heads/* → refs/remotes/origin/*. A refs/* source nests under
    // refs/remotes/origin/heads/<branch> (see docstring), which this never reads.
    return source === "refs/heads/*" && destination === "refs/remotes/origin/*";
  });
}

/**
 * Refusal message when the inventory cannot be shown to cover every remote branch, or "" when
 * it can.
 *
 * A second, independent way to get a confident wrong answer, and it survives the shallow fix:
 * `git clone --depth 1` implies `--single-branch`, which pins `remote.origin.fetch` to the one
 * cloned branch. `git fetch --unshallow` converts the history — `is-shallow-repository` flips to
 * `false`, satisfying `shallowCloneRefusal` — but it does NOT widen the refspec, and an ordinary
 * `git fetch origin` then respects the narrow one. Measured in a fixture with `main` and
 * `feature`: after unshallowing, `git ls-remote --heads origin` listed both while
 * `refs/remotes/origin` held only `origin/main`, so the sweep exited 0 reporting
 * `"branches": []`. An empty inventory is not a safe failure here — it reads as "nothing to
 * clean up", and where `origin/main` itself is missing every `rev-list` fails into 0/0, making
 * every branch look like a deletion candidate with no unique patch content.
 *
 * `wildcardFetchCompleted` is why this is not simply a config check: the sweep's own fetch passes
 * an explicit `+refs/heads/*:refs/remotes/origin/*`, which populates every remote-tracking ref
 * without rewriting the operator's config, so a successful fetch establishes coverage on its own.
 * The refusal is therefore reserved for the cases where nothing established it — `--no-fetch`,
 * offline, or a failed fetch over a narrow refspec.
 */
export function branchCoverageRefusal(configOutput, wildcardFetchCompleted) {
  if (fetchRefspecCoversAllBranches(configOutput) || wildcardFetchCompleted) return "";
  return [
    "refusing to report: remote.origin.fetch does not cover every branch, and no",
    "wildcard fetch completed to make up for it.",
    "",
    "`git clone --depth 1` implies `--single-branch`, which pins the refspec to the one",
    "cloned branch. `git fetch --unshallow` fixes the history but NOT the refspec, so",
    "`--is-shallow-repository` reads false while every other branch stays invisible:",
    "the sweep would report an empty or partial inventory as if it were complete.",
    "",
    "A ^-prefixed negative refspec has the same effect: it excludes branches from an",
    "otherwise-wildcard config, so the configured fetch cannot be shown to cover them.",
    "So does a refspec whose destination is not refs/remotes/origin/* — a mirror",
    "(+refs/*:refs/*) fetches every branch into refs/heads/*, which this never reads.",
    "So does `+refs/*:refs/remotes/origin/*`: git's wildcard nests the matched suffix,",
    "writing refs/remotes/origin/heads/<branch> instead of origin/<branch>.",
    "",
    "Fix: git remote set-branches origin '*'",
    "     git fetch --prune origin",
    "Then re-run and confirm `git config --get-all remote.origin.fetch` maps",
    "refs/heads/* → refs/remotes/origin/* with no ^ exclusions — or pass --fetch and",
    "let the sweep fetch the wildcard itself, which overrides a configured exclusion.",
  ].join("\n");
}

/** The exact network command the sweep runs when, and only when, `--fetch` is passed. */
export const SWEEP_FETCH_COMMAND = "git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'";

/**
 * Network is opt-in: a report-only sweep contacts origin only when the operator passes
 * `--fetch`. `--no-fetch` remains accepted (it was the old opt-out) and means the same as
 * the default; an explicit `--no-fetch` beside `--fetch` wins, since it is the safer reading.
 */
export function sweepFetchRequested(argv) {
  return argv.includes("--fetch") && !argv.includes("--no-fetch");
}

function main() {
  const asJson = process.argv.includes("--json");
  const refuse = (message) => {
    if (asJson) {
      console.log(JSON.stringify({ error: "history-not-verified", message, branches: null }, null, 2));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  };

  // Fail closed BEFORE the fetch and before any branch maths: a shallow clone cannot
  // produce a trustworthy inventory, and an untrustworthy inventory is worse than none.
  const refusal = shallowCloneRefusal(tryGit(["rev-parse", "--is-shallow-repository"]));
  if (refusal) {
    refuse(refusal);
    return;
  }

  let wildcardFetchCompleted = false;
  if (!sweepFetchRequested(process.argv)) {
    console.error(
      `sweep-branch-ledger: reporting from the local remote-tracking refs (no network). ` +
        `To refresh them first, re-run with --fetch, which runs: ${SWEEP_FETCH_COMMAND}`,
    );
  } else {
    try {
      // Explicit wildcard refspec, not the configured one: a --depth 1 / --single-branch clone
      // pins remote.origin.fetch to one branch, and unshallowing does not widen it. Passing the
      // refspec fetches every head without rewriting the operator's config.
      execFileSync("git", ["fetch", "--prune", "--quiet", "origin", "+refs/heads/*:refs/remotes/origin/*"], {
        cwd: root,
        stdio: "ignore",
      });
      wildcardFetchCompleted = true;
    } catch {
      /* offline — fall through to the coverage guard, which refuses on a narrow refspec */
    }
  }

  // Complete history is not the same as complete branch coverage; both have to hold before any
  // inventory is printed.
  const coverageRefusal = branchCoverageRefusal(
    tryGit(["config", "--get-all", "remote.origin.fetch"]),
    wildcardFetchCompleted,
  );
  if (coverageRefusal) {
    refuse(coverageRefusal);
    return;
  }

  // Every comparison below is against origin/main; without it every branch would read as 0/0
  // with no unique commits.
  if (!tryGit(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"])) {
    refuse(
      "refusing to report: origin/main does not resolve locally, so no branch can be compared " +
        `with it. Refresh the remote-tracking refs (re-run with --fetch, which runs: ${SWEEP_FETCH_COMMAND}) and retry.`,
    );
    return;
  }

  const ledgerText = (() => {
    try {
      return readLedgerCorpus();
    } catch {
      return "";
    }
  })();

  const remoteBranches = tryGit(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
    .split("\n")
    .map((b) => b.trim())
    // `refname:short` renders refs/remotes/origin/HEAD as bare "origin"; exclude it.
    .filter((b) => b && b !== "origin" && b !== "origin/HEAD" && b !== "origin/main");

  const rows = [];
  for (const ref of remoteBranches) {
    const short = ref.replace(/^origin\//, "");
    const counts = gitOrNull(["rev-list", "--left-right", "--count", `origin/main...${ref}`]);
    // Cherry-pick-aware: commits on the branch NOT already in main (by patch id).
    const uniqueLog = gitOrNull(["log", "--oneline", "--right-only", "--cherry-pick", `origin/main...${ref}`]);
    const { ahead, behind, uniqueCommits, deletionCandidate } = branchComparison(counts, uniqueLog);
    const headSha = tryGit(["rev-parse", ref]);
    rows.push({
      branch: short,
      ahead,
      behind,
      uniqueCommits,
      // Only a completed `branch-cleanup` review at the current HEAD counts as
      // reviewed/skippable; deletion-pending rows and stale HEADs report `no`.
      reviewed: hasCompletedCleanupReview(ledgerText, short, headSha),
      deletionCandidate,
    });
  }

  // Indeterminate rows (null counts) sort last.
  const sortableCount = (value) => (value === null ? Number.MAX_SAFE_INTEGER : value);
  rows.sort(
    (a, b) => sortableCount(a.uniqueCommits) - sortableCount(b.uniqueCommits) || a.branch.localeCompare(b.branch),
  );

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), branches: rows }, null, 2));
    return;
  }

  const candidates = rows.filter((r) => r.deletionCandidate);
  console.log(`Branch inventory vs origin/main (${rows.length} remote branches):\n`);
  console.log("unique  ahead  behind  review  branch");
  for (const r of rows) {
    console.log(
      `${String(r.uniqueCommits ?? "?").padStart(6)}  ${String(r.ahead ?? "?").padStart(5)}  ${String(r.behind ?? "?").padStart(6)}  ` +
        `${r.reviewed ? "  yes " : "  no  "}  ${r.branch}`,
    );
  }
  console.log(`\n${candidates.length} deletion candidate(s) (no unique patch content — squash-merged or empty):`);
  for (const r of candidates) console.log(`  - ${r.branch}`);
  console.log(
    "\nREPORT ONLY — nothing deleted. Verify each candidate per docs/branch-cleanup-guide.md before removing.",
  );
}

const invokedDirectly = process.argv[1]?.endsWith("sweep-branch-ledger.mjs");
if (invokedDirectly) main();
