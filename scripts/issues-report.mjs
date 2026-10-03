#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { parseIssues } from "./check-outstanding-issues.mjs";
import { issueIdCitations } from "./issue-id.mjs";
import { applyRequest, planRequestBatch } from "./ledger-inbox.mjs";
import { splitCells } from "./outstanding-issues.mjs";

const LEDGER_PATH = "docs/outstanding-issues.md";
const INBOX_DIR = "docs/outstanding-issues-inbox";
const APPLIED_DIR = `${INBOX_DIR}/applied`;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return undefined;
  }
}

function queueRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("## Recommended execution queue"));
  if (start < 0) return [];
  const rows = [];
  for (let index = start + 1; index < lines.length && !lines[index].startsWith("## "); index += 1) {
    if (!/^\|\s*\d+\s*\|/.test(lines[index])) continue;
    const cells = splitCells(lines[index]);
    if (cells.length !== 7) continue;
    rows.push({
      order: Number(cells[0]),
      ids: issueIdCitations(cells[1]),
      acuity: cells[2],
      capability: cells[3],
      when: cells[4],
      estimate: cells[5],
      outcome: cells[6],
    });
  }
  return rows;
}

function maximumHours(estimate) {
  if (/\b(?:day|week|month|blocked|corpus|provider-gated)\b/i.test(estimate)) return null;
  const hours = [...estimate.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*hours?/gi)];
  if (hours.length === 0) {
    const minutes = [...estimate.matchAll(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*min/gi)];
    return minutes.length ? Math.max(...minutes.map((match) => Number(match[2] ?? match[1]) / 60)) : null;
  }
  return Math.max(...hours.map((match) => Number(match[2] ?? match[1])));
}

export function classifyAgentSafeWins(rows) {
  return rows.filter((row) => {
    const combined = `${row.capability} ${row.when} ${row.estimate} ${row.outcome}`;
    const hours = maximumHours(row.estimate);
    return (
      hours !== null &&
      hours <= 4 &&
      !/\boperator\b/i.test(row.capability) &&
      !/\b(?:provider|live |production|staging|hosted.?ci|ci.?uploaded|human (?:decision|review)|owner decides?|approval|rag|retrieval|clinical|design.?owner|do not close automatically|the decision is a human|not for agents?|human.?only|requires? human|awaiting? (?:owner|human|operator)|operator decision)\b/i.test(
        combined,
      )
    );
  });
}

export function buildIssuesReport(markdown, source, options = {}) {
  const parsed = parseIssues(markdown);
  const queue = queueRows(markdown);
  let openRows = parsed.rows
    .filter((row) => row.table === "open")
    .map((row) => {
      const cells = splitCells(row.raw);
      return {
        // parseIssues strips the durable ULID comment from the human-facing id.
        id: row.id,
        priority: cells[1],
        type: cells[2],
        summary: cells[3],
        detail: cells[4],
        source: cells[5],
        added: cells[6],
      };
    });
  // Report each queue row's prose from the cited row's own Detail cell, and keep the
  // queue's own Outcome cell beside it as `gate` whenever the two differ. The two cells
  // were once independent copies of the same prose and drifted; because this report is
  // what /issues reads back, the drifted copy was the one acted on — the #231 queue cell
  // spent days pointing at an approach that row had already refuted. Since #M6JNR8 the
  // queue cell IS correctable in place (`npm run issues:queue -- '#id' --outcome "..."`)
  // and the issues skill tells operators to use it for re-grades, so dropping the cell
  // would silently discard those corrections. Detail stays the prose; the queue cell is
  // shown as the gate/stop condition. Order, acuity, capability, when and estimate stay
  // from the queue, which is the only place they exist.
  const detailById = new Map(openRows.map((row) => [row.id, row.detail]));
  let derived = queue.map((row) => {
    // A composite ID(s) cell has no single row to speak for it; keep the queue
    // text there rather than arbitrarily picking one of the cited rows.
    if (row.ids.length !== 1) return { ...row, gate: null };
    const detail = detailById.get(row.ids[0]);
    if (!detail) return { ...row, gate: null };
    return { ...row, outcome: detail, gate: row.outcome === detail ? null : row.outcome };
  });

  if (options.filter) {
    const term = String(options.filter).toLowerCase();
    const matches = (r) =>
      Boolean(
        (r.summary && String(r.summary).toLowerCase().includes(term)) ||
        (r.detail && String(r.detail).toLowerCase().includes(term)) ||
        (r.outcome && String(r.outcome).toLowerCase().includes(term)) ||
        (r.id && String(r.id).toLowerCase().includes(term)) ||
        (r.ids && r.ids.some((id) => String(id).toLowerCase().includes(term))),
      );
    const matchingOpenIds = new Set(openRows.filter(matches).map((r) => r.id));
    openRows = openRows.filter(matches);
    derived = derived.filter((row) => matches(row) || (row.ids && row.ids.some((id) => matchingOpenIds.has(id))));
  }

  return {
    source,
    counts: { open: openRows.length, recommended: derived.length },
    priorityBlockers: derived.filter((row) => row.acuity === "A1"),
    recommended: derived,
    open: openRows,
    // Keep queue-only stop conditions in the safe-win classifier. `derived` is
    // presentation text, while the queue outcome also carries safety gates that
    // may not appear in the cited row's Detail cell.
    agentSafeWins: classifyAgentSafeWins(queue),
  };
}

/** Pending inbox requests recorded at a git ref, read in one `git cat-file --batch` call. */
function inboxRequestsAtRef(ref, cwd) {
  const listing = tryGit(["ls-tree", "--name-only", `${ref}:${INBOX_DIR}`], cwd);
  if (!listing) return [];
  const names = listing
    .split(/\r?\n/)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length === 0) return [];
  let batch = "";
  try {
    batch = execFileSync("git", ["cat-file", "--batch"], {
      cwd,
      encoding: "utf8",
      input: names.map((name) => `${ref}:${INBOX_DIR}/${name}\n`).join(""),
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const requests = [];
  let offset = 0;
  while (offset < batch.length) {
    const headerEnd = batch.indexOf("\n", offset);
    if (headerEnd < 0) break;
    const header = batch.slice(offset, headerEnd).split(" ");
    offset = headerEnd + 1;
    if (header[1] !== "blob") continue;
    const size = Number(header[2]);
    const body = batch.slice(offset, offset + size);
    offset += size + 1;
    try {
      requests.push(JSON.parse(body));
    } catch {
      /* an unparseable request is reconcile's problem to report; skip it here */
    }
  }
  return requests;
}

/** Pending inbox requests present as files in the worktree. */
function inboxRequestsInWorktree(cwd, directory = INBOX_DIR) {
  const absolute = path.resolve(cwd, ...directory.split("/"));
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .flatMap((name) => {
      try {
        return [JSON.parse(readFileSync(path.join(absolute, name), "utf8"))];
      } catch {
        return [];
      }
    });
}

/**
 * Project the pending inbox onto the ledger the way `issues:reconcile` will, so rows
 * with a queued `done` are not read back as open work, queued `add`s are visible, and
 * queued `update`/`queue` corrections are honoured. Fails soft: if the batch cannot be
 * planned or applied, the raw ledger is returned with a warning rather than a guess.
 *
 * @param {string} markdown
 * @param {Array<object>} requests
 * @param {{ appliedRequests?: Map<string, object> }} [options]
 */
export function applyPendingInbox(markdown, requests, options = {}) {
  const counts = { add: 0, done: 0, update: 0, queue: 0, skipped: 0 };
  const pending = { counts, total: requests.length, applied: false, closingIds: [], warning: null };
  if (requests.length === 0) return { markdown, pending };
  try {
    const plan = planRequestBatch(requests, { appliedRequests: options.appliedRequests, warn: () => {} });
    // Cancellation requests and the requests they cancel are both "skipped".
    counts.skipped = requests.length - plan.active.length;
    let next = markdown;
    for (const request of plan.active) {
      next = applyRequest(next, request);
      counts[request.action] += 1;
      if (request.action === "done") pending.closingIds.push(request.payload.id);
    }
    pending.applied = true;
    return { markdown: next, pending };
  } catch (error) {
    pending.warning = `pending inbox (${requests.length} request(s)) could not be applied to this report: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return { markdown, pending };
  }
}

function pendingInboxRequests(cwd, ref) {
  const atRef = ref ? inboxRequestsAtRef(ref, cwd) : [];
  const seen = new Set(atRef.map((request) => request?.id));
  // A request queued in this worktree but not yet on origin/main is still pending work.
  const local = inboxRequestsInWorktree(cwd).filter((request) => request?.id && !seen.has(request.id));
  return [...atRef, ...local];
}

function appliedRequestsInWorktree(cwd) {
  return new Map(
    inboxRequestsInWorktree(cwd, APPLIED_DIR)
      .filter((request) => request?.id)
      .map((request) => [request.id, request]),
  );
}

export function loadRevalidatedLedger(cwd = process.cwd()) {
  const branch = tryGit(["branch", "--show-current"], cwd) || "(detached)";
  const counts = tryGit(["rev-list", "--left-right", "--count", "origin/main...HEAD"], cwd);
  const [behind, ahead] = counts ? counts.split(/\s+/).map(Number) : [null, null];
  const gitPath = LEDGER_PATH.replace(/\\/g, "/");
  const remoteLedger = tryGit(["show", `origin/main:${gitPath}`], cwd);
  if (remoteLedger !== undefined) {
    const projected = applyPendingInbox(remoteLedger, pendingInboxRequests(cwd, "origin/main"), {
      appliedRequests: appliedRequestsInWorktree(cwd),
    });
    return {
      markdown: projected.markdown,
      source: {
        ref: "origin/main (cached)",
        branch,
        behind,
        ahead,
        revalidated: false,
        warning:
          "origin/main is a local remote-tracking ref; refresh it explicitly before relying on current remote state",
        pending: projected.pending,
      },
    };
  }
  const localPath = path.resolve(cwd, ...gitPath.split("/"));
  let markdown = "";
  try {
    markdown = readFileSync(localPath, "utf8");
  } catch {
    markdown = readFileSync(fileURLToPath(new URL(`../${gitPath}`, import.meta.url)), "utf8");
  }
  const projected = applyPendingInbox(markdown, pendingInboxRequests(cwd, null), {
    appliedRequests: appliedRequestsInWorktree(cwd),
  });
  return {
    markdown: projected.markdown,
    source: {
      ref: "worktree",
      branch,
      behind,
      ahead,
      revalidated: false,
      warning: "origin/main is unavailable; this report may be stale",
      pending: projected.pending,
    },
  };
}

export function renderIssuesReport(report, winsOnly) {
  const { source, counts } = report;
  const lines = [];
  lines.push(
    `[issues] source=${source.ref} revalidated=${source.revalidated} branch=${source.branch} behind=${source.behind ?? "unknown"} ahead=${source.ahead ?? "unknown"}`,
  );
  if (source.warning) lines.push(`[issues] WARNING: ${source.warning}`);
  if (source.pending) {
    const { counts, total, applied, closingIds } = source.pending;
    if (source.pending.warning) lines.push(`[issues] WARNING: ${source.pending.warning}`);
    else if (total > 0) {
      const closing = closingIds.length ? ` (closing: ${closingIds.join(", ")})` : "";
      lines.push(
        `[issues] pending inbox ${applied ? "applied to this report" : "not applied"}: done=${counts.done} update=${counts.update} add=${counts.add} queue=${counts.queue} skipped (cancellations)=${counts.skipped}${closing} — run npm run issues:reconcile to land them`,
      );
    }
  }
  const rows = winsOnly ? report.agentSafeWins : report.recommended;
  lines.push(`[issues] open=${counts.open} recommended=${counts.recommended} shown=${rows.length}`);
  if (winsOnly && report.priorityBlockers.length) {
    lines.push(
      `[issues] A1 priority remains ahead of wins: ${report.priorityBlockers.map((row) => row.ids.join(",")).join(" ")}`,
    );
  }
  for (const row of rows) {
    lines.push(`${row.order}. ${row.ids.join(", ")} · ${row.acuity} · ${row.estimate} · ${row.outcome}`);
    if (row.gate) lines.push(`   gate/stop (queue cell): ${row.gate}`);
  }
  return lines.join("\n");
}

function render(report, winsOnly) {
  console.log(renderIssuesReport(report, winsOnly));
}

export function parseCliArgs(argv) {
  const flags = new Set();
  let filter = undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["--json", "--agent-safe-wins"].includes(arg)) {
      flags.add(arg);
    } else if (arg === "--filter") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new Error("Option '--filter' requires a non-empty value");
      }
      filter = next;
      i += 1;
    } else if (arg.startsWith("--filter=")) {
      const val = arg.slice("--filter=".length);
      if (!val) {
        throw new Error("Option '--filter' requires a non-empty value");
      }
      filter = val;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return {
    json: flags.has("--json"),
    winsOnly: flags.has("--agent-safe-wins"),
    filter,
  };
}

function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const { markdown, source } = loadRevalidatedLedger();
  const report = buildIssuesReport(markdown, source, options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else render(report, options.winsOnly);
}

const isDirectRun = isDirectEntrypoint(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(`[issues-report] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
