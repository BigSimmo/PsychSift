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
  staticManifestDigest: Digest;
  embeddingContract: Readonly<{ model: string; dimensions: number }>;
  batchSize: number;
  changed: Array<SiteContentSyncRecord & { changeKind: "added" | "changed" }>;
  unchanged: Array<SiteContentSyncRecord & { reusedEmbedding: SiteContentEmbeddingIdentity }>;
  tombstoned: Array<{ logicalId: string; priorContentHash: Digest }>;
  legacyReconciliationDigest: Digest;
  expectedCounts: { desired: number; changed: number; unchanged: number; tombstoned: number };
  dynamicStateDigest: Digest;
  releaseDigest: Digest;
  planDigest: Digest;
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

function digest(value: unknown): Digest {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function assertDigest(value: string, label: string): asserts value is Digest {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a sha256 digest.`);
}

function sortedByLogicalId<T extends { logicalId: string }>(records: T[]) {
  return [...records].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

function reconcileLegacyRows(input: SiteContentSyncInput) {
  const dispositions = new Map(input.legacyDispositions.map((entry) => [entry.logicalId, entry]));
  const grouped = new Map<string, typeof input.legacyRows>();
  for (const row of input.legacyRows) grouped.set(row.logicalId, [...(grouped.get(row.logicalId) ?? []), row]);
  const normalized = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([logicalId, rows]) => {
      const hashes = new Set(rows.map((row) => row.contentHash));
      const disposition = dispositions.get(logicalId);
      if (hashes.size > 1 && !disposition) {
        throw new Error(`Divergent legacy rows for ${logicalId} require an explicit administrator disposition.`);
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
        disposition: disposition ?? null,
      };
    });
  return digest(normalized);
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
  const legacyReconciliationDigest = reconcileLegacyRows(input);
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
  const dynamicStateDigest = digest(
    desired.map(({ logicalId, contentHash, publicationVersion, sourceLineageDigest }) => ({
      logicalId,
      contentHash,
      publicationVersion,
      sourceLineageDigest,
    })),
  );
  const releaseDigest = digest({
    registryVersion: input.registryVersion,
    staticManifestDigest: input.staticManifestDigest,
    embeddingContract: Object.freeze({ ...input.expectedEmbedding }),
    dynamicStateDigest,
    generationId: input.generationId,
  });
  let recoveryEvidence: RecoveryReadinessEvidence | undefined;
  if (input.write) {
    recoveryEvidence = parseRecoveryReadinessEvidence(input.recoveryEvidence);
    assertRecoveryReadinessForOperation(recoveryEvidence, "site-release", input.projectRef, input.now ?? new Date());
  }
  const planWithoutDigest = {
    version: "site-content-sync-plan-v1" as const,
    mode: input.write ? ("write" as const) : ("dry-run" as const),
    projectRef: input.projectRef,
    candidateReleaseId: input.candidateReleaseId,
    previousReleaseId: input.previousReleaseId,
    generationId: input.generationId,
    registryVersion: input.registryVersion,
    staticManifestDigest: input.staticManifestDigest,
    embeddingContract: Object.freeze({ ...input.expectedEmbedding }),
    batchSize: input.batchSize,
    changed,
    unchanged,
    tombstoned,
    legacyReconciliationDigest,
    expectedCounts: {
      desired: desired.length,
      changed: changed.length,
      unchanged: unchanged.length,
      tombstoned: tombstoned.length,
    },
    dynamicStateDigest,
    releaseDigest,
    ...(recoveryEvidence ? { recoveryEvidence } : {}),
  };
  return Object.freeze({ ...planWithoutDigest, planDigest: digest(planWithoutDigest) });
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
