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
  expectedSiteContentStaticDomainEvidence,
  expectedSiteContentStaticManifestDigest,
} from "@/lib/site-content/site-content-static-build.generated";
import type { SiteContentDomainEvidence } from "@/lib/site-content/site-content-manifest";
import { readSiteContentRuntimeAuthority, type SiteContentRuntimeAuthoritySnapshot } from "@/lib/supabase/health";

const MAX_PENDING_LOGICAL_IDS = 100;

type CollectorDependencies = Readonly<{
  readAuthority?: () => Promise<SiteContentRuntimeAuthoritySnapshot>;
  deploymentSha?: () => string | null;
  staticDomainEvidence?: readonly SiteContentDomainEvidence[];
}>;

const eligibleDynamicDomains = siteContentProducerDefinitions
  .filter((producer) => producer.activationState === "eligible" && producer.producerClass === "dynamic_registry")
  .map((producer) => producer.domain)
  .sort();
const eligibleStaticDomains = siteContentProducerDefinitions
  .filter((producer) => producer.activationState === "eligible" && producer.producerClass === "static_repository")
  .map((producer) => producer.domain)
  .sort();
const eligibleDomains = [...eligibleDynamicDomains, ...eligibleStaticDomains].sort();

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertDomainEvidence(
  evidence: readonly SiteContentDomainEvidence[],
  expectedDomains: readonly string[],
  authority: "runtime" | "static",
) {
  const sorted = [...evidence].sort((left, right) => left.domain.localeCompare(right.domain));
  if (
    !Array.isArray(evidence) ||
    evidence.length !== expectedDomains.length ||
    new Set(evidence.map((entry) => entry.domain)).size !== evidence.length ||
    evidence.some(
      (entry, index) =>
        typeof entry.domain !== "string" ||
        entry.domain !== sorted[index]?.domain ||
        !integer(entry.recordCount) ||
        entry.recordCount === 0 ||
        !["unreviewed", "reviewed"].includes(entry.reviewState) ||
        !["current", "review_due", "outdated", "unknown"].includes(entry.sourceStatus) ||
        !["unverified", "locally_reviewed", "approved"].includes(entry.validationStatus),
    ) ||
    JSON.stringify(evidence.map((entry) => entry.domain)) !== JSON.stringify(expectedDomains)
  ) {
    throw new Error(
      `${authority === "runtime" ? "Runtime authority" : "Static manifest"} domain evidence is malformed or incomplete.`,
    );
  }
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
  const domains = snapshot.domainEvidence;
  assertDomainEvidence(domains, eligibleDynamicDomains, "runtime");
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
    const staticDomainEvidence = dependencies.staticDomainEvidence ?? expectedSiteContentStaticDomainEvidence;
    assertDomainEvidence(staticDomainEvidence, eligibleStaticDomains, "static");
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
    const dispositionsByDomain = new Map(domainDispositions.map((entry) => [entry.domain, entry.disposition]));
    const domainEvidence = [...snapshot.domainEvidence, ...staticDomainEvidence].sort((left, right) =>
      left.domain.localeCompare(right.domain),
    );
    if (JSON.stringify(domainEvidence.map((entry) => entry.domain)) !== JSON.stringify(eligibleDomains)) {
      throw new Error("Combined site-content domain evidence does not match the eligible producer set.");
    }
    const domains = domainEvidence.map((entry) => {
      const disposition = dispositionsByDomain.get(entry.domain);
      if (disposition !== "eligible") throw new Error("Site-content authority returned an ineligible domain.");
      return {
        domain: entry.domain,
        reviewState: entry.reviewState,
        eligibility: disposition,
        sourceStatus: entry.sourceStatus,
        validationStatus: entry.validationStatus,
      };
    });
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
