#!/usr/bin/env node
/**
 * generate-branch-review-index — render docs/branch-review-index.md, a navigable
 * table of contents for the 570+ content-addressed files in
 * docs/branch-review-records/.
 *
 *   node scripts/generate-branch-review-index.mjs           # write the index
 *   node scripts/generate-branch-review-index.mjs --check    # advisory staleness report
 *
 * Why this exists. Every review record is named for the sha256 of its own row, so
 * the directory listing carries no information at all: you cannot tell which file
 * holds which review without opening it. Worse, the hash-filename -> row mapping
 * exists in NO static artifact today — scripts/generate-repo-awareness-snapshot.ts
 * reads `{file, line}` per record and then drops `file` when it builds
 * `review_state`, emitting only the six cells. This index supplies that missing
 * join, and nothing else does.
 *
 * DELIBERATELY NOT GATED. Records are appended roughly 27 times a day (570 landed
 * in August 2026 alone). A byte-equality check on a file derived from that corpus
 * would go red on `main` after nearly every merge and would conflict between
 * concurrent pull requests — which is exactly why
 * scripts/check-repo-awareness-snapshot.ts excludes `review_state` from
 * COMPARED_CONTENT_KEYS. So this generator is wired into no gate: not
 * verify:cheap:internal, not .github/workflows/ci.yml, not verify-pr-local.mjs,
 * not .githooks/pre-commit. `--check` is advisory and manual. The index may lag
 * the corpus; `npm run ledger:lookup` reads the records themselves and stays
 * authoritative for "was this reviewed?".
 *
 * One enforcement property IS worth knowing about, and it is a side effect of the
 * links rather than a gate of its own: `npm run docs:check-links` scans
 * docs/**\/*.md and fails when a relative link target does not resolve. Because
 * this index links EVERY record by path, that checker becomes the first piece of
 * code in the repository that notices a deleted review record. Deleting one is
 * already forbidden by policy (docs/codex-review-protocol.md) but was, until this
 * file existed, caught by nothing. Do not "fix" a docs:check-links failure here by
 * regenerating the index — regenerating hides the deletion. Restore the record.
 *
 * Determinism: no wall clock, no hostname, no git SHA. Identical corpus content
 * produces byte-identical output on any platform. Freshness is expressed only
 * through content-derived facts (record count, date range). Ordering uses a total
 * order — date descending, then record path ascending — so no reliance is placed
 * on sort stability.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

// Reuse the repo's own corpus reader rather than adding a third parser. In
// particular `parseLedgerRows` splits on CELL_SPLIT (`/(?<!\\)\|/`), not on a
// naive "|": four records carry an escaped pipe in their checks cell (e.g.
// "Tests 7274 passed \| 4 skipped"), and a naive split turns each into a phantom
// seventh column. `parseLedgerRows` trims but does NOT unescape, so cells arrive
// with `\|` intact — which is what re-emitting into a markdown table needs.
import { listLedgerRecordPaths, normalizeRef, parseLedgerRows, refTokens } from "./branch-review-ledger.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = "docs/branch-review-index.md";
const RECORD_SUFFIX = ".record.md";

/** Relative to docs/, so links resolve for both readers and docs:check-links. */
const RECORD_LINK_DIR = "branch-review-records";

/**
 * Truncation limits, chosen so a row stays readable in a terminal. Scope and
 * outcome are free text with measured maxima of 625 and 2111 characters; the
 * record link is the way to the full text.
 */
export const SCOPE_LIMIT = 90;
export const OUTCOME_LIMIT = 70;

/**
 * Strip a trailing run that would corrupt the emitted table cell, repeatedly
 * until stable.
 *
 * A lone trailing backslash is the dangerous case: the corpus escapes pipes as
 * `\|`, so a naive `slice(0, limit)` can land between the backslash and the pipe
 * (leaving a dangling `\`) or drop the backslash and emit a BARE `|`, which
 * markdown reads as a column boundary and which CELL_SPLIT would then re-parse as
 * an extra cell. Whitespace is stripped too, and the two interact — "foo\ "
 * needs both passes — hence the loop rather than two ordered replaces.
 */
export function trimUnsafeTail(text) {
  let out = String(text);
  for (;;) {
    const trimmed = out.replace(/\s+$/u, "");
    const trailingBackslashes = /(\\*)$/u.exec(trimmed)[1];
    const fixed = trailingBackslashes.length % 2 === 1 ? trimmed.slice(0, -1) : trimmed;
    if (fixed === out) return out;
    out = fixed;
  }
}

/**
 * Drop a code span that truncation opened but never closed, along with the text
 * inside it. One record in the corpus carries inline code spans in its outcome
 * cell; cutting inside one would turn the remainder of the table row into code.
 * Dropping the whole partial span is preferred over deleting only the backtick,
 * which would silently re-present code text (`verify:pr-local`) as prose.
 */
export function balanceBackticks(text) {
  const source = String(text);
  const count = (source.match(/`/gu) ?? []).length;
  if (count % 2 === 0) return source;
  return trimUnsafeTail(source.slice(0, source.lastIndexOf("`")));
}

/** Shorten a free-text cell for the index table without breaking the table. */
export function truncateCell(value, limit) {
  const text = String(value ?? "").trim();
  if (text.length <= limit) return text;
  const sliced = trimUnsafeTail(text.slice(0, limit));
  // Never let backtick balancing swallow the whole cell (a span opened at
  // character 0); fall back to the slice with its backticks stripped.
  const balanced = balanceBackticks(sliced) || trimUnsafeTail(sliced.replace(/`/gu, ""));
  return `${balanced}…`;
}

/** Never emit an empty cell: `|  |` reads as a formatting bug rather than as data. */
function cell(value) {
  const text = String(value ?? "").trim();
  return text === "" ? "-" : text;
}

/** Read every record file and flatten it to one row, failing closed on a malformed file. */
export function collectRecords({
  paths = listLedgerRecordPaths(),
  read = (p) => readFileSync(path.join(repoRoot, p), "utf8"),
} = {}) {
  const records = [];
  for (const recordPath of paths) {
    const rows = parseLedgerRows(read(recordPath));
    if (rows.length !== 1) {
      throw new Error(`${recordPath}: expected exactly one review row, found ${rows.length}`);
    }
    const hash = path.posix.basename(recordPath, RECORD_SUFFIX);
    records.push({ ...rows[0], path: recordPath, hash });
  }
  return records;
}

/**
 * Total order: date descending, then record path ascending. The tiebreak is not
 * decoration — `listLedgerRecordPaths()` returns hashes in sorted order, so this
 * makes the output independent of both readdir order and sort stability.
 */
export function sortRecords(records) {
  return [...records].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return 0;
  });
}

/**
 * Best-effort supersession key. The `(supersedes YYYY-MM-DD)` scope suffix that
 * `ledger:append --supersede` writes appears in only 8 of 576 records (3 of them
 * hand-written prose), so it is a hint, not the signal. The real signal is a
 * repeated (ref, head) pair: the same branch tip reviewed more than once.
 *
 * Ref cells are free text — bare branches, "PR #1966 / branch", bare PR numbers,
 * the placeholder "work", a full GitHub URL, and one whole sentence — so 22 of
 * 576 yield no branch token at all. `refTokens` is therefore best-effort and the
 * normalised raw cell is the fallback; neither may throw on any shape.
 */
export function supersessionKey(record) {
  const tokens = [...refTokens(record.ref)].sort();
  const refKey = tokens.length > 0 ? tokens.join(" ") : normalizeRef(record.ref);
  return `${refKey}\u0000${record.head.toLowerCase()}`;
}

function recordLink(record) {
  return `[${record.hash.slice(0, 8)}](${RECORD_LINK_DIR}/${record.hash}${RECORD_SUFFIX})`;
}

function renderHeader(records) {
  const dates = records.map((record) => record.date);
  const earliest = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : "-";
  const latest = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : "-";
  const refs = new Set(records.map((record) => record.ref));
  const heads = new Set(records.map((record) => record.head.toLowerCase()));

  const perDate = new Map();
  for (const record of records) perDate.set(record.date, (perDate.get(record.date) ?? 0) + 1);
  const dateLines = [...perDate.keys()]
    .sort()
    .reverse()
    .map((date) => `- \`${date}\` — ${perDate.get(date)} ${perDate.get(date) === 1 ? "record" : "records"}`);

  return [
    "# Branch review record index",
    "",
    "This file is generated by `npm run ledger:index` (and refreshed by `npm run docs:update`).",
    "Run `npm run ledger:index:check` to see whether it is current.",
    "",
    "**This index is not a gate and it may lag the corpus.** Review records are appended by",
    "every PR handoff, so a byte-equality check on a file derived from them would go red on",
    "`main` after nearly every merge and would conflict between concurrent pull requests. It is",
    "therefore wired into no verification gate, and `ledger:index:check` is advisory only. For",
    'the authoritative answer to "has this ref been reviewed for this scope?", ask the records',
    'themselves: `npm run ledger:lookup -- <ref> --scope "<scope>"`.',
    "",
    "Record format and write rules: [`branch-review-records/README.md`](branch-review-records/README.md).",
    "Retention and rotation: [`branch-review-archival-policy.md`](branch-review-archival-policy.md).",
    "",
    "## Summary",
    "",
    `- Records: ${records.length}`,
    `- Distinct ref cells: ${refs.size}`,
    `- Distinct reviewed heads: ${heads.size}`,
    `- Date range: \`${earliest}\` to \`${latest}\``,
    "",
    "Records per date, newest first:",
    "",
    ...dateLines,
  ];
}

function renderAllRecords(sorted) {
  const lines = [
    "## All records, newest first",
    "",
    "Scope and outcome are truncated; follow the record link for the full six-cell row.",
    "",
    "| Date | Ref | Scope | Outcome | Record |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const record of sorted) {
    lines.push(
      `| ${cell(record.date)} | ${cell(record.ref)} | ${cell(truncateCell(record.scope, SCOPE_LIMIT))} | ${cell(
        truncateCell(record.outcome, OUTCOME_LIMIT),
      )} | ${recordLink(record)} |`,
    );
  }
  return lines;
}

function renderSupersessionChains(sorted) {
  const groups = new Map();
  for (const record of sorted) {
    const key = supersessionKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const chains = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    // `sorted` is newest-first, so the first entry of each group is its newest
    // record and the group arrives in newest-first order already. Reverse to
    // read the chain oldest -> newest, which is the order it was written in.
    .map(([key, group]) => ({ key, newest: group[0], group: [...group].reverse() }))
    .sort((a, b) => {
      if (a.newest.date !== b.newest.date) return a.newest.date < b.newest.date ? 1 : -1;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return 0;
    });

  const lines = [
    "## Refs reviewed more than once",
    "",
    "Same ref, same reviewed head, more than one record — the shape a supersession chain",
    "takes. Ref shown is the newest record's cell verbatim; dates and record links only, so",
    "this section stays short. Grouping is best-effort: ref cells are free text.",
    "",
  ];
  if (chains.length === 0) {
    lines.push("_No ref/head pair carries more than one record._");
    return lines;
  }
  lines.push("| Ref | Head | Records |", "| --- | --- | --- |");
  for (const chain of chains) {
    const entries = chain.group.map((record) => `${record.date} ${recordLink(record)}`).join(", ");
    lines.push(`| ${cell(chain.newest.ref)} | \`${chain.newest.head.slice(0, 8)}\` | ${entries} |`);
  }
  return lines;
}

/**
 * Pure renderer: records in, markdown out. Cells are emitted with single-space
 * padding (`| a | b |`) and the file is EXCLUDED from Prettier, because Prettier
 * column-pads markdown tables — one long cell would repad all 576 rows and turn a
 * one-record append into a whole-file diff, the same reason
 * docs/branch-review-ledger.md is ignored.
 */
export function renderBranchReviewIndex(records) {
  const sorted = sortRecords(records);
  return [...renderHeader(sorted), "", ...renderAllRecords(sorted), "", ...renderSupersessionChains(sorted), ""].join(
    "\n",
  );
}

export function generate(options = {}) {
  return renderBranchReviewIndex(collectRecords(options));
}

function main(argv) {
  const outputPath = path.join(repoRoot, OUTPUT_PATH);
  const expected = generate();
  if (argv.includes("--check")) {
    let current = null;
    try {
      current = readFileSync(outputPath, "utf8");
    } catch {
      current = null;
    }
    if (current === expected) {
      console.log(`[ledger:index] ${OUTPUT_PATH} is current.`);
      return 0;
    }
    console.error(
      `[ledger:index] ${OUTPUT_PATH} is stale — run \`npm run ledger:index\`.\n` +
        "This check is ADVISORY and intentionally gates nothing: review records are appended\n" +
        "constantly, so the index lagging main is expected, not a failure of the change under review.",
    );
    return 1;
  }
  writeFileSync(outputPath, expected, "utf8");
  console.log(`[ledger:index] wrote ${OUTPUT_PATH}`);
  return 0;
}

// Windows-safe main-module check (same convention as
// scripts/generate-outstanding-issues-snapshot.mjs): a hand-built `file://` string
// never matches import.meta.url on Windows, so the guard would silently never
// fire. Importing this module for tests must never write the file.
if (isDirectEntrypoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
