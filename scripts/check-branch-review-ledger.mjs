#!/usr/bin/env node
/**
 * Keep the append-only branch review ledger machine-readable and merge-safe.
 *
 * Immutable records now preserve concurrent review entries; this gate catches the ways
 * the historical tables and new records can degrade in practice:
 *   - a merge driver reintroduced on the frozen legacy table, or conflict markers committed verbatim
 *   - exact duplicate records
 *   - mojibake (`???` / U+FFFD) from an append that was not written as UTF-8, which also
 *     hides duplicates from the exact-match check by making the twin rows differ
 *   - rows that are not six cells, from an unescaped `|` in prose or a missing separator
 *   - records written as a heading + bullet list inside the table, which splits the table
 *     and makes the record invisible to every consumer that parses rows
 *   - HEADs recorded as `see PR head` or an abbreviation, which no `git rev-parse` lookup
 *     can match, so the review throttle silently never fires
 *
 * The last two HEAD/duplicate rules are enforced only for records dated on or after
 * STRICT_FROM. Everything before that is the historical record, repaired for encoding and
 * cell structure on 2026-07-28 but deliberately not rewritten for content.
 *
 * The legacy table and the archived record files are frozen. Since 2026-10-20 new review
 * records are pull request comments (docs/agents/pull-request-workflow.md#records), so this
 * check guards history only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listLedgerArchivePaths,
  listLedgerRecordPaths,
  normalizeRef,
  normalizeScope,
  parseLedgerRows,
  refTokens,
  reviewRecordPath,
} from "./branch-review-ledger.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_PATH = "docs/branch-review-ledger.md";
const PROTOCOL_PATH = "docs/codex-review-protocol.md";

/**
 * Records dated on or after this landed through the retired record writer and must be fully
 * machine-readable. It is the first day after the hygiene pass, so no pre-existing
 * record is retroactively invalidated.
 */
export const STRICT_FROM = "2026-07-29";

const CELL_SPLIT = /(?<!\\)\|/;
const conflictMarker = /^(?:<{7}(?: .*)?|={7}|>{7}(?: .*)?)\r?$/gm;
const datedTableRow = /^\| \d{4}-\d{2}-\d{2} \|/;
const headingRecord = /^#{1,6} \d{4}-\d{2}-\d{2}\b/;

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function isRealDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function reviewKey(row) {
  const tokens = [...refTokens(row.ref)].sort();
  const ref = tokens.length > 0 ? tokens.join(",") : normalizeRef(row.ref);
  const head = row.head.replace(/`/g, "").trim().toLowerCase();
  return `${ref}::${head}::${normalizeScope(row.scope)}`;
}

/** Detect equivalent review records whose non-key prose differs across sources. */
export function duplicateReviewKeyFailures(rows, { crossSourceOnly = false } = {}) {
  const failures = [];
  const seen = new Map();
  for (const row of rows) {
    if (row.date < STRICT_FROM) continue;
    const key = reviewKey(row);
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, row);
      continue;
    }
    if (crossSourceOnly && prior.source === row.source) continue;
    const first = prior.source ? `${prior.source}:${prior.line}` : `line ${prior.line}`;
    const second = row.source ? `${row.source}:${row.line}` : `line ${row.line}`;
    failures.push(
      `review records repeat the same normalized ref/HEAD/scope at ${first} and ${second}; ` +
        "cite the prior record or use a distinct superseding scope.",
    );
  }
  return failures;
}

export function validateLedger({ ledger, mergeAttribute, protocol }) {
  const failures = [];
  const lines = ledger.split(/\r?\n/);

  if (mergeAttribute !== "unspecified") {
    failures.push(
      `${LEDGER_PATH} must leave merge unspecified (found ${JSON.stringify(mergeAttribute || "empty")}); ` +
        "GitHub cannot use a workstation-local merge driver, and normal review writes are immutable records.",
    );
  }

  const markers = [...ledger.matchAll(conflictMarker)];
  if (markers.length > 0) {
    failures.push(
      `conflict marker(s) found at ledger line(s): ${markers.map((m) => lineNumber(ledger, m.index)).join(", ")}.`,
    );
  }

  const mojibake = [];
  lines.forEach((line, i) => {
    if (line.includes("???") || line.includes("�")) mojibake.push(i + 1);
  });
  if (mojibake.length > 0) {
    failures.push(
      `${mojibake.length} line(s) contain mojibake (\`???\` or U+FFFD) at line(s) ${mojibake.slice(0, 10).join(", ")}${
        mojibake.length > 10 ? ", ..." : ""
      }. The table is frozen: restore these lines from the base branch instead of editing them.`,
    );
  }

  const headings = [];
  lines.forEach((line, i) => {
    if (headingRecord.test(line)) headings.push(i + 1);
  });
  if (headings.length > 0) {
    failures.push(
      `${headings.length} record(s) written as a dated heading instead of a table row at line(s) ${headings.join(", ")}. ` +
        "Heading records split the table and are invisible to every ledger consumer.",
    );
  }

  const rows = [];
  lines.forEach((line, i) => {
    if (!datedTableRow.test(line)) return;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(CELL_SPLIT)
      .map((cell) => cell.trim());
    rows.push({ line: i + 1, raw: line, cells, date: cells[0], ref: cells[1], head: cells[2], scope: cells[3] });
  });

  const wrongWidth = rows.filter((row) => row.cells.length !== 6);
  if (wrongWidth.length > 0) {
    failures.push(
      `${wrongWidth.length} record(s) do not have exactly 6 cells: ` +
        `${wrongWidth
          .slice(0, 6)
          .map((row) => `line ${row.line} (${row.cells.length})`)
          .join(", ")}. Escape prose pipes as \`\\|\`.`,
    );
  }

  const badDates = rows.filter((row) => !isRealDate(row.date));
  if (badDates.length > 0) {
    failures.push(
      `${badDates.length} record(s) have an impossible date: line(s) ${badDates.map((r) => r.line).join(", ")}.`,
    );
  }

  const firstRow = rows[0]?.line;
  const lastRow = rows.at(-1)?.line;
  if (firstRow && lastRow) {
    const gaps = [];
    for (let i = firstRow; i < lastRow; i += 1) {
      if (lines[i] !== undefined && lines[i].trim() === "") gaps.push(i + 1);
    }
    if (gaps.length > 0) {
      failures.push(
        `blank line(s) inside the record table at line(s) ${gaps.join(", ")} split it into separate tables.`,
      );
    }
  }

  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.raw)) duplicates.push(row.line);
    seen.add(row.raw);
  }
  if (duplicates.length > 0) {
    failures.push(`${duplicates.length} exact duplicate review record(s) found at line(s) ${duplicates.join(", ")}.`);
  }

  const strict = rows.filter((row) => row.date >= STRICT_FROM);
  const looseHeads = strict.filter((row) => {
    const head = row.head.replace(/`/g, "");
    return !/^[0-9a-f]{40}$/.test(head) && !/^n\/a\b/i.test(head);
  });
  if (looseHeads.length > 0) {
    failures.push(
      `${looseHeads.length} record(s) dated ${STRICT_FROM} or later record a HEAD that no lookup can match ` +
        `(line(s) ${looseHeads.map((r) => r.line).join(", ")}). Use the full 40-character SHA, or "n/a - <reason>".`,
    );
  }

  const strictKeys = new Map();
  const nearDuplicates = [];
  for (const row of strict) {
    const key = reviewKey(row);
    if (strictKeys.has(key)) nearDuplicates.push(`${strictKeys.get(key)} and ${row.line}`);
    else strictKeys.set(key, row.line);
  }
  if (nearDuplicates.length > 0) {
    failures.push(
      `${nearDuplicates.length} record(s) repeat the same ref/HEAD/scope (line pairs ${nearDuplicates.join("; ")}). ` +
        "Cite the prior record, or record what supersedes it in the Scope cell.",
    );
  }

  if (
    !ledger.includes("This file is a frozen historical table.") ||
    !ledger.includes("New review records are pull request comments")
  ) {
    failures.push(`${LEDGER_PATH} is missing its immutable-record editing contract.`);
  }
  if (!protocol.includes("post one `Review record` comment on the PR") || !protocol.includes("The table is frozen")) {
    failures.push(`${PROTOCOL_PATH} is missing its review-record reviewer instruction.`);
  }

  return { failures, recordCount: rows.length, strictCount: strict.length };
}

function effectiveMergeAttribute() {
  const output = execFileSync("git", ["check-attr", "merge", "--", LEDGER_PATH], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return output.match(/:\s*merge:\s*(\S+)$/)?.[1] ?? "";
}

function assert(condition, label) {
  if (!condition) throw new Error(`self-test failed: ${label}`);
}

function selfTest() {
  const row = (over = {}) => {
    const cells = {
      date: "2026-07-29",
      ref: "codex/thing",
      head: "a".repeat(40),
      scope: "diff review",
      outcome: "fine",
      checks: "npm run test",
      ...over,
    };
    return `| ${[cells.date, cells.ref, cells.head, cells.scope, cells.outcome, cells.checks].join(" | ")} |`;
  };
  const ledgerWith = (...extra) =>
    [
      "# Ledger",
      "",
      "This file is a frozen historical table.",
      "New review records are pull request comments.",
      "",
      row(),
      ...extra,
      "",
    ].join("\n");

  const valid = {
    ledger: ledgerWith(),
    mergeAttribute: "unspecified",
    protocol: "post one `Review record` comment on the PR. The table is frozen",
  };
  const fails = (input, needle, label) =>
    assert(
      validateLedger({ ...valid, ...input }).failures.some((failure) => failure.includes(needle)),
      label,
    );

  assert(validateLedger(valid).failures.length === 0, "valid ledger passes");
  assert(validateLedger(valid).recordCount === 1, "counts records");

  fails({ mergeAttribute: "ledger" }, "leave merge unspecified", "legacy custom driver fails");
  fails({ mergeAttribute: "union" }, "leave merge unspecified", "stock union attribute fails");
  fails({ mergeAttribute: "unset" }, "leave merge unspecified", "explicitly unset merge fails");
  fails({ protocol: "append records" }, "reviewer instruction", "missing protocol contract fails");
  fails({ ledger: `${valid.ledger}<<<<<<< ours\n` }, "conflict marker", "conflict marker fails");
  fails({ ledger: ledgerWith(row()) }, "exact duplicate", "exact duplicate record fails");
  fails({ ledger: ledgerWith(row({ outcome: "different prose" })) }, "same ref/HEAD/scope", "near duplicate fails");
  fails({ ledger: ledgerWith(row({ outcome: "restored ??? arc" })) }, "mojibake", "mojibake fails");
  fails({ ledger: ledgerWith(row({ outcome: "restored � arc" })) }, "mojibake", "replacement char fails");
  fails({ ledger: ledgerWith(row({ outcome: "a | b", head: "b".repeat(40) })) }, "6 cells", "unescaped pipe fails");
  fails(
    { ledger: ledgerWith(row({ date: "2026-02-31", head: "b".repeat(40) })) },
    "impossible date",
    "impossible date fails",
  );
  fails({ ledger: ledgerWith(row({ head: "see PR head" })) }, "no lookup can match", "prose HEAD fails after cutoff");
  fails({ ledger: ledgerWith(row({ head: "abc1234" })) }, "no lookup can match", "abbreviated HEAD fails after cutoff");
  fails({ ledger: ledgerWith("", row({ head: "b".repeat(40) })) }, "blank line", "blank line inside the table fails");
  fails({ ledger: ledgerWith("## 2026-07-24 - a review") }, "dated heading", "heading-style record fails");

  assert(
    validateLedger({ ...valid, ledger: ledgerWith(row({ date: "2026-07-01", head: "see PR head" })) }).failures
      .length === 0,
    "pre-cutoff records keep their historical HEAD text",
  );
  assert(
    validateLedger({ ...valid, ledger: ledgerWith(row({ head: "n/a - branch never pushed" })) }).failures.length === 0,
    "documented n/a HEAD is accepted",
  );
  assert(
    validateLedger({ ...valid, ledger: ledgerWith(row({ outcome: "a \\| b", head: "b".repeat(40) })) }).failures
      .length === 0,
    "escaped pipe is accepted",
  );

  const first = { ...parseLedgerRows(row({ outcome: "first" }))[0], source: "a.record.md" };
  const second = {
    ...parseLedgerRows(row({ date: "2026-07-30", ref: "origin/codex/thing", outcome: "second" }))[0],
    source: "b.record.md",
  };
  assert(
    duplicateReviewKeyFailures([first, second], { crossSourceOnly: true }).length === 1,
    "equivalent key across immutable sources fails even when prose differs",
  );
  const superseding = {
    ...second,
    scope: "diff review (supersedes 2026-07-29)",
    raw: row({
      date: "2026-07-30",
      ref: "origin/codex/thing",
      scope: "diff review (supersedes 2026-07-29)",
      outcome: "second",
    }),
  };
  assert(
    duplicateReviewKeyFailures([first, superseding], { crossSourceOnly: true }).length === 0,
    "distinct superseding scope remains valid",
  );

  console.log("branch-review-ledger self-test passed.");
}

function validateArchiveStructure(relativePath, markdown) {
  const failures = [];
  if ([...markdown.matchAll(conflictMarker)].length > 0) {
    failures.push(`${relativePath}: conflict marker(s) found.`);
  }
  if (markdown.includes("???") || markdown.includes("�")) {
    failures.push(`${relativePath}: mojibake found.`);
  }
  const rows = parseLedgerRows(markdown);
  const wrongWidth = rows.filter((row) => row.cells.length !== 6);
  if (wrongWidth.length > 0) {
    failures.push(`${relativePath}: ${wrongWidth.length} record(s) do not have exactly 6 cells.`);
  }
  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.raw)) duplicates.push(row.line);
    seen.add(row.raw);
  }
  if (duplicates.length > 0) {
    failures.push(`${relativePath}: ${duplicates.length} exact duplicate record(s).`);
  }
  return { failures, recordCount: rows.length };
}

function validateImmutableRecord(relativePath, markdown) {
  const failures = [];
  if (markdown.includes("\n<<<<<<<") || markdown.includes("\n=======") || markdown.includes("\n>>>>>>>")) {
    failures.push(`${relativePath}: conflict marker(s) found.`);
  }
  if (markdown.includes("???") || markdown.includes("�")) failures.push(`${relativePath}: mojibake found.`);
  const rows = parseLedgerRows(markdown);
  if (rows.length !== 1 || markdown.trim() !== rows[0]?.raw) {
    failures.push(`${relativePath}: immutable record must contain exactly one table row and no prose.`);
    return { failures, rows: [] };
  }
  const row = rows[0];
  if (reviewRecordPath(row.raw) !== relativePath) {
    failures.push(`${relativePath}: filename must be the SHA-256 content address for its record row.`);
  }
  if (row.cells.length !== 6) failures.push(`${relativePath}: record must have exactly 6 cells.`);
  if (!isRealDate(row.date)) failures.push(`${relativePath}: record has an impossible date.`);
  const head = row.head.replace(/`/g, "");
  if (row.date >= STRICT_FROM && !/^[0-9a-f]{40}$/.test(head) && !/^n\/a\b/i.test(head)) {
    failures.push(`${relativePath}: record must carry a full 40-character SHA or documented n/a HEAD.`);
  }
  return { failures, rows };
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const result = validateLedger({
    ledger: readFileSync(path.join(root, LEDGER_PATH), "utf8"),
    mergeAttribute: effectiveMergeAttribute(),
    protocol: readFileSync(path.join(root, PROTOCOL_PATH), "utf8"),
  });

  const failures = [...result.failures];
  let archiveRecords = 0;
  for (const relative of listLedgerArchivePaths().slice(1)) {
    const archive = validateArchiveStructure(relative, readFileSync(path.join(root, relative), "utf8"));
    failures.push(...archive.failures);
    archiveRecords += archive.recordCount;
  }

  let immutableRecords = 0;
  const withSource = (relative, rows) => rows.map((row) => ({ ...row, source: relative }));
  const allRows = withSource(LEDGER_PATH, parseLedgerRows(readFileSync(path.join(root, LEDGER_PATH), "utf8")));
  for (const relative of listLedgerArchivePaths().slice(1)) {
    allRows.push(...withSource(relative, parseLedgerRows(readFileSync(path.join(root, relative), "utf8"))));
  }
  for (const relative of listLedgerRecordPaths()) {
    const record = validateImmutableRecord(relative, readFileSync(path.join(root, relative), "utf8"));
    failures.push(...record.failures);
    immutableRecords += record.rows.length;
    allRows.push(...withSource(relative, record.rows));
  }
  const exactRows = new Set();
  for (const row of allRows) {
    if (exactRows.has(row.raw)) failures.push(`duplicate review record across ledger sources: ${row.raw}`);
    exactRows.add(row.raw);
  }
  failures.push(...duplicateReviewKeyFailures(allRows, { crossSourceOnly: true }));

  if (failures.length > 0) {
    console.error("Branch review ledger guard failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `Branch review ledger guard passed: ${result.recordCount} live table records` +
      `${archiveRecords > 0 ? ` + ${archiveRecords} archived` : ""}` +
      `${immutableRecords > 0 ? ` + ${immutableRecords} immutable` : ""} ` +
      `(${result.strictCount} under the ${STRICT_FROM} machine-readable contract), immutable review writes, ` +
      "six cells each, no conflict markers, mojibake, heading records, or duplicates.",
  );
}

const isMain =
  process.argv[1]?.endsWith("/check-branch-review-ledger.mjs") ||
  process.argv[1]?.endsWith("\\check-branch-review-ledger.mjs");
if (isMain) main();
