#!/usr/bin/env node
/**
 * audit-merge-loss — find merged pull requests whose content was silently
 * reverted by a later merge resolution.
 *
 * Why this exists. On 2026-08-11 merge commit acf78bf ("Merge remote-tracking
 * branch origin/main into probe2-1815") took the stale branch side of several
 * manual conflict resolutions and reverted seven already-merged PRs — #1800,
 * #1803, #1804, #1809, #1811, #1815 and #1796. Nothing went red, because the
 * reverts took each PR's tests in the same stroke: no assertion survived to
 * fail. The docs casualties were repaired by 55f51ab; the source casualties
 * went unnoticed for two days. Care at the keyboard is demonstrably not the
 * control here — commit 6f8c70d shows a human consciously preserving the #1803
 * migration and a later merge in the same chain undoing it anyway.
 *
 * The measurement. For each pull request that landed on the target ref inside
 * the window, compare the ref's current tree entry for every file that landing
 * changed against that file's tree entry at the landing's first parent. Equality
 * means the landing's contribution to that file is no longer present. Tree
 * entries include the file mode and blob OID, so mode-only landings are not
 * mistaken for losses while the comparison stays cheap over a wide window.
 *
 * ADVISORY BY DESIGN — this exits 0 even when it finds something. A deliberate
 * later revert is byte-identical to an accidental one at blob level, so a
 * positive is a question for a human, not a verdict. The report names the pull
 * request, the landing commit and every affected file so that question can be
 * answered. `--strict` exits 1 for a caller that wants a hard failure.
 *
 * DELIBERATELY NOT WIRED INTO CI OR A SCHEDULE. Running this automatically is
 * an operational change that needs its own pull request and explicit approval;
 * its absence from .github/workflows/ is a decision, not an oversight. It is
 * also not in `verify:cheap:internal`: check-gate-manifest.mjs would then
 * require a matching ci.yml step.
 *
 * Run: npm run audit:merge-loss
 *      npm run audit:merge-loss -- --since 30 --ref origin/main
 *      npm run audit:merge-loss -- --json
 *      npm run audit:merge-loss -- --strict     # exit 1 on any finding
 *      node scripts/audit-merge-loss.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REF = "origin/main";
const DEFAULT_WINDOW_DAYS = 14;
const LOG_FORMAT = "%H%x09%cI%x09%s";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

/**
 * The pull request a landing commit belongs to, or undefined.
 *
 * Both shapes occur on this repo's main: a merge landing ("Merge pull request
 * #1935 from …") and a squash landing ("… (#1933)"). A squash subject can carry
 * more than one issue reference, so the pull request is the LAST parenthesised
 * number — GitHub appends it.
 */
export function parsePullNumber(subject) {
  const merge = /^Merge pull request #(\d+)\b/.exec(String(subject ?? ""));
  if (merge) return Number(merge[1]);
  const squashed = [...String(subject ?? "").matchAll(/\(#(\d+)\)/g)];
  const last = squashed.at(-1);
  return last ? Number(last[1]) : undefined;
}

/** Parse `git log --format=%H\t%cI\t%s` output into landing records. */
export function parseLogEntries(rawLog) {
  return String(rawLog ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [sha, date, ...rest] = line.split("\t");
      const subject = rest.join("\t");
      return { sha, date, subject, pullNumber: parsePullNumber(subject) };
    });
}

const INBOX = "docs/outstanding-issues-inbox";

/**
 * The one exemption, kept deliberately narrow.
 *
 * `npm run issues:reconcile` MOVES a pending request from the inbox to
 * `applied/` verbatim, so every pull request that queues one looks like it
 * added a file that is now gone. That is the request's designed lifecycle, not
 * a loss — and it accounted for six of fifteen findings on the first real run,
 * which would have buried the genuine #1803 signal. The move is only credited
 * when the identically-named audit record exists at the target ref with the
 * same tree entry as the request at its landing. This confirms the move was
 * verbatim rather than hiding a mismatched or corrupted request.
 */
export function isReconciliationMove(file, landingRef, ref, entryAt) {
  const match = new RegExp(`^${INBOX}/([^/]+\\.json)$`).exec(file);
  if (!match) return false;
  const requestAtLanding = entryAt(landingRef, file);
  return requestAtLanding !== null && entryAt(ref, `${INBOX}/applied/${match[1]}`) === requestAtLanding;
}

/**
 * Where a landing's contribution to one file disappeared, and by what mechanism.
 *
 * Walk the commits that touched `file` between the landing and the ref OLDEST
 * FIRST and take the first one whose tree entry already equals the pre-landing
 * entry. That is where the contribution stopped being present; a later commit
 * that also matches is just carrying the absence forward.
 *
 * The mechanism is the triage signal, and it is the reason this tool can be read
 * at all. A merge commit dropping a side is the accidental case the audit exists
 * for. A single-parent commit is somebody choosing to remove the change, and its
 * subject almost always says why. Measured over the 2026-08-01..15 window: of 66
 * flagged non-inbox files, 14 were merge-resolution removals and 13 of those came
 * from the single documented bad merge (acf78bf) — while every one of the other 52
 * had an explanatory single-parent subject ("Re-land the --shadow-tight
 * retirement", "rework the viewer for phone and PWA reading", "ci: speed
 * iteration without weakening gates").
 *
 * This does NOT turn the audit into a verdict, and deliberately does not filter:
 * a deliberate-looking commit can still be a mistake, and `unknown` means the
 * walk found no commit matching the pre-landing entry, which is a question rather
 * than a clean bill. It orders the reading list so the accidental cases are not
 * buried under the deliberate ones.
 *
 * Pure, with git access injected, so it is testable without a repository.
 *
 * @param {{ file: string, landingSha: string, preEntry: string | null, ref: string,
 *   historyOf: (landingSha: string, ref: string, file: string) => Array<{ sha: string, subject: string }>,
 *   entryAt: (ref: string, file: string) => string | null,
 *   isMergeCommit: (sha: string) => boolean }} options
 */
export function classifyRemoval({ file, landingSha, preEntry, ref, historyOf, entryAt, isMergeCommit }) {
  const commits = historyOf(landingSha, ref, file) ?? [];
  for (const commit of commits) {
    if (entryAt(commit.sha, file) !== preEntry) continue;
    return {
      mechanism: isMergeCommit(commit.sha) ? "merge-resolution" : "deliberate-commit",
      sha: commit.sha,
      subject: commit.subject,
    };
  }
  return { mechanism: "unknown", sha: undefined, subject: undefined };
}

const MECHANISMS = ["merge-resolution", "deliberate-commit", "unknown"];

/** How many of a finding's files went in a merge resolution — the ordering key. */
function mergeResolutionCount(finding) {
  return finding.revertedFiles.filter((entry) => entry.removal?.mechanism === "merge-resolution").length;
}

/**
 * Compare each landing's contribution against the ref's current state.
 *
 * `entryAt(ref, file)` returns a tree entry (mode, object type, and blob OID),
 * or null when the path does not exist at that ref. Injected so the whole
 * classifier is testable without git.
 *
 * A file is reported when its current blob equals its pre-landing blob. Both
 * being null counts: that is the "the pull request added this file and it is
 * gone again" case. A file the pull request DELETED and which is still absent
 * does not match, because its pre-landing blob existed — the deletion survived.
 *
 * `removalOf` is optional. When given, each reported file carries the commit and
 * mechanism that removed it (see classifyRemoval) and findings are ordered so the
 * merge-resolution cases come first. Omitting it leaves the finding shape and the
 * original ordering untouched.
 *
 * Pure and exported for the self-test and focused tests.
 *
 * @typedef {{ sha: string, date: string, subject: string, pullNumber: number | undefined,
 *   preRef: string, files?: string[] }} Landing
 * @typedef {{ mechanism: "merge-resolution" | "deliberate-commit" | "unknown",
 *   sha: string | undefined, subject: string | undefined }} Removal
 * @param {{ landings?: Landing[], entryAt: (ref: string, file: string) => string | null,
 *   ref?: string,
 *   removalOf?: (context: { file: string, landingSha: string, preEntry: string | null }) => Removal | undefined
 *   }} options
 */
export function classifyMergeLoss({ landings = [], entryAt, ref = DEFAULT_REF, removalOf }) {
  const findings = [];
  let filesCompared = 0;
  let filesExempted = 0;
  const skipped = [];
  const mechanismCounts = Object.fromEntries(MECHANISMS.map((mechanism) => [mechanism, 0]));
  for (const landing of landings) {
    if (landing.pullNumber === undefined) {
      skipped.push(landing);
      continue;
    }
    const reverted = [];
    for (const file of landing.files ?? []) {
      filesCompared += 1;
      const before = entryAt(landing.preRef, file);
      const now = entryAt(ref, file);
      if (before !== now) continue;
      if (now === null && isReconciliationMove(file, landing.sha, ref, entryAt)) {
        filesExempted += 1;
        continue;
      }
      // `removalOf` stays optional so the finding shape is unchanged for callers
      // that only want the comparison — the mechanism costs a `git log` per
      // flagged file, which is worth paying for findings and not for every
      // compared file.
      const removal = removalOf ? removalOf({ file, landingSha: landing.sha, preEntry: before }) : undefined;
      if (removal) mechanismCounts[removal.mechanism] += 1;
      reverted.push(removal ? { file, absent: now === null, removal } : { file, absent: now === null });
    }
    if (reverted.length > 0) {
      findings.push({
        pullNumber: landing.pullNumber,
        sha: landing.sha,
        date: landing.date,
        subject: landing.subject,
        changedFiles: (landing.files ?? []).length,
        revertedFiles: reverted,
      });
    }
  }
  // Merge-resolution removals first: they are the accidental case. With no
  // `removalOf` every count is 0, so this falls through to the original
  // most-of-the-landing-missing order.
  findings.sort(
    (a, b) =>
      mergeResolutionCount(b) - mergeResolutionCount(a) ||
      b.revertedFiles.length - a.revertedFiles.length ||
      a.pullNumber - b.pullNumber,
  );
  return {
    findings,
    scannedLandings: landings.length - skipped.length,
    skipped,
    filesCompared,
    filesExempted,
    mechanismCounts,
  };
}

function resolveArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const rawSince = value("--since");
  const since = rawSince === undefined ? DEFAULT_WINDOW_DAYS : Number(rawSince);
  if (!Number.isFinite(since) || since <= 0) {
    throw new Error(`--since expects a positive number of days, received "${rawSince}"`);
  }
  return {
    ref: value("--ref") ?? DEFAULT_REF,
    since,
    json: argv.includes("--json"),
    strict: argv.includes("--strict"),
  };
}

function collectLandings(ref, since) {
  const rawLog = git(["log", "--first-parent", `--since=${since} days ago`, `--format=${LOG_FORMAT}`, ref]);
  return parseLogEntries(rawLog).map((landing) => {
    const preRef = `${landing.sha}^1`;
    const names = tryGit(["diff", "--name-only", preRef, landing.sha]);
    return { ...landing, preRef, files: names === undefined ? [] : names.split(/\r?\n/).filter(Boolean) };
  });
}

/**
 * The mode/type/OID prefix of one `git ls-tree` line, with the path removed.
 *
 * `ls-tree` renders `<mode> SP <type> SP <oid> TAB <path>`, so the split is on a
 * REAL tab. This is exported because getting it wrong is invisible to any test
 * that injects `entryAt` directly, which is how the original `"\\t"` (a literal
 * backslash-t, matching nothing) survived a green suite: leaving the path on the
 * entry is harmless for the same-path comparison that finds losses, and breaks
 * only the cross-path reconciliation check, which compares an inbox request
 * against its `applied/` record. That silently turned every reconciled request
 * back into a finding — 189 of 255 flagged files on a 14-day window, with
 * `filesExempted` reporting 0 — burying the genuine signal the exemption exists
 * to protect. Parse it here, once, and test it against real `ls-tree` output.
 */
export function parseTreeEntry(raw) {
  if (raw === undefined || raw === null) return null;
  const line = String(raw);
  if (line.length === 0) return null;
  return line.split("\t", 1)[0];
}

function treeEntryReader() {
  const cache = new Map();
  return (ref, file) => {
    const key = `${ref}:${file}`;
    if (!cache.has(key)) {
      cache.set(key, parseTreeEntry(tryGit(["ls-tree", ref, "--", file])));
    }
    return cache.get(key);
  };
}

/**
 * Commits touching `file` between a landing and the ref, oldest first.
 *
 * `--full-history` matters: default history simplification hides the merge
 * commits that are exactly what this walk is looking for, so without it a
 * merge-resolution removal reports as `unknown`.
 */
function historyReader() {
  const cache = new Map();
  return (landingSha, ref, file) => {
    const key = `${landingSha}..${ref}:${file}`;
    if (!cache.has(key)) {
      const raw = tryGit([
        "log",
        "--reverse",
        "--first-parent",
        "--full-history",
        "--format=%H%x1f%s",
        `${landingSha}..${ref}`,
        "--",
        file,
      ]);
      cache.set(
        key,
        String(raw ?? "")
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0)
          .map((line) => {
            const [sha, ...rest] = line.split("\x1f");
            return { sha, subject: rest.join("\x1f") };
          }),
      );
    }
    return cache.get(key);
  };
}

function mergeCommitReader() {
  const cache = new Map();
  return (sha) => {
    if (!cache.has(sha)) {
      const raw = tryGit(["rev-list", "--parents", "-n", "1", sha]);
      // `<sha> <parent>…` — more than one parent means a merge.
      cache.set(sha, raw === undefined ? false : raw.trim().split(/\s+/).length - 1 > 1);
    }
    return cache.get(sha);
  };
}

const MECHANISM_LABEL = {
  "merge-resolution": "MERGE-RESOLUTION",
  "deliberate-commit": "deliberate commit",
  unknown: "unresolved",
};

function report(result, { ref, since, strict }) {
  const { findings, scannedLandings, skipped, filesCompared, filesExempted } = result;
  console.log(
    `[merge-loss] scanned ${scannedLandings} pull request landing(s) on ${ref} over the last ${since} day(s); ` +
      `compared ${filesCompared} file(s).`,
  );
  if (skipped.length > 0) {
    console.log(
      `[merge-loss] ${skipped.length} first-parent commit(s) carried no pull request number and were skipped.`,
    );
  }
  if (filesExempted > 0) {
    console.log(
      `[merge-loss] ${filesExempted} inbox request(s) were excluded: issues:reconcile moved them to applied/ verbatim.`,
    );
  }
  if (findings.length === 0) {
    console.log("[merge-loss] No landing has been reverted to its pre-merge state.");
    return 0;
  }

  console.log("");
  console.log(`[merge-loss] ${findings.length} landing(s) look reverted — HUMAN CONFIRMATION REQUIRED.`);
  console.log("A deliberate later revert is identical to an accidental one at blob level, so this is a");
  console.log("question, not a verdict. For each entry below, decide whether the change was meant to go.");
  const counts = result.mechanismCounts ?? {};
  if (MECHANISMS.some((mechanism) => counts[mechanism] > 0)) {
    console.log("");
    console.log(
      `[merge-loss] removal mechanism across ${MECHANISMS.reduce((total, m) => total + counts[m], 0)} flagged file(s): ` +
        `${counts["merge-resolution"]} merge-resolution, ${counts["deliberate-commit"]} deliberate commit, ` +
        `${counts.unknown} unresolved.`,
    );
    console.log("Merge-resolution removals are the accidental case and are listed FIRST. A deliberate commit");
    console.log("with an explanatory subject is usually a real decision — check it, but check the others first.");
    console.log("`unresolved` means no commit in the window matched the pre-merge entry; treat it as a question.");
  }
  for (const finding of findings) {
    console.log("");
    console.log(`  PR #${finding.pullNumber} — ${finding.subject}`);
    console.log(`    landed ${finding.date} as ${finding.sha.slice(0, 12)}`);
    console.log(
      `    ${finding.revertedFiles.length} of ${finding.changedFiles} changed file(s) match the pre-merge tree entry:`,
    );
    for (const entry of finding.revertedFiles) {
      console.log(`      - ${entry.file}${entry.absent ? " (added by the PR, absent now)" : ""}`);
      if (entry.removal) {
        const where = entry.removal.sha ? ` ${entry.removal.sha.slice(0, 12)} — ${entry.removal.subject}` : "";
        console.log(`          via ${MECHANISM_LABEL[entry.removal.mechanism]}:${where}`);
      }
    }
    console.log(`    Inspect: git diff ${finding.sha}^1 ${finding.sha} -- <file>`);
  }
  console.log("");
  console.log("Confirmed losses are re-landed as their own pull request; record the decision with npm run issues:add.");
  return strict ? 1 : 0;
}

function selfTest() {
  if (parsePullNumber("Merge pull request #1935 from BigSimmo/codex/fix-x") !== 1935) {
    throw new Error("self-test failed: merge-landing subject not parsed");
  }
  if (parsePullNumber("ci: speed iteration without weakening gates (#1926)") !== 1926) {
    throw new Error("self-test failed: squash-landing subject not parsed");
  }
  if (parsePullNumber("fix: close (#12) properly (#1930)") !== 1930) {
    throw new Error("self-test failed: trailing pull request number not preferred");
  }
  if (parsePullNumber("Merge branch 'main' into feature") !== undefined) {
    throw new Error("self-test failed: a non-pull-request subject produced a number");
  }

  const entries = parseLogEntries("abc\t2026-08-14T06:00:11+08:00\tMerge pull request #10 from o/b\n");
  if (entries.length !== 1 || entries[0].pullNumber !== 10 || entries[0].sha !== "abc") {
    throw new Error("self-test failed: log parsing is incorrect");
  }

  const blobs = new Map([
    ["pre:kept.ts", "aaa"],
    ["head:kept.ts", "bbb"],
    ["pre:lost.ts", "ccc"],
    ["head:lost.ts", "ccc"],
    ["head:deleted.ts", null],
    ["pre:deleted.ts", "ddd"],
  ]);
  const entryAt = (ref, file) => blobs.get(`${ref}:${file}`) ?? null;
  const { findings } = classifyMergeLoss({
    ref: "head",
    entryAt,
    landings: [
      { sha: "s1", date: "d", subject: "x (#1)", pullNumber: 1, preRef: "pre", files: ["kept.ts"] },
      { sha: "s2", date: "d", subject: "y (#2)", pullNumber: 2, preRef: "pre", files: ["lost.ts", "kept.ts"] },
      { sha: "s3", date: "d", subject: "z (#3)", pullNumber: 3, preRef: "pre", files: ["deleted.ts"] },
      { sha: "s4", date: "d", subject: "w (#4)", pullNumber: 4, preRef: "pre", files: ["added.ts"] },
    ],
  });
  const byPull = new Map(findings.map((finding) => [finding.pullNumber, finding]));
  if (byPull.has(1)) throw new Error("self-test failed: a surviving change was reported as lost");
  if (byPull.get(2)?.revertedFiles.length !== 1) throw new Error("self-test failed: a reverted file was not reported");
  if (byPull.has(3)) throw new Error("self-test failed: a surviving deletion was reported as lost");
  if (!byPull.get(4)) throw new Error("self-test failed: a vanished added file was not reported");

  const request = `${INBOX}/11111111-1111-4111-8111-111111111111.json`;
  const reconciled = classifyMergeLoss({
    ref: "head",
    entryAt: (reference, file) => {
      if (reference === "s5" && file === request) return "100644 blob eee";
      return reference === "head" && file === `${INBOX}/applied/${path.posix.basename(request)}`
        ? "100644 blob eee"
        : null;
    },
    landings: [{ sha: "s5", date: "d", subject: "q (#5)", pullNumber: 5, preRef: "pre", files: [request] }],
  });
  if (reconciled.findings.length !== 0 || reconciled.filesExempted !== 1) {
    throw new Error("self-test failed: a reconciled inbox request was reported as a merge loss");
  }

  // Regression guard for the `"\\t"` bug. The check above injects bare entries, so
  // it passes either way; this one runs real `ls-tree` output through the real
  // parser, where leaving the path attached makes the cross-path comparison fail.
  if (parseTreeEntry("100644 blob eee\tsome/path.json") !== "100644 blob eee") {
    throw new Error("self-test failed: parseTreeEntry did not strip the path from an ls-tree line");
  }
  if (parseTreeEntry(undefined) !== null || parseTreeEntry("") !== null) {
    throw new Error("self-test failed: parseTreeEntry did not treat a missing path as null");
  }
  const applied = `${INBOX}/applied/${path.posix.basename(request)}`;
  const lsTree = (file) => parseTreeEntry(`100644 blob eee\t${file}`);
  const realistic = classifyMergeLoss({
    ref: "head",
    entryAt: (reference, file) => {
      if (reference === "s6" && file === request) return lsTree(file);
      return reference === "head" && file === applied ? lsTree(file) : null;
    },
    landings: [{ sha: "s6", date: "d", subject: "r (#6)", pullNumber: 6, preRef: "pre", files: [request] }],
  });
  if (realistic.findings.length !== 0 || realistic.filesExempted !== 1) {
    throw new Error("self-test failed: the reconciliation exemption does not survive real ls-tree entries");
  }

  const history = { "s7..head:lost.ts": [{ sha: "m1", subject: "Merge remote-tracking branch 'origin/main'" }] };
  const removal = classifyRemoval({
    file: "lost.ts",
    landingSha: "s7",
    preEntry: "pre-entry",
    ref: "head",
    historyOf: (landingSha, reference, file) => history[`${landingSha}..${reference}:${file}`] ?? [],
    entryAt: () => "pre-entry",
    isMergeCommit: (sha) => sha === "m1",
  });
  if (removal.mechanism !== "merge-resolution" || removal.sha !== "m1") {
    throw new Error("self-test failed: a merge-resolution removal was not classified");
  }
  const unresolved = classifyRemoval({
    file: "lost.ts",
    landingSha: "s7",
    preEntry: "pre-entry",
    ref: "head",
    historyOf: () => [],
    entryAt: () => "pre-entry",
    isMergeCommit: () => false,
  });
  if (unresolved.mechanism !== "unknown") {
    throw new Error("self-test failed: an empty history should classify as unknown, not as deliberate");
  }
  console.error("merge-loss audit self-test passed.");
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const options = resolveArgs(process.argv.slice(2));

  const shallow = tryGit(["rev-parse", "--is-shallow-repository"]);
  if (shallow?.trim() !== "false") {
    console.error("[merge-loss] this is a shallow clone; pre-merge parents are unavailable and a clean sweep here");
    console.error("[merge-loss] would be meaningless. Re-run after `git fetch --unshallow`.");
    process.exitCode = 1;
    return;
  }
  if (tryGit(["rev-parse", "--verify", "--quiet", `${options.ref}^{commit}`]) === undefined) {
    console.error(`[merge-loss] cannot resolve ref "${options.ref}"; fetch it or pass --ref <ref>.`);
    process.exitCode = 1;
    return;
  }

  const landings = collectLandings(options.ref, options.since);
  const entryAt = treeEntryReader();
  const historyOf = historyReader();
  const isMergeCommit = mergeCommitReader();
  const result = classifyMergeLoss({
    landings,
    entryAt,
    ref: options.ref,
    removalOf: ({ file, landingSha, preEntry }) =>
      classifyRemoval({ file, landingSha, preEntry, ref: options.ref, historyOf, entryAt, isMergeCommit }),
  });
  if (options.json) {
    console.log(JSON.stringify({ ref: options.ref, sinceDays: options.since, ...result }, null, 2));
    process.exitCode = options.strict && result.findings.length > 0 ? 1 : 0;
    return;
  }
  process.exitCode = report(result, options);
}

if (isDirectEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[merge-loss] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
