import type { ClinicalSourceRole, RagProgrammeMode, SiteContentDomain, SiteContentPartitionState } from "@/lib/types";

export type SiteContentRecord = {
  version: "site-content-record-v1";
  logicalId: string;
  producerClass: "static_repository" | "dynamic_registry";
  domain: SiteContentDomain;
  route: string;
  title: string;
  body: string;
  sourceRole: ClinicalSourceRole;
  access: "public";
  validationStatus: "unverified" | "locally_reviewed" | "approved";
  sourceStatus: "current" | "review_due" | "outdated" | "unknown";
  publicationVersion: string;
  sourceLineage: Array<{
    sourceId: string;
    sourceHash: string;
    relationship: "derived_from" | "references";
  }>;
  contentHash: string;
};

export type ActiveSiteContentRelease = {
  version: "clinical-kb-site-release-v1";
  releaseId: string;
  registryVersion: string;
  staticManifestDigest: string;
  dynamicStateDigest: string;
  releaseDigest: string;
  state: "active";
  activatedAt: string;
};

export type SiteContentPartitionSnapshot = {
  registryVersion: string | null;
  releaseId: string | null;
  expectedStaticManifestDigest: string | null;
  activeStaticManifestDigest: string | null;
  staticManifestDigest: string | null;
  staticManifestMatch: boolean;
  dynamicStateDigest: string | null;
  releaseDigest: string | null;
  changeEpoch: string | null;
  pendingLogicalIds: string[];
  pendingLogicalIdsDigest: string | null;
  state: SiteContentPartitionState;
};

export type UploadedLocalSnapshotIdentity = {
  indexGeneration: string;
  activationDigest: string;
};

export type AustralianPublicSnapshotIdentity = {
  indexGeneration: string | null;
  releaseDigest: string | null;
};

export type RagContextSnapshot = {
  version: "rag-context-snapshot-v1";
  resolvedAt: string;
  documentIndexGeneration: string;
  sourcePolicyVersion: string;
  rolloutVersion: RagProgrammeMode;
  uploadedLocal: UploadedLocalSnapshotIdentity;
  australianPublic: AustralianPublicSnapshotIdentity;
  publicSiteContent: SiteContentPartitionSnapshot;
};
