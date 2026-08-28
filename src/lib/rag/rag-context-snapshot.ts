import { createHash } from "node:crypto";
import type {
  ActiveSiteContentRelease,
  AustralianPublicSnapshotIdentity,
  RagContextSnapshot,
  SiteContentPartitionSnapshot,
  UploadedLocalSnapshotIdentity,
} from "@/lib/site-content/site-content-contracts";
import {
  assertSiteContentPartitionSnapshot,
  siteContentPendingLogicalIdsDigest,
} from "@/lib/site-content/site-content-registry";
import type { RagProgrammeMode } from "@/lib/types";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const RELEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const rolloutVersions = new Set<RagProgrammeMode>(["legacy", "shadow", "canary"]);

export type RagContextSnapshotInput = Readonly<{
  expectedSiteStaticManifestDigest: string | null;
  activePublicSiteRelease: ActiveSiteContentRelease | null;
  publicSiteChangeEpoch: string | null;
  pendingPublicSiteChangeCount: number;
  pendingPublicSiteLogicalIds: readonly string[];
  documentIndexGeneration: string;
  sourcePolicyVersion: string;
  rolloutVersion: RagProgrammeMode;
  uploadedLocal?: UploadedLocalSnapshotIdentity;
  australianPublic?: AustralianPublicSnapshotIdentity;
  resolvedAt?: string;
}>;

export type ResolvedRagContextSnapshot = RagContextSnapshot &
  Readonly<{
    rolloutVersion: RagProgrammeMode;
    publicSiteContent: SiteContentPartitionSnapshot;
  }>;

export function selectRequestRagContextSnapshot(
  direct: ResolvedRagContextSnapshot | undefined,
  cached: ResolvedRagContextSnapshot | undefined,
) {
  if (direct && cached && direct !== cached) {
    throw new Error("RAG request received conflicting context snapshot references.");
  }
  return direct ?? cached;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function sha256Digest(value: unknown): value is string {
  return typeof value === "string" && SHA256_DIGEST.test(value);
}

function exactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function activeReleaseValid(value: unknown): value is ActiveSiteContentRelease {
  if (!value || typeof value !== "object") return false;
  const release = value as Record<string, unknown>;
  return (
    release.version === "clinical-kb-site-release-v1" &&
    release.state === "active" &&
    typeof release.releaseId === "string" &&
    RELEASE_ID.test(release.releaseId) &&
    nonEmpty(release.registryVersion) &&
    sha256Digest(release.staticManifestDigest) &&
    sha256Digest(release.dynamicStateDigest) &&
    sha256Digest(release.releaseDigest) &&
    exactIsoTimestamp(release.activatedAt)
  );
}

function canonicalPendingLogicalIds(input: RagContextSnapshotInput): string[] | null {
  if (
    !Number.isSafeInteger(input.pendingPublicSiteChangeCount) ||
    input.pendingPublicSiteChangeCount < 0 ||
    !Array.isArray(input.pendingPublicSiteLogicalIds)
  ) {
    return null;
  }
  const ids = [...input.pendingPublicSiteLogicalIds];
  const canonical = [...ids].sort();
  if (
    ids.length !== input.pendingPublicSiteChangeCount ||
    ids.some((id) => !nonEmpty(id)) ||
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => canonical[index] !== id)
  ) {
    return null;
  }
  return ids;
}

function identityFreeSitePartition(state: "disabled" | "unavailable"): SiteContentPartitionSnapshot {
  return {
    registryVersion: null,
    releaseId: null,
    expectedStaticManifestDigest: null,
    activeStaticManifestDigest: null,
    staticManifestDigest: null,
    staticManifestMatch: false,
    dynamicStateDigest: null,
    releaseDigest: null,
    changeEpoch: null,
    pendingLogicalIds: [],
    pendingLogicalIdsDigest: null,
    state,
  };
}

function resolveSitePartition(input: RagContextSnapshotInput, resolvedAt: string): SiteContentPartitionSnapshot {
  const disabled =
    input.expectedSiteStaticManifestDigest === null &&
    input.activePublicSiteRelease === null &&
    input.publicSiteChangeEpoch === null &&
    input.pendingPublicSiteChangeCount === 0 &&
    Array.isArray(input.pendingPublicSiteLogicalIds) &&
    input.pendingPublicSiteLogicalIds.length === 0;
  if (disabled) return identityFreeSitePartition("disabled");

  const pendingLogicalIds = canonicalPendingLogicalIds(input);
  const release = input.activePublicSiteRelease;
  if (
    !sha256Digest(input.expectedSiteStaticManifestDigest) ||
    !activeReleaseValid(release) ||
    Date.parse(release.activatedAt) > Date.parse(resolvedAt) ||
    !nonEmpty(input.publicSiteChangeEpoch) ||
    pendingLogicalIds === null
  ) {
    return identityFreeSitePartition("unavailable");
  }

  const staticManifestMatch = input.expectedSiteStaticManifestDigest === release.staticManifestDigest;
  if (!staticManifestMatch && pendingLogicalIds.length > 0) return identityFreeSitePartition("unavailable");
  const partition: SiteContentPartitionSnapshot = {
    registryVersion: release.registryVersion,
    releaseId: release.releaseId,
    expectedStaticManifestDigest: input.expectedSiteStaticManifestDigest,
    activeStaticManifestDigest: release.staticManifestDigest,
    staticManifestDigest: release.staticManifestDigest,
    staticManifestMatch,
    dynamicStateDigest: release.dynamicStateDigest,
    releaseDigest: release.releaseDigest,
    changeEpoch: input.publicSiteChangeEpoch,
    pendingLogicalIds,
    pendingLogicalIdsDigest: siteContentPendingLogicalIdsDigest(pendingLogicalIds),
    state: staticManifestMatch ? (pendingLogicalIds.length > 0 ? "updating" : "current") : "stale",
  };
  assertSiteContentPartitionSnapshot(partition);
  return partition;
}

function freezeSnapshot(snapshot: ResolvedRagContextSnapshot): ResolvedRagContextSnapshot {
  Object.freeze(snapshot.publicSiteContent.pendingLogicalIds);
  Object.freeze(snapshot.publicSiteContent);
  Object.freeze(snapshot.uploadedLocal);
  Object.freeze(snapshot.australianPublic);
  return Object.freeze(snapshot);
}

export function resolveRagContextSnapshot(input: RagContextSnapshotInput): ResolvedRagContextSnapshot {
  if (!nonEmpty(input.documentIndexGeneration) || !nonEmpty(input.sourcePolicyVersion)) {
    throw new Error("RAG context snapshot requires document-index and source-policy authority.");
  }
  if (
    input.uploadedLocal &&
    (!nonEmpty(input.uploadedLocal.indexGeneration) || !sha256Digest(input.uploadedLocal.activationDigest))
  ) {
    throw new Error("RAG context snapshot received malformed uploaded-local identity.");
  }
  if (
    input.australianPublic &&
    ((input.australianPublic.indexGeneration !== null && !nonEmpty(input.australianPublic.indexGeneration)) ||
      (input.australianPublic.releaseDigest !== null && !sha256Digest(input.australianPublic.releaseDigest)))
  ) {
    throw new Error("RAG context snapshot received malformed Australian-public identity.");
  }
  if (!rolloutVersions.has(input.rolloutVersion)) {
    throw new Error("RAG context snapshot received an unknown programme mode.");
  }
  if (input.resolvedAt !== undefined && !exactIsoTimestamp(input.resolvedAt)) {
    throw new Error("RAG context snapshot resolvedAt must be an exact ISO timestamp.");
  }
  const resolvedAt = input.resolvedAt ?? new Date().toISOString();
  const snapshot: ResolvedRagContextSnapshot = {
    version: "rag-context-snapshot-v1",
    resolvedAt,
    documentIndexGeneration: input.documentIndexGeneration,
    sourcePolicyVersion: input.sourcePolicyVersion,
    rolloutVersion: input.rolloutVersion,
    uploadedLocal: input.uploadedLocal
      ? { ...input.uploadedLocal }
      : {
          indexGeneration: input.documentIndexGeneration,
          activationDigest: `sha256:${opaqueDigest(input.documentIndexGeneration)}`,
        },
    australianPublic: input.australianPublic
      ? { ...input.australianPublic }
      : {
          indexGeneration: null,
          releaseDigest: null,
        },
    publicSiteContent: resolveSitePartition(input, resolvedAt),
  };
  return freezeSnapshot(snapshot);
}

function opaqueDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function ragContextSnapshotCacheKey(snapshot: ResolvedRagContextSnapshot) {
  return `rag-context-snapshot-v1:${opaqueDigest({
    version: snapshot.version,
    documentIndexGeneration: snapshot.documentIndexGeneration,
    sourcePolicyVersion: snapshot.sourcePolicyVersion,
    rolloutVersion: snapshot.rolloutVersion,
    uploadedLocal: {
      indexGeneration: snapshot.uploadedLocal.indexGeneration,
      activationDigest: snapshot.uploadedLocal.activationDigest,
    },
    australianPublic: {
      indexGeneration: snapshot.australianPublic.indexGeneration,
      releaseDigest: snapshot.australianPublic.releaseDigest,
    },
    publicSiteContent: {
      state: snapshot.publicSiteContent.state,
      registryVersion: snapshot.publicSiteContent.registryVersion,
      expectedStaticManifestDigest: snapshot.publicSiteContent.expectedStaticManifestDigest,
      activeStaticManifestDigest: snapshot.publicSiteContent.activeStaticManifestDigest,
      staticManifestDigest: snapshot.publicSiteContent.staticManifestDigest,
      dynamicStateDigest: snapshot.publicSiteContent.dynamicStateDigest,
      releaseDigest: snapshot.publicSiteContent.releaseDigest,
      changeEpoch: snapshot.publicSiteContent.changeEpoch,
      pendingLogicalIdsDigest: snapshot.publicSiteContent.pendingLogicalIdsDigest,
    },
  })}`;
}

export function ragContextSnapshotTelemetry(snapshot: ResolvedRagContextSnapshot) {
  const pendingCount = snapshot.publicSiteContent.pendingLogicalIds.length;
  return {
    site_content_state: snapshot.publicSiteContent.state,
    site_content_static_manifest_match: snapshot.publicSiteContent.staticManifestMatch,
    site_content_pending_bucket:
      pendingCount === 0 ? "none" : pendingCount === 1 ? "one" : pendingCount < 10 ? "few" : "many",
  } as const;
}

export function ragContextSnapshotInvalidationTags(snapshot: ResolvedRagContextSnapshot) {
  const tags = [
    `rag-context:${ragContextSnapshotCacheKey(snapshot)}`,
    `documents:${opaqueDigest(snapshot.documentIndexGeneration)}`,
    `source-policy:${opaqueDigest(snapshot.sourcePolicyVersion)}`,
    `rollout:${snapshot.rolloutVersion}`,
    `site-state:${snapshot.publicSiteContent.state}`,
  ];
  if (snapshot.publicSiteContent.pendingLogicalIdsDigest) {
    tags.push(`site-pending:${snapshot.publicSiteContent.pendingLogicalIdsDigest}`);
  }
  return Object.freeze(tags);
}
