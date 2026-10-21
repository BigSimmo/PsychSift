#!/usr/bin/env node
/**
 * branch-review-ledger — read and write docs/branch-review-ledger.md through one
 * checked path instead of hand-editing a 1000-row markdown table.
 *
 * Hand-writing rows is what produced every defect the 2026-07-28 hygiene pass had to
 * repair: rows appended by a shell redirect that was not UTF-8 (146 mojibake lines),
 * rows written with five or twelve cells instead of six, records written as a heading
 * plus bullet list in the middle of the table, and abbreviated/`see PR head` HEADs that
 * no `git rev-parse` lookup could ever match — so the throttle the ledger exists to
 * provide silently never fired.
 *
 *   node scripts/branch-review-ledger.mjs lookup <branch-or-ref> [--head <sha>] [--scope <text>] [--json] [--verbose]
 *   node scripts/branch-review-ledger.mjs append --ref <x> --head <sha> --scope <s> --outcome <o> --checks <c>
 *   node scripts/branch-review-ledger.mjs migrate-legacy [--base <commit>] [--dry-run]
 *   node scripts/branch-review-ledger.mjs dedupe [--dry-run]
 *   node scripts/branch-review-ledger.mjs rotate [--before YYYY-MM-DD] [--dry-run]
 *   node scripts/branch-review-ledger.mjs --self-test
 *
 * Since 2026-10-20 new review records are pull request comments
 * (docs/agents/pull-request-workflow.md#records). The record files are archived read-only under
 * docs/archive/branch-review-records/, and every write command below needs
 * ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE=true for an explicitly approved historical repair.
 *
 * `lookup` answers the only question the ledger is for: has this exact ref at this exact
 * HEAD already been reviewed for this scope? It reads the live ledger plus any
 * `docs/archive/branch-review-ledger-*.md` files and immutable review records. `append`
 * writes one valid row to its own file, avoiding a shared append hunk. `dedupe` removes
 * exact duplicate dated records only from the legacy live table. `rotate` moves
 * dated records older than a cutoff into a quarterly archive (maturity L4).
 *
 * Read-only except for `append`, `migrate-legacy`, and explicitly authorized historical
 * repair. Never calls a provider or a network service; `git rev-parse` is local.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_PATH = "docs/branch-review-ledger.md";
const ARCHIVE_DIR = "docs/archive";
const ARCHIVE_PREFIX = "branch-review-ledger-";
const RECORDS_DIR = "docs/archive/branch-review-records";
const RECORD_SUFFIX = ".record.md";

/** Cell separator: a literal `|` that was not escaped as `\|` inside prose. */
export const CELL_SPLIT = /(?<!\\)\|/;
export const RECORD_START = /^\| \d{4}-\d{2}-\d{2} \|/;
export const COLUMNS = ["date", "ref", "head", "scope", "outcome", "checks"];

/**
 * Drop exact-duplicate dated records, keeping the first copy. The ledger contract
 * allows this; it is the fix for twins that `merge=union` used to reintroduce on sync.
 */
export function dedupeLedgerMarkdown(markdown) {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const seen = new Set();
  const out = [];
  let removed = 0;
  for (const line of lines) {
    if (RECORD_START.test(line)) {
      if (seen.has(line)) {
        removed += 1;
        continue;
      }
      seen.add(line);
    }
    out.push(line);
  }
  let result = out.join(newline);
  if (markdown.endsWith(newline) && !result.endsWith(newline)) result += newline;
  return { markdown: result, removed, kept: seen.size };
}

/**
 * Three-way merge dated records while preserving intentional deletions.
 *
 * Rows added independently on either side are unioned. A row that existed in the
 * merge base is retained only while both tips still contain it, so rotating rows
 * out of the live ledger on one side cannot be undone by a stale branch. Preamble
 * and trailing prose use ordinary three-way semantics and fail on divergent edits.
 * Used by the `merge.ledger` driver.
 */
export function mergeLedgerMarkdown(base, ours, theirs) {
  const split = (markdown) => {
    const lines = markdown.split(/\r?\n/);
    const preamble = [];
    const records = [];
    const trailing = [];
    let seenRecord = false;
    for (const line of lines) {
      if (RECORD_START.test(line)) {
        seenRecord = true;
        records.push(line);
        continue;
      }
      if (!seenRecord) preamble.push(line);
      else trailing.push(line);
    }
    return { preamble, records, trailing };
  };

  const ancestor = split(base);
  const a = split(ours);
  const b = split(theirs);
  const baseRecords = new Set(ancestor.records);
  const oursRecords = new Set(a.records);
  const theirsRecords = new Set(b.records);
  const seen = new Set();
  const records = [];
  const keep = (line) => !baseRecords.has(line) || (oursRecords.has(line) && theirsRecords.has(line));
  for (const line of [...a.records, ...b.records]) {
    if (!keep(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    records.push(line);
  }

  const chooseSection = (label, baseSection, oursSection, theirsSection) => {
    const ancestorText = baseSection.join("\n");
    const oursText = oursSection.join("\n");
    const theirsText = theirsSection.join("\n");
    if (oursText === theirsText) return oursSection;
    if (oursText === ancestorText) return theirsSection;
    if (theirsText === ancestorText) return oursSection;
    throw new Error(`ledger ${label} changed differently on both sides`);
  };

  const preamble = chooseSection("preamble", ancestor.preamble, a.preamble, b.preamble);
  const trailing = chooseSection("trailing content", ancestor.trailing, a.trailing, b.trailing);
  let markdown = [...preamble, ...records, ...trailing].join("\n");
  if (!markdown.endsWith("\n")) markdown += "\n";
  return { markdown, recordCount: records.length };
}

/**
 * UTC calendar-quarter start (YYYY-MM-DD) for a Date or YYYY-MM-DD string.
 * @param {string | Date} [value]
 * @returns {string}
 */
export function calendarQuarterStart(value = new Date()) {
  const date =
    typeof value === "string"
      ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
      : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return `${date.getUTCFullYear()}-${String(quarterMonth + 1).padStart(2, "0")}-01`;
}

/**
 * Archive slug for a YYYY-MM-DD date, e.g. 2026-07-15 → `2026-q3`.
 * @param {string} dateStr
 * @returns {string}
 */
export function archiveQuarterLabel(dateStr) {
  const [year, month] = dateStr.slice(0, 10).split("-").map(Number);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year}-q${quarter}`;
}

/** Legacy live ledger first, then sorted archive files. */
export function listLedgerArchivePaths() {
  const paths = [LEDGER_PATH];
  const absArchive = path.join(root, ARCHIVE_DIR);
  if (!existsSync(absArchive)) return paths;
  for (const name of readdirSync(absArchive).sort()) {
    if (name.startsWith(ARCHIVE_PREFIX) && name.endsWith(".md")) {
      paths.push(path.join(ARCHIVE_DIR, name));
    }
  }
  return paths;
}

/** Immutable review records avoid a shared append hunk across active PRs. */
export function listLedgerRecordPaths() {
  const absRecords = path.join(root, RECORDS_DIR);
  if (!existsSync(absRecords)) return [];
  return readdirSync(absRecords)
    .filter((name) => name.endsWith(RECORD_SUFFIX))
    .sort()
    .map((name) => path.posix.join(RECORDS_DIR, name));
}

/** Every source used by lookup: legacy tables plus immutable records. */
export function listLedgerPaths() {
  return [...listLedgerArchivePaths(), ...listLedgerRecordPaths()];
}

/** Equivalent rows converge on one path; distinct PR writes never share a file. */
export function reviewRecordPath(row) {
  const hash = createHash("sha256").update(row, "utf8").digest("hex");
  return path.posix.join(RECORDS_DIR, `${hash}${RECORD_SUFFIX}`);
}

/**
 * Create one content-addressed review record. If a concurrent identical append wins
 * the `wx` race, verify the existing bytes and treat the operation as idempotent.
 */
export function writeImmutableReviewRecord(target, row, { write = writeFileSync, read = readFileSync } = {}) {
  const expected = `${row}\n`;
  try {
    write(target, expected, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = read(target, "utf8");
    if (existing !== expected) {
      throw new Error("immutable review record path already exists with different content");
    }
    return "existing";
  }
}

/** Concatenate every ledger source for consumers that parse one markdown blob. */
export function readLedgerCorpus() {
  return listLedgerPaths()
    .map((relative) => readFileSync(path.join(root, relative), "utf8"))
    .join("\n");
}

function splitLedgerMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const preamble = [];
  const records = [];
  const trailing = [];
  let seenRecord = false;
  for (const line of lines) {
    if (RECORD_START.test(line)) {
      seenRecord = true;
      records.push(line);
      continue;
    }
    if (!seenRecord) preamble.push(line);
    else trailing.push(line);
  }
  return { preamble, records, trailing };
}

function archivePreamble(label) {
  return [
    `# Branch Review Ledger Archive — ${label}`,
    "",
    "Historical review records rotated out of `docs/branch-review-ledger.md` so the live",
    "table stays navigable. Do not hand-edit. `npm run ledger:lookup` reads this file",
    "together with the legacy table and archived review records. New reviews are recorded as PR comments.",
    "",
    "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |",
    "| --- | --- | --- | --- | --- | --- |",
  ].join("\n");
}

/**
 * Move live dated records with date < before into quarterly archive files.
 * Returns counts; does not delete unique review content.
 * @param {string} liveMarkdown
 * @param {{ before: string, existingArchives?: Map<string, string> }} [options]
 */
export function rotateLedgerMarkdown(liveMarkdown, { before, existingArchives = new Map() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    throw new Error(`before must be YYYY-MM-DD (got ${JSON.stringify(before)})`);
  }
  const { preamble, records, trailing } = splitLedgerMarkdown(liveMarkdown);
  const keep = [];
  const byLabel = new Map();
  for (const line of records) {
    const date = line.slice(2, 12);
    if (date < before) {
      const label = archiveQuarterLabel(date);
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(line);
    } else {
      keep.push(line);
    }
  }

  const archives = [];
  for (const [label, moved] of [...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const relative = path.posix.join(ARCHIVE_DIR, `${ARCHIVE_PREFIX}${label}.md`);
    const prior = existingArchives.get(relative) ?? "";
    const priorRecords = prior ? splitLedgerMarkdown(prior).records : [];
    const seen = new Set(priorRecords);
    const mergedRecords = [...priorRecords];
    for (const line of moved) {
      if (seen.has(line)) continue;
      seen.add(line);
      mergedRecords.push(line);
    }
    const body = prior.trim() ? splitLedgerMarkdown(prior).preamble.join("\n") : archivePreamble(label);
    let markdown = `${body}\n${mergedRecords.join("\n")}\n`;
    if (!markdown.endsWith("\n")) markdown += "\n";
    archives.push({ path: relative, label, markdown, added: moved.length, total: mergedRecords.length });
  }

  let live = [...preamble, ...keep, ...trailing].join("\n");
  if (!live.endsWith("\n")) live += "\n";
  return {
    liveMarkdown: live,
    archives,
    moved: records.length - keep.length,
    kept: keep.length,
  };
}

/** Parse the six cells of every review record. Non-record lines are ignored. */
export function parseLedgerRows(markdown) {
  const rows = [];
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (!RECORD_START.test(line)) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(CELL_SPLIT)
      .map((cell) => cell.trim());
    const [date, ref, head, scope, outcome, checks] = COLUMNS.map((_, i) => cells[i] ?? "");
    rows.push({ line: index + 1, raw: line, cells, date, ref, head, scope, outcome, checks });
  }
  return rows;
}

/** Strip markdown/prose decoration so `origin/foo`, `` `foo` `` and `PR #1 / foo` compare equal. */
export function normalizeRef(value) {
  return value
    .replace(/`/g, "")
    .trim()
    .replace(/^origin\//, "")
    .toLowerCase();
}

/** Scope cells compare as exact (case/whitespace-insensitive) strings — never substrings. */
export function normalizeScope(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Every branch-like token in a ref cell, so "PR #1137 / `codex/x` (babysit)" yields `codex/x`.
 * Slash-form tokens only when present; bare names are kept only when the cell has no slash
 * token, so parenthetical prose like "(babysit)" cannot false-hit an unrelated lookup.
 */
export function refTokens(cell) {
  const tokens = new Set();
  const plain = cell.replace(/`/g, "");
  for (const match of plain.matchAll(/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/g)) tokens.add(normalizeRef(match[0]));
  if (tokens.size === 0) {
    const bare = plain.trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{2,}$/.test(bare)) tokens.add(normalizeRef(bare));
  }
  return tokens;
}

/** SHA prefix from a HEAD cell: pure hex, or hex at the start before annotation like `(squash)`. */
function shaToken(value) {
  const cleaned = value.replace(/`/g, "").trim().toLowerCase();
  if (!cleaned || /^n\/a\b/i.test(cleaned)) return "";
  if (/^[0-9a-f]{7,40}$/.test(cleaned)) return cleaned;
  return (cleaned.match(/^([0-9a-f]{7,40})\b/) ?? [])[1] ?? "";
}

/** A recorded HEAD matches when either side is an abbreviation (>= 7 chars) of the other. */
export function headMatches(recorded, target) {
  const aSha = shaToken(recorded);
  const bSha = shaToken(target);
  if (!aSha || !bSha) return false;
  const short = aSha.length <= bSha.length ? aSha : bSha;
  const long = aSha.length <= bSha.length ? bSha : aSha;
  return long.startsWith(short);
}

/** Prior review records for this ref, split by whether the reviewed HEAD still matches. */
export function findReviews(markdown, { ref, head = "", scope = "" }) {
  const wanted = normalizeRef(ref);
  const wantedScope = scope ? normalizeScope(scope) : "";
  const atHead = [];
  const otherHead = [];
  for (const row of parseLedgerRows(markdown)) {
    if (!refTokens(row.ref).has(wanted)) continue;
    if (wantedScope && normalizeScope(row.scope) !== wantedScope) continue;
    (head && headMatches(row.head, head) ? atHead : otherHead).push(row);
  }
  return { atHead, otherHead };
}

/** One cell of prose, safe to place in a markdown table row. */
export function sanitizeCell(value) {
  const text = String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.replace(/(?<!\\)\|/g, "\\|");
}

export function buildRow({ date, ref, head, scope, outcome, checks }) {
  const cells = [date, ref, head, scope, outcome, checks].map(sanitizeCell);
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) problems.push(`date must be YYYY-MM-DD (got ${JSON.stringify(cells[0])})`);
  COLUMNS.forEach((name, i) => {
    if (!cells[i]) problems.push(`${name} must not be empty`);
  });
  const headCell = cells[2].replace(/`/g, "");
  if (!/^[0-9a-f]{40}$/.test(headCell) && !/^n\/a\b/i.test(headCell)) {
    problems.push(`head must be a full 40-character SHA, or "n/a - <reason>" (got ${JSON.stringify(cells[2])})`);
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
  return `| ${cells.join(" | ")} |`;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * Expand a ref or SHA to a full commit SHA via `git rev-parse`. Full-length hex is verified
 * the same way as abbreviations — a mistyped 40-char string must not become an unmatchable
 * ledger HEAD. Documented `n/a - …` heads pass through unchanged.
 */
function resolveHead(value, { required = false } = {}) {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) {
    if (required) throw new Error("head is empty");
    return "";
  }
  if (/^n\/a\b/i.test(cleaned)) return cleaned;
  const resolved = git(["rev-parse", "--verify", `${cleaned}^{commit}`]);
  if (resolved) return resolved.toLowerCase();
  if (required) {
    throw new Error(
      `head ${JSON.stringify(cleaned)} is not a commit in this repository; pass a real SHA/ref, or "n/a - <reason>"`,
    );
  }
  return /^[0-9a-f]{40}$/i.test(cleaned) ? cleaned.toLowerCase() : cleaned;
}

const BOOLEAN_FLAGS = new Set(["json", "supersede", "dry-run", "verbose"]);

export function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 2) {
      flags[token.slice(2, equalsIndex)] = token.slice(equalsIndex + 1);
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    i += 1;
  }
  return { flags, positional };
}

function summarize(row) {
  const outcome = row.outcome.length > 140 ? `${row.outcome.slice(0, 137)}...` : row.outcome;
  return `  ${row.date}  ${row.head.replace(/`/g, "").slice(0, 12).padEnd(12)}  ${row.scope}\n      ${outcome}`;
}

/**
 * The `files:` line of a lookup. Every immutable record is a source, so listing them
 * put ~580 content-addressed paths on one ~60 KB line ahead of the verdict every time a
 * reviewer ran the throttle check. Print counts by default; `--verbose` lists the paths.
 *
 * @param {string[]} sources
 * @param {{ verbose?: boolean }} [options]
 */
export function lookupFilesLine(sources, { verbose = false } = {}) {
  if (verbose) return `files: ${sources.join(", ")}`;
  const records = sources.filter((source) => source.endsWith(RECORD_SUFFIX)).length;
  const tables = sources.length - records;
  return `files: ${tables} ledger table(s) + ${records} immutable record(s) (pass --verbose to list them)`;
}

function runLookup(_liveMarkdown, argv) {
  const { flags, positional } = parseFlags(argv);
  const ref = positional[0] ?? flags.ref;
  if (!ref || ref === true) {
    console.error(
      "usage: branch-review-ledger.mjs lookup <branch-or-ref> [--head <sha>] [--scope <text>] [--json] [--verbose]",
    );
    process.exitCode = 2;
    return;
  }
  const head = flags.head && flags.head !== true ? resolveHead(flags.head) : resolveHead(ref);
  const scope = flags.scope && flags.scope !== true ? flags.scope : "";
  const sources = listLedgerPaths();
  const markdown = readLedgerCorpus();
  const { atHead, otherHead } = findReviews(markdown, { ref, head, scope });

  if (flags.json) {
    console.log(JSON.stringify({ ref, head, scope: scope || null, sources, atHead, otherHead }, null, 2));
    return;
  }

  console.log(`ref:   ${ref}`);
  console.log(`head:  ${head}${/^[0-9a-f]{40}$/.test(head) ? "" : "  (not resolvable to a SHA here)"}`);
  if (scope) console.log(`scope: exact ${JSON.stringify(scope)}`);
  console.log(lookupFilesLine(sources, { verbose: flags.verbose === true }));
  console.log("");

  if (atHead.length > 0) {
    console.log(`ALREADY REVIEWED - ${atHead.length} record(s) at this HEAD${scope ? " and scope" : ""}:`);
    for (const row of atHead) console.log(summarize(row));
    console.log(
      "\nCommitted HEAD/scope record found; this lookup does not compare the base, working tree, environment or artifacts. Reuse only within that evidence scope; verify additional inputs for current-diff/readiness claims. Skip an unchanged committed-content review unless a fresh pass was explicitly requested.",
    );
    return;
  }

  console.log(`NOT REVIEWED at this HEAD${scope ? " and scope" : ""}.`);
  if (otherHead.length > 0) {
    console.log(
      `\n${otherHead.length} earlier record(s) for this ref at a different HEAD (review the changed scope only):`,
    );
    for (const row of otherHead.slice(-5)) console.log(summarize(row));
  }
}

function runAppend(markdown, argv) {
  const { flags } = parseFlags(argv);
  if (!requireRetiredRecordWrite("append", false)) return;
  const required = ["ref", "head", "scope", "outcome", "checks"];
  const missing = required.filter((name) => !flags[name] || flags[name] === true);
  if (missing.length > 0) {
    console.error(`missing required flag(s): ${missing.map((name) => `--${name}`).join(", ")}`);
    console.error(
      "usage: branch-review-ledger.mjs append --ref <x> --head <sha> --scope <s> --outcome <o> --checks <c>",
    );
    process.exitCode = 2;
    return;
  }

  const date = flags.date && flags.date !== true ? flags.date : new Date().toISOString().slice(0, 10);
  let head;
  try {
    head = /^n\/a\b/i.test(String(flags.head)) ? String(flags.head) : resolveHead(flags.head, { required: true });
  } catch (error) {
    console.error(`refusing to append: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const appendTokens = refTokens(String(flags.ref));
  if (appendTokens.size === 0) appendTokens.add(normalizeRef(String(flags.ref)));
  const sameRefHeadScope = (existing, scopeValue) =>
    headMatches(existing.head, head) &&
    normalizeScope(existing.scope) === normalizeScope(scopeValue) &&
    [...appendTokens].some((token) => refTokens(existing.ref).has(token));

  const rows = parseLedgerRows(readLedgerCorpus());
  let scope = String(flags.scope);
  const near = rows.filter((existing) => sameRefHeadScope(existing, scope));
  if (near.length > 0) {
    if (!flags.supersede) {
      console.error(`refusing to append: this ref/HEAD/scope was already recorded on ${near.at(-1).date}.`);
      console.error(
        "Cite the prior record instead, or pass --supersede to append a distinct superseding scope the guard accepts.",
      );
      process.exitCode = 1;
      return;
    }
    const priorDate = near.at(-1).date;
    let suffix = 1;
    do {
      scope =
        suffix === 1
          ? `${String(flags.scope)} (supersedes ${priorDate})`
          : `${String(flags.scope)} (supersedes ${priorDate} #${suffix})`;
      suffix += 1;
    } while (rows.some((existing) => sameRefHeadScope(existing, scope)));
  }

  let row;
  try {
    row = buildRow({ date, ref: flags.ref, head, scope, outcome: flags.outcome, checks: flags.checks });
  } catch (error) {
    console.error(`refusing to append: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (rows.some((existing) => existing.raw === row)) {
    console.error("refusing to append: an identical record already exists.");
    process.exitCode = 1;
    return;
  }

  const relative = reviewRecordPath(row);
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    const status = writeImmutableReviewRecord(target, row);
    const verb = status === "created" ? "Recorded" : "Verified existing";
    console.log(`${verb} immutable review entry at ${relative}:\n${row}`);
  } catch (error) {
    console.error(`refusing to append: ${error.message}`);
    process.exitCode = 1;
  }
}

/**
 * Move rows introduced by a legacy branch out of the shared table without
 * rewriting the rest of the file. This is the one-time compatibility path for
 * active PRs that recorded a review before immutable records existed.
 */
export function migrateLegacyRows(markdown, baseMarkdown) {
  const baseCounts = new Map();
  for (const row of parseLedgerRows(baseMarkdown)) baseCounts.set(row.raw, (baseCounts.get(row.raw) ?? 0) + 1);

  const added = [];
  for (const row of parseLedgerRows(markdown)) {
    const remaining = baseCounts.get(row.raw) ?? 0;
    if (remaining > 0) baseCounts.set(row.raw, remaining - 1);
    else added.push(row.raw);
  }
  const removed = [...baseCounts.entries()].filter(([, count]) => count > 0);
  if (removed.length > 0) {
    throw new Error(
      "the current table removes or rewrites a base review row; resolve that historical repair separately",
    );
  }

  const removeCounts = new Map();
  for (const row of added) removeCounts.set(row, (removeCounts.get(row) ?? 0) + 1);
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const remaining = removeCounts.get(line) ?? 0;
    if (RECORD_START.test(line) && remaining > 0) {
      removeCounts.set(line, remaining - 1);
      continue;
    }
    kept.push(line);
  }
  let nextMarkdown = kept.join(newline);
  if (markdown.endsWith(newline) && !nextMarkdown.endsWith(newline)) nextMarkdown += newline;
  return { markdown: nextMarkdown, added };
}

function resolveMigrationBase(flags) {
  if (flags.base && flags.base !== true) {
    const resolved = git(["rev-parse", "--verify", `${flags.base}^{commit}`]);
    if (resolved) return resolved;
    throw new Error(`base ${JSON.stringify(flags.base)} is not a commit in this repository`);
  }
  const base = git(["merge-base", "HEAD", "refs/remotes/origin/main"]);
  if (!base) throw new Error("cannot resolve a merge base; fetch refs/remotes/origin/main or pass --base <commit>");
  return base;
}

function runMigrateLegacy(markdown, argv) {
  const { flags } = parseFlags(argv);
  const dryRun = Boolean(flags["dry-run"]);
  if (!requireRetiredRecordWrite("migrate-legacy", dryRun)) return;
  let base;
  let result;
  try {
    base = resolveMigrationBase(flags);
    const baseMarkdown = execFileSync("git", ["show", `${base}:${LEDGER_PATH}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = migrateLegacyRows(markdown, baseMarkdown);
  } catch (error) {
    console.error(`refusing legacy migration: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.added.length === 0) {
    console.log(`No branch-added legacy review rows relative to ${base.slice(0, 12)}.`);
    return;
  }
  const records = result.added.map((row) => ({ row, relative: reviewRecordPath(row) }));
  for (const { row, relative } of records) {
    const target = path.join(root, relative);
    if (!existsSync(target)) continue;
    if (readFileSync(target, "utf8") !== `${row}\n`) {
      console.error(`refusing legacy migration: existing ${relative} does not match its content-addressed row`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `${dryRun ? "Would migrate" : "Migrating"} ${records.length} legacy review row(s) from ${LEDGER_PATH} ` +
      `to immutable records relative to ${base.slice(0, 12)}.`,
  );
  for (const { relative } of records) console.log(`  ${relative}`);
  if (dryRun) return;

  mkdirSync(path.join(root, RECORDS_DIR), { recursive: true });
  for (const { row, relative } of records) {
    const target = path.join(root, relative);
    if (!existsSync(target)) writeFileSync(target, `${row}\n`, { encoding: "utf8", flag: "wx" });
  }
  writeFileSync(path.join(root, LEDGER_PATH), result.markdown, "utf8");
  console.log(
    `Migrated ${records.length} legacy review row(s); commit the table removal and immutable records together.`,
  );
}

/** Historical maintenance writes need an intentional, visible opt-in. */
export function legacyMaintenanceAllowed({
  dryRun = false,
  allow = process.env.ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE,
} = {}) {
  return dryRun || allow === "true";
}

/**
 * Review records moved to pull request comments on 2026-10-20 and the record files are archived
 * read-only, so writing one needs the same explicit opt-in as historical repair.
 */
function requireRetiredRecordWrite(command, dryRun) {
  if (legacyMaintenanceAllowed({ dryRun })) return true;
  console.error(
    `refusing ${command}: review records now live in pull request comments ` +
      "(docs/agents/pull-request-workflow.md#records) and the archived record files are read-only. " +
      "Set ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE=true only for an explicitly approved historical repair.",
  );
  process.exitCode = 1;
  return false;
}

function requireLegacyMaintenance(command, dryRun) {
  if (legacyMaintenanceAllowed({ dryRun })) return true;
  console.error(
    `refusing ${command}: the historical review table is frozen. ` +
      "Use --dry-run to inspect, then set ALLOW_LEGACY_REVIEW_LEDGER_MAINTENANCE=true for an explicitly approved repair.",
  );
  process.exitCode = 1;
  return false;
}

function runRotate(liveMarkdown, argv) {
  const { flags } = parseFlags(argv);
  const before = flags.before && flags.before !== true ? String(flags.before) : calendarQuarterStart(new Date());
  const dryRun = Boolean(flags["dry-run"]);
  if (!requireLegacyMaintenance("rotate", dryRun)) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    console.error(`refusing to rotate: --before must be YYYY-MM-DD (got ${JSON.stringify(before)})`);
    process.exitCode = 1;
    return;
  }

  const existingArchives = new Map();
  for (const relative of listLedgerArchivePaths().slice(1)) {
    existingArchives.set(relative, readFileSync(path.join(root, relative), "utf8"));
  }

  let result;
  try {
    result = rotateLedgerMarkdown(liveMarkdown, { before, existingArchives });
  } catch (error) {
    console.error(`refusing to rotate: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.moved === 0) {
    console.log(`No live records dated before ${before}; kept ${result.kept}.`);
    return;
  }

  console.log(
    `${dryRun ? "Would move" : "Moving"} ${result.moved} record(s) dated before ${before}; ` +
      `${result.kept} remain in the live ledger.`,
  );
  for (const archive of result.archives) {
    console.log(`  ${archive.path}: +${archive.added} (archive total ${archive.total})`);
  }
  if (dryRun) return;

  mkdirSync(path.join(root, ARCHIVE_DIR), { recursive: true });
  for (const archive of result.archives) {
    writeFileSync(path.join(root, archive.path), archive.markdown, "utf8");
  }
  writeFileSync(path.join(root, LEDGER_PATH), result.liveMarkdown, "utf8");
  console.log(`Rotated ${result.moved} record(s) out of ${LEDGER_PATH}.`);
}

function runDedupe(markdown, argv) {
  const { flags } = parseFlags(argv);
  const dryRun = Boolean(flags["dry-run"]);
  if (!requireLegacyMaintenance("dedupe", dryRun)) return;
  const { markdown: next, removed, kept } = dedupeLedgerMarkdown(markdown);
  if (removed === 0) {
    console.log(`No exact duplicate records in ${LEDGER_PATH} (${kept} unique dated rows).`);
    return;
  }
  if (dryRun) {
    console.log(`Would remove ${removed} exact duplicate record(s); ${kept} unique dated rows remain.`);
    return;
  }
  writeFileSync(path.join(root, LEDGER_PATH), next, "utf8");
  console.log(`Removed ${removed} exact duplicate record(s) from ${LEDGER_PATH}; ${kept} unique dated rows remain.`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`self-test failed: ${label}`);
}

function selfTest() {
  const markdown = [
    "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |",
    "| --- | --- | --- | --- | --- | --- |",
    `| 2026-07-24 | PR #1 / \`codex/thing\` | ${"a".repeat(40)} | branch-cleanup | kept | npm run test |`,
    `| 2026-07-25 | origin/codex/thing | ${"b".repeat(40)} | diff review | fine | none |`,
    "| 2026-07-26 | pipes | " + "c".repeat(40) + " | s | a \\| b | none |",
  ].join("\n");

  const rows = parseLedgerRows(markdown);
  assert(rows.length === 3, "parses only dated records");
  assert(rows[2].outcome === "a \\| b", "escaped pipe stays inside one cell");
  assert(rows[0].cells.length === 6, "records have six cells");

  assert(headMatches("`abc1234`", "abc1234def"), "abbreviated HEAD matches full");
  assert(headMatches("abc1234 (squash)", "abc1234def"), "leading annotated HEAD matches full");
  assert(!headMatches("abc1234", "def5678"), "different HEADs do not match");
  assert(!headMatches("see PR head", "a".repeat(40)), "prose HEAD matches nothing");
  assert(!headMatches("n/a - see deadbeef", "deadbeef" + "0".repeat(32)), "n/a prose does not match embedded hex");
  assert(!refTokens("PR #1 / `codex/thing` (babysit)").has("babysit"), "parenthetical prose is not a ref token");

  const hit = findReviews(markdown, { ref: "codex/thing", head: "a".repeat(40) });
  assert(hit.atHead.length === 1, "finds the record at this HEAD");
  assert(hit.otherHead.length === 1, "reports the other-HEAD record separately");
  assert(
    findReviews(markdown, { ref: "origin/codex/thing", head: "b".repeat(40) }).atHead.length === 1,
    "origin/ ref normalizes",
  );
  assert(
    findReviews(markdown, { ref: "codex/thing", head: "a".repeat(40), scope: "branch-cleanup" }).atHead.length === 1,
    "exact scope filter matches",
  );
  assert(
    findReviews(markdown, {
      ref: "codex/thing",
      head: "a".repeat(40),
      scope: "branch-cleanup-deletion-pending",
    }).atHead.length === 0,
    "scope filter is exact, not substring",
  );
  assert(
    findReviews(markdown, { ref: "codex/thing", head: "a".repeat(40), scope: "release" }).atHead.length === 0,
    "scope filter excludes",
  );

  assert(sanitizeCell("a | b\nc") === "a \\| b c", "cells are single-line and pipe-escaped");
  const built = buildRow({
    date: "2026-07-28",
    ref: "x",
    head: "d".repeat(40),
    scope: "s",
    outcome: "o",
    checks: "c",
  });
  assert(parseLedgerRows(built)[0].cells.length === 6, "built row has six cells");
  for (const [bad, label] of [
    [{ date: "28-07-2026" }, "bad date rejected"],
    [{ head: "abc1234" }, "abbreviated HEAD rejected"],
    [{ checks: "" }, "empty cell rejected"],
  ]) {
    let threw = false;
    try {
      buildRow({ date: "2026-07-28", ref: "x", head: "d".repeat(40), scope: "s", outcome: "o", checks: "c", ...bad });
    } catch {
      threw = true;
    }
    assert(threw, label);
  }
  assert(
    buildRow({ date: "2026-07-28", ref: "x", head: "n/a - not pushed yet", scope: "s", outcome: "o", checks: "c" }),
    "documented n/a HEAD accepted",
  );

  const expected = `${built}\n`;
  assert(
    writeImmutableReviewRecord("unused", built, { write() {}, read() {} }) === "created",
    "first immutable record write is created",
  );
  assert(
    writeImmutableReviewRecord("unused", built, {
      write() {
        const error = new Error("exists");
        error.code = "EEXIST";
        throw error;
      },
      read() {
        return expected;
      },
    }) === "existing",
    "concurrent identical immutable record is idempotent",
  );
  let mismatchedRecordRejected = false;
  try {
    writeImmutableReviewRecord("unused", built, {
      write() {
        const error = new Error("exists");
        error.code = "EEXIST";
        throw error;
      },
      read() {
        return "different\n";
      },
    });
  } catch {
    mismatchedRecordRejected = true;
  }
  assert(mismatchedRecordRejected, "existing immutable record with different bytes is rejected");

  assert(calendarQuarterStart("2026-07-30") === "2026-07-01", "Q3 start");
  assert(calendarQuarterStart("2026-10-01") === "2026-10-01", "Q4 start");
  assert(archiveQuarterLabel("2026-07-15") === "2026-q3", "July is q3");
  const preamble = [
    "# Ledger",
    "",
    "This file is append-only.",
    "",
    "| Date | Branch or ref | Reviewed HEAD | Scope | Outcome | Checks |",
    "| --- | --- | --- | --- | --- | --- |",
  ].join("\n");
  const oldRow = `| 2026-07-01 | old/x | ${"a".repeat(40)} | s | o | c |`;
  const newRow = `| 2026-07-29 | new/x | ${"b".repeat(40)} | s | o | c |`;
  const rotated = rotateLedgerMarkdown(`${preamble}\n${oldRow}\n${newRow}\n`, { before: "2026-07-29" });
  assert(rotated.moved === 1 && rotated.kept === 1, "rotate moves only older rows");
  assert(rotated.archives[0].path.endsWith("branch-review-ledger-2026-q3.md"), "archive path uses quarter label");
  assert(rotated.liveMarkdown.includes(newRow) && !rotated.liveMarkdown.includes(oldRow), "live keeps new only");
  assert(rotated.archives[0].markdown.includes(oldRow), "archive receives old row");

  const twinRow = `| 2026-07-28 | x | ${"e".repeat(40)} | s | o | c |`;
  const dedupedRows = dedupeLedgerMarkdown(`${preamble}\n${twinRow}\n${twinRow}\n`);
  assert(dedupedRows.removed === 1 && dedupedRows.kept === 1, "dedupe drops exact twin");
  const mergedTips = mergeLedgerMarkdown(
    `${preamble}\n${twinRow}\n`,
    `${preamble}\n${twinRow}\n`,
    `${preamble}\n${twinRow}\n| 2026-07-28 | y | ${"f".repeat(40)} | s | o | c |\n`,
  );
  assert(mergedTips.recordCount === 2, "merge unions distinct rows and drops shared twin");

  const legacyMigration = migrateLegacyRows(`${preamble}\n${oldRow}\n${newRow}\n`, `${preamble}\n${oldRow}\n`);
  assert(legacyMigration.added.length === 1 && legacyMigration.added[0] === newRow, "finds branch-added legacy rows");
  assert(
    !legacyMigration.markdown.includes(newRow) && legacyMigration.markdown.includes(oldRow),
    "removes only added rows",
  );
  let rejectedRewrite = false;
  try {
    migrateLegacyRows(`${preamble}\n${newRow}\n`, `${preamble}\n${oldRow}\n`);
  } catch {
    rejectedRewrite = true;
  }
  assert(rejectedRewrite, "rejects historical row rewrites");
  assert(legacyMaintenanceAllowed({ dryRun: true }), "dry-run legacy maintenance remains safe");
  assert(!legacyMaintenanceAllowed({ allow: "false" }), "legacy maintenance requires explicit opt-in");
  assert(legacyMaintenanceAllowed({ allow: "true" }), "explicit legacy maintenance opt-in works");

  console.log("branch-review-ledger self-test passed.");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const markdown = readFileSync(path.join(root, LEDGER_PATH), "utf8");
  const [command, ...rest] = argv;
  if (command === "lookup") return runLookup(markdown, rest);
  if (command === "append") return runAppend(markdown, rest);
  if (command === "migrate-legacy") return runMigrateLegacy(markdown, rest);
  if (command === "dedupe") return runDedupe(markdown, rest);
  if (command === "rotate") return runRotate(markdown, rest);
  console.error("usage: branch-review-ledger.mjs <lookup|append|migrate-legacy|dedupe|rotate|--self-test> [...]");
  console.error("  lookup <branch-or-ref> [--head <sha>] [--scope <text>] [--json] [--verbose]");
  console.error(
    "  append --ref <x> --head <sha> --scope <s> --outcome <o> --checks <c> [--date <YYYY-MM-DD>] [--supersede]",
  );
  console.error("  migrate-legacy [--base <commit>] [--dry-run]");
  console.error("  dedupe [--dry-run]");
  console.error("  rotate [--before YYYY-MM-DD] [--dry-run]");
  process.exitCode = 2;
}

const isMain =
  process.argv[1]?.endsWith("/branch-review-ledger.mjs") || process.argv[1]?.endsWith("\\branch-review-ledger.mjs");
if (isMain) main();
