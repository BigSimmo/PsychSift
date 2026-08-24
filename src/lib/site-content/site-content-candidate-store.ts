import { createHash } from "node:crypto";

import type { SiteContentSyncPlan, SiteContentWorkerLease } from "@/lib/site-content/site-content-sync";

type Digest = `sha256:${string}`;
type CandidateLease = SiteContentWorkerLease & { attempt: number };

type Projection = Readonly<{
  logicalId: string;
  contentHash: Digest;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  embeddingDigest: Digest | null;
  tombstoned: boolean;
}>;

type CandidateState = {
  projectRef: string;
  generationId: string;
  planDigest: Digest;
  releaseDigest: Digest;
  staticManifestDigest: Digest;
  dynamicStateDigest: Digest;
  embeddingContract: SiteContentSyncPlan["embeddingContract"];
  expectedCounts: SiteContentSyncPlan["expectedCounts"];
  applied: Set<string>;
  projections: Map<string, Projection>;
  completed: boolean;
};

type ResumeRuntime = {
  projectRef: string;
  now: () => Date;
  embed: (logicalId: string) => Promise<Float32Array>;
  reusedEmbeddingBytes: (logicalId: string) => Float32Array;
  assertLease?: (lease: CandidateLease) => void | Promise<void>;
  interruptAfter?: number;
};

export function embeddingBytesDigest(bytes: Float32Array): Digest {
  return `sha256:${createHash("sha256")
    .update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex")}`;
}

function assertLease(plan: SiteContentSyncPlan, lease: CandidateLease, runtime: ResumeRuntime) {
  if (lease.generationId !== plan.generationId || !Number.isInteger(lease.attempt) || lease.attempt < 1) {
    throw new Error("Candidate lease generation/attempt binding mismatch.");
  }
  if (Date.parse(lease.expiresAt) <= runtime.now().getTime()) throw new Error("Candidate lease expired.");
}

export type CandidateProjectionStoreState = ReadonlyArray<
  Omit<CandidateState, "applied" | "projections"> & {
    candidateReleaseId: string;
    applied: string[];
    projections: Projection[];
  }
>;

export function createCandidateProjectionStore(initial: CandidateProjectionStoreState = []) {
  const candidates = new Map<string, CandidateState>();
  for (const persisted of initial) {
    candidates.set(persisted.candidateReleaseId, {
      ...persisted,
      applied: new Set(persisted.applied),
      projections: new Map(persisted.projections.map((projection) => [projection.logicalId, projection])),
    });
  }

  async function resume(plan: SiteContentSyncPlan, lease: CandidateLease, runtime: ResumeRuntime) {
    assertLease(plan, lease, runtime);
    await runtime.assertLease?.(lease);
    const existing = candidates.get(plan.candidateReleaseId);
    const state: CandidateState = existing ?? {
      projectRef: runtime.projectRef,
      generationId: plan.generationId,
      planDigest: plan.planDigest,
      releaseDigest: plan.releaseDigest,
      staticManifestDigest: plan.staticManifestDigest,
      dynamicStateDigest: plan.dynamicStateDigest,
      embeddingContract: plan.embeddingContract,
      expectedCounts: plan.expectedCounts,
      applied: new Set(),
      projections: new Map(),
      completed: false,
    };
    const expectedBinding = JSON.stringify({
      projectRef: runtime.projectRef,
      generationId: plan.generationId,
      planDigest: plan.planDigest,
      releaseDigest: plan.releaseDigest,
      staticManifestDigest: plan.staticManifestDigest,
      dynamicStateDigest: plan.dynamicStateDigest,
      embeddingContract: plan.embeddingContract,
      expectedCounts: plan.expectedCounts,
    });
    const actualBinding = JSON.stringify({
      projectRef: state.projectRef,
      generationId: state.generationId,
      planDigest: state.planDigest,
      releaseDigest: state.releaseDigest,
      staticManifestDigest: state.staticManifestDigest,
      dynamicStateDigest: state.dynamicStateDigest,
      embeddingContract: state.embeddingContract,
      expectedCounts: state.expectedCounts,
    });
    if (expectedBinding !== actualBinding) throw new Error("Candidate target/digest/count binding mismatch.");
    candidates.set(plan.candidateReleaseId, state);

    let mutations = 0;
    const beforeMutation = async () => {
      assertLease(plan, lease, runtime);
      await runtime.assertLease?.(lease);
    };
    for (const record of plan.changed) {
      if (state.applied.has(`changed:${record.logicalId}`)) continue;
      await beforeMutation();
      const bytes = await runtime.embed(record.logicalId);
      await beforeMutation();
      if (bytes.length !== plan.embeddingContract.dimensions) {
        throw new Error("Generated embedding model/dimension binding mismatch.");
      }
      state.projections.set(record.logicalId, {
        logicalId: record.logicalId,
        contentHash: record.contentHash,
        embeddingModel: plan.embeddingContract.model,
        embeddingDimensions: bytes.length,
        embeddingDigest: embeddingBytesDigest(bytes),
        tombstoned: false,
      });
      state.applied.add(`changed:${record.logicalId}`);
      mutations += 1;
      if (mutations === runtime.interruptAfter) throw new Error("Synthetic candidate synchronization interrupted.");
    }
    for (const record of plan.unchanged) {
      if (state.applied.has(`unchanged:${record.logicalId}`)) continue;
      await beforeMutation();
      const bytes = runtime.reusedEmbeddingBytes(record.logicalId);
      if (
        bytes.length !== record.reusedEmbedding.dimensions ||
        embeddingBytesDigest(bytes) !== record.reusedEmbedding.digest
      ) {
        throw new Error("Verified embedding byte/model/dimension reuse mismatch.");
      }
      state.projections.set(record.logicalId, {
        logicalId: record.logicalId,
        contentHash: record.contentHash,
        embeddingModel: record.reusedEmbedding.model,
        embeddingDimensions: record.reusedEmbedding.dimensions,
        embeddingDigest: record.reusedEmbedding.digest,
        tombstoned: false,
      });
      state.applied.add(`unchanged:${record.logicalId}`);
      mutations += 1;
      if (mutations === runtime.interruptAfter) throw new Error("Synthetic candidate synchronization interrupted.");
    }
    for (const record of plan.tombstoned) {
      if (state.applied.has(`tombstone:${record.logicalId}`)) continue;
      await beforeMutation();
      state.projections.set(record.logicalId, {
        logicalId: record.logicalId,
        contentHash: record.priorContentHash,
        embeddingModel: null,
        embeddingDimensions: null,
        embeddingDigest: null,
        tombstoned: true,
      });
      state.applied.add(`tombstone:${record.logicalId}`);
      mutations += 1;
      if (mutations === runtime.interruptAfter) throw new Error("Synthetic candidate synchronization interrupted.");
    }
    state.completed = state.applied.size === plan.changed.length + plan.unchanged.length + plan.tombstoned.length;
    return state;
  }

  function snapshot(candidateReleaseId: string) {
    const state = candidates.get(candidateReleaseId);
    if (!state) return null;
    return Object.freeze({
      projectRef: state.projectRef,
      generationId: state.generationId,
      planDigest: state.planDigest,
      releaseDigest: state.releaseDigest,
      staticManifestDigest: state.staticManifestDigest,
      dynamicStateDigest: state.dynamicStateDigest,
      embeddingContract: state.embeddingContract,
      expectedCounts: state.expectedCounts,
      completed: state.completed,
      projections: [...state.projections.values()],
    });
  }

  function exportState(): CandidateProjectionStoreState {
    return [...candidates.entries()].map(([candidateReleaseId, state]) => ({
      candidateReleaseId,
      ...state,
      applied: [...state.applied],
      projections: [...state.projections.values()],
    }));
  }

  return Object.freeze({ resume, snapshot, exportState });
}
