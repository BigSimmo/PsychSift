#!/usr/bin/env node
/**
 * check-ledger-stamp-retention — detect merge-loss and silent overwrites of
 * updated rows in docs/outstanding-issues.md across branch lifecycles (#311).
 *
 * Why this exists:
 * During multi-branch merges and rebases against main, manual merge conflict
 * resolutions occasionally take a stale side wholesale or silently drop
 * in-progress updates to open ledger rows. A hand-written list of rows is fragile
 * and easily misses entries; this tool derives the touched row IDs dynamically
 * from git history between the branch merge-base and HEAD, verifying that every
 * touched row still carries its branch stamp/content if it remains open.
 *
 * NOT wired into CI or verify:cheap — this is an on-demand branch safety check
 * designed to be run after syncing with main.
 *
 * Usage:
 *   npm run check:ledger-stamp-retention
 *   node scripts/check-ledger-stamp-retention.mjs --base origin/main
 *   node scripts/check-ledger-stamp-retention.mjs --since 2026-08-12
 *   node scripts/check-ledger-stamp-retention.mjs --self-test
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { canonicalLegacyIssueId, parseIssueIdCell } from "./issue-id.mjs";

export const ISSUES_PATH = "docs/outstanding-issues.md";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args, cwd = ROOT) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryGit(args, cwd = ROOT) {
  try {
    return git(args, cwd);
  } catch {
    return undefined;
  }
}

/**
 * Parses markdown table rows from docs/outstanding-issues.md.
 * Returns map of id -> { id, priority, kind, title, description, origin, date, section, raw }
 */
export function parseLedgerRows(content) {
  const rows = new Map();
  const lines = String(content ?? "").split(/\r?\n/);
  let currentSection = "preamble";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## Open items")) {
      currentSection = "open";
      continue;
    } else if (trimmed.startsWith("## Resolved / archive") || trimmed.startsWith("## Resolved")) {
      currentSection = "archive";
      continue;
    } else if (trimmed.startsWith("## Recommended execution queue")) {
      currentSection = "queue";
      continue;
    } else if (trimmed.startsWith("## ")) {
      currentSection = "other";
      continue;
    }

    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    // Skip separator and header rows
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue;

    const rawCells = trimmed.slice(1, -1).split(/(?<!\\)\|/);
    if (rawCells.length < 5) continue;

    const cells = rawCells.map((cell) => cell.trim());
    const idCell = cells[0] ?? "";
    if (idCell.toLowerCase() === "id" || idCell.toLowerCase() === "issue") continue;

    const parsedId = parseIssueIdCell(idCell);
    const key =
      parsedId.ulid ??
      (parsedId.number !== null && parsedId.number !== undefined
        ? canonicalLegacyIssueId(parsedId.number)
        : parsedId.id || idCell);

    rows.set(key, {
      id: key,
      rawId: idCell,
      priority: cells[1] ?? "",
      kind: cells[2] ?? "",
      title: cells[3] ?? "",
      description: cells[4] ?? "",
      origin: cells[5] ?? "",
      date: cells[6] ?? "",
      section: currentSection,
      raw: trimmed,
    });
  }

  return rows;
}

/**
 * Finds all row IDs touched on this branch between merge-base and HEAD.
 */
export function findBranchTouchedRowIds(baseRef = "origin/main", cwd = ROOT) {
  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"], cwd) || tryGit(["merge-base", "main", "HEAD"], cwd);
  if (!mergeBase) return new Set();

  const commitsRaw = tryGit(["rev-list", `${mergeBase}..HEAD`], cwd);
  if (!commitsRaw) return new Set();

  const commits = commitsRaw.split(/\r?\n/).filter((sha) => sha.trim().length > 0);
  const touchedIds = new Set();

  const baseContent = tryGit(["show", `${mergeBase}:${ISSUES_PATH}`], cwd);
  const baseRows = baseContent ? parseLedgerRows(baseContent) : new Map();

  for (const commit of commits) {
    const content = tryGit(["show", `${commit}:${ISSUES_PATH}`], cwd);
    if (!content) continue;
    const commitRows = parseLedgerRows(content);

    for (const id of new Set([...baseRows.keys(), ...commitRows.keys()])) {
      const baseRow = baseRows.get(id);
      const commitRow = commitRows.get(id);
      if (!baseRow || !commitRow || baseRow.raw !== commitRow.raw || baseRow.section !== commitRow.section) {
        touchedIds.add(id);
      }
    }
  }

  return touchedIds;
}

/**
 * Inspects whether touched rows on this branch retain their updates.
 */
export function checkLedgerStampRetention(options = {}) {
  const cwd = options.cwd ?? ROOT;
  const baseRef = options.baseRef ?? "origin/main";
  const since = options.since;
  const marker = options.marker;

  const currentPath = path.resolve(cwd, ISSUES_PATH);
  if (!existsSync(currentPath)) {
    return { ok: false, error: `Ledger file not found at ${currentPath}` };
  }

  const currentContent = readFileSync(currentPath, "utf8");
  const currentRows = parseLedgerRows(currentContent);

  const mergeBase = tryGit(["merge-base", baseRef, "HEAD"], cwd) || tryGit(["merge-base", "main", "HEAD"], cwd);
  if (!mergeBase) {
    return {
      ok: false,
      error: `Could not resolve a merge-base against "${baseRef}" or "main". Git history is unavailable, so this check cannot verify anything — it must not report a clean pass.`,
    };
  }

  const baseContent = tryGit(["show", `${mergeBase}:${ISSUES_PATH}`], cwd);
  const baseRows = baseContent ? parseLedgerRows(baseContent) : new Map();

  const touchedIds = options.touchedIds ?? findBranchTouchedRowIds(baseRef, cwd);
  const retained = [];
  const lost = [];
  const archived = [];

  for (const id of touchedIds) {
    const current = currentRows.get(id);
    const base = baseRows.get(id);

    if (!current) {
      lost.push({ id, reason: "Row completely missing from current ledger" });
      continue;
    }

    if (current.section === "archive") {
      archived.push(id);
      continue;
    }

    // If a marker is specified, verify current row contains it
    if (marker && !current.description.includes(marker) && !current.title.includes(marker)) {
      lost.push({ id, reason: `Missing required marker "${marker}"` });
      continue;
    }

    // If since date is specified, verify date >= since
    if (since && current.date && current.date < since) {
      lost.push({ id, reason: `Row date (${current.date}) is older than --since threshold (${since})` });
      continue;
    }

    // If base exists and current row reverted to base content
    if (
      base &&
      base.description === current.description &&
      base.title === current.title &&
      base.date === current.date
    ) {
      lost.push({ id, reason: "Row reverted exactly to base ref version" });
      continue;
    }

    retained.push(id);
  }

  return {
    ok: lost.length === 0,
    baseRef,
    mergeBase: mergeBase ?? null,
    totalTouched: touchedIds.size,
    retainedCount: retained.length,
    lostCount: lost.length,
    archivedCount: archived.length,
    retained,
    lost,
    archived,
  };
}

export function runSelfTest() {
  const sampleBase = `
## Open items
| ID | Pri | Type | Title | Description | Origin | Date |
| --- | --- | --- | --- | --- | --- | --- |
| #001 | P2 | task | Original Title | Original Description | src | 2026-08-01 |
| #002 | P2 | task | Kept Title | Kept Description | src | 2026-08-01 |
`;

  const sampleCurrentWithRevert = `
## Open items
| ID | Pri | Type | Title | Description | Origin | Date |
| --- | --- | --- | --- | --- | --- | --- |
| #001 | P2 | task | Original Title | Original Description | src | 2026-08-01 |
| #002 | P2 | task | Kept Title | Updated Description (2026-08-12) | src | 2026-08-12 |
`;

  const baseRows = parseLedgerRows(sampleBase);
  const currentRows = parseLedgerRows(sampleCurrentWithRevert);

  // If #001 was touched on branch but current matches base, it should report lost
  const touchedIds = new Set(["#001", "#002"]);
  const lost = [];
  const retained = [];

  for (const id of touchedIds) {
    const cur = currentRows.get(id);
    const bas = baseRows.get(id);
    if (bas && cur && bas.description === cur.description) {
      lost.push(id);
    } else {
      retained.push(id);
    }
  }

  if (lost.length !== 1 || lost[0] !== "#001" || retained.length !== 1 || retained[0] !== "#002") {
    throw new Error(
      `Self-test failed: expected lost=[#001], retained=[#002], got lost=${JSON.stringify(lost)}, retained=${JSON.stringify(retained)}`,
    );
  }

  console.log("check-ledger-stamp-retention: self-test passed.");
}

function parseArgs(args) {
  const options = { baseRef: "origin/main", strict: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--self-test") {
      runSelfTest();
      process.exit(0);
    }
    if (token === "--strict") {
      options.strict = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--base" || token === "--ref") {
      options.baseRef = args[index + 1];
      index += 1;
      continue;
    }
    if (token === "--since") {
      options.since = args[index + 1];
      index += 1;
      continue;
    }
    if (token === "--marker") {
      options.marker = args[index + 1];
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      console.log(
        "Usage: node scripts/check-ledger-stamp-retention.mjs [--base <ref>] [--since <date>] [--marker <text>] [--strict] [--json] [--self-test]",
      );
      process.exit(0);
    }
  }
  return options;
}

if (isDirectEntrypoint(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = checkLedgerStampRetention(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.error) {
    console.error(`Ledger stamp retention check could not run: ${result.error}`);
  } else if (result.ok) {
    console.log(
      `Ledger stamp retention OK: ${result.retainedCount} touched rows verified, ${result.archivedCount} archived, 0 lost.`,
    );
  } else {
    console.warn(`Ledger stamp retention findings (${result.lostCount} lost):`);
    for (const item of result.lost) {
      console.warn(`  - ${item.id}: ${item.reason}`);
    }
  }

  if (!result.ok && options.strict) {
    process.exit(1);
  }
}
