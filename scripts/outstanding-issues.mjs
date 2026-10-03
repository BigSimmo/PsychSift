#!/usr/bin/env node
// Writer for docs/outstanding-issues.md — the counterpart to
// check-outstanding-issues.mjs, which only ever validated.
//
// Why this exists. docs/branch-review-ledger.md has had a writer
// (branch-review-ledger.mjs) since it was introduced, and hand-authoring a row
// there is forbidden by AGENTS.md. This file had a gate but no writer, so every
// mutation was hand-authored — and the 2026-07-30/31 session produced exactly
// the failures that predicts, none of which were judgement calls:
//
//   - rows appended into the archive table because the author anchored on an id
//     that had since been archived (the gate caught it as a cell-count error,
//     which is a confusing way to be told "wrong table")
//   - an unescaped `|` inside prose splitting one row into extra cells
//   - ids formerly allocated by reading a numeric marker by eye and colliding
//     with a concurrent branch
//
// So the rules live in ONE place: this writer imports the gate's parser rather
// than re-deriving where the tables are or how wide they are, and it re-runs the
// gate against its own output before writing. A refusal here is the same
// refusal CI would give, minus the round trip.
//
// New rows use a request-owned durable ULID and a permanent Crockford display
// locator. The locator starts at six characters and extends only on collision;
// existing sequential ids remain valid and are never rewritten.
//
// Usage:
//   node scripts/outstanding-issues.mjs add --pri P2 --type issue \
//     --summary "..." --detail "..." --source "..."
//   node scripts/outstanding-issues.mjs done '#151' --outcome "Resolved ..."
//   node scripts/outstanding-issues.mjs update '#151' --detail "..."
//   node scripts/outstanding-issues.mjs update '#151' --pri P3
//   node scripts/outstanding-issues.mjs queue '#151' --acuity A2 --when "..."
//   node scripts/outstanding-issues.mjs --self-test
//
// `update --pri` exists because re-prioritising is the mutation triage performs
// most often, and until ledger #313 it was the only one the writer could not
// do — so every demotion was hand-authored against a rule that forbids exactly
// that. Deliberately per-row: there is no bulk re-prioritise mode, because a
// sweep that moves many rows at once is the kind of change that should be
// visible row by row in review.
//
// `queue` closes the same gap one table over (ledger #M6JNR8). The recommended
// execution queue could only be pruned on close, never corrected, so a re-grade
// recorded against an Open-items row left the queue advertising the old acuity
// and timing forever — and the queue is what an operator reads to decide what to
// start, so a stale row there is the one that actually misdirects work.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { ISSUES_PATH, checkIssues, parseIssues } from "./check-outstanding-issues.mjs";
import {
  allocateDisplayId,
  displayIdForUlid,
  issueIdCell,
  issueIdCitations,
  issueUlid,
  normalizeIssueDisplayId,
} from "./issue-id.mjs";

const OPEN_CELLS = 7; // ID | Pri | Type | Summary | Detail / next action | Source | Added
const ARCHIVE_CELLS = 5; // ID | Type | Summary | Outcome | Resolved
const PRIORITIES = new Set(["P1", "P2", "P3"]);
const TYPES = new Set(["task", "issue", "rec"]);
// Queue row is Order | ID(s) | Acuity | Capability | When | Estimate | Outcome.
// Order and ID(s) are deliberately absent — see updateQueueRow.
const QUEUE_EDITABLE = { acuity: 2, capability: 3, when: 4, estimate: 5, outcome: 6 };

/**
 * Make one cell safe to place in a markdown table.
 *
 * The pipe escape is the whole point: prose in these rows routinely contains
 * `a | b`, and an unescaped pipe silently becomes a column boundary, which the
 * gate then reports as a width error somewhere else on the line. Newlines
 * collapse for the same reason — a row is one line, by construction.
 */
export function escapeCell(value) {
  return String(value ?? "")
    .replace(/\r?\n+/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a row into cells, honouring `\|` escapes so prose pipes stay put. */
export function splitCells(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cell = "";
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cell += "\\|";
      i += 1;
      continue;
    }
    if (inner[i] === "|") {
      out.push(cell.trim());
      cell = "";
      continue;
    }
    cell += inner[i];
  }
  out.push(cell.trim());
  return out;
}

export function buildRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

function today(options = {}) {
  if (options.date) return options.date;
  return new Date().toISOString().slice(0, 10);
}

/** Last line index of the last body block of a table, or null when absent. */
function lastRowIndex(parsed, table) {
  const rows = parsed.rows.filter((row) => row.table === table);
  if (rows.length === 0) return null;
  return rows[rows.length - 1].line - 1;
}

export function findRow(parsed, id) {
  const normalized = normalizeIssueDisplayId(id);
  return parsed.rows.find((row) => row.id === id || (row.id && normalizeIssueDisplayId(row.id) === normalized)) ?? null;
}

function isQueueHeaderRow(cells) {
  return /^Order$/i.test((cells[0] ?? "").trim());
}

function isQueueSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s/g, "")) || cell.trim() === "");
}

/**
 * Remove a resolved id from the recommended-execution queue (#201 + /issues done).
 *
 * - Drops the id from a composite ID(s) cell and keeps the row when siblings remain.
 * - Deletes the whole queue row when no cited open id remains.
 * - Renumbers Order 1..N to close gaps (skill contract).
 */
export function pruneResolvedIdFromQueue(markdown, id) {
  // Normalize so lowercase Crockford locators (accepted by validate/findRow)
  // still prune uppercase queue citations.
  const target = normalizeIssueDisplayId(id);

  const lines = markdown.split("\n");
  const queueStart = lines.findIndex((line) => line.startsWith("## Recommended execution queue"));
  if (queueStart < 0) return markdown;
  const openStart = lines.findIndex((line) => line.startsWith("## Open items"));
  const archiveStart = lines.findIndex((line) => line.startsWith("## Resolved / archive"));
  const limit = openStart >= 0 ? openStart : archiveStart >= 0 ? archiveStart : lines.length;

  // Walk bottom-up so splice indices stay valid while deleting.
  for (let index = limit - 1; index > queueStart; index -= 1) {
    const line = lines[index];
    if (!/^\|/.test(line) || !/\|\s*$/.test(line)) continue;
    const cells = splitCells(line);
    if (cells.length < 2 || isQueueHeaderRow(cells) || isQueueSeparatorRow(cells)) continue;

    const idCell = cells[1] ?? "";
    const cited = issueIdCitations(idCell);
    if (!cited.some((candidate) => normalizeIssueDisplayId(candidate) === target)) continue;

    const remaining = cited.filter((candidate) => normalizeIssueDisplayId(candidate) !== target);
    if (remaining.length === 0) {
      lines.splice(index, 1);
      continue;
    }
    cells[1] = remaining.map((candidate) => `\`${candidate}\``).join(", ");
    lines[index] = buildRow(cells);
  }

  // Close Order gaps after deletions/edits. Recompute the section boundary:
  // every deletion above shifted the headings' indices down.
  const nextOpenStart = lines.findIndex((line) => line.startsWith("## Open items"));
  const nextArchiveStart = lines.findIndex((line) => line.startsWith("## Resolved / archive"));
  const renumberLimit = nextOpenStart >= 0 ? nextOpenStart : nextArchiveStart >= 0 ? nextArchiveStart : lines.length;
  let order = 1;
  for (let index = queueStart + 1; index < renumberLimit; index += 1) {
    const line = lines[index];
    if (!/^\|/.test(line) || !/\|\s*$/.test(line)) continue;
    const cells = splitCells(line);
    if (cells.length < 2 || isQueueHeaderRow(cells) || isQueueSeparatorRow(cells)) continue;
    cells[0] = String(order);
    lines[index] = buildRow(cells);
    order += 1;
  }

  return lines.join("\n");
}

/**
 * Apply an edit, then re-run the gate on the result. Returning the markdown
 * only when it passes is what makes a wrong-table insert impossible rather than
 * merely detectable later.
 */
function guarded(markdown, mutate) {
  const next = mutate(markdown);
  const problems = checkIssues(next, { prettierIgnored: true });
  if (problems.length > 0) {
    throw new Error(`refusing to write, the result would fail the gate:\n  - ${problems.join("\n  - ")}`);
  }
  return next;
}

export function addIssue(markdown, fields, options = {}) {
  const pri = String(fields.pri ?? "P2");
  const type = String(fields.type ?? "task");
  if (!PRIORITIES.has(pri)) throw new Error(`--pri must be one of ${[...PRIORITIES].join(", ")}, got ${pri}`);
  if (!TYPES.has(type)) throw new Error(`--type must be one of ${[...TYPES].join(", ")}, got ${type}`);
  if (!fields.summary) throw new Error("--summary is required");

  return guarded(markdown, (current) => {
    const parsed = parseIssues(current);
    if (parsed.openStart < 0) throw new Error("no '## Open items' heading found");

    const ulid = String(fields.issueUlid ?? options.issueUlid ?? issueUlid());
    const id = allocateDisplayId(ulid, new Set(parsed.rows.filter((entry) => entry.valid).map((entry) => entry.id)));
    const row = buildRow([
      issueIdCell(id, ulid),
      pri,
      type,
      escapeCell(fields.summary),
      escapeCell(fields.detail ?? ""),
      escapeCell(fields.source ?? `session ${today(options)}`),
      today(options),
    ]);
    if (splitCells(row).length !== OPEN_CELLS) {
      throw new Error(`built an open row with ${splitCells(row).length} cells, expected ${OPEN_CELLS}`);
    }

    const anchor = lastRowIndex(parsed, "open");
    if (anchor === null) throw new Error("the open-items table has no rows to append after");

    const lines = current.split("\n");
    lines.splice(anchor + 1, 0, row);
    return lines.join("\n");
  });
}

export function mergeArchiveOutcome(existingOutcome, newOutcome) {
  const escapedExisting = String(existingOutcome ?? "").trim();
  const escapedNew = escapeCell(newOutcome);
  if (!escapedNew) return escapedExisting;
  if (!escapedExisting) return escapedNew;
  const noteContent = escapedNew.replace(/^Note:\s*/i, "");
  const noteSegment = `Note: ${noteContent}`;
  if (escapedExisting.includes(noteSegment)) {
    return escapedExisting;
  }
  return `${escapedExisting} \\| ${noteSegment}`;
}

export function resolveIssue(markdown, id, outcome, options = {}) {
  if (!outcome) throw new Error("--outcome is required");
  const allowArchived = Boolean(options.allowArchived ?? options.mergeOutcome);
  return guarded(markdown, (current) => {
    const parsed = parseIssues(current);
    const row = findRow(parsed, id);
    if (!row) throw new Error(`${id} is not in ${ISSUES_PATH}`);
    if (row.table === "archive") {
      if (allowArchived) {
        const cells = splitCells(row.raw);
        cells[3] = mergeArchiveOutcome(cells[3], outcome);
        const updatedRow = buildRow(cells);
        if (splitCells(updatedRow).length !== ARCHIVE_CELLS) {
          throw new Error(
            `built an archive row with ${splitCells(updatedRow).length} cells, expected ${ARCHIVE_CELLS}`,
          );
        }
        const lines = current.split("\n");
        lines[row.line - 1] = updatedRow;
        return pruneResolvedIdFromQueue(lines.join("\n"), id);
      }
      if (options.idempotent) return current;
      throw new Error(`${id} is already archived`);
    }

    const cells = splitCells(row.raw);
    // Open is ID|Pri|Type|Summary|Detail|Source|Added; archive drops Pri,
    // Detail and Source and gains Outcome + Resolved.
    const archived = buildRow([cells[0], cells[2], cells[3], escapeCell(outcome), today(options)]);
    if (splitCells(archived).length !== ARCHIVE_CELLS) {
      throw new Error(`built an archive row with ${splitCells(archived).length} cells, expected ${ARCHIVE_CELLS}`);
    }

    const lines = current.split("\n");
    lines.splice(row.line - 1, 1);
    // Prune the queue before re-parsing so #201 does not refuse the write when
    // the ID(s) cell still cites the id we just moved to archive.
    const withoutOpen = pruneResolvedIdFromQueue(lines.join("\n"), id);
    const afterRemoval = parseIssues(withoutOpen);
    const nextLines = withoutOpen.split("\n");
    const anchor = lastRowIndex(afterRemoval, "archive");
    if (anchor === null) throw new Error("the archive table has no rows to append after");
    nextLines.splice(anchor + 1, 0, archived);
    return nextLines.join("\n");
  });
}

export function updateIssue(markdown, id, fields) {
  const editable = { pri: 1, summary: 3, detail: 4, source: 5 };
  const requested = Object.keys(editable).filter((key) => fields[key] !== undefined);
  if (requested.length === 0) throw new Error("pass at least one of --pri, --summary, --detail, --source");
  // Validate before guarded() so a bad priority fails with this message rather
  // than as a gate refusal about a malformed row. Re-prioritising is the single
  // most common triage mutation, and it is the one that used to force a hand
  // edit — the exact path this writer exists to close (ledger #313).
  if (fields.pri !== undefined && !PRIORITIES.has(String(fields.pri))) {
    throw new Error(`--pri must be one of ${[...PRIORITIES].join(", ")}, got ${fields.pri}`);
  }

  return guarded(markdown, (current) => {
    const parsed = parseIssues(current);
    const row = findRow(parsed, id);
    if (!row) throw new Error(`${id} is not in ${ISSUES_PATH}`);
    if (row.table !== "open") throw new Error(`${id} is archived; archived rows are history and are not edited`);

    const cells = splitCells(row.raw);
    for (const key of requested) cells[editable[key]] = escapeCell(fields[key]);
    const lines = current.split("\n");
    lines[row.line - 1] = buildRow(cells);
    return lines.join("\n");
  });
}

/**
 * Amend the outcome of an archived issue row (#1BKK79).
 * Preserves historical resolution while allowing outcome corrections or notes.
 */
export function updateArchivedIssue(markdown, id, outcome, options = {}) {
  if (!outcome) throw new Error("--outcome is required to update an archived issue");
  return guarded(markdown, (current) => {
    const parsed = parseIssues(current);
    const targetId = normalizeIssueDisplayId(id);
    const row = parsed.rows.find((r) => r.table === "archive" && normalizeIssueDisplayId(r.id) === targetId);
    if (!row) throw new Error(`${id} is not in archive table in ${ISSUES_PATH}`);

    const cells = splitCells(row.raw);
    cells[3] = options.replace ? escapeCell(outcome) : mergeArchiveOutcome(cells[3], outcome);
    const updatedRow = buildRow(cells);
    if (splitCells(updatedRow).length !== ARCHIVE_CELLS) {
      throw new Error(`built an archive row with ${splitCells(updatedRow).length} cells, expected ${ARCHIVE_CELLS}`);
    }
    const lines = current.split("\n");
    lines[row.line - 1] = updatedRow;
    return pruneResolvedIdFromQueue(lines.join("\n"), id);
  });
}

/**
 * Edit the recommended-execution-queue row that cites `id` (ledger #M6JNR8).
 *
 * The queue owns recommended order, acuity, capability, timing and approvals,
 * and it was the one table in this ledger no writer could correct. `done`
 * pruned rows and nothing else touched them, so a re-grade recorded against an
 * Open-items row left the queue asserting the old acuity indefinitely — the
 * `#231` instance kept sending sessions at an "Immediate approved live
 * investigation" for a cause the ledger had already measured closed.
 *
 * Deliberately NOT editable: Order and the ID(s) cell. Order is derived — it is
 * renumbered 1..N whenever a row is pruned, so a hand-set value would be
 * silently overwritten by the next close. The ID(s) cell is the linkage
 * `checkIssues` validates against Open items; changing queue membership is an
 * add or a close, not an edit. Re-ordering the queue therefore stays out of
 * scope and remains a separate, visible decision.
 */
export function updateQueueRow(markdown, id, fields) {
  const requested = Object.keys(QUEUE_EDITABLE).filter((key) => fields[key] !== undefined);
  if (requested.length === 0) {
    const flags = Object.keys(QUEUE_EDITABLE)
      .map((key) => `--${key}`)
      .join(", ");
    throw new Error(`pass at least one of ${flags}`);
  }

  return guarded(markdown, (current) => {
    const parsed = parseIssues(current);
    const normalizedId = normalizeIssueDisplayId(id);
    const cited = (parsed.queueCitations ?? []).filter((citation) => citation.id === normalizedId);
    const lineNumbers = [...new Set(cited.map((citation) => citation.line))];
    if (lineNumbers.length === 0) {
      throw new Error(`${normalizedId} has no recommended-execution-queue row; the queue carries only scheduled work`);
    }
    if (lineNumbers.length > 1) {
      throw new Error(
        `${normalizedId} is cited by ${lineNumbers.length} queue rows (lines ${lineNumbers.join(", ")}); refusing to guess which`,
      );
    }

    const lines = current.split("\n");
    const cells = splitCells(lines[lineNumbers[0] - 1]);
    for (const key of requested) {
      const column = QUEUE_EDITABLE[key];
      if (column >= cells.length) {
        throw new Error(
          `the queue row for ${id} has ${cells.length} cells, so --${key} (column ${column + 1}) has nowhere to go`,
        );
      }
      cells[column] = escapeCell(fields[key]);
    }
    lines[lineNumbers[0] - 1] = buildRow(cells);
    return lines.join("\n");
  });
}

function argValue(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function selfTest() {
  const fixture = [
    "# Outstanding",
    "",
    "<!-- issues:next-id=17 -->",
    "",
    "## Recommended execution queue",
    "",
    "<!-- prettier-ignore -->",
    "",
    "| Order | ID(s) | Acuity | Capability | When | Estimate | Outcome |",
    "| ----: | -------------- | -------- | --- | --- | --- | --- |",
    "| 1 | `#005` | A2 | High | now | 1h | solo |",
    "| 2 | `#013`, `#016` | A3 | High | later | 1d | composite |",
    "| 3 | `#006` | A3 | High | later | 1h | trailing |",
    "| 4 | `#DREDWA` | A2 | Med | later | 2h | crockford |",
    "| 5 | `#TF6TPJ` | A2 | Med | later | 2h | anti-churn |",
    "",
    "## Open items",
    "",
    "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
    "| ---- | --- | ---- | ---- | ---- | ---- | ---- |",
    "| #005 | P2 | issue | first | detail one | src | 2026-01-01 |",
    "| #006 | P3 | task | second | detail two | src | 2026-01-02 |",
    "| #013 | P3 | task | left | detail | src | 2026-01-03 |",
    "| #016 | P3 | task | right | detail | src | 2026-01-04 |",
    "| #DREDWA <!-- issue-ulid:01M09A9WXBDREDWA7KN2EB1JRA --> | P3 | rec | Crockford rec | detail | src | 2026-01-05 |",
    "| #TF6TPJ <!-- issue-ulid:01M0BEKPPPTF6TPJJMJ4WW5KWJ --> | P2 | task | In-flight CI guard | detail | src | 2026-01-06 |",
    "",
    "## Resolved / archive",
    "",
    "| ID | Type | Summary | Outcome | Resolved |",
    "| ---- | ---- | ---- | ---- | ---- |",
    "| #001 | task | old | done long ago | 2025-12-01 |",
    "",
  ].join("\n");

  const failures = [];
  const check = (label, condition) => {
    if (!condition) failures.push(label);
  };

  const testUlid = issueUlid(Date.UTC(2026, 1, 2), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  const testId = displayIdForUlid(testUlid);

  // add: lands in the OPEN table with a durable, collision-free identity.
  const added = addIssue(
    fixture,
    { pri: "P1", type: "rec", summary: "third", detail: "d", source: "s" },
    { date: "2026-02-02", issueUlid: testUlid },
  );
  const addedParsed = parseIssues(added);
  check(
    "add stores the derived display id",
    addedParsed.rows.some((r) => r.id === testId && r.ulid === testUlid && r.table === "open"),
  );
  check("add leaves the deprecated marker untouched", addedParsed.nextId === 17);
  check("add appends after the last open row", added.indexOf(testId) > added.indexOf("#016"));
  check("add stays out of the archive", !addedParsed.rows.some((r) => r.id === testId && r.table === "archive"));

  // The wrong-table failure that motivated this writer: appending must not land
  // in the archive even though an archived row sits later in the file.
  check("add lands before the archive heading", added.indexOf(`| ${testId} `) < added.indexOf("## Resolved / archive"));

  // escaping: a pipe in prose must not become a column.
  const piped = addIssue(
    fixture,
    { pri: "P2", type: "task", summary: "a | b", detail: "c | d" },
    { date: "2026-02-02", issueUlid: testUlid },
  );
  const pipedRow = parseIssues(piped).rows.find((r) => r.id === testId);
  check("pipes are escaped, not new cells", splitCells(pipedRow.raw).length === OPEN_CELLS);
  check("escaped pipe survives in the text", pipedRow.raw.includes("a \\| b"));

  // done: moves rather than copies, and reshapes to the archive width.
  const resolved = resolveIssue(fixture, "#005", "Resolved by PR #1", { date: "2026-03-03" });
  const resolvedParsed = parseIssues(resolved);
  const moved = resolvedParsed.rows.filter((r) => r.id === "#005");
  check("done leaves exactly one #005", moved.length === 1);
  check("done puts it in the archive", moved[0]?.table === "archive");
  check("done reshapes to archive width", splitCells(moved[0].raw).length === ARCHIVE_CELLS);
  check("done keeps the summary", moved[0].raw.includes("first"));
  check("done records the outcome", moved[0].raw.includes("Resolved by PR #1"));
  // #201: resolving must prune the queue so guarded() does not refuse the write.
  check("done drops solo queue row for #005", !resolved.includes("`#005`"));
  check("done renumbers remaining queue orders", /\|\s*1\s*\|\s*`#013`/.test(resolved));
  check("done keeps composite sibling after solo prune", resolved.includes("`#016`"));

  // Composite queue cell: remove only the resolved id, keep the sibling.
  const composite = resolveIssue(fixture, "#013", "Resolved left side", { date: "2026-03-04" });
  check("done keeps composite sibling id", /`#016`/.test(composite) && !/`#013`/.test(composite));
  check("done does not drop the composite queue row", composite.includes("composite"));

  // Multi-row queue prune must not walk into Open items with a stale boundary
  // (Devin: Order renumber overwrote the open ID header after enough deletions).
  const multiQueue = [
    "# Outstanding",
    "",
    "<!-- issues:next-id=17 -->",
    "",
    "## Recommended execution queue",
    "",
    "<!-- prettier-ignore -->",
    "",
    "| Order | ID(s) | Acuity | Capability | When | Estimate | Outcome |",
    "| ----: | --- | --- | --- | --- | --- | --- |",
    "| 1 | `#005` | A2 | High | now | 1h | a |",
    "| 2 | `#005` | A2 | High | now | 1h | b |",
    "| 3 | `#005` | A2 | High | now | 1h | c |",
    "| 4 | `#005` | A2 | High | now | 1h | d |",
    "| 5 | `#005` | A2 | High | now | 1h | e |",
    "| 6 | `#005` | A2 | High | now | 1h | f |",
    "",
    "",
    "",
    "## Open items",
    "",
    "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
    "| ---- | --- | ---- | ---- | ---- | ---- | ---- |",
    "| #005 | P2 | issue | first | detail one | src | 2026-01-01 |",
    "| #006 | P3 | task | second | detail two | src | 2026-01-02 |",
    "",
    "## Resolved / archive",
    "",
    "| ID | Type | Summary | Outcome | Resolved |",
    "| ---- | ---- | ---- | ---- | ---- |",
    "| #001 | task | old | done long ago | 2025-12-01 |",
    "",
  ].join("\n");
  const multiResolved = resolveIssue(multiQueue, "#005", "Resolved multi-queue", { date: "2026-03-05" });
  check("multi-queue prune keeps open ID header", multiResolved.includes("| ID | Pri | Type | Summary |"));
  check("multi-queue prune does not order-stamp open header", !/\|\s*1\s*\|\s*Pri\s*\|/.test(multiResolved));
  check(
    "multi-queue prune still archives #005",
    parseIssues(multiResolved).rows.some((r) => r.id === "#005" && r.table === "archive"),
  );

  // update: edits in place, same table, same width.
  const updated = updateIssue(fixture, "#006", { detail: "replaced | detail" });
  const updatedRow = parseIssues(updated).rows.find((r) => r.id === "#006");
  check("update stays in the open table", updatedRow.table === "open");
  check("update keeps the width", splitCells(updatedRow.raw).length === OPEN_CELLS);
  check("update escapes the new text", updatedRow.raw.includes("replaced \\| detail"));

  // update --pri (#313): the Pri cell moves and nothing else does. The second
  // assertion is the one that matters — an off-by-one in the editable map would
  // write the priority over the ID or the Type and still produce a valid row.
  const reprioritised = updateIssue(fixture, "#006", { pri: "P1" });
  const reprioritisedCells = splitCells(parseIssues(reprioritised).rows.find((r) => r.id === "#006").raw);
  check("update --pri writes the Pri cell", reprioritisedCells[1] === "P1");
  check(
    "update --pri leaves every other cell alone",
    reprioritisedCells[0] === "#006" &&
      reprioritisedCells[2] === "task" &&
      reprioritisedCells[3] === "second" &&
      reprioritisedCells[4] === "detail two" &&
      reprioritisedCells[5] === "src" &&
      reprioritisedCells[6] === "2026-01-02",
  );
  check("update --pri keeps the width", reprioritisedCells.length === OPEN_CELLS);
  check(
    "update --pri stays in the open table",
    parseIssues(reprioritised).rows.find((r) => r.id === "#006").table === "open",
  );

  // Promotion and demotion are the same code path; assert both directions so a
  // future guard cannot accidentally allow only one.
  const promoted = updateIssue(fixture, "#013", { pri: "P1" });
  const demoted = updateIssue(fixture, "#005", { pri: "P3" });
  check("update --pri promotes", splitCells(parseIssues(promoted).rows.find((r) => r.id === "#013").raw)[1] === "P1");
  check("update --pri demotes", splitCells(parseIssues(demoted).rows.find((r) => r.id === "#005").raw)[1] === "P3");

  // Combined with another field in one call, since triage usually records the
  // reason in the same breath as the move.
  const both = updateIssue(fixture, "#006", { pri: "P3", detail: "demoted because ..." });
  const bothCells = splitCells(parseIssues(both).rows.find((r) => r.id === "#006").raw);
  check("update --pri combines with --detail", bothCells[1] === "P3" && bothCells[4] === "demoted because ...");

  // Crockford ULID operations (#DREDWA and all-digit #041061)
  const resolvedDredwa = resolveIssue(fixture, "#DREDWA", "Resolved Crockford item", { date: "2026-03-05" });
  const dredwaMoved = parseIssues(resolvedDredwa).rows.find((r) => r.id === "#DREDWA");
  check(
    "done archives #DREDWA preserving ULID comment",
    dredwaMoved && dredwaMoved.table === "archive" && dredwaMoved.ulid === "01M09A9WXBDREDWA7KN2EB1JRA",
  );
  check("done drops #DREDWA from queue", !resolvedDredwa.includes("`#DREDWA`"));

  const updatedDredwa = updateIssue(fixture, "#DREDWA", { pri: "P1", detail: "promoted crockford" });
  const dredwaUpdated = parseIssues(updatedDredwa).rows.find((r) => r.id === "#DREDWA");
  check(
    "update modifies #DREDWA in place",
    dredwaUpdated &&
      dredwaUpdated.table === "open" &&
      splitCells(dredwaUpdated.raw)[1] === "P1" &&
      dredwaUpdated.raw.includes("promoted crockford"),
  );

  const resolvedTf6tpj = resolveIssue(fixture, "#TF6TPJ", "Resolved TF6TPJ item", { date: "2026-03-05" });
  const tf6tpjMoved = parseIssues(resolvedTf6tpj).rows.find((r) => r.id === "#TF6TPJ");
  check(
    "done archives #TF6TPJ preserving ULID",
    tf6tpjMoved && tf6tpjMoved.table === "archive" && tf6tpjMoved.ulid === "01M0BEKPPPTF6TPJJMJ4WW5KWJ",
  );
  check("done drops #TF6TPJ from queue", !resolvedTf6tpj.includes("`#TF6TPJ`"));

  const updatedTf6tpj = updateIssue(fixture, "#TF6TPJ", { pri: "P3", summary: "TF6TPJ summary updated" });
  const tf6tpjUpdated = parseIssues(updatedTf6tpj).rows.find((r) => r.id === "#TF6TPJ");
  check(
    "update modifies #TF6TPJ in place",
    tf6tpjUpdated &&
      tf6tpjUpdated.table === "open" &&
      splitCells(tf6tpjUpdated.raw)[1] === "P3" &&
      tf6tpjUpdated.raw.includes("TF6TPJ summary updated"),
  );

  // Also test all-digit Crockford ULID operations on the dynamically added row (testId is #041061)
  const resolvedAllDigit = resolveIssue(added, testId, "Resolved all-digit added item", { date: "2026-03-05" });
  const allDigitMoved = parseIssues(resolvedAllDigit).rows.find((r) => r.id === testId);
  check(
    "done archives all-digit Crockford #041061",
    allDigitMoved && allDigitMoved.table === "archive" && allDigitMoved.ulid === testUlid,
  );

  const updatedAllDigit = updateIssue(added, testId, { pri: "P3", summary: "all digit summary updated" });
  const allDigitUpdated = parseIssues(updatedAllDigit).rows.find((r) => r.id === testId);
  check(
    "update modifies all-digit Crockford #041061 in place",
    allDigitUpdated &&
      allDigitUpdated.table === "open" &&
      splitCells(allDigitUpdated.raw)[1] === "P3" &&
      allDigitUpdated.raw.includes("all digit summary updated"),
  );

  // refusals
  const rejects = (label, run) => {
    try {
      run();
      failures.push(`${label} should have thrown`);
    } catch {
      /* expected */
    }
  };
  rejects("unknown id", () => resolveIssue(fixture, "#999", "x"));
  rejects("double archive", () => resolveIssue(resolved, "#005", "again"));
  const doubleResolved = resolveIssue(resolved, "#005", "re-closed with note", { allowArchived: true });
  const doubleRow = parseIssues(doubleResolved).rows.find((r) => r.id === "#005");
  check(
    "idempotent resolve merges outcome note",
    doubleRow && doubleRow.raw.includes("Resolved by PR #1 \\| Note: re-closed with note"),
  );
  rejects("bad priority", () => addIssue(fixture, { pri: "P9", summary: "x" }));
  rejects("bad type", () => addIssue(fixture, { type: "nope", summary: "x" }));
  rejects("missing summary", () => addIssue(fixture, {}));
  rejects("empty update", () => updateIssue(fixture, "#006", {}));
  rejects("bad update priority", () => updateIssue(fixture, "#006", { pri: "P9" }));
  rejects("lowercase update priority", () => updateIssue(fixture, "#006", { pri: "p1" }));
  rejects("archived row cannot be re-prioritised", () => updateIssue(resolved, "#005", { pri: "P1" }));

  // queue (#M6JNR8): the recommended-execution-queue row is editable, and the
  // Order and ID(s) cells are not. Order is renumbered on every close, so a
  // writer that could set it would be writing a value the next close discards.
  const queueLine = (markdown, id) => {
    const parsed = parseIssues(markdown);
    const line = [...new Set((parsed.queueCitations ?? []).filter((c) => c.id === id).map((c) => c.line))][0];
    return splitCells(markdown.split("\n")[line - 1]);
  };
  const regraded = updateQueueRow(fixture, "#005", { acuity: "A3", when: "after the audit" });
  const regradedCells = queueLine(regraded, "#005");
  check("queue writes the Acuity cell", regradedCells[2] === "A3");
  check("queue writes the When cell", regradedCells[4] === "after the audit");
  check(
    "queue leaves Order, ID(s) and untouched columns alone",
    regradedCells[0] === "1" &&
      regradedCells[1] === "`#005`" &&
      regradedCells[3] === "High" &&
      regradedCells[5] === "1h" &&
      regradedCells[6] === "solo",
  );
  check(
    "queue does not touch the Open-items row",
    splitCells(parseIssues(regraded).rows.find((r) => r.id === "#005").raw)[1] === "P2",
  );

  // A composite ID(s) cell is one row shared by two issues; addressing it by
  // either cited id must reach the same row rather than only the first.
  const compositeByFirst = queueLine(updateQueueRow(fixture, "#013", { estimate: "2d" }), "#013");
  const compositeBySecond = queueLine(updateQueueRow(fixture, "#016", { estimate: "2d" }), "#016");
  check("queue reaches a composite row by its first id", compositeByFirst[5] === "2d");
  check("queue reaches a composite row by its second id", compositeBySecond[5] === "2d");
  check("queue keeps the composite ID(s) cell intact", compositeBySecond[1] === "`#013`, `#016`");

  // Escaping is the same hazard as everywhere else in this file: a bare pipe in
  // prose would silently become a column boundary.
  check("queue escapes pipes in new text", updateQueueRow(fixture, "#005", { outcome: "a | b" }).includes("a \\| b"));

  // Assert the MESSAGE, not merely that something threw. Without the explicit
  // "no queue row" guard the lookup still fails — on a NaN index, several frames
  // later, with a message about splitting undefined — so a bare rejects() here
  // passes whether or not the guard exists and pins nothing.
  const rejectsWith = (label, pattern, run) => {
    try {
      run();
      failures.push(`${label} should have thrown`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!pattern.test(message)) failures.push(`${label} threw the wrong error: ${message}`);
    }
  };
  rejectsWith("queue with no editable field", /--acuity/, () => updateQueueRow(fixture, "#005", {}));
  rejectsWith("queue for an id with no queue row", /no recommended-execution-queue row/, () =>
    updateQueueRow(fixture, "#008", { acuity: "A1" }),
  );
  // Order is not in the editable map, so passing it alone is "no editable field"
  // rather than a silent no-op write — and the queue row must be untouched.
  rejectsWith("queue refuses to set Order", /--acuity/, () => updateQueueRow(fixture, "#005", { order: "9" }));

  if (failures.length > 0) {
    console.error("outstanding-issues writer self-test FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("outstanding-issues writer self-test passed.");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const [command, positional] = argv;
  const issuesFile = path.resolve(process.cwd(), ISSUES_PATH);
  const markdown = readFileSync(issuesFile, "utf8");
  let next;

  try {
    if (command === "add") {
      next = addIssue(markdown, {
        pri: argValue(argv, "pri"),
        type: argValue(argv, "type"),
        summary: argValue(argv, "summary"),
        detail: argValue(argv, "detail"),
        source: argValue(argv, "source"),
      });
    } else if (command === "done") {
      const allowArchived = argv.includes("--allow-archived") || argv.includes("--merge-outcome");
      next = resolveIssue(markdown, positional, argValue(argv, "outcome"), {
        allowArchived,
        idempotent: argv.includes("--idempotent"),
      });
    } else if (command === "update") {
      next = updateIssue(markdown, positional, {
        pri: argValue(argv, "pri"),
        summary: argValue(argv, "summary"),
        detail: argValue(argv, "detail"),
        source: argValue(argv, "source"),
      });
    } else if (command === "queue") {
      next = updateQueueRow(markdown, positional, {
        acuity: argValue(argv, "acuity"),
        capability: argValue(argv, "capability"),
        when: argValue(argv, "when"),
        estimate: argValue(argv, "estimate"),
        outcome: argValue(argv, "outcome"),
      });
    } else {
      console.error("usage: outstanding-issues.mjs <add|done|update|queue> [id] [--flags]  (see file header)");
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error(`outstanding-issues: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  writeFileSync(issuesFile, next, "utf8");
  const parsed = parseIssues(next);
  const open = parsed.rows.filter((r) => r.table === "open").length;
  const archived = parsed.rows.filter((r) => r.table === "archive").length;
  console.log(`${ISSUES_PATH} updated: ${open} open, ${archived} archived, collision-free id allocation enabled.`);
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) main();
