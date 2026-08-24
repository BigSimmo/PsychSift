import {
  assertSiteContentSyncPlan,
  siteContentSyncDigest,
  type SiteContentSyncPlan,
} from "@/lib/site-content/site-content-sync";

type Digest = `sha256:${string}`;

type Receipt<T extends object> = Readonly<T & { digest: Digest }>;

export type SiteContentReleaseVerificationEvidence = Readonly<{
  version: "site-content-release-verification-v1";
  subject: Readonly<{
    projectRef: string;
    releaseId: string;
    planDigest: Digest;
    releaseDigest: Digest;
    staticManifestDigest: Digest;
    dynamicStateDigest: Digest;
    legacyReconciliationDigest: Digest;
    expectedCounts: SiteContentSyncPlan["expectedCounts"];
    logicalIds: string[];
  }>;
  subjectDigest: Digest;
  publicVisibility: Receipt<{
    version: "site-content-public-visibility-v1";
    subjectDigest: Digest;
    observedLogicalIds: string[];
    checkedAt: string;
  }>;
  governance: Receipt<{
    version: "site-content-governance-verification-v1";
    subjectDigest: Digest;
    reviewedLogicalIds: string[];
    reviewEvidenceDigest: Digest;
    checkedAt: string;
  }>;
  mustPass: Receipt<{
    version: "site-content-must-pass-verification-v1";
    subjectDigest: Digest;
    caseSetDigest: Digest;
    caseResults: Array<{ caseId: string; outcome: "passed" }>;
    checkedAt: string;
  }>;
  digest: Digest;
}>;

type EvidenceInputs = {
  publicVisibility: { observedLogicalIds: string[]; checkedAt: string };
  governance: { reviewedLogicalIds: string[]; reviewEvidenceDigest: Digest; checkedAt: string };
  mustPass: {
    caseSetDigest: Digest;
    caseResults: Array<{ caseId: string; outcome: "passed" }>;
    checkedAt: string;
  };
};

function sortedUnique(values: string[], label: string) {
  if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) {
    throw new Error(`${label} identities must be non-empty and unique.`);
  }
  return [...values].sort();
}

function assertTimestamp(value: string, label: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} timestamp is invalid.`);
}

function subjectFor(planInput: unknown) {
  const plan = assertSiteContentSyncPlan(planInput);
  const logicalIds = plan.operations
    .filter((operation) => operation.operation !== "tombstone")
    .map((operation) => operation.logicalId)
    .sort();
  return {
    projectRef: plan.projectRef,
    releaseId: plan.candidateReleaseId,
    planDigest: plan.planDigest,
    releaseDigest: plan.releaseDigest,
    staticManifestDigest: plan.staticManifestDigest,
    dynamicStateDigest: plan.dynamicStateDigest,
    legacyReconciliationDigest: plan.legacyReconciliationDigest,
    expectedCounts: plan.expectedCounts,
    logicalIds,
  } as const;
}

function receipt<T extends object>(value: T): Receipt<T> {
  return Object.freeze({ ...value, digest: siteContentSyncDigest(value) });
}

export function createSiteContentReleaseVerificationEvidence(
  planInput: unknown,
  inputs: EvidenceInputs,
): SiteContentReleaseVerificationEvidence {
  const subject = subjectFor(planInput);
  const subjectDigest = siteContentSyncDigest(subject);
  const publicVisibility = receipt({
    version: "site-content-public-visibility-v1" as const,
    subjectDigest,
    observedLogicalIds: sortedUnique(inputs.publicVisibility.observedLogicalIds, "Public visibility"),
    checkedAt: inputs.publicVisibility.checkedAt,
  });
  const governance = receipt({
    version: "site-content-governance-verification-v1" as const,
    subjectDigest,
    reviewedLogicalIds: sortedUnique(inputs.governance.reviewedLogicalIds, "Governance"),
    reviewEvidenceDigest: inputs.governance.reviewEvidenceDigest,
    checkedAt: inputs.governance.checkedAt,
  });
  const mustPass = receipt({
    version: "site-content-must-pass-verification-v1" as const,
    subjectDigest,
    caseSetDigest: inputs.mustPass.caseSetDigest,
    caseResults: [...inputs.mustPass.caseResults].sort((left, right) => left.caseId.localeCompare(right.caseId)),
    checkedAt: inputs.mustPass.checkedAt,
  });
  const withoutDigest = {
    version: "site-content-release-verification-v1" as const,
    subject,
    subjectDigest,
    publicVisibility,
    governance,
    mustPass,
  };
  return Object.freeze({ ...withoutDigest, digest: siteContentSyncDigest(withoutDigest) });
}

export function assertSiteContentReleaseVerificationEvidence(
  input: unknown,
  planInput: unknown,
): SiteContentReleaseVerificationEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Canonical site-content release verification evidence is required.");
  }
  const evidence = input as SiteContentReleaseVerificationEvidence;
  const subject = subjectFor(planInput);
  const expectedIds = JSON.stringify(subject.logicalIds);
  if (
    evidence.version !== "site-content-release-verification-v1" ||
    siteContentSyncDigest(subject) !== evidence.subjectDigest ||
    JSON.stringify(evidence.subject) !== JSON.stringify(subject)
  ) {
    throw new Error("Release verification subject identity mismatch.");
  }
  for (const value of [evidence.publicVisibility, evidence.governance, evidence.mustPass]) {
    const { digest, ...withoutDigest } = value ?? ({} as never);
    if (!digest || siteContentSyncDigest(withoutDigest) !== digest) {
      throw new Error("Release verification artifact digest mismatch.");
    }
  }
  if (
    evidence.publicVisibility.version !== "site-content-public-visibility-v1" ||
    evidence.publicVisibility.subjectDigest !== evidence.subjectDigest ||
    JSON.stringify(sortedUnique(evidence.publicVisibility.observedLogicalIds, "Public visibility")) !== expectedIds
  ) {
    throw new Error("Public-visibility evidence does not cover the exact release population.");
  }
  if (
    evidence.governance.version !== "site-content-governance-verification-v1" ||
    evidence.governance.subjectDigest !== evidence.subjectDigest ||
    JSON.stringify(sortedUnique(evidence.governance.reviewedLogicalIds, "Governance")) !== expectedIds ||
    !/^sha256:[a-f0-9]{64}$/.test(evidence.governance.reviewEvidenceDigest)
  ) {
    throw new Error("Governance evidence does not cover the exact release population.");
  }
  if (
    evidence.mustPass.version !== "site-content-must-pass-verification-v1" ||
    evidence.mustPass.subjectDigest !== evidence.subjectDigest ||
    !/^sha256:[a-f0-9]{64}$/.test(evidence.mustPass.caseSetDigest) ||
    !evidence.mustPass.caseResults.length ||
    new Set(evidence.mustPass.caseResults.map((entry) => entry.caseId)).size !== evidence.mustPass.caseResults.length ||
    evidence.mustPass.caseResults.some((entry) => !entry.caseId.trim() || entry.outcome !== "passed")
  ) {
    throw new Error("Must-pass evidence is incomplete or contains a failure.");
  }
  assertTimestamp(evidence.publicVisibility.checkedAt, "Public visibility");
  assertTimestamp(evidence.governance.checkedAt, "Governance");
  assertTimestamp(evidence.mustPass.checkedAt, "Must-pass");
  const { digest, ...withoutDigest } = evidence;
  if (siteContentSyncDigest(withoutDigest) !== digest)
    throw new Error("Release verification evidence digest mismatch.");
  return evidence;
}
