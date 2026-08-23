import { registryCorpusDetailHref } from "@/lib/registry-corpus-links";
import type { RegistryCorpusEntry } from "@/lib/registry-corpus";
import { createSiteContentRecord, siteContentSha256 } from "@/lib/site-content/site-content-manifest";
import type { SiteContentRecord } from "@/lib/site-content/site-content-contracts";
import type { ClinicalSourceRole, SiteContentDomain } from "@/lib/types";

const registryMetadata = {
  service: { domain: "services", role: "service_directory", prefix: "service" },
  form: { domain: "forms", role: "form_reference", prefix: "form" },
  medication: { domain: "medications", role: "clinical_reference", prefix: "medication" },
  differential: { domain: "differentials", role: "clinical_reference", prefix: "differential" },
} as const satisfies Record<
  RegistryCorpusEntry["kind"],
  { domain: SiteContentDomain; role: ClinicalSourceRole; prefix: string }
>;

function validationStatus(value: string): SiteContentRecord["validationStatus"] {
  return value === "approved" || value === "locally_reviewed" ? value : "unverified";
}

function sourceStatus(value: string): SiteContentRecord["sourceStatus"] {
  return value === "current" || value === "review_due" || value === "outdated" ? value : "unknown";
}

export function registryEntriesToSiteContentRecords(entries: readonly RegistryCorpusEntry[]): SiteContentRecord[] {
  return entries.map((entry) => {
    const metadata = registryMetadata[entry.kind];
    const route = registryCorpusDetailHref({
      kind: entry.kind,
      slug: entry.slug,
      subkind: entry.subkind,
      recordId: entry.recordId,
    });
    if (!route) throw new Error(`Registry record ${entry.recordId} has no canonical public route.`);
    const publicationVersion = entry.metadata.publication_version;
    return createSiteContentRecord({
      logicalId:
        entry.kind === "differential"
          ? `${metadata.prefix}:${entry.subkind ?? "diagnosis"}:${entry.slug}`
          : `${metadata.prefix}:${entry.slug}`,
      producerClass: "dynamic_registry",
      domain: metadata.domain,
      route,
      title: entry.title,
      body: entry.content,
      sourceRole: metadata.role,
      access: "public",
      validationStatus: validationStatus(entry.validationStatus),
      sourceStatus: sourceStatus(entry.sourceStatus),
      publicationVersion:
        typeof publicationVersion === "string" && publicationVersion.trim()
          ? publicationVersion
          : "registry-publication-version-unknown",
      sourceLineage: [
        {
          sourceId: `registry:${entry.kind}:${entry.recordId}`,
          sourceHash: siteContentSha256(entry.content),
          relationship: "derived_from",
        },
      ],
    });
  });
}

export type RegistryPublicReconciliationCandidate = {
  record: SiteContentRecord;
  publicationState: "draft" | "preview" | "published" | "retired";
  renderedByPublicSite: boolean;
  ownerId: string | null;
};

export function buildRegistryPublicReconciliationReport(candidates: readonly RegistryPublicReconciliationCandidate[]) {
  const byLogicalId = new Map<string, RegistryPublicReconciliationCandidate[]>();
  for (const candidate of candidates) {
    const group = byLogicalId.get(candidate.record.logicalId) ?? [];
    group.push(candidate);
    byLogicalId.set(candidate.record.logicalId, group);
  }
  const records = [...byLogicalId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([logicalId, group]) => {
      const rendered = group.filter(
        (candidate) => candidate.publicationState === "published" && candidate.renderedByPublicSite,
      );
      const uniqueVersions = new Set(rendered.map((candidate) => candidate.record.contentHash));
      const requiresAdministratorReview = rendered.length !== 1 || uniqueVersions.size !== 1;
      return {
        logicalId,
        selectedPublicationVersion: requiresAdministratorReview ? null : rendered[0]!.record.publicationVersion,
        selectedContentHash: requiresAdministratorReview ? null : rendered[0]!.record.contentHash,
        requiresAdministratorReview,
      };
    });
  const divergentLogicalIds = records
    .filter((record) => record.requiresAdministratorReview)
    .map((record) => record.logicalId);
  return {
    version: "registry-public-reconciliation-v1" as const,
    ready: divergentLogicalIds.length === 0,
    divergentLogicalIds,
    records,
  };
}
