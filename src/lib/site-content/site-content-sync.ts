import { createHash } from "node:crypto";

import {
  assertReceiptAppendOnlyPair,
  assertRecoveryReadinessForOperation,
  parseRecoveryReadinessEvidence,
  type ActivationReceipt,
  type RecoveryReadinessEvidence,
  type RollbackReceipt,
} from "@/lib/recovery-readiness-evidence";
import type { SiteContentDomain } from "@/lib/types";

type Digest = `sha256:${string}`;

export type SiteContentSyncRecord = Readonly<{
  logicalId: string;
  domain: SiteContentDomain;
  publicationVersion: string;
  contentHash: Digest;
  sourceLineageDigest: Digest;
}>;

export type SiteContentEmbeddingIdentity = Readonly<{
  model: string;
  dimensions: number;
  contentHash: Digest;
  digest: Digest;
}>;

export type SiteContentActiveProjection = Readonly<{
  logicalId: string;
  contentHash: Digest;
  embedding: SiteContentEmbeddingIdentity;
}>;

export type SiteContentSyncInput = Readonly<{
  projectRef: string;
  expectedProjectRef: string;
  candidateReleaseId: string;
  previousReleaseId: string;
  generationId: string;
  registryVersion: string;
  deploymentSha: string;
  staticManifestDigest: Digest;
  expectedEmbedding: { model: string; dimensions: number };
  desiredRecords: SiteContentSyncRecord[];
  activeProjections: SiteContentActiveProjection[];
  legacyRows: Array<{ rowId: string; logicalId: string; contentHash: Digest }>;
  legacyDispositions: Array<{ logicalId: string; selectedRowId: string; retiredRowIds: string[] }>;
  batchSize: number;
  write?: boolean;
  recoveryEvidence?: unknown;
  now?: Date;
}>;

export type SiteContentSyncPlan = Readonly<{
  version: "site-content-sync-plan-v1";
  mode: "dry-run" | "write";
  projectRef: string;
  candidateReleaseId: string;
  previousReleaseId: string;
  generationId: string;
  registryVersion: string;
  deploymentSha: string;
  staticManifestDigest: Digest;
  embeddingContract: Readonly<{ model: string; dimensions: number }>;
  batchSize: number;
  changed: Array<SiteContentSyncRecord & { changeKind: "added" | "changed" }>;
  unchanged: Array<SiteContentSyncRecord & { reusedEmbedding: SiteContentEmbeddingIdentity }>;
  tombstoned: Array<{ logicalId: string; priorContentHash: Digest }>;
  operations: Array<{
    logicalId: string;
    operation: "changed" | "unchanged" | "tombstone";
    contentHash: Digest;
  }>;
  legacyReconciliation: Array<{
    logicalId: string;
    rows: Array<{ rowId: string; contentHash: Digest }>;
    disposition: { logicalId: string; selectedRowId: string; retiredRowIds: string[] } | null;
  }>;
  legacyDispositions: Array<{ logicalId: string; selectedRowId: string; retiredRowIds: string[] }>;
  legacyReconciliationDigest: Digest;
  expectedCounts: { desired: number; changed: number; unchanged: number; tombstoned: number };
  dynamicStateDigest: Digest;
  releaseDigest: Digest;
  planDigest: Digest;
  recoveryEvidenceDigest: Digest | null;
  recoveryEvidence?: RecoveryReadinessEvidence;
}>;

export type SiteContentWorkerLease = Readonly<{
  workerId: string;
  leaseId: string;
  generationId: string;
  expiresAt: string;
}>;

export type SiteContentSyncRuntime = Readonly<{
  now?: () => Date;
  stageChanged?: (record: SiteContentSyncPlan["changed"][number], lease: SiteContentWorkerLease) => Promise<void>;
  carryForward?: (record: SiteContentSyncPlan["unchanged"][number], lease: SiteContentWorkerLease) => Promise<void>;
  tombstone?: (record: SiteContentSyncPlan["tombstoned"][number], lease: SiteContentWorkerLease) => Promise<void>;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function siteContentSyncCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function siteContentSyncDigest(value: unknown): Digest {
  return `sha256:${createHash("sha256").update(siteContentSyncCanonicalJson(value)).digest("hex")}`;
}

export type SiteContentProjectionBinding = Readonly<{
  logicalId: string;
  recordKind: string;
  contentHash: Digest;
  projectionDigest: Digest;
}>;

export function bindSiteContentProjection(input: unknown): SiteContentProjectionBinding {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Site-content publication must be an object.");
  }
  const record = input as Record<string, unknown>;
  const governance = record.governance;
  if (record.kind !== undefined && record.recordKind !== undefined && record.kind !== record.recordKind) {
    throw new Error("Site-content publication kind and recordKind must not conflict.");
  }
  const recordKind = record.recordKind ?? record.kind;
  if (
    typeof record.logicalId !== "string" ||
    !record.logicalId.length ||
    typeof record.domain !== "string" ||
    !["services", "forms", "medications", "differentials"].includes(record.domain) ||
    typeof recordKind !== "string" ||
    !recordKind.length ||
    typeof record.slug !== "string" ||
    !record.slug.length ||
    !record.payload ||
    typeof record.payload !== "object" ||
    Array.isArray(record.payload) ||
    !governance ||
    typeof governance !== "object" ||
    Array.isArray(governance) ||
    (governance as Record<string, unknown>).sourceStatus !== "current" ||
    !["locally_reviewed", "approved"].includes(
      String((governance as Record<string, unknown>).validationStatus ?? ""),
    ) ||
    typeof record.publicationVersion !== "string" ||
    !record.publicationVersion.length ||
    typeof record.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(record.contentHash) ||
    typeof record.sourceLineageDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(record.sourceLineageDigest)
  ) {
    throw new Error("Site-content publication governance or projection identity is invalid.");
  }
  const identity = {
    logicalId: record.logicalId,
    domain: record.domain,
    recordKind,
    slug: record.slug,
    payload: record.payload,
    governance,
    publicationVersion: record.publicationVersion,
    contentHash: record.contentHash,
    sourceLineageDigest: record.sourceLineageDigest,
  };
  return Object.freeze({
    logicalId: record.logicalId,
    recordKind,
    contentHash: record.contentHash as Digest,
    projectionDigest: siteContentSyncDigest(identity),
  });
}

function assertDigest(value: string, label: string): asserts value is Digest {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a sha256 digest.`);
}

function sortedByLogicalId<T extends { logicalId: string }>(records: T[]) {
  return [...records].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

function reconcileLegacyRows(input: SiteContentSyncInput) {
  if (new Set(input.legacyDispositions.map((entry) => entry.logicalId)).size !== input.legacyDispositions.length) {
    throw new Error("Duplicate legacy dispositions are not permitted.");
  }
  const dispositions = new Map(input.legacyDispositions.map((entry) => [entry.logicalId, entry]));
  const grouped = new Map<string, typeof input.legacyRows>();
  for (const row of input.legacyRows) grouped.set(row.logicalId, [...(grouped.get(row.logicalId) ?? []), row]);
  const normalized = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([logicalId, rows]) => {
      const disposition = dispositions.get(logicalId);
      if (rows.length > 1 && !disposition) {
        throw new Error(`Duplicate legacy rows for ${logicalId} require an explicit administrator disposition.`);
      }
      if (disposition) {
        const rowIds = new Set(rows.map((row) => row.rowId));
        if (!rowIds.has(disposition.selectedRowId)) throw new Error(`Legacy disposition for ${logicalId} is invalid.`);
        const expectedRetired = rows
          .map((row) => row.rowId)
          .filter((rowId) => rowId !== disposition.selectedRowId)
          .sort();
        if (JSON.stringify([...disposition.retiredRowIds].sort()) !== JSON.stringify(expectedRetired)) {
          throw new Error(`Legacy disposition for ${logicalId} must account for every duplicate.`);
        }
      }
      return {
        logicalId,
        rows: rows
          .map(({ rowId, contentHash }) => ({ rowId, contentHash }))
          .sort((a, b) => a.rowId.localeCompare(b.rowId)),
        disposition: disposition
          ? {
              logicalId,
              selectedRowId: disposition.selectedRowId,
              retiredRowIds: [...disposition.retiredRowIds].sort(),
            }
          : null,
      };
    });
  const unmatched = input.legacyDispositions.filter((entry) => !grouped.has(entry.logicalId));
  if (unmatched.length) throw new Error("Legacy dispositions must identify an exact legacy logical identity.");
  return {
    normalized,
    dispositions: normalized.flatMap((entry) => (entry.disposition ? [entry.disposition] : [])),
    digest: siteContentSyncDigest(normalized),
  };
}

function releaseDigestBasis(plan: Omit<SiteContentSyncPlan, "planDigest" | "releaseDigest">) {
  return {
    projectRef: plan.projectRef,
    candidateReleaseId: plan.candidateReleaseId,
    previousReleaseId: plan.previousReleaseId,
    generationId: plan.generationId,
    registryVersion: plan.registryVersion,
    staticManifestDigest: plan.staticManifestDigest,
    embeddingContract: plan.embeddingContract,
    dynamicStateDigest: plan.dynamicStateDigest,
    operations: plan.operations,
    legacyReconciliationDigest: plan.legacyReconciliationDigest,
    legacyDispositions: plan.legacyDispositions,
    expectedCounts: plan.expectedCounts,
    recoveryEvidenceDigest: plan.recoveryEvidenceDigest,
  };
}

export function assertSiteContentSyncPlan(input: unknown): SiteContentSyncPlan {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Canonical site-content plan is required.");
  const plan = input as SiteContentSyncPlan;
  if (plan.version !== "site-content-sync-plan-v1" || !["dry-run", "write"].includes(plan.mode)) {
    throw new Error("Canonical site-content plan version/mode is invalid.");
  }
  if (!/^[a-f0-9]{40}$/.test(plan.deploymentSha)) {
    throw new Error("Canonical site-content plan deployment SHA is invalid.");
  }
  const operations = [...plan.operations].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  if (new Set(operations.map((entry) => entry.logicalId)).size !== operations.length) {
    throw new Error("Canonical operation logical identities must be unique.");
  }
  const expectedOperations = [
    ...plan.changed.map((entry) => ({
      logicalId: entry.logicalId,
      operation: "changed" as const,
      contentHash: entry.contentHash,
    })),
    ...plan.unchanged.map((entry) => ({
      logicalId: entry.logicalId,
      operation: "unchanged" as const,
      contentHash: entry.contentHash,
    })),
    ...plan.tombstoned.map((entry) => ({
      logicalId: entry.logicalId,
      operation: "tombstone" as const,
      contentHash: entry.priorContentHash,
    })),
  ].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  if (JSON.stringify(operations) !== JSON.stringify(expectedOperations))
    throw new Error("Canonical operation manifest mismatch.");
  if (
    plan.expectedCounts.desired !== plan.changed.length + plan.unchanged.length ||
    plan.expectedCounts.changed !== plan.changed.length ||
    plan.expectedCounts.unchanged !== plan.unchanged.length ||
    plan.expectedCounts.tombstoned !== plan.tombstoned.length
  ) {
    throw new Error("Canonical plan counts mismatch.");
  }
  if (siteContentSyncDigest(plan.legacyReconciliation) !== plan.legacyReconciliationDigest) {
    throw new Error("Legacy reconciliation digest mismatch.");
  }
  if (
    JSON.stringify(plan.legacyReconciliation.flatMap((entry) => (entry.disposition ? [entry.disposition] : []))) !==
    JSON.stringify(plan.legacyDispositions)
  ) {
    throw new Error("Legacy dispositions do not match the normalized reconciliation.");
  }
  if (plan.mode === "write") {
    const evidence = parseRecoveryReadinessEvidence(plan.recoveryEvidence);
    if (plan.recoveryEvidenceDigest !== evidence.digest) throw new Error("Recovery evidence digest mismatch.");
  } else if (plan.recoveryEvidenceDigest !== null || plan.recoveryEvidence !== undefined) {
    throw new Error("Dry-run plans cannot claim recovery authority.");
  }
  const { planDigest, releaseDigest, ...withoutDigests } = plan;
  if (
    siteContentSyncDigest(releaseDigestBasis(plan as Omit<SiteContentSyncPlan, "planDigest" | "releaseDigest">)) !==
    releaseDigest
  ) {
    throw new Error("Canonical release digest mismatch.");
  }
  if (siteContentSyncDigest({ ...withoutDigests, releaseDigest }) !== planDigest) {
    throw new Error("Canonical plan digest mismatch.");
  }
  return plan;
}

export function planSiteContentSync(input: SiteContentSyncInput): SiteContentSyncPlan {
  if (input.projectRef !== input.expectedProjectRef) throw new Error("Site-content target project identity mismatch.");
  if (!input.projectRef.trim()) throw new Error("Site-content target project is required.");
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 100) {
    throw new Error("Site-content batch size must be between 1 and 100.");
  }
  if (!input.expectedEmbedding.model.trim() || !Number.isInteger(input.expectedEmbedding.dimensions)) {
    throw new Error("Expected embedding model and dimensions are required.");
  }
  assertDigest(input.staticManifestDigest, "Static manifest digest");
  if (!/^[a-f0-9]{40}$/.test(input.deploymentSha)) {
    throw new Error("Deployment SHA must be a full lowercase commit SHA.");
  }
  const legacy = reconcileLegacyRows(input);
  const desired = sortedByLogicalId(input.desiredRecords);
  if (new Set(desired.map((record) => record.logicalId)).size !== desired.length) {
    throw new Error("Desired site-content logical identities must be globally unique.");
  }
  for (const record of desired) {
    assertDigest(record.contentHash, "Content hash");
    assertDigest(record.sourceLineageDigest, "Source-lineage digest");
  }
  const active = new Map(input.activeProjections.map((projection) => [projection.logicalId, projection]));
  const unchanged: SiteContentSyncPlan["unchanged"] = [];
  const changed: SiteContentSyncPlan["changed"] = [];
  for (const record of desired) {
    const projection = active.get(record.logicalId);
    if (
      projection &&
      projection.contentHash === record.contentHash &&
      projection.embedding.contentHash === record.contentHash &&
      projection.embedding.model === input.expectedEmbedding.model &&
      projection.embedding.dimensions === input.expectedEmbedding.dimensions
    ) {
      assertDigest(projection.embedding.digest, "Embedding digest");
      unchanged.push({ ...record, reusedEmbedding: projection.embedding });
    } else {
      changed.push({ ...record, changeKind: projection ? "changed" : "added" });
    }
  }
  const desiredIds = new Set(desired.map((record) => record.logicalId));
  const tombstoned = sortedByLogicalId(
    input.activeProjections
      .filter((projection) => !desiredIds.has(projection.logicalId))
      .map((projection) => ({ logicalId: projection.logicalId, priorContentHash: projection.contentHash })),
  );
  const dynamicStateDigest = siteContentSyncDigest(
    desired.map(({ logicalId, contentHash, publicationVersion, sourceLineageDigest }) => ({
      logicalId,
      contentHash,
      publicationVersion,
      sourceLineageDigest,
    })),
  );
  let recoveryEvidence: RecoveryReadinessEvidence | undefined;
  if (input.write) {
    recoveryEvidence = parseRecoveryReadinessEvidence(input.recoveryEvidence);
    assertRecoveryReadinessForOperation(recoveryEvidence, "site-release", input.projectRef, input.now ?? new Date());
  }
  const operations = [
    ...changed.map((entry) => ({
      logicalId: entry.logicalId,
      operation: "changed" as const,
      contentHash: entry.contentHash,
    })),
    ...unchanged.map((entry) => ({
      logicalId: entry.logicalId,
      operation: "unchanged" as const,
      contentHash: entry.contentHash,
    })),
    ...tombstoned.map((entry) => ({
      logicalId: entry.logicalId,
      operation: "tombstone" as const,
      contentHash: entry.priorContentHash,
    })),
  ].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  const planCore = {
    version: "site-content-sync-plan-v1" as const,
    mode: input.write ? ("write" as const) : ("dry-run" as const),
    projectRef: input.projectRef,
    candidateReleaseId: input.candidateReleaseId,
    previousReleaseId: input.previousReleaseId,
    generationId: input.generationId,
    registryVersion: input.registryVersion,
    deploymentSha: input.deploymentSha,
    staticManifestDigest: input.staticManifestDigest,
    embeddingContract: Object.freeze({ ...input.expectedEmbedding }),
    batchSize: input.batchSize,
    changed,
    unchanged,
    tombstoned,
    operations,
    legacyReconciliation: legacy.normalized,
    legacyDispositions: legacy.dispositions,
    legacyReconciliationDigest: legacy.digest,
    expectedCounts: {
      desired: desired.length,
      changed: changed.length,
      unchanged: unchanged.length,
      tombstoned: tombstoned.length,
    },
    dynamicStateDigest,
    recoveryEvidenceDigest: (recoveryEvidence?.digest as Digest | undefined) ?? null,
    ...(recoveryEvidence ? { recoveryEvidence } : {}),
  };
  const releaseDigest = siteContentSyncDigest(
    releaseDigestBasis(planCore as Omit<SiteContentSyncPlan, "planDigest" | "releaseDigest">),
  );
  const planWithoutDigest = { ...planCore, releaseDigest };
  return Object.freeze({ ...planWithoutDigest, planDigest: siteContentSyncDigest(planWithoutDigest) });
}

export async function runSiteContentSync(
  plan: SiteContentSyncPlan,
  lease: SiteContentWorkerLease,
  runtime: SiteContentSyncRuntime = {},
) {
  if (lease.generationId !== plan.generationId) throw new Error("Worker generation no longer owns this sync plan.");
  const now = runtime.now?.() ?? new Date();
  if (!Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= now.getTime()) {
    throw new Error("Worker lease has expired.");
  }
  for (const record of plan.changed) await runtime.stageChanged?.(record, lease);
  for (const record of plan.unchanged) await runtime.carryForward?.(record, lease);
  for (const record of plan.tombstoned) await runtime.tombstone?.(record, lease);
  return Object.freeze({
    changed: plan.changed.length,
    unchanged: plan.unchanged.length,
    tombstoned: plan.tombstoned.length,
    dynamicStateDigest: plan.dynamicStateDigest,
    releaseDigest: plan.releaseDigest,
  });
}

export function assertSiteReleaseReceiptPair(
  activationInput: unknown,
  rollbackInput: unknown,
): Readonly<{ activation: ActivationReceipt; rollback: RollbackReceipt }> {
  const pair = assertReceiptAppendOnlyPair(activationInput, rollbackInput);
  if (
    pair.activation.operation !== "site-release" ||
    pair.activation.resource.kind !== "site-release" ||
    pair.activation.previousResource.kind !== "site-release" ||
    pair.rollback.operation !== "site-release" ||
    pair.rollback.failedResource.kind !== "site-release" ||
    pair.rollback.restoredResource.kind !== "site-release"
  ) {
    throw new Error("Site-release activation and rollback receipt identities are required.");
  }
  return pair;
}
