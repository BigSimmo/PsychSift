import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import {
  canonicalSiteContentText,
  compareCanonicalSiteContentIdentifiers,
  siteContentValueHash,
  validateSiteContentRecords,
  validateStaticSiteContentManifest,
  type StaticSiteContentManifest,
} from "@/lib/site-content/site-content-manifest";
import { canCarryForwardRegistryEmbedding } from "@/lib/site-content/adapters/registry";

export type SiteContentSyncSourceRecord = {
  record: SiteContentRecord;
  renderPayload?: unknown;
  targetPublicationId?: string;
  documentId: string;
  chunkId: string;
  publicMetadataFingerprint: string;
  governanceFingerprint: string;
  lineageFingerprint: string;
};

export type SiteContentSyncPlanItem = {
  logicalId: string;
  normalizedText: string;
  reuseEmbedding: boolean;
  embedding?: number[];
  tombstone?: boolean;
  documentId?: string;
  chunkId?: string;
  targetPublicationId?: string;
  publicationFingerprint?: string;
  contentHash?: string;
  governanceFingerprint?: string;
  lineageFingerprint?: string;
  publicMetadataFingerprint?: string;
  renderPayload?: unknown;
};

export type ExistingSiteContentReleaseRecord = {
  logicalId: string;
  targetPublicationId: string | null;
  publicationFingerprint: string;
  contentHash: string;
  governanceFingerprint: string;
  lineageFingerprint: string;
  publicMetadataFingerprint: string;
  normalizedText: string;
  documentId: string;
  chunkId: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingFingerprint: string;
  embedding: number[] | null;
  tombstone: boolean;
};

export type SiteContentSyncPlan = {
  version: "site-content-sync-plan-v1";
  releaseId: string;
  planDigest: string;
  releaseDigest: string;
  dynamicStateDigest: string;
  targetChangeEpoch: string;
  generationId: string;
  registryVersion: string;
  staticManifestDigest: string;
  reconciliationPlanDigest: string | null;
  embedding: { model: string; dimensions: number; fingerprint: string };
  added: SiteContentSyncPlanItem[];
  changed: SiteContentSyncPlanItem[];
  unchanged: SiteContentSyncPlanItem[];
  tombstones: SiteContentSyncPlanItem[];
  counts: { added: number; changed: number; unchanged: number; tombstones: number; total: number };
};

export type SiteContentSyncInput = {
  manifest: StaticSiteContentManifest;
  staticRecords: readonly SiteContentSyncSourceRecord[];
  dynamicRecords: readonly SiteContentSyncSourceRecord[];
  existingReleaseRecords: readonly ExistingSiteContentReleaseRecord[];
  registryVersion: string;
  targetChangeEpoch: string;
  generationId: string;
  embedding: { model: string; dimensions: number; fingerprint: string };
  retirementTargets?: readonly { logicalId: string; targetPublicationId: string }[];
  reconciliationPlanDigest?: string | null;
  actorId?: string;
  leaseToken?: string;
};

function logicalIdOf(value: { logicalId: string } | SiteContentSyncSourceRecord): string {
  return "logicalId" in value ? value.logicalId : value.record.logicalId;
}

function sorted<T extends { logicalId: string } | SiteContentSyncSourceRecord>(records: readonly T[]): T[] {
  return [...records].sort((left, right) =>
    compareCanonicalSiteContentIdentifiers(logicalIdOf(left), logicalIdOf(right)),
  );
}

function assertExactStaticPopulation(
  manifest: StaticSiteContentManifest,
  records: readonly SiteContentSyncSourceRecord[],
) {
  const byId = new Map(records.map((entry) => [entry.record.logicalId, entry]));
  if (byId.size !== records.length || records.length !== manifest.records.length) {
    throw new Error("Static site-content population does not exactly match the manifest.");
  }
  for (const expected of manifest.records) {
    const actual = byId.get(expected.logicalId);
    if (
      !actual ||
      actual.record.contentHash !== expected.contentHash ||
      siteContentValueHash(actual.record.sourceLineage) !== expected.lineageDigest
    ) {
      throw new Error(`Static site-content record ${expected.logicalId} does not match the manifest.`);
    }
  }
}

function publicPopulationDigestProjection(entry: SiteContentSyncSourceRecord) {
  return {
    logicalId: entry.record.logicalId,
    documentId: entry.documentId,
    chunkId: entry.chunkId,
    publicationVersion: entry.record.publicationVersion,
    contentHash: entry.record.contentHash,
    governanceFingerprint: entry.governanceFingerprint,
    lineageFingerprint: entry.lineageFingerprint,
    publicMetadataFingerprint: entry.publicMetadataFingerprint,
    tombstone: false,
  };
}

function releaseDigestProjection(entry: SiteContentSyncSourceRecord, embedding: SiteContentSyncInput["embedding"]) {
  return {
    ...publicPopulationDigestProjection(entry),
    embeddingModel: embedding.model,
    embeddingDimensions: embedding.dimensions,
    embeddingFingerprint: embedding.fingerprint,
  };
}

function uuidFromDigest(digest: string) {
  const hex = digest.slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function planItem(
  source: SiteContentSyncSourceRecord,
  options: { reuseEmbedding: boolean; embedding?: number[] | null },
): SiteContentSyncPlanItem {
  return {
    logicalId: source.record.logicalId,
    normalizedText: canonicalSiteContentText(source.record.body),
    reuseEmbedding: options.reuseEmbedding,
    ...(options.embedding ? { embedding: [...options.embedding] } : {}),
    documentId: source.documentId,
    chunkId: source.chunkId,
    ...(source.targetPublicationId ? { targetPublicationId: source.targetPublicationId } : {}),
    publicationFingerprint: source.record.publicationVersion,
    contentHash: source.record.contentHash,
    governanceFingerprint: source.governanceFingerprint,
    lineageFingerprint: source.lineageFingerprint,
    publicMetadataFingerprint: source.publicMetadataFingerprint,
    ...(source.renderPayload !== undefined ? { renderPayload: source.renderPayload } : {}),
  };
}

export function planSiteContentSync(input: SiteContentSyncInput): SiteContentSyncPlan {
  const manifest = validateStaticSiteContentManifest(input.manifest, {
    expectedRegistryVersion: input.registryVersion,
  });
  validateSiteContentRecords([...input.staticRecords, ...input.dynamicRecords].map((entry) => entry.record));
  assertExactStaticPopulation(manifest, input.staticRecords);
  if (!/^\d+$/.test(input.targetChangeEpoch) || BigInt(input.targetChangeEpoch) < 0n) {
    throw new Error("Site-content target change epoch must be a non-negative integer string.");
  }
  if (!input.generationId.trim()) throw new Error("Site-content generation id is required.");
  if (
    !input.embedding.model ||
    !input.embedding.fingerprint ||
    !Number.isInteger(input.embedding.dimensions) ||
    input.embedding.dimensions !== 1536
  ) {
    throw new Error("Site-content embedding dimensions must be exactly 1536.");
  }

  const population = sorted([...input.staticRecords, ...input.dynamicRecords]);
  const ids = new Set<string>();
  for (const entry of population) {
    if (ids.has(entry.record.logicalId)) throw new Error(`Duplicate logicalId: ${entry.record.logicalId}`);
    ids.add(entry.record.logicalId);
  }
  const existingById = new Map(input.existingReleaseRecords.map((entry) => [entry.logicalId, entry]));
  if (existingById.size !== input.existingReleaseRecords.length) {
    throw new Error("Existing site-content release records contain duplicate logical ids.");
  }
  const retirementTargets = new Map(
    (input.retirementTargets ?? []).map((entry) => [entry.logicalId, entry.targetPublicationId]),
  );
  if (retirementTargets.size !== (input.retirementTargets ?? []).length) {
    throw new Error("Site-content retirement targets contain duplicate logical ids.");
  }

  const added: SiteContentSyncPlanItem[] = [];
  const changed: SiteContentSyncPlanItem[] = [];
  const unchanged: SiteContentSyncPlanItem[] = [];
  for (const source of population) {
    const existing = existingById.get(source.record.logicalId);
    if (!existing || existing.tombstone) {
      added.push(planItem(source, { reuseEmbedding: false }));
      continue;
    }
    existingById.delete(source.record.logicalId);
    const exact =
      (existing.targetPublicationId ?? undefined) === source.targetPublicationId &&
      existing.contentHash === source.record.contentHash &&
      existing.publicationFingerprint === source.record.publicationVersion &&
      existing.governanceFingerprint === source.governanceFingerprint &&
      existing.lineageFingerprint === source.lineageFingerprint &&
      existing.publicMetadataFingerprint === source.publicMetadataFingerprint &&
      existing.documentId === source.documentId &&
      existing.chunkId === source.chunkId &&
      existing.embeddingModel === input.embedding.model &&
      existing.embeddingDimensions === input.embedding.dimensions &&
      existing.embeddingFingerprint === input.embedding.fingerprint &&
      existing.embedding !== null;
    if (exact) {
      unchanged.push(planItem(source, { reuseEmbedding: true, embedding: existing.embedding }));
      continue;
    }
    const reusable =
      existing.embedding !== null &&
      existing.contentHash === source.record.contentHash &&
      existing.publicationFingerprint === source.record.publicationVersion &&
      existing.governanceFingerprint === source.governanceFingerprint &&
      existing.documentId === source.documentId &&
      existing.chunkId === source.chunkId &&
      existing.embeddingFingerprint === input.embedding.fingerprint &&
      canCarryForwardRegistryEmbedding(
        {
          normalizedText: existing.normalizedText,
          model: existing.embeddingModel,
          dimensions: existing.embeddingDimensions,
        },
        { normalizedText: source.record.body, model: input.embedding.model, dimensions: input.embedding.dimensions },
      );
    changed.push(planItem(source, { reuseEmbedding: reusable, embedding: reusable ? existing.embedding : null }));
  }

  const tombstones = sorted([...existingById.values()].filter((entry) => !entry.tombstone)).map((entry) => {
    const targetPublicationId = retirementTargets.get(entry.logicalId) ?? entry.targetPublicationId;
    retirementTargets.delete(entry.logicalId);
    return {
      logicalId: entry.logicalId,
      normalizedText: "",
      reuseEmbedding: false,
      tombstone: true,
      documentId: entry.documentId,
      chunkId: entry.chunkId,
      ...(targetPublicationId ? { targetPublicationId } : {}),
      publicationFingerprint: entry.publicationFingerprint,
      contentHash: entry.contentHash,
      governanceFingerprint: entry.governanceFingerprint,
      lineageFingerprint: entry.lineageFingerprint,
      publicMetadataFingerprint: entry.publicMetadataFingerprint,
    };
  });
  if (retirementTargets.size) throw new Error("Site-content retirement target does not identify a removed record.");
  const dynamicProjection = sorted(input.dynamicRecords).map(publicPopulationDigestProjection);
  const dynamicStateDigest = siteContentValueHash({
    version: "site-content-dynamic-state-v1",
    records: dynamicProjection,
  });
  const releaseProjection = population.map((entry) => releaseDigestProjection(entry, input.embedding));
  const releaseDigest = siteContentValueHash({
    version: "site-content-release-digest-v1",
    registryVersion: input.registryVersion,
    staticManifestDigest: manifest.staticManifestDigest,
    dynamicStateDigest,
    records: releaseProjection,
    tombstones: tombstones.map((entry) => ({
      logicalId: entry.logicalId,
      documentId: entry.documentId,
      chunkId: entry.chunkId,
      tombstone: true,
    })),
  });
  const counts = {
    added: added.length,
    changed: changed.length,
    unchanged: unchanged.length,
    tombstones: tombstones.length,
    total: population.length + tombstones.length,
  };
  const governedPlan = {
    version: "site-content-sync-plan-v1" as const,
    releaseDigest,
    dynamicStateDigest,
    targetChangeEpoch: input.targetChangeEpoch,
    generationId: input.generationId,
    registryVersion: input.registryVersion,
    staticManifestDigest: manifest.staticManifestDigest,
    reconciliationPlanDigest: input.reconciliationPlanDigest ?? null,
    embedding: input.embedding,
    added,
    changed,
    unchanged,
    tombstones,
    counts,
  };
  const releaseId = uuidFromDigest(
    siteContentValueHash({
      version: "site-content-release-instance-v1",
      releaseDigest,
      targetChangeEpoch: input.targetChangeEpoch,
      generationId: input.generationId,
    }),
  );
  const contentAddressedPlan = { ...governedPlan, releaseId };
  return {
    ...contentAddressedPlan,
    planDigest: siteContentValueHash({ domain: "site-content-sync-plan-v1", ...contentAddressedPlan }),
  };
}

export type SiteContentSyncLease = {
  eventId: string;
  workerId: string;
  leaseToken: string;
  leaseGeneration: number;
};

export type SiteContentSyncAdapters = {
  embed: (records: Array<{ logicalId: string; text: string }>) => Promise<Map<string, number[]>>;
  heartbeat: (lease: SiteContentSyncLease) => Promise<boolean>;
  stage: (
    plan: SiteContentSyncPlan,
    records: Array<SiteContentSyncPlanItem & { embedding?: number[] }>,
    lease: SiteContentSyncLease,
  ) => Promise<boolean>;
  fail: (lease: SiteContentSyncLease, code: "provider_failure" | "staging_failure") => Promise<boolean>;
  log?: (event: { code: string; eventId: string; count: number }) => void;
};

export async function runSiteContentSync(
  plan: SiteContentSyncPlan,
  lease: SiteContentSyncLease,
  adapters: SiteContentSyncAdapters,
): Promise<{ embeddedCount: number; stagedCount: number; tombstoneCount: number }> {
  const changed = [...plan.added, ...plan.changed];
  const requiresEmbedding = changed
    .filter((entry) => !entry.reuseEmbedding && !entry.tombstone)
    .map((entry) => ({ logicalId: entry.logicalId, text: entry.normalizedText }));
  let embeddings = new Map<string, number[]>();
  if (requiresEmbedding.length > 0) {
    if (!(await adapters.heartbeat(lease))) throw new Error("SITE_CONTENT_LEASE_STALE");
    let periodicHeartbeatFailed = false;
    const heartbeatTimer = setInterval(() => {
      void adapters
        .heartbeat(lease)
        .then((alive) => {
          if (!alive) periodicHeartbeatFailed = true;
        })
        .catch(() => {
          periodicHeartbeatFailed = true;
        });
    }, 30_000);
    try {
      embeddings = await adapters.embed(requiresEmbedding);
    } catch {
      await adapters.fail(lease, "provider_failure");
      adapters.log?.({
        code: "SITE_CONTENT_EMBEDDING_FAILED",
        eventId: lease.eventId,
        count: requiresEmbedding.length,
      });
      throw new Error("SITE_CONTENT_EMBEDDING_FAILED");
    } finally {
      clearInterval(heartbeatTimer);
    }
    if (periodicHeartbeatFailed || !(await adapters.heartbeat(lease))) throw new Error("SITE_CONTENT_LEASE_STALE");
  }
  const staged = [...changed, ...plan.unchanged, ...plan.tombstones].map((entry) => {
    const embedding = entry.reuseEmbedding ? entry.embedding : embeddings.get(entry.logicalId);
    if (!entry.tombstone && !embedding) throw new Error("SITE_CONTENT_EMBEDDING_MISSING");
    return { ...entry, ...(embedding ? { embedding } : {}) };
  });
  if (!(await adapters.stage(plan, staged, lease))) {
    await adapters.fail(lease, "staging_failure");
    throw new Error("SITE_CONTENT_STAGE_REJECTED");
  }
  adapters.log?.({ code: "SITE_CONTENT_STAGE_READY", eventId: lease.eventId, count: staged.length });
  return {
    embeddedCount: requiresEmbedding.length,
    stagedCount: staged.length,
    tombstoneCount: plan.tombstones.length,
  };
}
