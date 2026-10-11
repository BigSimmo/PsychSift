import { createHash } from "node:crypto";
import { classifyPullRequestFiles, evaluatePullRequestPolicy } from "./pr-policy.mjs";

export const STATE_BRANCH = "codex/pr-batch-state";
export const CONFIRMATION = "Authorize this batch: repairs, GitHub writes, protected merges and Railway deployments";
export const TERMINAL = new Set(["merged", "parked", "excluded"]);
export const ACTIVE_BATCH = new Set(["running", "paused"]);
export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const approvedPolicyHash = (state) => state.approvedControllerHash ?? state.manifest.controllerHash;
export const validTaskReference = (value) =>
  /^(?:codex:\/\/threads\/[a-f0-9-]{36}|https:\/\/chatgpt\.com\/codex\/(?:cloud\/)?tasks\/task_[A-Za-z0-9_]+\/?)$/u.test(
    value,
  );

// Shared by launch classification and the trusted repair publisher. PR declarations
// cannot grant permission to modify the controller, credentials, or clinical data.
export function protectedPath(path) {
  const segments = path.split(/[\\/]/u);
  return (
    /^(?:\.github\/|\.codex\/|\.claude\/|\.agents\/|AGENTS\.md$|PROJECT-INSTRUCTIONS-CONTINUATION\.md$|CLAUDE\.md$|supabase\/|Dockerfile|railway[./]|\.env(?:\.|$)|docs\/agents\/|docs\/codex-review-protocol\.md$|scripts\/(?:pr-batch|check-github-action|check-codex|pr-policy|guard-push|sync.*pr))/i.test(
      path,
    ) ||
    segments.some((segment) =>
      /^(?:[^/]*(?:auth|permission|security|credential|secret)[^/]*|\.npmrc|\.netrc|\.gitmodules|[^/]*\.(?:pem|key|p12|pfx|keystore))$/i.test(
        segment,
      ),
    ) ||
    /^src\/lib\/(?:env|client-env|security-headers)\./i.test(path)
  );
}

export function eligibility(pr) {
  if (pr.state !== "open") return "closed";
  if (pr.draft) return "draft";
  if (pr.fork) return "fork";
  if (pr.baseRef !== "main") return "non-main-target";
  if (
    !/^(?!\/)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._/-]+$/.test(pr.headRef) ||
    /^(?:main|master|develop|release(?:\/|$))/.test(pr.headRef) ||
    pr.headRef === STATE_BRANCH
  )
    return "unsafe-head";
  if (
    pr.labels.some((label) =>
      ["hold", "do-not-merge", "skip-branch-sync", "skip-codex-review"].includes(label.toLowerCase()),
    ) ||
    /\b(?:WIP|do not merge)\b/i.test(pr.title)
  )
    return "opt-out";
  if (!pr.filesComplete) return "incomplete-file-evidence";
  if (pr.files.some(protectedPath)) return "protected-surface";
  const classification = classifyPullRequestFiles(pr.files);
  // A canary assertion in PR text is not an authenticated exact-candidate proof.
  // Accept only a trusted, launch-bound attestation that the adapter verifies.
  if (classification.ragRanking && !pr.canaryVerified) return "rag-evidence-required";
  // Clinical-content PRs stay out of the unattended batch on their own rule.
  if (classification.clinicalRisk) return "clinical-review-required";
  // supabase/ is already excluded via protectedPath above. Remaining policy failures
  // (deferred-deploy claims, transport-file landings, etc.) still exclude a PR.
  const policy = evaluatePullRequestPolicy({
    title: pr.title,
    body: pr.body,
    headRef: pr.headRef,
    files: pr.files,
  });
  if (!policy.ok) return `policy: ${policy.errors.join("; ")}`;
  return null;
}

export function dependencies(body) {
  // Only explicit line-level declarations influence order; they grant no authority.
  return [...new Set([...String(body).matchAll(/^Depends-on:\s*#(\d+)\s*$/gim)].map((match) => Number(match[1])))];
}

export function orderPullRequests(prs) {
  const remaining = [...prs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number);
  const result = [];
  const captured = new Set(prs.map((pr) => pr.number));
  while (remaining.length) {
    const index = remaining.findIndex((pr) =>
      dependencies(pr.body).every((id) => !captured.has(id) || result.some((done) => done.number === id)),
    );
    if (index < 0) return [...result, ...remaining.map((pr) => ({ ...pr, dependencyCycle: true }))];
    result.push(...remaining.splice(index, 1));
  }
  return result;
}

/** @returns {import('./pr-batch-types.d.mts').BatchState} */
export function createBatch({
  prs,
  actor,
  authorization,
  controllerHash,
  mergeMethod = "merge",
  id,
  now,
  perPr = 3,
  total = 30,
  canaryEvidence = {},
}) {
  if (actor !== "BigSimmo" || !validTaskReference(authorization))
    throw new Error("Invalid batch authorization identity or task reference");
  if (!/^batch-\d+$/.test(id)) throw new Error("Invalid batch identifier");
  if (![perPr, total].every((n) => Number.isInteger(n) && n > 0) || perPr > 6 || total > 100)
    throw new Error("Repair limits out of bounds");
  if (prs.some((pr) => pr.armed || pr.enqueued)) throw new Error("Existing merge ownership must settle before launch");
  const ordered = orderPullRequests(prs);
  const manifest = {
    version: 1,
    id,
    actor,
    authorization,
    controllerHash,
    mergeMethod,
    launchedAt: now,
    perPr,
    total,
    canaryEvidence,
    prs: ordered.map((pr) => ({
      number: pr.number,
      head: pr.head,
      headRef: pr.headRef,
      dependencies: dependencies(pr.body),
      exclusion: pr.dependencyCycle ? "dependency-cycle" : eligibility(pr),
    })),
  };
  return {
    version: 1,
    manifest,
    manifestDigest: digest(manifest),
    status: "running",
    resumedAt: now,
    revision: 0,
    repairs: 0,
    pass: 0,
    active: null,
    pending: null,
    reason: null,
    entries: manifest.prs.map((pr) => ({
      number: pr.number,
      head: pr.head,
      state: pr.exclusion ? "excluded" : "queued",
      reason: pr.exclusion,
      attempts: 0,
      fingerprints: [],
      updatedAt: now,
      progressAt: now,
      retried: false,
    })),
    events: [],
  };
}

export function verifyCanaryResults(baseline, post) {
  if (
    !Array.isArray(baseline?.results) ||
    !baseline.results.length ||
    !Array.isArray(post?.results) ||
    baseline.results.length !== post.results.length
  )
    return false;
  for (const result of [baseline, post]) {
    if (
      result.mode !== "quality" ||
      result.summary?.document_recall_at_5 !== 1 ||
      result.summary?.content_recall_at_5 !== 1 ||
      result.summary?.failed_cases?.length !== 0
    )
      return false;
    if (new Set(result.results.map((item) => item.id)).size !== result.results.length) return false;
  }
  if (baseline.fixture !== post.fixture) return false;
  return baseline.results.every((before) => {
    const after = post.results.find((item) => item.id === before.id);
    return (
      after &&
      Number.isFinite(before.reciprocalRankAt10) &&
      Number.isFinite(after.reciprocalRankAt10) &&
      after.reciprocalRankAt10 >= before.reciprocalRankAt10 &&
      Number.isFinite(before.contentReciprocalRankAt10) &&
      Number.isFinite(after.contentReciprocalRankAt10) &&
      after.contentReciprocalRankAt10 >= before.contentReciprocalRankAt10
    );
  });
}

export function validateState(state) {
  if (
    state?.version !== 1 ||
    state.manifestDigest !== digest(state.manifest) ||
    !Array.isArray(state.entries) ||
    !Number.isInteger(state.revision)
  )
    throw new Error("Invalid batch state or manifest digest");
  if (
    !/^batch-\d+$/.test(state.manifest.id) ||
    !["running", "paused", "all_merged", "completed_with_unresolved"].includes(state.status)
  )
    throw new Error("Unsupported batch identity or status");
  if (
    state.entries.some(
      (entry) =>
        ![
          "queued",
          "preparing",
          "repairing",
          "waiting_ci",
          "ready",
          "merge_requested",
          "merged",
          "parked",
          "excluded",
        ].includes(entry.state),
    )
  )
    throw new Error("Unsupported PR state");
  if (
    state.pending &&
    (!["repair", "sync", "merge"].includes(state.pending.kind) ||
      state.pending.number !== state.active ||
      !/^[a-f0-9]{40}$/.test(state.pending.head) ||
      !/^[a-f0-9]{40}$/.test(state.pending.base))
  )
    throw new Error("Invalid pending operation");
  if (state.entries.filter((entry) => !TERMINAL.has(entry.state) && entry.state !== "queued").length > 1)
    throw new Error("Multiple active PRs in state");
  if (
    state.entries.length !== state.manifest.prs.length ||
    state.entries.some((entry, i) => entry.number !== state.manifest.prs[i].number)
  )
    throw new Error("Batch membership changed");
  return state;
}

export function transition(state, now, kind, detail = {}) {
  state.revision += 1;
  state.events.push({ revision: state.revision, at: now, kind, ...detail });
  return state;
}

// Pure decision function. The runtime journals each mutation intent before calling
// GitHub; a wake with a pending intent must reconcile it before making a decision.
/** @returns {{action: string, reason?: string, number?: number, commit?: string}} */
export function decide(state, evidence, now) {
  validateState(state);
  if (state.status !== "running") return { action: "idle" };
  if (Date.parse(now) - Date.parse(state.resumedAt) >= 24 * 60 * 60 * 1000)
    return { action: "pause", reason: "batch-deadline" };
  if (state.pending) return { action: "reconcile" };
  const entry = state.entries.find((item) => item.number === state.active);
  if (!entry) {
    const next = state.entries.find((item) => item.state === "queued");
    return next ? { action: "select", number: next.number } : { action: "finish-pass" };
  }
  if (!evidence) return { action: "inspect", number: entry.number };
  if (evidence.externalArmed) return { action: "pause", reason: "external-merge-ownership" };
  if (evidence.merged)
    return evidence.mergeVerified
      ? { action: "merged", commit: evidence.mergeCommit }
      : { action: "pause", reason: "merge-not-verified-on-main" };
  const armed = evidence.armed || evidence.enqueued || entry.state === "merge_requested";
  const stop = (reason) => ({ action: armed ? "pause" : "park", reason });
  if (entry.state === "merge_requested" && !evidence.armed && !evidence.enqueued)
    return { action: "pause", reason: "merge-request-disappeared" };
  if ((evidence.armed || evidence.enqueued) && entry.state !== "merge_requested")
    return { action: "pause", reason: "external-merge-ownership" };
  const exclusion = eligibility(evidence);
  if (exclusion) return stop(exclusion);
  if (evidence.head !== entry.head) return { action: "pause", reason: "external-head-change" };
  if (!evidence.complete) return stop("incomplete-evidence");
  if (evidence.dependencyBlocked) return stop("dependency-blocked");
  if (Date.parse(now) - Date.parse(entry.progressAt) >= 2 * 60 * 60 * 1000) return stop("no-progress-timeout");
  if (evidence.busy) return { action: "wait", reason: "existing-repair-owner" };
  if (armed) {
    if (evidence.failures.length || evidence.threads.length || evidence.conflicting)
      return { action: "pause", reason: "armed-pr-needs-repair" };
    return { action: "wait", reason: "github-merge-pending" };
  }
  // Settle one CI wave before deciding a real blocker exists; real conflicts can prevent CI.
  if (evidence.inFlight && !evidence.conflicting) return { action: "wait", reason: "ci-in-flight" };
  // No automated repair is dispatched for any of these; the PR is parked with a
  // reason naming the blocker so a person can act, and the batch moves on.
  if (evidence.conflicting) return stop("needs-repair: conflicting");
  if (evidence.failures.length) return stop("needs-repair: failing-checks");
  if (evidence.threads.length) return stop("needs-repair: unresolved-threads");
  // The one sanctioned sync: only for the active PR, only once it has no
  // conflicts, failures, threads, or in-flight CI, and only because the branch
  // ruleset requires an up-to-date branch to merge. With a merge queue on the
  // base branch there is no sync at all: the queue tests the PR against the
  // latest main itself, so a behind PR goes straight to the merge request.
  if (evidence.behind && !evidence.queue) return { action: "sync" };
  if (!evidence.requiredGreen) return { action: "wait", reason: "required-checks-missing-or-pending" };
  if (!evidence.reviewsSatisfied) return { action: "wait", reason: "approval-required" };
  if (!evidence.mergeable) return { action: "wait", reason: "mergeability-pending" };
  return { action: "merge" };
}

export function report(state) {
  const counts = Object.fromEntries(
    ["merged", "parked", "excluded", "queued"].map((name) => [
      name,
      state.entries.filter((entry) => entry.state === name).length,
    ]),
  );
  return {
    batch: state.manifest.id,
    status: state.status,
    reason: state.reason,
    active: state.active,
    counts,
    repairs: state.repairs,
    entries: state.entries.map(({ number, state: disposition, reason, head, mergeCommit, attempts }) => ({
      number,
      disposition,
      reason,
      head,
      mergeCommit,
      attempts,
    })),
    deploymentHealth: "Not established by PR merge evidence",
    armedPause: state.status === "paused" && state.entries.some((entry) => entry.state === "merge_requested"),
  };
}
