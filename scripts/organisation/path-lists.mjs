// Safety-list coverage checks for the organisation framework (suggestions 2 and 7).
//
// Two questions, both answered from `scripts/pr-policy.mjs`, which owns the lists. This module
// never edits a list and never decides policy; it only reports.
//
// 1. `coverageLossFindings`: did a rename, copy or move in this change take a file off a safety
//    list, judged against the lists as they were before the change? A file silently losing its
//    protection is a safety problem, not a tidiness one, so those findings are marked `loud` for
//    the integrator to print prominently. Findings never block: the owner decided that only a
//    self-contradictory map blocks a PR.
// 2. `deadEntryFindings`: does an exact file name on the ranking or clinical-risk list point at
//    no tracked file, so the entry protects nothing?
//
// Deliberately NOT checked here:
// - CODEOWNERS dead patterns: `tests/ci-audit-contracts.test.ts` already fails on any CODEOWNERS
//   pattern that matches nothing. CODEOWNERS also starts with a catch-all `*` line, so a move can
//   never leave a file without a code owner; it can only fall back to the catch-all.
// - The site-content owners list (`src/lib/site-content/site-content-change-owners.json`):
//   `scripts/ci-change-scope.mjs` already throws on an owner path that does not exist.
//
// Findings carry both `severity` (the framework's stage-2 name) and `level` (the name
// `scripts/check-organisation.mjs` prints), so either consumer can read them unchanged.

import { spawnSync } from "node:child_process";
import { posix as posixPath } from "node:path";

import { safetyPathLists } from "../pr-policy.mjs";
import { SAFETY_CLASSES, safetyClassesFor } from "./safety-lists.mjs";

const POLICY_FILE = "scripts/pr-policy.mjs";

// What each list is called in pr-policy, what it does for a PR, and how to put a file back on it.
const LIST_DESCRIPTIONS = Object.freeze({
  ragRanking: {
    label: "the ranking-protected list",
    variable: "ragRankingPatterns",
    effect: "PRs that change it are no longer flagged as ranking-sensitive or asked for a `RAG impact:` line",
  },
  clinicalRisk: {
    label: "the clinical-risk list",
    variable: "clinicalRiskPatterns",
    effect: "PRs that change it no longer require the Clinical Governance Preflight",
  },
  migration: {
    label: "the database-migration list",
    variable: "migrationPatterns",
    effect: "PRs that change it no longer get the migration-history and deploy-claim checks",
  },
});

function describeList(name) {
  return (
    LIST_DESCRIPTIONS[name] ?? {
      label: `the ${name} list`,
      variable: name,
      effect: "PRs that change it no longer get that list's checks",
    }
  );
}

/**
 * @typedef {object} PathListFinding
 * @property {"warning"} severity
 * @property {"warning"} level
 * @property {boolean} loud true when the integrator should print it prominently
 * @property {string} key stable identity, e.g. `coverage-lost:<new path>`
 * @property {string} subject the path the finding is about
 * @property {string} [about] the related path (the old name of a rename, or the policy file)
 * @property {string} message plain-English explanation and remedy
 */

/**
 * @param {{ key: string, subject: string, about?: string, message: string, loud?: boolean }} fields
 * @returns {PathListFinding}
 */
function warning({ key, subject, about, message, loud = false }) {
  /** @type {PathListFinding} */
  const finding = { severity: "warning", level: "warning", loud, key, subject, message };
  if (about) finding.about = about;
  return finding;
}

function checkRef(name, value) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("-") || /[\s\0]/.test(value)) {
    throw new Error(`${name} must be a git revision, got ${JSON.stringify(value)}`);
  }
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    // Plain-English git messages, so the rename-limit warning below is recognisable.
    env: { ...process.env, LC_ALL: "C", LANG: "C", GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw new Error(`git could not run: ${result.error.message}`);
  if (result.status !== 0) {
    const reason = (result.stderr || "").trim().split("\n")[0] || `exit ${result.status}`;
    throw new Error(`git ${args[0]} failed: ${reason}`);
  }
  return result;
}

/**
 * Parses `git diff --name-status -z` output into `{ status, path, from? }` entries.
 * @param {string} output
 * @returns {{ status: string, path: string, from?: string }[]}
 */
export function parseNameStatus(output) {
  const tokens = String(output ?? "").split("\0");
  const entries = [];
  let index = 0;
  while (index < tokens.length && tokens[index] !== "") {
    const status = tokens[index];
    if (/^[RC]/.test(status)) {
      entries.push({ status: status[0], from: tokens[index + 1], path: tokens[index + 2] });
      index += 3;
    } else {
      entries.push({ status: status[0], path: tokens[index + 1] });
      index += 2;
    }
  }
  return entries;
}

// Runs in a child `node --input-type=module` process so `coverageLossFindings` stays synchronous.
// It loads one revision's copy of pr-policy (which imports only node builtins) from a data: URL
// per side and classifies that side's paths with it. A side that cannot load reports an error.
const CLASSIFY_WITH_POLICY_COPIES = `
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { copies, classes } = JSON.parse(input);
const output = {};
for (const [side, { source, files }] of Object.entries(copies)) {
  try {
    if (typeof source !== "string") throw new Error("no copy of the policy at this revision");
    const policy = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    const result = {};
    for (const file of files) {
      const flags = policy.classifyPullRequestFiles([file]);
      result[file] = classes.filter((name) => flags[name]);
    }
    output[side] = { classes: result };
  } catch (error) {
    output[side] = { error: String(error && error.message ? error.message : error) };
  }
}
process.stdout.write(JSON.stringify(output));
`;

function policySourceAt(root, revision) {
  const result = spawnSync("git", ["-C", root, "show", `${revision}:${POLICY_FILE}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C", LANG: "C", GIT_OPTIONAL_LOCKS: "0" },
  });
  return !result.error && result.status === 0 ? result.stdout : null;
}

/**
 * Classifies old paths with the base revision's pr-policy and new paths with the head
 * revision's, each loaded from git. A side that cannot be loaded comes back as null.
 */
function classifyWithPolicyCopies(root, sides) {
  const copies = {};
  for (const [side, { revision, files }] of Object.entries(sides)) {
    copies[side] = { source: policySourceAt(root, revision), files };
  }
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", CLASSIFY_WITH_POLICY_COPIES], {
    input: JSON.stringify({ copies, classes: SAFETY_CLASSES }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  const loaded = { base: null, head: null };
  if (child.error || child.status !== 0) return loaded;
  try {
    const output = JSON.parse(child.stdout);
    for (const side of Object.keys(loaded)) {
      if (output[side] && output[side].classes) loaded[side] = output[side].classes;
    }
  } catch {
    // Unreadable output: both sides fall back.
  }
  return loaded;
}

function listLabels(names) {
  return names.map((name) => `${describeList(name).label} (${describeList(name).variable})`).join(" and ");
}

function listVariables(names) {
  return names.map((name) => describeList(name).variable).join(" and ");
}

function blobsByHash(root, revision) {
  /** @type {Map<string, string[]>} */
  const byHash = new Map();
  for (const record of git(root, ["ls-tree", "-r", "-z", revision]).stdout.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const hash = record.slice(0, tab).split(" ")[2];
    const file = record.slice(tab + 1);
    if (!hash || !file) continue;
    const paths = byHash.get(hash);
    if (paths) paths.push(file);
    else byHash.set(hash, [file]);
  }
  return byHash;
}

/**
 * Exact copies git's `-C` leaves unpaired. Copy detection only considers a source
 * that also changed in the same diff, unless `--find-copies-harder` scans the
 * whole tree. That scan is too expensive here. Blob hashes answer the unmodified
 * case exactly: the new file's blob equals a file that already existed at base.
 * @param {string} root
 * @param {string} base
 * @param {string} head
 * @param {readonly string[]} addedPaths
 * @returns {{ from: string, path: string }[]}
 */
function unmodifiedExactCopies(root, base, head, addedPaths) {
  if (addedPaths.length === 0) return [];
  const byHash = blobsByHash(root, base);
  /** @type {{ from: string, path: string }[]} */
  const copies = [];
  for (const file of addedPaths) {
    const hash = git(root, ["rev-parse", `${head}:${file}`]).stdout.trim();
    for (const from of byHash.get(hash) ?? []) {
      if (from !== file) copies.push({ from, path: file });
    }
  }
  return copies;
}

function coverageLostFinding({ path, from, how, lost }) {
  const details = lost.map((name) => {
    const list = describeList(name);
    return `${list.label} (${list.variable}): ${list.effect}`;
  });
  const copyNote =
    how === "copied from" ? " The original stays protected; this matters when the copy takes over its job." : "";
  return warning({
    key: `coverage-lost:${path}`,
    subject: path,
    about: from,
    loud: true,
    message: `${how} \`${from}\`, and the new path has lost its safety protection. It is not on ${details.join("; and not on ")}.${copyNote} To restore it, add \`${path}\` to ${listVariables(lost)} in ${POLICY_FILE}.`,
  });
}

function filesAt(root, revision) {
  return git(root, ["ls-tree", "-r", "-z", "--name-only", revision]).stdout.split("\0").filter(Boolean);
}

// When a change edits pr-policy, a file that stays where it is can still lose its protection
// because its pattern was removed or narrowed. Judge every file present on both sides with each
// side's lists. A copy that cannot be loaded gives one loud "check by hand" finding instead.
function listEditFindings(root, base, head) {
  // Every path present on both sides, including files edited in place; moved files are judged
  // by the rename check instead, because their old and new paths are never both present.
  const before = new Set(filesAt(root, base));
  const files = filesAt(root, head).filter((file) => before.has(file));
  const loaded = classifyWithPolicyCopies(root, {
    base: { revision: base, files },
    head: { revision: head, files },
  });
  if (!loaded.base || !loaded.head) {
    return [
      warning({
        key: "coverage-list-edit-unchecked",
        subject: POLICY_FILE,
        loud: true,
        message: `this change edits the safety lists in ${POLICY_FILE}, but one side's copy could not be loaded, so files taken off a list were not checked. Compare the lists by hand.`,
      }),
    ];
  }
  const findings = [];
  for (const file of files) {
    const after = new Set(loaded.head[file] ?? []);
    const lost = (loaded.base[file] ?? []).filter((name) => !after.has(name));
    if (lost.length === 0) continue;
    findings.push(
      warning({
        key: `coverage-dropped:${file}`,
        subject: file,
        about: POLICY_FILE,
        loud: true,
        message: `was on ${listLabels(lost)} before this change and is not any more, although the file did not move. If that is intended, say so in the PR; otherwise restore its entry in ${listVariables(lost)} in ${POLICY_FILE}.`,
      }),
    );
  }
  return findings;
}

/**
 * Safety coverage a change loses by moving files, as findings. Never blocking.
 *
 * Old paths are judged against the BASE revision's lists and new paths against the HEAD
 * revision's, so a change that renames a file and also deletes its name from pr-policy is still
 * caught. Both copies are loaded from git in a child process (pr-policy imports only node
 * builtins); a copy that cannot be loaded falls back to the head copy, then to the copy this
 * module imported.
 *
 * - A rename, or a copy, whose new path is missing a list the old path was on gives one `loud`
 *   warning keyed `coverage-lost:<new>`, naming each lost list and how to restore it.
 *   Git's `-C` pairs a copy only when the source also changed in the same diff. An exact
 *   copy of an unmodified safety-listed file is still flagged, by blob hash.
 * - A deleted file that was on a list gives a plain warning keyed `coverage-deleted:<old>`:
 *   deletion is not lost protection. It becomes `loud` when the same change adds a file with the
 *   same name that is missing one of those lists, because that is what an undetected move looks
 *   like.
 * - If the base lists cannot be loaded and the change edits pr-policy while renaming or deleting
 *   files, one `loud` warning says the old paths were judged against the edited lists.
 * - If git skipped rename detection (too many files), a `loud` warning says so.
 *
 * `classify(path)`, when given, replaces pr-policy for both old and new paths (tests use it).
 * Throws when git cannot run or a revision cannot be read, so the caller can report
 * "could not check" instead of a false pass.
 *
 * @param {{ root: string, base: string, head?: string, classify?: (file: string) => readonly string[] }} options
 * @returns {PathListFinding[]}
 */
export function coverageLossFindings({ root, base, head = "HEAD", classify }) {
  if (typeof root !== "string" || root.length === 0) throw new Error("root is required");
  checkRef("base", base);
  checkRef("head", head);
  // 30% similarity (git's default is 50%) so a file renamed and heavily rewritten in one change
  // still reads as a move rather than an unrelated delete and add.
  const diff = git(root, [
    "diff",
    "-M30%",
    "-C30%",
    "--name-status",
    "-z",
    "--no-color",
    "--no-ext-diff",
    base,
    head,
    "--",
  ]);
  const findings = [];
  if (/(?:rename|copy) detection was skipped/i.test(diff.stderr || "")) {
    findings.push(
      warning({
        key: "coverage-rename-detection-skipped",
        subject: `${base}..${head}`,
        loud: true,
        message:
          "git skipped rename detection for this change because it touches too many files, so a file moved off a safety list would show only as a deletion. Check the deleted safety-listed files below by hand.",
      }),
    );
  }
  const entries = parseNameStatus(diff.stdout);
  const policyEdited = entries.some((entry) => entry.path === POLICY_FILE || entry.from === POLICY_FILE);
  if (policyEdited && !classify) findings.push(...listEditFindings(root, base, head));
  const moved = entries.filter((entry) => entry.status === "R" || entry.status === "C");
  const deleted = entries.filter((entry) => entry.status === "D");
  const pureAdds = entries.filter((entry) => entry.status === "A").map((entry) => entry.path);
  const blobCopies = unmodifiedExactCopies(root, base, head, pureAdds);
  if (moved.length === 0 && deleted.length === 0 && blobCopies.length === 0) return findings;
  const added = entries.filter((entry) => entry.status === "A" || entry.status === "C").map((entry) => entry.path);
  // A deleted safety-listed file is a suspected move when the same change adds an unlisted file
  // with its name anywhere, or any unlisted file in its folder (a split or a heavy rewrite).
  const suspects = (gone) =>
    added.filter(
      (file) =>
        posixPath.basename(file) === posixPath.basename(gone) || posixPath.dirname(file) === posixPath.dirname(gone),
    );

  let classifyOld;
  let classifyNew;
  if (classify) {
    classifyOld = classify;
    classifyNew = classify;
  } else {
    const oldPaths = [
      ...moved.map((entry) => entry.from),
      ...deleted.map((entry) => entry.path),
      ...blobCopies.map((entry) => entry.from),
    ];
    const newPaths = [
      ...moved.map((entry) => entry.path),
      ...deleted.flatMap((entry) => suspects(entry.path)),
      ...blobCopies.map((entry) => entry.path),
    ];
    const loaded = classifyWithPolicyCopies(root, {
      base: { revision: base, files: [...new Set(oldPaths)] },
      head: { revision: head, files: [...new Set(newPaths)] },
    });
    classifyNew = loaded.head ? (file) => loaded.head[file] ?? safetyClassesFor(file) : safetyClassesFor;
    classifyOld = loaded.base ? (file) => loaded.base[file] ?? classifyNew(file) : classifyNew;
    if (!loaded.base && policyEdited) {
      findings.push(
        warning({
          key: "coverage-base-lists-unavailable",
          subject: POLICY_FILE,
          loud: true,
          message: `this change edits the safety lists and also renames or deletes files, but the base revision's copy of ${POLICY_FILE} could not be loaded. The old paths were judged against the edited lists instead, so a file whose protection was removed in the same change would not be flagged. Check the renamed and deleted files by hand.`,
        }),
      );
    }
  }

  for (const entry of moved) {
    const from = /** @type {string} */ (entry.from);
    const after = new Set(classifyNew(entry.path));
    const lost = classifyOld(from).filter((name) => !after.has(name));
    if (lost.length === 0) continue;
    findings.push(
      coverageLostFinding({
        path: entry.path,
        from,
        how: entry.status === "C" ? "copied from" : "renamed from",
        lost,
      }),
    );
  }

  for (const entry of deleted) {
    const lists = classifyOld(entry.path);
    if (lists.length === 0) continue;
    const sameName = suspects(entry.path).filter((file) => {
      const after = new Set(classifyNew(file));
      return lists.some((name) => !after.has(name));
    });
    if (sameName.length > 0) {
      const targets = sameName.map((added) => `\`${added}\``).join(", ");
      findings.push(
        warning({
          key: `coverage-deleted:${entry.path}`,
          subject: entry.path,
          about: sameName[0],
          loud: true,
          message: `was on ${listLabels(lists)} and has been deleted, and this change adds a file with the same name or in the same folder (${targets}) that is not on all of those lists. If the content moved there, its protection was lost: add the new path to ${listVariables(lists)} in ${POLICY_FILE}.`,
        }),
      );
      continue;
    }
    findings.push(
      warning({
        key: `coverage-deleted:${entry.path}`,
        subject: entry.path,
        about: POLICY_FILE,
        message: `was on ${listLabels(lists)} and has been deleted. Deleting a file is not lost protection, but if its content moved to a new file, add the new path to the same list in ${POLICY_FILE}.`,
      }),
    );
  }

  const reported = new Set(
    findings.filter((finding) => finding.key.startsWith("coverage-lost:")).map((finding) => finding.key),
  );
  for (const copy of blobCopies) {
    const key = `coverage-lost:${copy.path}`;
    if (reported.has(key)) continue;
    const after = new Set(classifyNew(copy.path));
    const lost = classifyOld(copy.from).filter((name) => !after.has(name));
    if (lost.length === 0) continue;
    findings.push(coverageLostFinding({ path: copy.path, from: copy.from, how: "copied from", lost }));
    reported.add(key);
  }
  return findings;
}

const MAX_ALTERNATIVES = 512;

/**
 * Expands an anchored regular expression that is only literal text, non-capturing alternation
 * groups and optional groups into every string it can match, e.g.
 * `/^src\/lib\/(?:a|b)\.ts$/` gives `texts: ["src/lib/a.ts", "src/lib/b.ts"]`.
 *
 * `entries` groups those strings into the names the pattern lists: each alternative of a group
 * is its own entry, while the variants an optional part produces (`\.tsx?` gives `.ts` and
 * `.tsx`) stay together as one entry, so an entry is dead only when every variant is missing.
 *
 * Returns null for anything else (wildcards, character classes, `\b`, repetition, lookaround,
 * an unanchored start, a top-level `|`), which marks a keyword-style pattern with no literal
 * file names. Without a trailing `$` the texts are prefixes (usually folders).
 *
 * @param {RegExp | string} pattern
 * @returns {{ anchoredEnd: boolean, texts: string[], entries: string[][] } | null}
 */
export function literalAlternatives(pattern) {
  const source = pattern instanceof RegExp ? pattern.source : String(pattern ?? "");
  if (!source.startsWith("^")) return null;
  let body = source.slice(1);
  let anchoredEnd = false;
  // A final `$` is an anchor unless an odd number of backslashes escapes it.
  if (body.endsWith("$") && body.slice(0, -1).match(/\\*$/)[0].length % 2 === 0) {
    anchoredEnd = true;
    body = body.slice(0, -1);
  }
  const state = { text: body, index: 0 };
  const items = parseAlternation(state, true);
  if (items === null || state.index !== body.length) return null;
  const grouped = new Map();
  for (const item of items) {
    const variants = grouped.get(item.key) ?? [];
    if (!variants.includes(item.text)) variants.push(item.text);
    grouped.set(item.key, variants);
  }
  return { anchoredEnd, texts: [...new Set(items.map((item) => item.text))], entries: [...grouped.values()] };
}

// Each parsed item is one string the pattern can match (`text`) plus the identity of the entry
// it belongs to (`key`): literal text and chosen alternatives are part of the key, while an
// optional part contributes the same marker whether or not it is taken.
function parseAlternation(state, topLevel) {
  const options = parseSequence(state);
  if (options === null) return null;
  while (state.text[state.index] === "|") {
    if (topLevel) return null;
    state.index += 1;
    const more = parseSequence(state);
    if (more === null) return null;
    options.push(...more);
    if (options.length > MAX_ALTERNATIVES) return null;
  }
  return options;
}

function parseSequence(state) {
  let accumulated = [{ text: "", key: "" }];
  while (state.index < state.text.length) {
    const char = state.text[state.index];
    if (char === "|" || char === ")") break;
    let piece;
    if (char === "\\") {
      const escaped = state.text[state.index + 1];
      // `\b`, `\d`, `\w`, `\s`, back-references and the like are not literal text.
      if (escaped === undefined || /[A-Za-z0-9]/.test(escaped)) return null;
      piece = [{ text: escaped, key: escaped }];
      state.index += 2;
    } else if (char === "(") {
      if (state.text.startsWith("(?:", state.index)) state.index += 3;
      else if (state.text[state.index + 1] === "?") return null;
      else state.index += 1;
      const inner = parseAlternation(state, false);
      if (inner === null || state.text[state.index] !== ")") return null;
      state.index += 1;
      piece = inner;
    } else if (".[]{}*+?^$".includes(char)) {
      return null;
    } else {
      piece = [{ text: char, key: char }];
      state.index += 1;
    }
    if (state.text[state.index] === "?") {
      state.index += 1;
      const marker = `\0(${piece.map((item) => item.key).join("|")})?`;
      piece = [{ text: "", key: marker }, ...piece.map((item) => ({ text: item.text, key: marker }))];
    }
    if (state.index < state.text.length && "*+?{".includes(state.text[state.index])) return null;
    const next = [];
    for (const prefix of accumulated) {
      for (const suffix of piece) next.push({ text: prefix.text + suffix.text, key: prefix.key + suffix.key });
    }
    if (next.length > MAX_ALTERNATIVES) return null;
    accumulated = next;
  }
  return accumulated;
}

function trackedFilesAt(root) {
  return git(root, ["ls-files", "-z"]).stdout.split("\0").filter(Boolean);
}

/**
 * Warnings for safety-list entries that point at nothing, so they protect nothing.
 *
 * - Every exact file name on each list (grouped alternations such as
 *   `src\/lib\/(?:a|b)\.ts$` are split into single names) that matches no tracked file. A name
 *   with an optional part (`\.tsx?`) is dead only when every variant is missing.
 * - Every literal folder or name prefix on a list that no tracked file starts with.
 * - A keyword-style pattern (no literal names) is not split; it warns only when it matches no
 *   tracked file at all.
 *
 * `lists` maps a list name to its patterns and defaults to pr-policy's ranking and clinical-risk
 * lists. `trackedFiles` defaults to `git ls-files` at `root`. Never blocking.
 *
 * @param {{ root?: string, trackedFiles?: readonly string[], lists?: Readonly<Record<string, readonly RegExp[]>> }} [options]
 * @returns {PathListFinding[]}
 */
export function deadEntryFindings({ root, trackedFiles, lists = safetyPathLists } = {}) {
  let files = trackedFiles;
  if (!Array.isArray(files)) {
    if (typeof root !== "string" || root.length === 0) throw new Error("root or trackedFiles is required");
    files = trackedFilesAt(root);
  }
  const exact = new Set(files);
  const lowerFiles = files.map((file) => file.toLowerCase());
  const lowerExact = new Set(lowerFiles);
  const findings = [];
  const seen = new Set();
  const push = (finding) => {
    if (seen.has(finding.key)) return;
    seen.add(finding.key);
    findings.push(finding);
  };
  for (const [name, patterns] of Object.entries(lists)) {
    const list = describeList(name);
    const where = `${list.variable} in ${POLICY_FILE}`;
    for (const pattern of patterns) {
      const ignoreCase = pattern instanceof RegExp && pattern.flags.includes("i");
      const expanded = literalAlternatives(pattern);
      if (expanded === null) {
        if (!files.some((file) => pattern.test(file))) {
          push(
            warning({
              key: `dead-pattern:${name}:${pattern.source}`,
              subject: POLICY_FILE,
              message: `the pattern \`${pattern}\` on ${list.label} (${list.variable}) matches no tracked file, so it protects nothing. If the files it covered moved, update the pattern; retiring it is the owner's call.`,
            }),
          );
        }
        continue;
      }
      const exists = expanded.anchoredEnd
        ? (text) => (ignoreCase ? lowerExact.has(text.toLowerCase()) : exact.has(text))
        : (text) =>
            ignoreCase
              ? lowerFiles.some((file) => file.startsWith(text.toLowerCase()))
              : files.some((file) => file.startsWith(text));
      for (const variants of expanded.entries) {
        if (variants.some(exists)) continue;
        const [subject] = variants;
        const others =
          variants.length > 1 ? ` (nor does any variant: ${variants.map((v) => `\`${v}\``).join(", ")})` : "";
        push(
          warning({
            key: `dead-entry:${name}:${subject}`,
            subject,
            about: POLICY_FILE,
            message: expanded.anchoredEnd
              ? `is named on ${list.label} (${where}) but no tracked file has that path${others}, so the entry protects nothing. If the file moved, add its new path to ${list.variable}; removing the name is the owner's call.`
              : `is a folder or name prefix on ${list.label} (${where}) but no tracked file starts with it${others}, so the entry protects nothing. If the files moved, add their new location to ${list.variable}; removing it is the owner's call.`,
          }),
        );
      }
    }
  }
  return findings;
}
