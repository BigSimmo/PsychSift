#!/usr/bin/env node
/**
 * Enforce the conflict-free ledger architecture at the Git boundary.
 *
 * - Branch-review history is immutable records; the historic table's dated rows
 *   must not change in ordinary PR work.
 * - Outstanding-issue mutations are a single serial transaction: pending JSON
 *   requests move to `applied/`, and the resulting canonical Markdown must be
 *   exactly what applying those requests to the base ledger produces.
 *
 * This is deliberately stronger than a shape check. A valid-looking manual
 * edit would still reintroduce the shared-hunk race that the inbox removes.
 *
 * Both comparison endpoints are commits, so an edit that is still sitting in
 * the working tree is invisible here and the audited range is empty. Reporting
 * a pass in that state told an author on 2026-08-13 that a forbidden hand-edit
 * of the canonical ledger was fine (issue #313). The gate therefore refuses to
 * report any verdict while a governed path is dirty — see dirtyGovernedPaths.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyRequestBatch, validateRequest } from "./ledger-inbox.mjs";
import { isAppliedRecordPath } from "./lib/inbox-archive.mjs";
import { parseLedgerRows } from "./branch-review-ledger.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEW_LEDGER = "docs/branch-review-ledger.md";
const ISSUES_LEDGER = "docs/outstanding-issues.md";
const INBOX = "docs/outstanding-issues-inbox";
const APPLIED = `${INBOX}/applied`;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * Untrimmed on purpose: porcelain's status field is two columns wide and its
 * first column is a space for an unstaged change, so trimming shifts every path
 * by one character and the governed-path match silently stops firing.
 */
function statusPorcelain(pathspecs) {
  return execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--", ...pathspecs], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function readAt(ref, relative) {
  return execFileSync("git", ["show", `${ref}:${relative}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function filesAt(ref, directory) {
  let names = "";
  try {
    names = git(["ls-tree", "-r", "--name-only", ref, "--", directory]);
  } catch {
    return new Map();
  }
  // Applied records may also sit in a quarter archive folder. They are keyed by file name, so an
  // archive move that keeps the content byte for byte passes the immutability rules below.
  const targets = names
    .split(/\r?\n/)
    .filter((name) =>
      directory === APPLIED
        ? isAppliedRecordPath(name)
        : name.endsWith(".json") && path.posix.dirname(name) === directory,
    );
  if (targets.length === 0) return new Map();

  const entries = new Map();
  const input = targets.map((f) => `${ref}:${f}`).join("\n") + "\n";
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    cwd: ROOT,
    input,
    maxBuffer: 100 * 1024 * 1024,
  });

  let offset = 0;
  for (const relative of targets) {
    const newlineIdx = raw.indexOf(10, offset);
    if (newlineIdx === -1) break;
    const header = raw.subarray(offset, newlineIdx).toString("utf8");
    const parts = header.split(" ");
    if (parts[1] !== "blob") {
      throw new Error(`failed to read ${ref}:${relative}: ${header}`);
    }
    const size = parseInt(parts[2], 10);
    const contentStart = newlineIdx + 1;
    const contentEnd = contentStart + size;
    const content = raw.subarray(contentStart, contentEnd).toString("utf8");
    offset = contentEnd + 1;
    const name = path.posix.basename(relative);
    if (entries.has(name)) throw new Error(`${name} appears more than once under ${directory} at ${ref}`);
    entries.set(name, content);
  }
  return entries;
}

function parsedRequests(entries, label) {
  const problems = [];
  const requests = new Map();
  for (const [name, text] of entries) {
    try {
      const request = JSON.parse(text);
      const requestProblems = validateRequest(request);
      if (requestProblems.length > 0) problems.push(`${label}/${name}: ${requestProblems.join("; ")}`);
      requests.set(name, request);
    } catch (error) {
      problems.push(`${label}/${name}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { requests, problems };
}

/**
 * Pure transaction verifier. Maps are keyed by one immutable UUID filename.
 * Exported for focused tests and the script self-test.
 */
export function verifyIssueReconciliation({
  baseIssues,
  headIssues,
  basePending,
  headPending,
  baseApplied,
  headApplied,
}) {
  const failures = [];
  const basePendingParsed = parsedRequests(basePending, INBOX);
  const headPendingParsed = parsedRequests(headPending, INBOX);
  const baseAppliedParsed = parsedRequests(baseApplied, APPLIED);
  const headAppliedParsed = parsedRequests(headApplied, APPLIED);
  failures.push(
    ...basePendingParsed.problems,
    ...headPendingParsed.problems,
    ...baseAppliedParsed.problems,
    ...headAppliedParsed.problems,
  );

  const moved = [];
  const retained = [];
  for (const [name, text] of basePending) {
    const targetPending = headPending.get(name);
    const targetApplied = headApplied.get(name);
    if (targetPending === text) {
      retained.push(name);
      continue;
    }
    if (targetPending !== undefined) {
      failures.push(`${INBOX}/${name} changed in place; requests are immutable.`);
      continue;
    }
    if (targetApplied !== text) {
      failures.push(`${INBOX}/${name} was removed without an identical ${APPLIED}/${name} audit record.`);
      continue;
    }
    moved.push(name);
  }

  for (const [name, text] of baseApplied) {
    if (headApplied.get(name) !== text)
      failures.push(`${APPLIED}/${name} changed or disappeared; applied records are immutable.`);
  }
  for (const [name, text] of headApplied) {
    if (!baseApplied.has(name) && basePending.get(name) !== text) {
      failures.push(`${APPLIED}/${name} was introduced without moving the identical pending request from the base.`);
    }
  }

  for (const [name] of headPending) {
    if (!basePending.has(name) && headApplied.has(name)) {
      failures.push(`${INBOX}/${name} exists in both pending and applied locations.`);
    }
  }

  if (moved.length > 0 && retained.length > 0) {
    failures.push(
      `reconciliation moved only part of the base inbox and left ${retained.length} request(s) pending: ${retained.join(", ")}. ` +
        "Process the complete batch and use an immutable cancel request for each rejected mutation.",
    );
  }

  if (failures.length > 0) return failures;
  let expected;
  try {
    const requests = moved.sort().map((name) => basePendingParsed.requests.get(name));
    expected = applyRequestBatch(baseIssues, requests).markdown;
  } catch (error) {
    failures.push(
      `queued reconciliation cannot be applied safely: ${error instanceof Error ? error.message : String(error)}`,
    );
    return failures;
  }
  if (expected !== headIssues) {
    failures.push(
      `${ISSUES_LEDGER} does not exactly match the audited application of ${moved.length} moved inbox request(s) from the base. ` +
        "Run npm run issues:reconcile from a fresh ledger branch; do not edit the canonical ledger directly.",
    );
  }
  return failures;
}

function governedReason(relative) {
  if (relative === ISSUES_LEDGER) return "the canonical outstanding-issues ledger";
  if (relative === REVIEW_LEDGER) return "the frozen branch-review ledger";
  if (relative === INBOX || relative.startsWith(`${INBOX}/`)) return "an outstanding-issues inbox request";
  return undefined;
}

/**
 * Governed paths carrying working-tree changes the committed-range audit cannot
 * see. Input is `git status --porcelain=v1 -z --untracked-files=normal` output;
 * NUL records avoid porcelain's quoting rules entirely, and a rename/copy record
 * is followed by a second field holding its original path.
 *
 * Pure and exported so the script self-test and focused tests can exercise it
 * without a fixture repository.
 */
export function dirtyGovernedPaths(porcelain) {
  const fields = String(porcelain ?? "").split("\0");
  const dirty = [];
  const seen = new Set();
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record.length < 4) continue; // trailing empty field, never a real record
    const status = record.slice(0, 2);
    const paths = [record.slice(3)];
    if (status[0] === "R" || status[0] === "C") {
      const origin = fields[index + 1];
      index += 1;
      if (origin) paths.push(origin);
    }
    for (const relative of paths) {
      const reason = governedReason(relative);
      if (reason === undefined || seen.has(relative)) continue;
      seen.add(relative);
      const change =
        status === "??" ? "is untracked" : `has an uncommitted change (${status.trim() || status.trimEnd()})`;
      dirty.push({ path: relative, status, reason: `${reason} ${change}` });
    }
  }
  return dirty;
}

export function reviewLedgerRowsChanged(baseMarkdown, headMarkdown) {
  const baseRows = parseLedgerRows(baseMarkdown).map((row) => row.raw);
  const headRows = parseLedgerRows(headMarkdown).map((row) => row.raw);
  return JSON.stringify(baseRows) !== JSON.stringify(headRows);
}

function resolveArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : "";
  };
  const requestedBase = value("--base") || process.env.LEDGER_WRITE_BASE_SHA || "";
  const requestedHead = value("--head") || "HEAD";
  if (requestedBase) return { base: requestedBase, head: requestedHead };
  try {
    return { base: git(["merge-base", "HEAD", "refs/remotes/origin/main"]), head: requestedHead };
  } catch {
    throw new Error("cannot resolve a comparison base; pass --base <commit> or fetch refs/remotes/origin/main");
  }
}

function selfTest() {
  const base = [
    "<!-- issues:next-id=2 -->",
    "",
    "## Recommended execution queue",
    "",
    "<!-- prettier-ignore -->",
    "",
    "| Order | ID(s) |",
    "| --- | --- |",
    "| 1 | `#001` |",
    "",
    "## Open items",
    "",
    "<!-- prettier-ignore -->",
    "",
    "| ID | Pri | Type | Summary | Detail / next action | Source | Added |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| #001 | P2 | issue | existing | detail | source | 2026-01-01 |",
    "",
    "## Resolved / archive",
    "",
    "<!-- prettier-ignore -->",
    "",
    "| ID | Type | Summary | Outcome | Resolved |",
    "| ---- | ---- | ---- | ---- | ---- |",
    "| #000 | issue | old | done | 2026-01-01 |",
    "",
  ].join("\n");
  const name = "11111111-1111-4111-8111-111111111111.json";
  const request = JSON.stringify({
    version: 1,
    id: name.slice(0, -5),
    createdOn: "2026-08-13",
    action: "add",
    payload: { pri: "P2", type: "issue", summary: "queued" },
  });
  const parsed = JSON.parse(request);
  const head = applyRequestBatch(base, [parsed]).markdown;
  const options = {
    baseIssues: base,
    headIssues: head,
    basePending: new Map([[name, request]]),
    headPending: new Map(),
    baseApplied: new Map(),
    headApplied: new Map([[name, request]]),
  };
  if (verifyIssueReconciliation(options).length !== 0)
    throw new Error("self-test failed: valid serial reconciliation rejected");
  if (verifyIssueReconciliation({ ...options, headIssues: base }).length === 0) {
    throw new Error("self-test failed: manual canonical edit accepted");
  }

  const doneName = "22222222-2222-4222-8222-222222222222.json";
  const updateName = "33333333-3333-4333-8333-333333333333.json";
  const cancelName = "44444444-4444-4444-8444-444444444444.json";
  const done = JSON.stringify({
    version: 1,
    id: doneName.slice(0, -5),
    createdOn: "2026-08-13",
    action: "done",
    payload: { id: "#001", outcome: "superseded" },
  });
  const update = JSON.stringify({
    version: 1,
    id: updateName.slice(0, -5),
    createdOn: "2026-08-13",
    action: "update",
    payload: { id: "#001", summary: "updated" },
  });
  const cancel = JSON.stringify({
    version: 1,
    id: cancelName.slice(0, -5),
    createdOn: "2026-08-13",
    action: "cancel",
    payload: { requestId: doneName.slice(0, -5), reason: "prefer the update" },
  });
  const cancellationRequests = [done, update, cancel].map(JSON.parse);
  const cancellationHead = applyRequestBatch(base, cancellationRequests).markdown;
  const cancellationOptions = {
    baseIssues: base,
    headIssues: cancellationHead,
    basePending: new Map([
      [doneName, done],
      [updateName, update],
      [cancelName, cancel],
    ]),
    headPending: new Map(),
    baseApplied: new Map(),
    headApplied: new Map([
      [doneName, done],
      [updateName, update],
      [cancelName, cancel],
    ]),
  };
  if (verifyIssueReconciliation(cancellationOptions).length !== 0) {
    throw new Error("self-test failed: audited cancellation reconciliation rejected");
  }
  const partial = verifyIssueReconciliation({
    ...cancellationOptions,
    headIssues: applyRequestBatch(base, [JSON.parse(update)]).markdown,
    headPending: new Map([
      [doneName, done],
      [cancelName, cancel],
    ]),
    headApplied: new Map([[updateName, update]]),
  });
  if (!partial.some((failure) => failure.includes("only part of the base inbox"))) {
    throw new Error("self-test failed: partial reconciliation was accepted");
  }

  // #313: the committed-range audit cannot see a working-tree edit, so a pass
  // reported over a dirty governed path is a green that evaluated nothing.
  if (dirtyGovernedPaths("").length !== 0) throw new Error("self-test failed: a clean worktree was reported dirty");
  const dirtyLedger = dirtyGovernedPaths(` M ${ISSUES_LEDGER}\0`);
  if (dirtyLedger.length !== 1 || dirtyLedger[0].path !== ISSUES_LEDGER) {
    throw new Error("self-test failed: an uncommitted canonical ledger edit was not detected");
  }
  if (dirtyGovernedPaths(`?? ${INBOX}/${name}\0`).length !== 1) {
    throw new Error("self-test failed: an untracked inbox request was not detected");
  }
  if (dirtyGovernedPaths(`R  ${APPLIED}/${name}\0${INBOX}/${name}\0`).length !== 2) {
    throw new Error("self-test failed: a renamed request did not report both of its paths");
  }
  if (dirtyGovernedPaths(" M src/lib/rag/rag.ts\0").length !== 0) {
    throw new Error("self-test failed: an unrelated dirty file was treated as a ledger violation");
  }

  const review = `| 2026-08-13 | codex/a | ${"a".repeat(40)} | review | pass | test |\n`;
  if (!reviewLedgerRowsChanged("", review) || reviewLedgerRowsChanged(review, review)) {
    throw new Error("self-test failed: legacy review row change detection is incorrect");
  }
  console.log("ledger write discipline self-test passed.");
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const { base, head } = resolveArgs(process.argv.slice(2));

  // Only when the head endpoint is the working checkout's tip. guard-push.mjs
  // passes an explicit committed --head at a moment when the tree is legitimately
  // dirty, and CI checks out clean, so neither is affected by this refusal.
  if (head === "HEAD") {
    const dirty = dirtyGovernedPaths(statusPorcelain([ISSUES_LEDGER, REVIEW_LEDGER, INBOX]));
    if (dirty.length > 0) {
      console.error("Ledger write-discipline check refused to report a verdict:");
      for (const entry of dirty) console.error(`- ${entry.path}: ${entry.reason}`);
      console.error(
        "\nThis gate compares two committed refs, so an uncommitted ledger edit is invisible to it and a pass " +
          "would mean nothing. Commit the change first — git add the inbox request if it is new — then re-run.",
      );
      process.exitCode = 1;
      return;
    }
  }

  const failures = [];
  const baseReview = readAt(base, REVIEW_LEDGER);
  const headReview = readAt(head, REVIEW_LEDGER);
  if (reviewLedgerRowsChanged(baseReview, headReview)) {
    failures.push(
      `${REVIEW_LEDGER} dated rows changed. Write review history with npm run ledger:append so each PR adds an immutable record file instead.`,
    );
  }

  const baseIssues = readAt(base, ISSUES_LEDGER);
  const headIssues = readAt(head, ISSUES_LEDGER);
  failures.push(
    ...verifyIssueReconciliation({
      baseIssues,
      headIssues,
      basePending: filesAt(base, INBOX),
      headPending: filesAt(head, INBOX),
      baseApplied: filesAt(base, APPLIED),
      headApplied: filesAt(head, APPLIED),
    }),
  );

  if (failures.length > 0) {
    console.error("Ledger write-discipline check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Ledger write discipline passed for ${base.slice(0, 12)}..${head.slice(0, 12)}.`);
}

if (process.argv[1]?.endsWith("check-ledger-write-discipline.mjs")) {
  try {
    main();
  } catch (error) {
    console.error(`Ledger write-discipline check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
