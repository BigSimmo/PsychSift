import "server-only";

import { resolveDeploymentCommitSha } from "@/lib/observability/sentry-release";
import { siteContentDomainDispositionDigest, type SiteContentHealthInput } from "@/lib/health-response";
import {
  siteContentPendingLogicalIdsDigest,
  siteContentProducerDefinitions,
  siteContentRegistryVersion,
} from "@/lib/site-content/site-content-registry";
import {
  expectedSiteContentRegistryVersion,
  expectedSiteContentStaticManifestDigest,
} from "@/lib/site-content/site-content-static-build.generated";
import { readSiteContentRuntimeAuthority, type SiteContentRuntimeAuthoritySnapshot } from "@/lib/supabase/health";

const MAX_PENDING_LOGICAL_IDS = 100;

type CollectorDependencies = Readonly<{
  readAuthority?: () => Promise<SiteContentRuntimeAuthoritySnapshot>;
  deploymentSha?: () => string | null;
}>;

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function canonicalPendingIds(snapshot: SiteContentRuntimeAuthoritySnapshot) {
  if (!Array.isArray(snapshot.pendingLogicalIds) || snapshot.pendingLogicalIds.length > MAX_PENDING_LOGICAL_IDS) {
    throw new Error("Runtime authority pending logical IDs are unbounded.");
  }
  const ids = snapshot.pendingLogicalIds;
  const sorted = [...ids].sort();
  if (
    ids.some((id) => typeof id !== "string" || !id.length) ||
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => id !== sorted[index]) ||
    !integer(snapshot.pendingLogicalIdCount) ||
    snapshot.pendingLogicalIdCount !== ids.length
  ) {
    throw new Error("Runtime authority pending logical IDs are invalid or incomplete.");
  }
  return ids;
}

function assertRuntimeSnapshot(snapshot: SiteContentRuntimeAuthoritySnapshot) {
  if (
    snapshot.version !== "site-content-runtime-authority-v1" ||
    !timestamp(snapshot.observedAt) ||
    typeof snapshot.changeEpoch !== "string" ||
    !integer(snapshot.directSuccessorCandidateCount) ||
    !integer(snapshot.orphanedNonterminalOutboxCount) ||
    !integer(snapshot.outbox?.pendingCount) ||
    !integer(snapshot.outbox?.leasedCount) ||
    !integer(snapshot.outbox?.quarantinedCount) ||
    !integer(snapshot.integrity?.gateArtifactCount) ||
    !integer(snapshot.integrity?.gateArtifactSubjectMismatchCount) ||
    !integer(snapshot.integrity?.projectionOperationMismatchCount)
  ) {
    throw new Error("Runtime authority snapshot is malformed.");
  }
}

async function readProductionAuthority() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return readSiteContentRuntimeAuthority(createAdminClient() as never);
}

export async function collectSiteContentHealthInput(
  dependencies: CollectorDependencies = {},
): Promise<SiteContentHealthInput | undefined> {
  try {
    const snapshot = await (dependencies.readAuthority ?? readProductionAuthority)();
    assertRuntimeSnapshot(snapshot);
    const pendingLogicalIds = canonicalPendingIds(snapshot);
    const active = snapshot.activeRelease;
    const deploymentSha = (dependencies.deploymentSha ?? resolveDeploymentCommitSha)();
    if (!active || !deploymentSha || expectedSiteContentRegistryVersion !== siteContentRegistryVersion)
      return undefined;

    if (siteContentProducerDefinitions.some((producer) => producer.activationState === "pending_review")) {
      return undefined;
    }
    const domainDispositions = siteContentProducerDefinitions
      .map((producer) => ({
        domain: producer.domain,
        disposition: producer.activationState as "eligible" | "reviewed_ineligible",
      }))
      .sort((left, right) => left.domain.localeCompare(right.domain));
    const domains = domainDispositions
      .filter((entry) => entry.disposition === "eligible")
      .map((entry) => ({
        domain: entry.domain,
        reviewState: "reviewed" as const,
        eligibility: "eligible" as const,
        sourceStatus: "current" as const,
        validationStatus: "approved" as const,
      }));
    const pendingLogicalIdsDigest = siteContentPendingLogicalIdsDigest(pendingLogicalIds);
    const synchronizer = snapshot.synchronizer;

    return {
      expectedStaticManifestDigest: expectedSiteContentStaticManifestDigest,
      deploymentSha,
      activeRelease: {
        version: "clinical-kb-site-release-v1",
        releaseId: active.releaseId,
        registryVersion: active.registryVersion,
        staticManifestDigest: active.staticManifestDigest,
        dynamicStateDigest: active.dynamicStateDigest,
        releaseDigest: active.releaseDigest,
        state: active.state as "active",
        activatedAt: active.activatedAt,
        deploymentSha: active.deploymentSha,
        changeEpoch: snapshot.changeEpoch,
        pendingLogicalIds,
        pendingLogicalIdsDigest,
        rollbackAvailable: snapshot.rollbackAvailable,
        integrity: {
          expectedRecordCount: active.expectedRecordCount,
          publishedRecordCount: active.projectedRecordCount,
          untrackedDeletionCount: snapshot.integrity.projectionOperationMismatchCount,
          duplicatePublishedLogicalIdCount: 0,
          nonAdminPublicationCount: 0,
          gateArtifactCount: snapshot.integrity.gateArtifactCount,
          gateArtifactSubjectMismatchCount: snapshot.integrity.gateArtifactSubjectMismatchCount,
          directSuccessorCandidateCount: snapshot.directSuccessorCandidateCount,
          orphanedNonterminalOutboxCount: snapshot.orphanedNonterminalOutboxCount,
          integrityVerified: active.integrityVerified,
          publicVisibilityVerified: active.publicVisibilityVerified,
          governanceVerified: active.governanceVerified,
          mustPassVerified: active.mustPassVerified,
          domainDispositions,
          domainDispositionDigest: siteContentDomainDispositionDigest(domainDispositions),
          domains,
        },
      },
      queueHealth: {
        observedAt: snapshot.observedAt,
        synchronizerDeployed: Boolean(synchronizer.lastInvocationId && synchronizer.lastWorkerId),
        lastHeartbeatAt: synchronizer.lastHeartbeatAt,
        lastInvocationAt: synchronizer.lastInvokedAt,
        lastOutcome: synchronizer.lastOutcome,
        changeEpoch: snapshot.changeEpoch,
        pendingLogicalIds,
        pendingLogicalIdsDigest,
        pendingCount: snapshot.pendingLogicalIdCount,
        oldestPendingAgeSeconds: snapshot.outbox.oldestPendingAgeSeconds,
        failedCount: snapshot.outbox.quarantinedCount,
      },
    };
  } catch {
    return undefined;
  }
}
