#!/usr/bin/env node
/**
 * Conflict-free intake for the outstanding-issues ledger.
 *
 * Feature branches write one immutable request file; only a deliberately serialized
 * `reconcile` operation edits docs/outstanding-issues.md. Add requests carry a
 * durable ULID, so independent branches no longer contend on a numeric marker.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { addIssue, resolveIssue, updateArchivedIssue, updateIssue, updateQueueRow } from "./outstanding-issues.mjs";
import {
  ISSUES_PATH,
  archiveRowFingerprint,
  checkIssues,
  issueRowFingerprint,
  isValidIssueRowFingerprint,
  parseIssues,
  queueRowFingerprint,
} from "./check-outstanding-issues.mjs";
import {
  displayIdForUlid,
  isIssueDisplayId,
  isIssueUlid,
  issueUlid,
  issueUlidFromRequest,
  normalizeIssueDisplayId,
} from "./issue-id.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INBOX_DIR = "docs/outstanding-issues-inbox";
const APPLIED_DIR = path.posix.join(INBOX_DIR, "applied");
const ACTIONS = new Set(["add", "done", "update", "amend-outcome", "queue", "cancel"]);
// Fields a `queue` request may carry, mirroring updateQueueRow's editable map.
const QUEUE_FIELDS = ["acuity", "capability", "when", "estimate", "outcome"];
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECONCILE_LOCK_NAME = "outstanding-issues-reconcile.lock";
const OWNERLESS_LOCK_GRACE_MS = 5 * 60 * 1000;
const RECONCILE_TRANSACTION_NAME = "transaction.json";
const RECONCILE_BACKUP_NAME = "ledger.before";

function date() {
  return new Date().toISOString().slice(0, 10);
}

function argValue(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function requestPath(id) {
  return path.posix.join(INBOX_DIR, `${id}.json`);
}

function readOutstandingIssues() {
  return readFileSync(path.join(ROOT, ISSUES_PATH), "utf8");
}

function validateFingerprint(payload, action, problems) {
  if (payload?.baseRowFingerprint !== undefined && !isValidIssueRowFingerprint(payload.baseRowFingerprint)) {
    problems.push(`${action} requires a valid baseRowFingerprint`);
  }
}

function validateAddRequest(request, problems) {
  for (const field of ["pri", "type", "summary"]) {
    if (!request.payload?.[field]) problems.push(`add requires ${field}`);
  }
  if (request.payload?.pri && !["P1", "P2", "P3"].includes(String(request.payload.pri))) {
    problems.push("add pri must be P1, P2, or P3");
  }
  if (request.payload?.type && !["task", "issue", "rec"].includes(String(request.payload.type))) {
    problems.push("add type must be task, issue, or rec");
  }
  if (request.payload?.issueUlid !== undefined && !isIssueUlid(request.payload.issueUlid)) {
    problems.push("add issueUlid must be a valid ULID");
  }
  if (request.version === 2 && request.payload?.issueUlid === undefined) {
    problems.push("version 2 add requires a valid issueUlid");
  }
}

function validateDoneRequest(payload, problems) {
  if (!isIssueDisplayId(payload?.id)) problems.push("done requires a canonical issue display id");
  if (!payload?.outcome) problems.push("done requires outcome");
  validateFingerprint(payload, "done", problems);
  if (payload?.targetUlid !== undefined && !isIssueUlid(payload.targetUlid)) {
    problems.push("done targetUlid must be a valid ULID");
  }
}

function validateUpdateRequest(action, payload, problems) {
  if (!isIssueDisplayId(payload?.id)) {
    problems.push(`${action} requires a canonical issue display id`);
  }
  if (action === "amend-outcome") {
    if (!payload?.outcome) problems.push("amend-outcome requires outcome");
  } else {
    const openFields = ["pri", "summary", "detail", "source"].filter((field) => payload?.[field] !== undefined);
    const hasOutcome = payload?.outcome !== undefined;
    if (hasOutcome && openFields.length > 0) {
      problems.push("update cannot mix outcome with pri, summary, detail, or source");
    } else if (!hasOutcome && openFields.length === 0) {
      problems.push("update requires pri, summary, detail, source, or outcome");
    }
  }
  validateFingerprint(payload, action, problems);
  if (payload?.pri !== undefined && !["P1", "P2", "P3"].includes(String(payload.pri))) {
    problems.push("update pri must be P1, P2, or P3");
  }
  if (payload?.targetUlid !== undefined && !isIssueUlid(payload.targetUlid)) {
    problems.push("update targetUlid must be a valid ULID");
  }
}

function validateQueueRequest(payload, problems) {
  if (!isIssueDisplayId(payload?.id)) problems.push("queue requires a canonical issue display id");
  // A queue re-grade is usually exactly one cell (acuity), so requiring any
  // one field rather than a prose field keeps the common correction — the
  // #M6JNR8 instance — expressible without inventing filler text.
  if (!QUEUE_FIELDS.some((field) => payload?.[field] !== undefined)) {
    problems.push(`queue requires one of ${QUEUE_FIELDS.join(", ")}`);
  }
  validateFingerprint(payload, "queue", problems);
  if (payload?.targetUlid !== undefined && !isIssueUlid(payload.targetUlid)) {
    problems.push("queue targetUlid must be a valid ULID");
  }
}

function validateCancelRequest(payload, problems) {
  if (!REQUEST_ID.test(payload?.requestId ?? "")) {
    problems.push("cancel requires a pending request UUID");
  }
  if (!String(payload?.reason ?? "").trim()) problems.push("cancel requires reason");
}

export function validateRequest(request) {
  const problems = [];
  if (!request || typeof request !== "object") return ["request must be an object"];
  if (![1, 2].includes(request.version)) problems.push("version must be 1 or 2");
  if (!REQUEST_ID.test(request.id ?? "")) problems.push("id must be a UUID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.createdOn ?? "")) problems.push("createdOn must be YYYY-MM-DD");
  if (!ACTIONS.has(request.action)) problems.push("action must be add, done, update, queue, or cancel");
  if (!request.payload || typeof request.payload !== "object") problems.push("payload must be an object");
  if (request.action === "add") validateAddRequest(request, problems);
  if (request.action === "done") validateDoneRequest(request.payload, problems);
  if (request.action === "update" || request.action === "amend-outcome") {
    validateUpdateRequest(request.action, request.payload, problems);
  }
  if (request.action === "queue") validateQueueRequest(request.payload, problems);
  if (request.action === "cancel") validateCancelRequest(request.payload, problems);
  return problems;
}

function isOutcomeAmendment(request) {
  return request.action === "amend-outcome" || (request.action === "update" && request.payload?.outcome);
}

function findIssueRow(markdown, id, tables) {
  const targetId = normalizeIssueDisplayId(id);
  return parseIssues(markdown).rows.find(
    (row) => normalizeIssueDisplayId(row.id) === targetId && tables.includes(row.table),
  );
}

function assertOutcomeAmendmentTarget(markdown, request) {
  if (!isOutcomeAmendment(request)) return;
  const target = findIssueRow(markdown, request.payload.id, ["open", "archive"]);
  if (target?.table === "open") {
    throw new Error(
      `${request.action} outcome amendments require an archived issue; ${request.payload.id} is still open`,
    );
  }
}

function assertCurrentQueueFingerprint(markdown, request) {
  if (request.action !== "queue" || !request.payload?.baseRowFingerprint) return;
  const id = request.payload.id;
  const fingerprint = queueRowFingerprint(markdown, id);
  if (!fingerprint) {
    throw new Error(
      `${id} no longer has exactly one queue row; reread and reissue this request from the latest ledger`,
    );
  }
  if (fingerprint !== String(request.payload.baseRowFingerprint).toLowerCase()) {
    throw new Error(
      `${id} queue row is stale: it changed after this request was queued; reread and reissue from the latest ledger`,
    );
  }
}

function isArchivedIssue(markdown, id) {
  return Boolean(findIssueRow(markdown, id, ["archive"]));
}

function shouldKeepArchivedMarkdown(markdown, request, options, allowArchived) {
  if (!options.idempotent || !["done", "update", "amend-outcome"].includes(request.action) || allowArchived) {
    return false;
  }
  const id = request.payload?.id;
  if (typeof id !== "string" || !isArchivedIssue(markdown, id)) return false;
  return (request.action === "update" && !request.payload?.outcome) || request.action === "done";
}

function verifyIssueFingerprint(markdown, request, allowArchived) {
  if (!["done", "update", "amend-outcome"].includes(request.action) || !request.payload?.baseRowFingerprint) {
    return allowArchived;
  }
  const id = request.payload.id;
  let fingerprint = issueRowFingerprint(markdown, id);
  if (!fingerprint) {
    if (!isArchivedIssue(markdown, id)) {
      throw new Error(`${id} is no longer open; reread and reissue this request from the latest ledger`);
    }
    if (request.action === "done") {
      allowArchived = true;
    } else {
      fingerprint = archiveRowFingerprint(markdown, id);
    }
  }
  if (fingerprint && fingerprint !== String(request.payload.baseRowFingerprint).toLowerCase()) {
    throw new Error(
      `${id} is stale: the ledger row changed after this request was queued; reread and reissue from the latest ledger`,
    );
  }
  return allowArchived;
}

function applyValidatedRequest(markdown, request, options, dateOptions, allowArchived) {
  if (request.action === "add") {
    const durableId = request.payload.issueUlid ?? issueUlidFromRequest(request.createdOn, request.id);
    return addIssue(markdown, request.payload, { ...dateOptions, issueUlid: durableId });
  }
  if (request.action === "done") {
    return resolveIssue(markdown, request.payload.id, request.payload.outcome, {
      ...dateOptions,
      allowArchived,
      idempotent: Boolean(options.idempotent),
    });
  }
  if (request.action === "queue") return updateQueueRow(markdown, request.payload.id, request.payload);
  if (isOutcomeAmendment(request)) {
    if (isArchivedIssue(markdown, request.payload.id)) {
      return updateArchivedIssue(markdown, request.payload.id, request.payload.outcome, {
        ...dateOptions,
        replace: Boolean(options.replace ?? request.payload.replace),
      });
    }
    throw new Error(`${request.payload.id} is not archived; outcome amendments require an archived issue`);
  }
  return updateIssue(markdown, request.payload.id, request.payload);
}

export function applyRequest(markdown, request, options = {}) {
  const problems = validateRequest(request);
  if (problems.length > 0) throw new Error(problems.join("; "));
  if (request.action === "cancel") {
    throw new Error("cancel requests must be applied through batch reconciliation");
  }
  assertOutcomeAmendmentTarget(markdown, request);
  const dateOptions = { ...options, date: request.createdOn };
  assertCurrentQueueFingerprint(markdown, request);
  const allowArchived = Boolean(options.allowArchived ?? request.payload?.allowArchived);
  // Do NOT auto-allow every done-against-archive: without explicit allowArchived
  // (createRequest sets it) or a fingerprint race, archived targets must keep
  // throwing (non-idempotent) or no-oping (idempotent) for ledger integrity.
  if (shouldKeepArchivedMarkdown(markdown, request, options, allowArchived)) return markdown;
  const autoAllowArchived = verifyIssueFingerprint(markdown, request, allowArchived);
  return applyValidatedRequest(markdown, request, options, dateOptions, autoAllowArchived);
}

function mutationTargets(request, addUlids = new Set()) {
  if (request.action === "add" || request.action === "cancel") return [];
  const targetUlid = request.payload?.targetUlid;
  const isPendingAddTarget = targetUlid && addUlids.has(targetUlid);
  const id = isPendingAddTarget ? `ulid:${targetUlid}` : normalizeIssueDisplayId(request.payload.id);
  // Key by the rows a request actually mutates. `update` changes only the
  // Open-items row and `queue` changes only its queue row, so they can safely
  // share a batch. `done` moves the Open-items row *and* prunes its queue
  // citation, so it conflicts with either action on the same issue.
  if (request.action === "done") return [id, `queue ${id}`];
  return [request.action === "queue" ? `queue ${id}` : id];
}

function requestsByMutationTarget(requests, addUlids = new Set()) {
  const byTarget = new Map();
  for (const request of requests) {
    for (const target of mutationTargets(request, addUlids)) {
      const entries = byTarget.get(target) ?? [];
      entries.push(request);
      byTarget.set(target, entries);
    }
  }
  return byTarget;
}

function mutationConflicts(requests, addUlids = new Set()) {
  const conflicts = [];
  for (const [target, targetRequests] of requestsByMutationTarget(requests, addUlids).entries()) {
    if (targetRequests.length <= 1) continue;
    // Duplicate closes are batch-aware: after the first archives the row, later
    // closes append their outcomes. Archive amendments retain their original
    // fingerprint, so concurrent amendments must instead require cancellation.
    if (targetRequests.every((r) => r.action === "done")) continue;
    conflicts.push([target, targetRequests.map((r) => r.id)]);
  }
  return conflicts;
}

function indexRequests(requests) {
  const byId = new Map();
  for (const request of requests) {
    const problems = validateRequest(request);
    if (problems.length > 0) throw new Error(`${request?.id ?? "unknown request"}: ${problems.join("; ")}`);
    if (byId.has(request.id)) throw new Error(`duplicate immutable request id: ${request.id}`);
    byId.set(request.id, request);
  }
  return byId;
}

function recordIneffectiveCancellation(request, appliedTarget, ineffective, warn) {
  if (appliedTarget.action === "cancel") {
    throw new Error(`cancel request ${request.id} cannot cancel another cancellation request`);
  }
  ineffective.push({ requestId: request.id, targetId: request.payload.requestId });
  warn(
    `ledger inbox: cancel request ${request.id} did not take effect — its target ` +
      `${request.payload.requestId} was already applied by an earlier reconciliation. ` +
      `The cancellation is recorded but changed nothing; correct the affected row with a new update request.`,
  );
}

function recordPendingCancellation(request, target, cancelledIds, cancellations) {
  if (target.action === "cancel") {
    throw new Error(`cancel request ${request.id} cannot cancel another cancellation request`);
  }
  if (cancelledIds.has(target.id)) {
    throw new Error(`pending request ${target.id} is cancelled more than once`);
  }
  cancelledIds.add(target.id);
  cancellations.push({
    requestId: request.id,
    targetId: target.id,
    reason: String(request.payload.reason).trim(),
  });
}

function planCancellations(requests, byId, applied, warn) {
  const cancelledIds = new Set();
  const cancellations = [];
  const ineffective = [];
  for (const request of requests) {
    if (request.action !== "cancel") continue;
    const target = byId.get(request.payload.requestId);
    if (target) {
      recordPendingCancellation(request, target, cancelledIds, cancellations);
      continue;
    }
    const appliedTarget = applied.get(request.payload.requestId);
    if (!appliedTarget) {
      throw new Error(`cancel request ${request.id} targets missing pending request ${request.payload.requestId}`);
    }
    // Lost the race. Say so plainly: the correction this cancellation was
    // protecting did NOT take effect, and whoever queued it needs to fix the
    // row with a fresh update rather than assume the cancel did its job.
    recordIneffectiveCancellation(request, appliedTarget, ineffective, warn);
  }
  return { cancelledIds, cancellations, ineffective };
}

/**
 * Ids of requests that a previous reconciliation already applied. Used to tell a
 * cancellation that lost a race (its target landed via another branch's batch)
 * apart from one that names a request which never existed.
 */
function appliedRequestsById() {
  try {
    return new Map(
      loadRequestsIn(APPLIED_DIR)
        .map((entry) => entry.request)
        .filter((request) => request?.id)
        .map((request) => [request.id, request]),
    );
  } catch {
    return new Map();
  }
}

/**
 * Resolve immutable cancellation decisions before applying a pending request batch.
 * A cancellation request is itself retained in the applied audit trail, while the
 * targeted request is moved unchanged but deliberately not applied to the ledger.
 *
 * Parallel reconciliations are normal here: several branches queue requests and one
 * of them reconciles first. A cancellation whose target was applied by that earlier
 * batch has therefore *failed* — but throwing would wedge every consumer of this
 * function (check:docs-links, check:ledger-write-discipline and reconcile itself)
 * with no legal way out, because write discipline forbids deleting the queued file.
 * So an already-applied target is reported loudly and skipped rather than fatal; a
 * genuinely unknown target still throws.
 *
 * @param {Array<object>} requests pending requests in the batch
 * @param {{ appliedRequests?: Map<string, object>, warn?: (message: string) => void }} [options]
 */
export function planRequestBatch(requests, options = {}) {
  const applied = options.appliedRequests ?? appliedRequestsById();
  const warn = options.warn ?? ((message) => console.warn(message));
  const byId = indexRequests(requests);
  const { cancelledIds, cancellations, ineffective } = planCancellations(requests, byId, applied, warn);

  // Adds go first (stable otherwise): a close/update may target the issue a pending add creates
  // (attachIssueFingerprint accepts that), and filename order would otherwise let a mutation whose
  // UUID sorts first reach a row that does not exist yet and abort the whole batch.
  const remaining = requests.filter((request) => request.action !== "cancel" && !cancelledIds.has(request.id));
  const active = [
    ...remaining.filter((request) => request.action === "add"),
    ...remaining.filter((request) => request.action !== "add"),
  ];

  const addRequests = active.filter((request) => request.action === "add");
  const addsByPrefix = new Map();
  const addUlids = new Set();
  for (const add of addRequests) {
    const ulid = add.payload?.issueUlid ?? issueUlidFromRequest(add.createdOn, add.id);
    addUlids.add(ulid);
    const prefix = displayIdForUlid(ulid);
    const list = addsByPrefix.get(prefix) ?? [];
    list.push({ request: add, ulid });
    addsByPrefix.set(prefix, list);
  }

  for (const mutation of active.filter((request) => request.action !== "add")) {
    const targetDisplayId = normalizeIssueDisplayId(mutation.payload?.id);
    const matchingAdds = addsByPrefix.get(targetDisplayId) ?? [];
    if (matchingAdds.length > 1) {
      if (!mutation.payload?.targetUlid) {
        throw new Error(
          `mutation ${mutation.id} targets ambiguous display ID ${mutation.payload?.id}; multiple pending adds share this prefix. Specify targetUlid to disambiguate.`,
        );
      }
      const match = matchingAdds.find((a) => a.ulid === mutation.payload.targetUlid);
      if (!match) {
        throw new Error(
          `mutation ${mutation.id} targets ULID ${mutation.payload.targetUlid} which does not match any pending add with prefix ${targetDisplayId}`,
        );
      }
    } else if (matchingAdds.length === 1 && !mutation.payload?.baseRowFingerprint) {
      if (!mutation.payload?.targetUlid) {
        mutation.payload.targetUlid = matchingAdds[0].ulid;
      }
    }
  }

  const conflicts = mutationConflicts(active, addUlids);
  if (conflicts.length > 0) {
    const detail = conflicts.map(([id, requestIds]) => `${id}: ${requestIds.join(", ")}`).join("; ");
    throw new Error(
      `multiple pending mutations require an explicit cancellation decision (${detail}). ` +
        'Queue `node scripts/ledger-inbox.mjs cancel <request-uuid> --reason "<why>"` for each rejected mutation, land it, then reconcile again.',
    );
  }

  return { active, cancellations, cancelledIds: [...cancelledIds], ineffectiveCancellations: ineffective };
}

export function applyRequestBatch(markdown, requests, options = {}) {
  const plan = planRequestBatch(requests, options);
  let next = markdown;
  const closedInBatch = new Set();
  const ulidToDisplayId = new Map();

  for (const row of parseIssues(markdown).rows) {
    if (row.ulid && row.id) {
      ulidToDisplayId.set(row.ulid, normalizeIssueDisplayId(row.id));
    }
  }

  for (const request of plan.active) {
    if (request.action === "add") {
      const durableId = request.payload?.issueUlid ?? issueUlidFromRequest(request.createdOn, request.id);
      next = applyRequest(next, request, {
        ...options,
        idempotent: true,
        onAllocated: ({ id, ulid }) => {
          if (ulid && id) ulidToDisplayId.set(ulid, normalizeIssueDisplayId(id));
        },
      });
      if (!ulidToDisplayId.has(durableId)) {
        const addedRow = parseIssues(next).rows.find((r) => r.ulid === durableId);
        if (addedRow?.id) {
          ulidToDisplayId.set(durableId, normalizeIssueDisplayId(addedRow.id));
        }
      }
    } else {
      if (request.payload?.targetUlid && ulidToDisplayId.has(request.payload.targetUlid)) {
        request.payload.id = ulidToDisplayId.get(request.payload.targetUlid);
      }
      const id = normalizeIssueDisplayId(request.payload?.id);
      const isDuplicateClose = request.action === "done" && id && closedInBatch.has(id);
      // Honor payload.allowArchived from createRequest. Passing a literal false
      // would shadow it via `options.allowArchived ?? payload.allowArchived` and
      // reintroduce the silent idempotent omit for archive-aware closes.
      next = applyRequest(next, request, {
        ...options,
        idempotent: true,
        allowArchived: Boolean(options.allowArchived || isDuplicateClose || request.payload?.allowArchived),
      });
      if (request.action === "done" && id) {
        closedInBatch.add(id);
      }
    }
  }
  return { markdown: next, ...plan };
}

function loadPending() {
  return loadRequestsIn(INBOX_DIR);
}

function loadRequestsIn(directory) {
  const absolute = path.join(ROOT, directory);
  if (!existsSync(absolute)) return [];
  const files = readdirSync(absolute)
    .filter((name) => name.endsWith(".json"))
    .sort();
  return files.map((name) => {
    const relative = path.posix.join(directory, name);
    try {
      return { relative, request: JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) };
    } catch (error) {
      return { relative, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function allRequestEntries() {
  return [...loadPending(), ...loadRequestsIn(APPLIED_DIR)];
}

function canonicalLedgerIsClean() {
  for (const args of [
    ["diff", "--quiet", "--", ISSUES_PATH],
    ["diff", "--cached", "--quiet", "--", ISSUES_PATH],
  ]) {
    try {
      execFileSync("git", args, { cwd: ROOT, stdio: "ignore" });
    } catch {
      return false;
    }
  }
  return true;
}

function pendingRequestsAreTrackedAndClean(pending) {
  for (const entry of pending) {
    try {
      git(["ls-files", "--error-unmatch", "--", entry.relative]);
      git(["diff", "--quiet", "HEAD", "--", entry.relative]);
    } catch {
      throw new Error(
        `pending request ${entry.relative} is untracked or modified; commit the immutable request before reconciliation`,
      );
    }
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function processIsAlive(pid) {
  const numericPid = typeof pid === "string" && /^\d+$/.test(pid) ? Number(pid) : pid;
  if (!Number.isSafeInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function reconcileLockPath() {
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return path.join(commonDir, RECONCILE_LOCK_NAME);
}

function recoverReconcileTransaction(lockPath) {
  const transactionPath = path.join(lockPath, RECONCILE_TRANSACTION_NAME);
  if (!existsSync(transactionPath)) return false;
  const journal = JSON.parse(readFileSync(transactionPath, "utf8"));
  const backupPath = path.join(lockPath, journal.backup ?? RECONCILE_BACKUP_NAME);
  if (!existsSync(backupPath) || !Array.isArray(journal.pending)) {
    throw new Error(`incomplete reconciliation journal at ${transactionPath}; refusing automatic recovery`);
  }

  writeFileSync(path.join(ROOT, ISSUES_PATH), readFileSync(backupPath, "utf8"), "utf8");
  for (const relative of journal.pending) {
    const pendingPath = path.join(ROOT, relative);
    const appliedPath = path.join(ROOT, APPLIED_DIR, path.basename(relative));
    if (!existsSync(pendingPath) && existsSync(appliedPath)) renameSync(appliedPath, pendingPath);
  }
  rmSync(transactionPath, { force: true });
  rmSync(backupPath, { force: true });
  return true;
}

function createReconcileLock(lockPath) {
  mkdirSync(lockPath);
  const owner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    purpose: "outstanding-issues reconciliation",
  };
  writeFileSync(path.join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
  return owner;
}

function readReconcileLockOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    // The directory creation is atomic, but owner.json is written immediately
    // after it. Give an ownerless lock a short grace period before recovery so
    // a concurrent process cannot be mistaken for a crashed one.
    return null;
  }
}

function reconcileLockAge(lockPath) {
  try {
    return Math.max(0, Date.now() - statSync(lockPath).mtimeMs);
  } catch {
    throw new Error(`could not inspect reconciliation lock at ${lockPath}`);
  }
}

function recoverStaleReconcileLock(lockPath, recoverTransaction) {
  const owner = readReconcileLockOwner(lockPath);
  if (!owner && reconcileLockAge(lockPath) < OWNERLESS_LOCK_GRACE_MS) {
    throw new Error(`reconciliation lock at ${lockPath} is still initializing; retry after it completes`);
  }
  if (owner && processIsAlive(owner.pid)) {
    throw new Error(
      `another reconciliation is active at ${lockPath}${owner?.pid ? ` (PID ${owner.pid})` : ""}; retry after it completes`,
    );
  }
  try {
    recoverTransaction(lockPath);
  } catch (recoveryError) {
    throw new Error(`stale reconciliation requires recovery before retry: ${recoveryError.message}`);
  }
  rmSync(lockPath, { recursive: true, force: true });
}

export function acquireReconcileLock({
  lockPath = reconcileLockPath(),
  recoverTransaction = recoverReconcileTransaction,
} = {}) {
  // Every acquirer uses this atomic admission claim, including callers that
  // find no existing lock. A stale recoverer cannot remove a replacement lock
  // created between another recoverer's ownership check and directory removal.
  const admissionPath = `${lockPath}.admission`;
  try {
    mkdirSync(admissionPath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    throw new Error(
      `reconciliation admission is already claimed at ${admissionPath}; retry after release or obtain reviewed recovery`,
    );
  }
  try {
    writeFileSync(path.join(admissionPath, "owner.json"), `${JSON.stringify({ pid: process.pid })}\n`, "utf8");
    try {
      createReconcileLock(lockPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      recoverStaleReconcileLock(lockPath, recoverTransaction);
      try {
        createReconcileLock(lockPath);
      } catch (retryError) {
        throw new Error(`could not acquire reconciliation lock at ${lockPath}: ${retryError.message}`);
      }
    }
  } finally {
    rmSync(admissionPath, { recursive: true, force: true });
  }
  return () => rmSync(lockPath, { recursive: true, force: true });
}

function assertFreshReconciliationBase() {
  let originMain;
  try {
    originMain = git(["rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
  } catch {
    throw new Error(
      "reconciliation requires a fetched refs/remotes/origin/main; fetch first and start from that exact base",
    );
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", originMain, "HEAD"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    throw new Error(
      `reconciliation HEAD does not include the fetched origin/main (${originMain.slice(0, 12)}); merge or rebase it first to avoid a canonical-ledger conflict`,
    );
  }
}

/**
 * Detect whether another unmerged branch on `origin` carries inbox
 * reconciliations (applied inbox records under `docs/outstanding-issues-inbox/applied/`).
 *
 * This provides a pre-flight remote interlock so concurrent `issues:reconcile`
 * branches are not created simultaneously against the same base (issue #EH9VA6).
 *
 * When offline or when git ls-remote fails, it fails open (returns an empty list)
 * so offline workflows and tests are not blocked.
 *
 * @param {{
 *   lsRemoteOutput?: string,
 *   runner?: (args: string[], options?: {input?: string}) => string,
 *   originRef?: string,
 *   currentBranch?: string,
 *   warn?: (message: string) => void,
 *   strictRemote?: boolean,
 *   expectedSource?: {branch: string, sha: string}
 * }} [options]
 * @returns {Array<{ branch: string, sha: string, unmergedCount?: number, reason: string }>}
 */
function remoteGitRunner(options) {
  return (
    options.runner ??
    ((args, executionOptions = {}) =>
      execFileSync("git", args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: [executionOptions.input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
        ...executionOptions,
      }).trim())
  );
}

function readRemoteHeads(options, runner) {
  if (options.lsRemoteOutput !== undefined) return options.lsRemoteOutput;
  try {
    return runner(["ls-remote", "--heads", "origin"]);
  } catch {
    if (options.strictRemote)
      throw new Error("remote branch status is unavailable; preserved-source admission is blocked");
    // Offline or network error: fail open safely.
    return null;
  }
}

function readCurrentBranch(options, runner) {
  if (options.currentBranch !== undefined) return options.currentBranch;
  try {
    return runner(["branch", "--show-current"]).trim();
  } catch {
    return "";
  }
}

function parseRemoteCandidates(lsRemoteText, currentBranch, strictRemote = false) {
  const lines = lsRemoteText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const candidateBranches = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const sha = parts[0];
    const ref = parts[1];
    const branchName = ref.replace(/^refs\/heads\//, "");
    if (!/^[0-9a-f]{40}$/i.test(sha)) continue;
    if (
      branchName === "main" ||
      (!strictRemote && branchName === "master") ||
      (currentBranch && branchName === currentBranch)
    )
      continue;
    candidateBranches.push({ branch: branchName, sha });
  }
  return candidateBranches;
}

function readMainAppliedPaths(originMainRef) {
  try {
    const mainTree = execFileSync("git", ["ls-tree", "-r", "--name-only", originMainRef, "--", APPLIED_DIR], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return new Set(
      mainTree
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } catch {
    // If originMainRef cannot be inspected, fail open for tree diffs
    return new Set();
  }
}

function locallyAvailableCommitShas(shasToCheck) {
  const localShas = new Set();
  try {
    const checkOutput = execFileSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      cwd: ROOT,
      input: shasToCheck.join("\n") + "\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const entry of checkOutput.split("\n")) {
      const [sha, type] = entry.trim().split(" ");
      if (type === "commit") localShas.add(sha);
    }
  } catch {
    // If batch-check fails, fallback
  }
  return localShas;
}

function suspiciousAppliedCommits(originMainRef, presentShas, mainApplied) {
  if (presentShas.length === 0) return new Set();
  try {
    const logArgs = [
      "log",
      "--format=COMMIT:%H",
      "--name-only",
      `^${originMainRef}`,
      ...presentShas,
      "--",
      APPLIED_DIR,
    ];
    const logOutput = execFileSync("git", logArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const suspicious = new Set();
    for (const block of logOutput.split("COMMIT:").filter(Boolean)) {
      const lines = block.trim().split("\n");
      const files = lines
        .slice(1)
        .map((file) => file.trim())
        .filter(Boolean);
      if (files.some((file) => !mainApplied.has(file))) suspicious.add(lines[0].trim());
    }
    return suspicious;
  } catch {
    // fail open
    return new Set();
  }
}

function detectPresentReconciliations(presentCandidates, originMainRef, mainApplied, suspiciousCommits) {
  if (suspiciousCommits.size === 0) return [];
  const detected = [];
  for (const candidate of presentCandidates) {
    try {
      const branchLog = execFileSync(
        "git",
        ["log", "-1", "--format=%H", `^${originMainRef}`, candidate.sha, "--", APPLIED_DIR],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (!branchLog || !suspiciousCommits.has(branchLog)) continue;
      const branchApplied = execFileSync("git", ["ls-tree", "-r", "--name-only", candidate.sha, "--", APPLIED_DIR], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const unmerged = branchApplied.filter((entry) => !mainApplied.has(entry));
      if (unmerged.length === 0) continue;
      detected.push({
        branch: candidate.branch,
        sha: candidate.sha,
        unmergedCount: unmerged.length,
        reason: `carries ${unmerged.length} unmerged applied inbox record(s) under ${APPLIED_DIR}`,
      });
    } catch {
      // ignore
    }
  }
  return detected;
}

function detectUnfetchedNamedReconciliations(candidateBranches, localShas) {
  return candidateBranches
    .filter(
      (candidate) =>
        !localShas.has(candidate.sha) &&
        /(?:issues|ledger|inbox)[-_]?reconcile|reconcile[-_]?(?:issues|ledger|inbox)/i.test(candidate.branch),
    )
    .map((candidate) => ({
      branch: candidate.branch,
      sha: candidate.sha,
      reason: "unfetched remote branch name indicates an in-flight unmerged reconcile branch",
    }));
}

/** Strict (preserved-source) admission: the remote-head snapshot must be complete and current. */
function assertStrictRemoteSnapshot(lsRemoteText, options, runner, originMainRef) {
  if (
    options.strictRemote &&
    lsRemoteText
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .some((line) => !/^[0-9a-f]{40}\s+refs\/heads\/\S+$/i.test(line.trim()))
  ) {
    throw new Error("remote branch status is malformed; preserved-source admission is blocked");
  }
  if (options.strictRemote) {
    const mainRows = lsRemoteText
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((row) => row[1] === "refs/heads/main");
    let fetchedMain;
    try {
      fetchedMain = runner(["rev-parse", "--verify", `${originMainRef}^{commit}`]).trim();
    } catch {
      throw new Error("cannot resolve the fetched origin/main; preserved-source admission is blocked");
    }
    if (mainRows.length !== 1 || mainRows[0][0].toLowerCase() !== fetchedMain.toLowerCase()) {
      throw new Error(
        "remote main has moved since the last fetch (or is missing); fetch, merge origin/main and recheck; preserved-source admission is blocked",
      );
    }
  }
  if (options.expectedSource) {
    const ref = `refs/heads/${options.expectedSource.branch}`;
    const sourceRows = lsRemoteText
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((row) => row[1] === ref);
    if (sourceRows.length !== 1 || sourceRows[0][0] !== options.expectedSource.sha) {
      throw new Error(
        "preserved source is missing or moved in the complete remote-head snapshot; reconciliation remains blocked",
      );
    }
  }
}

/** Strict admission: every candidate commit and its applied tree must be inspectable. */
function detectStrictReconciliations(candidateBranches, runner, originMainRef) {
  const shasToCheck = candidateBranches.map((candidate) => candidate.sha);
  let mainApplied;
  try {
    mainApplied = new Set(
      runner(["ls-tree", "-r", "--name-only", originMainRef, "--", APPLIED_DIR]).split(/\r?\n/).filter(Boolean),
    );
  } catch {
    throw new Error("cannot inspect the current-main applied inbox; preserved-source admission is blocked");
  }

  const uniqueShas = [...new Set(shasToCheck)];
  let available;
  try {
    available = runner(["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
      input: uniqueShas.join("\n") + "\n",
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    throw new Error("cannot inspect remote commit availability; preserved-source admission is blocked");
  }
  // cat-file exits successfully for missing objects. Verify its complete output,
  // including ordinary branch names, rather than treating exit status as proof.
  const availableShas = new Set(available.map((entry) => entry.split(" ")[0]));
  if (
    available.length !== uniqueShas.length ||
    available.some((entry) => !/^[0-9a-f]{40} commit$/i.test(entry)) ||
    availableShas.size !== uniqueShas.length ||
    uniqueShas.some((sha) => !availableShas.has(sha))
  ) {
    const branches = candidateBranches.map((candidate) => candidate.branch).join(", ");
    throw new Error(
      `cannot inspect every remote candidate commit (${branches}); fetch remote heads and recheck; preserved-source admission is blocked`,
    );
  }

  const detected = [];
  for (const candidate of candidateBranches) {
    let applied;
    try {
      // Inspect the tip directly: a later edit to an already-landed record must
      // not hide an earlier unmerged record still present on this branch.
      applied = runner(["ls-tree", "-r", "--name-only", candidate.sha, "--", APPLIED_DIR])
        .split(/\r?\n/)
        .filter(Boolean);
    } catch {
      throw new Error(
        `cannot inspect the applied inbox on remote branch ${candidate.branch}; preserved-source admission is blocked`,
      );
    }
    const unmerged = applied.filter((path) => !mainApplied.has(path));
    if (unmerged.length) {
      detected.push({
        branch: candidate.branch,
        sha: candidate.sha,
        unmergedCount: unmerged.length,
        reason: `carries ${unmerged.length} unmerged applied inbox record(s) under ${APPLIED_DIR}`,
      });
    }
  }
  return detected;
}

export function findUnmergedRemoteReconciliations(options = {}) {
  const runner = remoteGitRunner(options);
  const lsRemoteText = readRemoteHeads(options, runner);
  if (!lsRemoteText || typeof lsRemoteText !== "string") {
    if (options.strictRemote)
      throw new Error("remote branch status is empty or invalid; preserved-source admission is blocked");
    return [];
  }
  const originMainRef = options.originRef ?? "refs/remotes/origin/main";
  if (options.strictRemote || options.expectedSource)
    assertStrictRemoteSnapshot(lsRemoteText, options, runner, originMainRef);
  const candidateBranches = parseRemoteCandidates(
    lsRemoteText,
    readCurrentBranch(options, runner),
    Boolean(options.strictRemote),
  );
  if (candidateBranches.length === 0) return [];
  if (options.strictRemote) return detectStrictReconciliations(candidateBranches, runner, originMainRef);

  const mainApplied = readMainAppliedPaths(originMainRef);
  const localShas = locallyAvailableCommitShas(candidateBranches.map((candidate) => candidate.sha));
  const presentCandidates = candidateBranches.filter((candidate) => localShas.has(candidate.sha));
  const suspiciousCommits = suspiciousAppliedCommits(
    originMainRef,
    presentCandidates.map((candidate) => candidate.sha),
    mainApplied,
  );
  return [
    ...detectPresentReconciliations(presentCandidates, originMainRef, mainApplied, suspiciousCommits),
    ...detectUnfetchedNamedReconciliations(candidateBranches, localShas),
  ];
}

function preservedSourcePin(argv) {
  const prFlag = "--preserved-source-pr";
  const shaFlag = "--preserved-source-sha";
  const prCount = argv.filter((arg) => arg === prFlag).length;
  const shaCount = argv.filter((arg) => arg === shaFlag).length;
  if (argv.some((arg) => arg.startsWith("--preserved-source-") && arg !== prFlag && arg !== shaFlag)) {
    throw new Error(
      "preserved-source admission requires exactly one --preserved-source-pr and --preserved-source-sha selector using separate values",
    );
  }
  if (!prCount && !shaCount) return undefined;
  const pr = argValue(argv, "preserved-source-pr");
  const sha = argValue(argv, "preserved-source-sha");
  if (
    prCount !== 1 ||
    shaCount !== 1 ||
    !/^[1-9][0-9]*$/.test(pr ?? "") ||
    !Number.isSafeInteger(Number(pr)) ||
    !/^[0-9a-f]{40}$/i.test(sha ?? "")
  ) {
    throw new Error("preserved-source admission requires exactly one positive PR number and one full source SHA");
  }
  return { number: Number(pr), sha: sha.toLowerCase() };
}

/** Fresh, read-only GitHub evidence for one explicitly pinned preserved source. */
function verifyPreservedSource(pin, options) {
  const gitRunner = options.runner ?? git;
  const githubRunner =
    options.githubRunner ??
    ((args) =>
      execFileSync("gh", args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      }).trim());
  const origin = gitRunner(["remote", "get-url", "origin"]);
  const match =
    /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      origin,
    );
  if (!match) throw new Error("preserved-source admission requires an unambiguous github.com origin");
  const repository = match[1];
  const read = (args) => {
    try {
      return JSON.parse(githubRunner(["api", "--hostname", "github.com", ...args]));
    } catch {
      throw new Error("preserved-source GitHub status is unavailable or invalid; reconciliation remains blocked");
    }
  };
  const validate = (pr) => {
    const sameRepo = (repo) =>
      typeof repo?.full_name === "string" && repo.full_name.toLowerCase() === repository.toLowerCase();
    if (
      pr?.number !== pin.number ||
      pr.state !== "closed" ||
      pr.merged !== false ||
      pr.merged_at !== null ||
      typeof pr.closed_at !== "string" ||
      !Number.isFinite(Date.parse(pr.closed_at)) ||
      pr.base?.ref !== "main" ||
      !sameRepo(pr.base?.repo) ||
      !sameRepo(pr.head?.repo) ||
      !Number.isSafeInteger(pr.base?.repo?.id) ||
      pr.base.repo.id <= 0 ||
      pr.head.repo.id !== pr.base.repo.id ||
      typeof pr.head?.ref !== "string" ||
      !pr.head.ref ||
      pr.head.sha !== pin.sha
    ) {
      throw new Error("preserved source must be a verified closed, unmerged PR in this repository at the pinned SHA");
    }
    return pr.head.ref;
  };
  const endpoint = `repos/${repository}/pulls/${pin.number}`;
  const branch = validate(read([endpoint]));
  const currentBranch = options.currentBranch ?? gitRunner(["branch", "--show-current"]);
  if (branch === currentBranch)
    throw new Error("reconciliation must use a separate branch; the preserved source cannot be its writer");
  const head = encodeURIComponent(`${repository.split("/")[0]}:${branch}`);
  const pages = read(["--paginate", "--slurp", `repos/${repository}/pulls?state=open&head=${head}&per_page=100`]);
  if (!Array.isArray(pages) || !pages.length || !pages.every(Array.isArray) || pages.some((page) => page.length)) {
    throw new Error("open or uncertain same-head PR status keeps the preserved source blocked");
  }
  if (validate(read([endpoint])) !== branch) throw new Error("preserved source changed during verification");
  let sourceRef;
  try {
    if (gitRunner(["cat-file", "-t", pin.sha]) !== "commit") throw new Error("source is not a commit");
    sourceRef = gitRunner(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).trim();
  } catch {
    throw new Error(
      "cannot verify the preserved source commit and remote branch; fetch and recheck without changing the source",
    );
  }
  const lines = sourceRef.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1 || lines[0] !== `${pin.sha}\trefs/heads/${branch}`) {
    throw new Error("preserved remote source is missing or moved from the pinned SHA; reconciliation remains blocked");
  }
  return { number: pin.number, repository, branch, sha: pin.sha };
}

/**
 * @param {string[]} [argv]
 * @param {{runner?: (args: string[]) => string, githubRunner?: (args: string[]) => string,
 * lsRemoteOutput?: string, originRef?: string, currentBranch?: string, warn?: (message: string) => void}} [options]
 */
export function assertSafeRemoteReconciliation(argv = [], options = {}) {
  const pin = preservedSourcePin(argv);
  const allowConcurrent =
    argv.includes("--allow-concurrent") ||
    argv.includes("--force") ||
    process.env.ALLOW_CONCURRENT_RECONCILE === "true";
  const skipRemoteCheck =
    argv.includes("--no-remote-check") ||
    argv.includes("--skip-remote-check") ||
    process.env.SKIP_REMOTE_CHECK === "true";

  if (pin && (skipRemoteCheck || allowConcurrent)) {
    throw new Error("verified preserved-source admission cannot be combined with reconciliation overrides");
  }
  if (skipRemoteCheck) return;

  const preservedSource = pin ? verifyPreservedSource(pin, options) : undefined;
  const conflicts = findUnmergedRemoteReconciliations({
    ...options,
    strictRemote: Boolean(pin),
    expectedSource: preservedSource,
  }).filter(
    (conflict) =>
      !preservedSource || conflict.branch !== preservedSource.branch || conflict.sha !== preservedSource.sha,
  );
  if (conflicts.length === 0) return preservedSource;

  const detail = conflicts.map((c) => `  - ${c.branch} (${c.sha.slice(0, 12)}): ${c.reason}`).join("\n");
  const message =
    `detected unmerged branch(es) on origin carrying pending inbox reconciliations:\n${detail}\n` +
    "Concurrent reconciliations cause canonical-ledger conflicts or corrupted reconciliation journals (#EH9VA6). " +
    "Land or close the existing reconciliation PR(s) before starting a new one, or pass --allow-concurrent to override.";

  if (allowConcurrent) {
    const warn = options.warn ?? ((msg) => console.warn(msg));
    warn(`warning: ${message}`);
  } else {
    throw new Error(message);
  }
}

function extractTargetUlid(argv) {
  const explicit = argValue(argv, "targetUlid");
  if (explicit && isIssueUlid(explicit)) return explicit;
  const positionalId = argv[1]?.startsWith("--") ? undefined : argv[1];
  const rawTargetId = argValue(argv, "id") ?? positionalId;
  if (!rawTargetId) return undefined;
  const stripped = rawTargetId.startsWith("#") ? rawTargetId.slice(1) : rawTargetId;
  if (isIssueUlid(stripped)) return stripped;
  return undefined;
}

function requestTargetId(argv) {
  const positionalId = argv[1]?.startsWith("--") ? undefined : argv[1];
  const rawTargetId = argValue(argv, "id") ?? positionalId;
  if (!rawTargetId) return undefined;
  const stripped = rawTargetId.startsWith("#") ? rawTargetId.slice(1) : rawTargetId;
  if (isIssueUlid(stripped)) return displayIdForUlid(stripped);
  return rawTargetId.startsWith("#") || rawTargetId.includes("-") ? rawTargetId : `#${rawTargetId}`;
}

function createRequestPayload(action, argv) {
  const targetId = requestTargetId(argv);
  const targetUlid = extractTargetUlid(argv);
  if (action === "add") {
    return {
      pri: argValue(argv, "pri"),
      type: argValue(argv, "type"),
      summary: argValue(argv, "summary"),
      detail: argValue(argv, "detail"),
      source: argValue(argv, "source"),
      issueUlid: issueUlid(),
    };
  }
  if (action === "done" || action === "amend-outcome") {
    const payload = { id: targetId, outcome: argValue(argv, "outcome") ?? argValue(argv, "reason") };
    if (targetUlid) payload.targetUlid = targetUlid;
    return payload;
  }
  if (action === "cancel") {
    const positionalId = argv[1]?.startsWith("--") ? undefined : argv[1];
    return {
      requestId: argValue(argv, "requestId") ?? argValue(argv, "id") ?? positionalId,
      reason: argValue(argv, "reason"),
    };
  }
  if (action === "queue") {
    const payload = {
      id: targetId,
      acuity: argValue(argv, "acuity"),
      capability: argValue(argv, "capability"),
      when: argValue(argv, "when"),
      estimate: argValue(argv, "estimate"),
      outcome: argValue(argv, "outcome") ?? argValue(argv, "reason"),
    };
    if (targetUlid) payload.targetUlid = targetUlid;
    return payload;
  }
  const payload = {
    // `pri` rides the same update request as the prose fields so a demotion and
    // its reason land as one auditable mutation. Without it, the CLI could not
    // express the re-prioritisation that updateIssue and validation both support.
    id: targetId,
    pri: argValue(argv, "pri"),
    summary: argValue(argv, "summary"),
    detail: argValue(argv, "detail"),
    source: argValue(argv, "source"),
    outcome: argValue(argv, "outcome") ?? argValue(argv, "reason"),
  };
  if (targetUlid) payload.targetUlid = targetUlid;
  return payload;
}

function attachIssueFingerprint(action, payload) {
  if (!["done", "update", "amend-outcome"].includes(action) || typeof payload.id !== "string") return;
  const current = readOutstandingIssues();
  const currentFingerprint = issueRowFingerprint(current, payload.id);
  if (currentFingerprint !== null) {
    if (action === "amend-outcome" || (action === "update" && payload.outcome !== undefined)) {
      throw new Error(
        `ledger request rejected: ${payload.id} is still open; outcome amendments require an archived issue`,
      );
    }
    payload.baseRowFingerprint = currentFingerprint;
    const row = findIssueRow(current, payload.id, ["open"]);
    if (row?.ulid && !payload.targetUlid) {
      payload.targetUlid = row.ulid;
    }
    return;
  }

  const isArchived = isArchivedIssue(current, payload.id);
  if (isArchived) {
    if (action === "done") {
      // Carry archive-aware intent so reconcile merges the outcome instead of
      // no-oping via the idempotent archived fast-path.
      payload.allowArchived = true;
      const row = findIssueRow(current, payload.id, ["archive"]);
      if (row?.ulid && !payload.targetUlid) {
        payload.targetUlid = row.ulid;
      }
      return;
    }
    const archiveFingerprint = archiveRowFingerprint(current, payload.id);
    if (archiveFingerprint) {
      payload.baseRowFingerprint = archiveFingerprint;
      payload.allowArchived = true;
      payload.targetTable = "archive";
      const row = findIssueRow(current, payload.id, ["archive"]);
      if (row?.ulid && !payload.targetUlid) {
        payload.targetUlid = row.ulid;
      }
      return;
    }
  }

  const targetDisplayId = normalizeIssueDisplayId(payload.id);
  const pending = loadPending();
  const pendingMatches = pending.filter(({ request }) => {
    if (request?.action !== "add" || !request?.payload?.issueUlid) return false;
    const derived = displayIdForUlid(request.payload.issueUlid);
    return derived === targetDisplayId;
  });
  if (pendingMatches.length === 1) {
    if (!payload.targetUlid) {
      payload.targetUlid = pendingMatches[0].request.payload.issueUlid;
    }
    return;
  }
  if (pendingMatches.length > 1) {
    if (payload.targetUlid) {
      const match = pendingMatches.find(({ request }) => request.payload.issueUlid === payload.targetUlid);
      if (match) return;
    }
    throw new Error(
      `ledger request rejected: ${payload.id} matches multiple pending add requests; specify the full ULID via --id to disambiguate`,
    );
  }

  throw new Error(`ledger request rejected: ${payload.id} is not in Open items`);
}

function attachQueueFingerprint(action, payload) {
  if (action !== "queue" || typeof payload.id !== "string") return;
  const currentFingerprint = queueRowFingerprint(readOutstandingIssues(), payload.id);
  if (currentFingerprint === null) {
    throw new Error(`ledger request rejected: ${payload.id} does not have exactly one recommended-execution-queue row`);
  }
  payload.baseRowFingerprint = currentFingerprint;
}

function writeRequest(action, argv, request) {
  const relative = requestPath(request.id);
  if (argv.includes("--dry-run")) {
    console.log(JSON.stringify(request, null, 2));
    console.log(`[dry-run] Planned ${action} request for ${relative} (no file written).`);
    return;
  }
  const target = path.join(ROOT, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(request, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(
    `Queued ${action} request at ${relative}. It is merge-safe; run npm run issues:reconcile after this PR lands.`,
  );
}

function createRequest(action, argv) {
  const payload = createRequestPayload(action, argv);
  attachIssueFingerprint(action, payload);
  attachQueueFingerprint(action, payload);
  const request = { version: 2, id: randomUUID(), createdOn: date(), action, payload };
  const problems = validateRequest(request);
  if (problems.length > 0) throw new Error(problems.join("; "));
  writeRequest(action, argv, request);
}

/**
 * `reconcile` is the only sanctioned writer of docs/outstanding-issues.md, and
 * it also moves every request it applied into `applied/` — so both the ledger
 * content and the inbox change, and data/outstanding-issues-snapshot.json (which
 * the developer hub renders) is behind the moment reconciliation returns.
 * Without this, every reconcile PR failed `check:outstanding-issues` with a fix
 * command. That is fail-closed and nothing wrong shipped, but a sanctioned path
 * that is routinely red is how gates come to be routed around.
 *
 * Deliberately OUTSIDE the reconciliation transaction, and only after it has
 * committed. `recoverReconcileTransaction` journals exactly two things — the
 * ledger backup and the pending request paths — and widening it to cover a
 * third, derived artifact would complicate the one transaction in this repo
 * that most needs to stay simple. The snapshot is regenerable from the ledger
 * at any time, so a failure here is a warning naming its own fix rather than a
 * failed reconcile: printing "refusing to reconcile" after the ledger has
 * already been rewritten would misdescribe the repository.
 *
 * Spawned with `cwd: ROOT` because the generator resolves its paths relative to
 * the working directory, and reconcile may be invoked from a subdirectory.
 */
function regenerateLedgerSnapshot() {
  try {
    execFileSync(process.execPath, ["scripts/generate-outstanding-issues-snapshot.mjs"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    console.log("Commit data/outstanding-issues-snapshot.json alongside the ledger.");
  } catch (error) {
    console.warn(
      `warning: the ledger was reconciled but data/outstanding-issues-snapshot.json was NOT regenerated (${error instanceof Error ? error.message : String(error)}). Run: npm run snapshot:issues`,
    );
  }
}

function refuseReconciliation(error) {
  console.error(`refusing to reconcile: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function pendingRequestsAreValid(pending) {
  const bad = pending.filter((entry) => entry.error || validateRequest(entry.request).length > 0);
  if (bad.length === 0) return true;
  for (const entry of bad) {
    console.error(`${entry.relative}: ${entry.error ?? validateRequest(entry.request).join("; ")}`);
  }
  process.exitCode = 1;
  return false;
}

function verifyTrackedPendingRequests(pending) {
  try {
    pendingRequestsAreTrackedAndClean(pending);
    return true;
  } catch (error) {
    refuseReconciliation(error);
    return false;
  }
}

/** @returns {{ok: boolean, preservedSource?: {number: number, branch: string, sha: string}}} */
function verifySafeRemoteReconciliation(argv) {
  try {
    const preservedSource = assertSafeRemoteReconciliation(argv);
    if (preservedSource)
      console.log(
        `Verified closed/unmerged preserved source PR #${preservedSource.number}: ${preservedSource.branch} at ${preservedSource.sha}. Branch retained; other reconciliation protections remain active.`,
      );
    return { ok: true, preservedSource };
  } catch (error) {
    refuseReconciliation(error);
    return { ok: false };
  }
}

function applyPendingRequests(pending) {
  const current = readFileSync(path.join(ROOT, ISSUES_PATH), "utf8");
  const result = applyRequestBatch(
    current,
    pending.map((entry) => entry.request),
  );
  const problems = checkIssues(result.markdown, { prettierIgnored: true });
  if (problems.length > 0) throw new Error(`invalid ${ISSUES_PATH}: ${problems.join("; ")}`);
  return result;
}

function previewReconciliation(pending) {
  let result;
  try {
    result = applyPendingRequests(pending);
  } catch (error) {
    refuseReconciliation(error);
  }
  return result;
}

function commitReconciliation(pending, initialResult, argv, preservedSource) {
  const decisions =
    initialResult.cancellations.length > 0
      ? ` with ${initialResult.cancellations.length} cancellation decision(s)`
      : "";
  console.log(`Reconciling ${pending.length} request(s) into ${ISSUES_PATH}${decisions}.`);
  const release = acquireReconcileLock();
  const lockPath = reconcileLockPath();
  const transactionPath = path.join(lockPath, RECONCILE_TRANSACTION_NAME);
  let transactionOpen = false;
  try {
    if (!canonicalLedgerIsClean())
      throw new Error(`${ISSUES_PATH} changed while reconciliation was waiting for its lock`);
    pendingRequestsAreTrackedAndClean(pending);
    assertFreshReconciliationBase();
    // The preserved source was admitted before the lock; re-verify it (GitHub state, pinned SHA,
    // remote heads and remote main) now that we hold the lock, so a moved source cannot pass.
    if (preservedSource) assertSafeRemoteReconciliation(argv);
    const result = applyPendingRequests(pending);

    const current = readFileSync(path.join(ROOT, ISSUES_PATH), "utf8");
    writeFileSync(path.join(lockPath, RECONCILE_BACKUP_NAME), current, "utf8");
    writeFileSync(
      transactionPath,
      `${JSON.stringify({
        backup: RECONCILE_BACKUP_NAME,
        pending: pending.map((entry) => entry.relative),
      })}\n`,
      "utf8",
    );
    transactionOpen = true;
    writeFileSync(path.join(ROOT, ISSUES_PATH), result.markdown, "utf8");
    mkdirSync(path.join(ROOT, APPLIED_DIR), { recursive: true });
    for (const entry of pending)
      renameSync(path.join(ROOT, entry.relative), path.join(ROOT, APPLIED_DIR, path.basename(entry.relative)));
    rmSync(transactionPath, { force: true });
    rmSync(path.join(lockPath, RECONCILE_BACKUP_NAME), { force: true });
    transactionOpen = false;
    console.log(`Applied ${pending.length} request(s); their immutable audit records are under ${APPLIED_DIR}.`);
    regenerateLedgerSnapshot();
  } catch (error) {
    if (transactionOpen) {
      try {
        recoverReconcileTransaction(lockPath);
        transactionOpen = false;
      } catch (recoveryError) {
        console.error(`reconciliation recovery is required: ${recoveryError.message}`);
      }
    }
    refuseReconciliation(error);
  } finally {
    if (!transactionOpen) release();
  }
}

function reconcile(argv) {
  const dryRun = argv.includes("--dry-run");
  const pending = loadPending();
  if (!pendingRequestsAreValid(pending)) return;
  if (pending.length === 0) {
    console.log("No outstanding-issue requests to reconcile.");
    return;
  }
  if (!verifyTrackedPendingRequests(pending)) return;
  if (!dryRun && !canonicalLedgerIsClean()) {
    refuseReconciliation(`${ISSUES_PATH} has staged or unstaged changes; preserve or commit them first.`);
    return;
  }
  assertFreshReconciliationBase();
  const remote = verifySafeRemoteReconciliation(argv);
  if (!remote.ok) return;
  const result = previewReconciliation(pending);
  if (!result) return;
  const decisions =
    result.cancellations.length > 0 ? ` with ${result.cancellations.length} cancellation decision(s)` : "";
  if (dryRun) {
    console.log(`Would reconcile ${pending.length} request(s) into ${ISSUES_PATH}${decisions}.`);
    return;
  }
  commitReconciliation(pending, result, argv, remote.preservedSource);
}

function selfTestRemoteInterlock() {
  const offlineResult = findUnmergedRemoteReconciliations({
    runner: () => {
      throw new Error("offline");
    },
  });
  if (offlineResult.length !== 0) {
    throw new Error("self-test failed: remote check must fail open when offline");
  }

  const cleanRemoteOutput = [`${"a".repeat(40)}\trefs/heads/main`, `${"b".repeat(40)}\trefs/heads/feature-branch`].join(
    "\n",
  );
  const cleanResult = findUnmergedRemoteReconciliations({
    lsRemoteOutput: cleanRemoteOutput,
    currentBranch: "feature-branch",
  });
  if (cleanResult.length !== 0) {
    throw new Error("self-test failed: clean remote branches must report no conflicts");
  }

  const conflictingRemoteOutput = [
    `${"a".repeat(40)}\trefs/heads/main`,
    `${"c".repeat(40)}\trefs/heads/claude/issues-reconcile-20260818`,
  ].join("\n");
  const conflictResult = findUnmergedRemoteReconciliations({
    lsRemoteOutput: conflictingRemoteOutput,
    currentBranch: "feature-branch",
  });
  if (conflictResult.length === 0 || conflictResult[0].branch !== "claude/issues-reconcile-20260818") {
    throw new Error("self-test failed: unmerged reconcile branch on origin was not detected");
  }

  let remoteInterlockError = false;
  try {
    assertSafeRemoteReconciliation([], {
      lsRemoteOutput: conflictingRemoteOutput,
      currentBranch: "feature-branch",
    });
  } catch (error) {
    remoteInterlockError = /detected unmerged branch/.test(String(error));
  }
  if (!remoteInterlockError) {
    throw new Error(
      "self-test failed: assertSafeRemoteReconciliation must throw when unmerged reconcile branch is found",
    );
  }

  const remoteWarnings = [];
  assertSafeRemoteReconciliation(["--allow-concurrent"], {
    lsRemoteOutput: conflictingRemoteOutput,
    currentBranch: "feature-branch",
    warn: (msg) => remoteWarnings.push(msg),
  });
  if (remoteWarnings.length === 0 || !remoteWarnings[0].includes("claude/issues-reconcile-20260818")) {
    throw new Error("self-test failed: --allow-concurrent must warn loudly rather than throw");
  }
}

function selfTestQueueRequests(base, update, done) {
  // #M6JNR8: a queue re-grade must survive validation, fingerprinting against
  // the queue row, and writing without disturbing Order or the ID(s) linkage.
  const queueBase = base.replace(
    ["| Order | ID(s) |", "| --- | --- |", "| 1 | `#001` |"].join("\n"),
    [
      "| Order | ID(s) | Acuity | Capability | When | Estimate | Outcome |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| 1 | `#001` | A1 | Specialist | Immediate | 2h | investigate |",
    ].join("\n"),
  );
  const regrade = {
    version: 1,
    id: "77777777-7777-4777-8777-777777777777",
    createdOn: "2026-08-13",
    action: "queue",
    payload: {
      id: "#001",
      acuity: "A3",
      when: "After the next release",
      baseRowFingerprint: queueRowFingerprint(queueBase, "#001"),
    },
  };
  if (validateRequest(regrade).length > 0) {
    throw new Error("self-test failed: a queue re-grade request must validate");
  }
  if (validateRequest({ ...regrade, payload: { id: "#001" } }).length === 0) {
    throw new Error("self-test failed: a queue request with no editable field must be rejected");
  }
  const regraded = applyRequest(queueBase, regrade);
  if (!/\|\s*1\s*\|\s*`#001`\s*\|\s*A3\s*\|/.test(regraded)) {
    throw new Error("self-test failed: a queue re-grade did not reach the Acuity cell");
  }
  if (!/\|\s*#001\s*\|\s*P2\s*\|/.test(regraded)) {
    throw new Error("self-test failed: a queue re-grade must not touch the Open-items row");
  }
  let staleQueueRejected = false;
  try {
    applyRequest(queueBase.replace("| 1 | `#001` | A1 |", "| 1 | `#001` | A2 |"), regrade);
  } catch (error) {
    staleQueueRejected = /stale/.test(String(error));
  }
  if (!staleQueueRejected) throw new Error("self-test failed: stale queue request was not rejected");
  if (!applyRequest(queueBase.replace("| #001 | P2 | issue | one |", "| #001 | P2 | issue | one prime |"), regrade)) {
    throw new Error("self-test failed: an unrelated Open-items edit invalidated a queue re-grade");
  }
  if (mutationConflicts([regrade, update]).length > 0) {
    throw new Error("self-test failed: a queue edit and an open-row update were treated as conflicting");
  }
  if (mutationConflicts([regrade, { ...regrade, id: "88888888-8888-4888-8888-888888888888" }]).length !== 1) {
    throw new Error("self-test failed: two queue edits for one id must conflict");
  }
  for (const requests of [
    [regrade, done],
    [done, regrade],
  ]) {
    let queueClosureRejected = false;
    try {
      applyRequestBatch(queueBase, requests);
    } catch (error) {
      queueClosureRejected = /explicit cancellation decision/.test(String(error));
    }
    if (!queueClosureRejected) {
      throw new Error("self-test failed: a queue edit and closure must require an explicit cancellation decision");
    }
  }
}

function createSelfTestFixtures() {
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
    "| #001 | P2 | issue | one | d | s | 2026-01-01 |",
    "| #041061 <!-- issue-ulid:01M00000000410610000000000 --> | P2 | task | modern | d | s | 2026-01-01 |",
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
  const add = {
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    createdOn: "2026-08-13",
    action: "add",
    payload: { pri: "P2", type: "issue", summary: "two" },
  };
  const done = {
    version: 1,
    id: "22222222-2222-4222-8222-222222222222",
    createdOn: "2026-08-13",
    action: "done",
    payload: { id: "#001", outcome: "done", baseRowFingerprint: issueRowFingerprint(base, "#001") },
  };
  const update = {
    version: 1,
    id: "33333333-3333-4333-8333-333333333333",
    createdOn: "2026-08-13",
    action: "update",
    payload: { id: "#001", summary: "updated", baseRowFingerprint: issueRowFingerprint(base, "#001") },
  };
  const modernUpdate = {
    ...update,
    id: "66666666-6666-4666-8666-666666666666",
    payload: {
      id: "#041061",
      summary: "modern updated",
      baseRowFingerprint: issueRowFingerprint(base, "#041061"),
    },
  };
  const cancel = {
    version: 1,
    id: "44444444-4444-4444-8444-444444444444",
    createdOn: "2026-08-13",
    action: "cancel",
    payload: { requestId: done.id, reason: "prefer the later update" },
  };
  // #313: a re-prioritisation must survive the whole path — accepted by the
  // validator on its own, and actually written to the Pri cell by the writer.
  // Each half failed independently while the other looked fine.
  const reprioritise = {
    version: 1,
    id: "55555555-5555-4555-8555-555555555555",
    createdOn: "2026-08-13",
    action: "update",
    payload: { id: "#001", pri: "P3", baseRowFingerprint: issueRowFingerprint(base, "#001") },
  };
  return { base, add, done, update, modernUpdate, cancel, reprioritise };
}

function selfTestApplyingRequests({ base, add, done, update, cancel }) {
  const added = applyRequest(base, add);
  const replayed = applyRequest(base, add);
  const legacyUlid = issueUlidFromRequest(add.createdOn, add.id);
  if (!added.includes(`issue-ulid:${legacyUlid}`) || added !== replayed) {
    throw new Error("self-test failed: legacy queued add did not derive a stable durable id");
  }
  const v2Add = {
    ...add,
    version: 2,
    payload: { ...add.payload, issueUlid: issueUlid(1, new Uint8Array(10)) },
  };
  if (validateRequest(v2Add).length > 0 || !applyRequest(base, v2Add).includes(v2Add.payload.issueUlid)) {
    throw new Error("self-test failed: version 2 add did not preserve its durable id");
  }
  if (validateRequest({ ...v2Add, payload: { ...v2Add.payload, issueUlid: "invalid" } }).length === 0) {
    throw new Error("self-test failed: invalid version 2 durable id accepted");
  }
  const resolved = applyRequest(base, done);
  if (resolved.includes("`#001`")) {
    throw new Error("self-test failed: queued resolve did not preserve ledger invariants");
  }
  const idempDone = {
    version: 1,
    id: "99999999-1111-4111-8111-111111111111",
    createdOn: "2026-08-14",
    action: "done",
    payload: { id: "#001", outcome: "idempotent note", baseRowFingerprint: issueRowFingerprint(base, "#001") },
  };
  const idempResult = applyRequest(resolved, idempDone);
  if (!idempResult.includes("done \\| Note: idempotent note")) {
    throw new Error("self-test failed: idempotent close did not merge outcome note into archive row");
  }
  const archivedClose = {
    version: 1,
    id: "99999999-4444-4444-8444-444444444444",
    createdOn: "2026-08-14",
    action: "done",
    payload: { id: "#000", outcome: "post-archive close note", allowArchived: true },
  };
  const archivedBatch = applyRequestBatch(base, [archivedClose]);
  if (!archivedBatch.markdown.includes("done \\| Note: post-archive close note")) {
    throw new Error("self-test failed: one-request archived done batch did not merge outcome");
  }
  if (validateRequest({ ...add, payload: {} }).length === 0) {
    throw new Error("self-test failed: invalid request accepted");
  }

  const staleBase = base.replace("one", "stale");
  let staleRejected = false;
  try {
    applyRequest(staleBase, done);
  } catch (error) {
    staleRejected = /stale/.test(String(error));
  }
  if (!staleRejected) throw new Error("self-test failed: stale done request was not rejected");
  let staleUpdateRejected = false;
  try {
    applyRequest(staleBase, update);
  } catch (error) {
    staleUpdateRejected = /stale/.test(String(error));
  }
  if (!staleUpdateRejected) throw new Error("self-test failed: stale update request was not rejected");

  let conflictRejected = false;
  try {
    applyRequestBatch(base, [done, update]);
  } catch (error) {
    conflictRejected = /explicit cancellation decision/.test(String(error));
  }
  if (!conflictRejected) throw new Error("self-test failed: colliding mutations were not rejected");
  const dupDone1 = {
    version: 1,
    id: "99999999-2222-4222-8222-222222222222",
    createdOn: "2026-08-14",
    action: "done",
    payload: { id: "#001", outcome: "batch close 1" },
  };
  const dupDone2 = {
    version: 1,
    id: "99999999-3333-4333-8333-333333333333",
    createdOn: "2026-08-14",
    action: "done",
    payload: { id: "#001", outcome: "batch close 2" },
  };
  if (mutationConflicts([dupDone1, dupDone2]).length > 0) {
    throw new Error("self-test failed: duplicate done requests in batch were flagged as conflict");
  }
  const dupBatchResult = applyRequestBatch(base, [dupDone1, dupDone2]);
  if (!dupBatchResult.markdown.includes("batch close 1 \\| Note: batch close 2")) {
    throw new Error("self-test failed: duplicate done requests in batch did not merge outcome notes");
  }
  const planned = applyRequestBatch(base, [done, update, cancel]);
  if (!planned.markdown.includes("updated") || planned.cancelledIds[0] !== done.id) {
    throw new Error("self-test failed: cancellation did not select the intended mutation");
  }
}

function selfTest() {
  const { base, add, done, update, modernUpdate, cancel, reprioritise } = createSelfTestFixtures();
  if (!applyRequest(base, modernUpdate).includes("| modern updated |")) {
    throw new Error("self-test failed: modern Crockford display id update was not applied");
  }
  if (validateRequest(reprioritise).length > 0) {
    throw new Error("self-test failed: a pri-only update request must validate");
  }
  if (validateRequest({ ...reprioritise, payload: { id: "#001", pri: "P9" } }).length === 0) {
    throw new Error("self-test failed: an out-of-range pri must be rejected");
  }
  const reprioritised = applyRequest(base, reprioritise);
  if (!/\|\s*#001\s*\|\s*P3\s*\|/.test(reprioritised)) {
    throw new Error("self-test failed: a pri-only update did not reach the Pri cell");
  }

  selfTestQueueRequests(base, update, done);
  selfTestApplyingRequests({ base, add, done, update, cancel });
  let missingTargetRejected = false;
  try {
    planRequestBatch([{ ...cancel, payload: { requestId: add.id, reason: "missing" } }]);
  } catch (error) {
    missingTargetRejected = /missing pending request/.test(String(error));
  }
  if (!missingTargetRejected) throw new Error("self-test failed: missing cancellation target was accepted");
  if (!processIsAlive(process.pid) || !processIsAlive(String(process.pid))) {
    throw new Error("self-test failed: current numeric or numeric-string PID was not treated as alive");
  }
  if (processIsAlive(0) || processIsAlive("not-a-pid")) {
    throw new Error("self-test failed: invalid PID was treated as alive");
  }

  // Pre-flight remote interlock self-test (#EH9VA6)
  selfTestRemoteInterlock();

  const parsedEnqueue = parseInboxCommand(["enqueue", "--action", "done", "--id", "#001", "--reason", "tested"]);
  if (parsedEnqueue.action !== "done" || !parsedEnqueue.argv.includes("--reason")) {
    throw new Error("self-test failed: parseInboxCommand did not properly parse enqueue alias");
  }

  console.log("ledger inbox self-test passed.");
}

export function parseInboxCommand(argv) {
  const action = argv[0];
  if (action !== "enqueue") return { action, argv };
  const explicitAction = argValue(argv, "action");
  if (!explicitAction || !ACTIONS.has(explicitAction)) {
    throw new Error(`enqueue requires --action <${[...ACTIONS].join("|")}>`);
  }
  const filteredArgv = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--action") {
      i++;
      continue;
    }
    filteredArgv.push(argv[i]);
  }
  return { action: explicitAction, argv: [explicitAction, ...filteredArgv] };
}

function entryProblems(entry) {
  return entry.error ? entry.error : validateRequest(entry.request).join("; ");
}

function duplicateRequestPaths(requests) {
  const seen = new Set();
  const duplicates = [];
  for (const entry of requests) {
    if (seen.has(entry.request.id)) duplicates.push(entry.relative);
    seen.add(entry.request.id);
  }
  return duplicates;
}

function checkInbox() {
  const requests = allRequestEntries();
  const bad = requests.filter((entry) => entry.error || validateRequest(entry.request).length > 0);
  if (bad.length > 0) {
    throw new Error(bad.map((entry) => `${entry.relative}: ${entryProblems(entry)}`).join("\n"));
  }
  const duplicates = duplicateRequestPaths(requests);
  if (duplicates.length > 0) throw new Error(`duplicate immutable request id(s): ${duplicates.join(", ")}`);
  console.log(
    `Ledger inbox check passed: ${loadPending().length} pending request(s), ${requests.length - loadPending().length} applied.`,
  );
}

function dispatchInboxCommand(action, argv) {
  if (ACTIONS.has(action)) return createRequest(action, argv);
  if (action === "reconcile") return reconcile(argv.slice(1));
  if (action === "check") return checkInbox();
  throw new Error(
    "usage: ledger-inbox.mjs <add|done|update|amend-outcome|queue|cancel|enqueue|reconcile|check> [args]",
  );
}

function main() {
  const rawArgv = process.argv.slice(2);
  if (rawArgv.includes("--self-test")) return selfTest();
  try {
    const { action, argv } = parseInboxCommand(rawArgv);
    return dispatchInboxCommand(action, argv);
  } catch (error) {
    console.error(`ledger inbox: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("ledger-inbox.mjs")) main();
