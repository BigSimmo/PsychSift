import {
  assertSiteContentSyncPlan,
  siteContentSyncDigest,
  type SiteContentSyncPlan,
} from "@/lib/site-content/site-content-sync";
import {
  SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST,
  SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
} from "@/lib/site-content/site-content-gate-owners";

type Digest = `sha256:${string}`;

export const SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT =
  "sha256:4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107" as const;

export const SITE_CONTENT_MUST_PASS_CASE_IDS = Object.freeze([
  "direct-evidence-generic-refusal",
  "trusted-admin-activation",
  "ordinary-upload-denied",
  "private-staging-excluded",
  "broad-partial-exact-gap",
  "uploaded-australian-augmentation",
  "site-specifier-current",
  "site-differential-current",
  "site-medication-current",
  "cross-domain-site-coverage",
  "uploaded-primary-over-site-summary",
  "site-product-primary",
  "changed-deleted-site-record",
  "stale-manifest-cache-mismatch",
  "uploaded-public-visible-conflict",
  "public-release-auth-parity",
  "site-admin-only-mutation",
  "source-role-mismatch",
  "site-sync-unavailable",
  "australian-augmentation-unavailable",
  "healthdirect-excluded",
  "etg-amh-link-only",
  "prohibited-upload-pre-provider",
  "narrow-answer-concise",
  "broad-answer-complete",
  "broad-management-route",
  "structured-output-truncation",
  "anaphoric-follow-up",
  "incremental-reconciliation",
] as const);

type PopulationEntry = Readonly<{ logicalId: string; contentHash: Digest }>;
type GateReceipt<T extends object> = Readonly<T & { digest: Digest }>;

export type SiteContentReleaseGateArtifacts = Readonly<{
  version: "site-content-release-gate-artifacts-v1";
  subject: Readonly<{ projectRef: string; releaseId: string; planDigest: Digest; releaseDigest: Digest }>;
  subjectDigest: Digest;
  publicVisibility: GateReceipt<{
    owner: "public-site-content-reader-v1";
    subjectDigest: Digest;
    observedAt: string;
    population: PopulationEntry[];
    populationDigest: Digest;
  }>;
  governance: GateReceipt<{
    owner: "site-content-governance-registry-v1";
    subjectDigest: Digest;
    observedAt: string;
    population: PopulationEntry[];
    registryVersion: string;
    staticManifestDigest: Digest;
    sourceStatus: "current";
    validationStatus: "locally_reviewed";
  }>;
  mustPass: GateReceipt<{
    owner: "rag-programme-eval-v1";
    subjectDigest: Digest;
    observedAt: string;
    caseSetFingerprint: typeof SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT;
    evaluatedCaseIds: string[];
    failedCaseIds: string[];
    runDigest: Digest;
    gatePolicyDigest: typeof SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST;
    gateDecisionDigest: typeof SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST;
  }>;
}>;

export type SiteContentReleaseVerificationEvidence = Readonly<
  Omit<SiteContentReleaseGateArtifacts, "version"> & {
    version: "site-content-release-verification-v2";
    digest: Digest;
  }
>;

function digestPattern(value: unknown): value is Digest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function expectedPopulation(plan: SiteContentSyncPlan): PopulationEntry[] {
  return plan.operations
    .filter((operation) => operation.operation !== "tombstone")
    .map(({ logicalId, contentHash }) => ({ logicalId, contentHash }))
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

function subjectFor(plan: SiteContentSyncPlan) {
  return {
    projectRef: plan.projectRef,
    releaseId: plan.candidateReleaseId,
    planDigest: plan.planDigest,
    releaseDigest: plan.releaseDigest,
  } as const;
}

function assertReceipt(value: { digest?: unknown }, label: string) {
  const { digest, ...withoutDigest } = value;
  if (!digestPattern(digest) || siteContentSyncDigest(withoutDigest) !== digest) {
    throw new Error(`${label} gate artifact digest mismatch.`);
  }
}

function timestamp(value: string, now: Date, label: string) {
  const observed = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(observed) ||
    new Date(observed).toISOString() !== value ||
    observed > now.getTime() ||
    observed < now.getTime() - 5 * 60 * 1000
  ) {
    throw new Error(`${label} gate artifact is stale or future-dated.`);
  }
  return observed;
}

export function verifySiteContentReleaseGateArtifacts(
  planInput: unknown,
  input: unknown,
  options: { now: Date },
): SiteContentReleaseVerificationEvidence {
  const plan = assertSiteContentSyncPlan(planInput);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Stored site-content release gate artifacts are required.");
  }
  const artifacts = input as SiteContentReleaseGateArtifacts;
  const subject = subjectFor(plan);
  const population = expectedPopulation(plan);
  if (
    artifacts.version !== "site-content-release-gate-artifacts-v1" ||
    JSON.stringify(artifacts.subject) !== JSON.stringify(subject) ||
    artifacts.subjectDigest !== siteContentSyncDigest(subject)
  ) {
    throw new Error("Release gate artifact subject mismatch.");
  }
  assertReceipt(artifacts.publicVisibility, "Public visibility");
  assertReceipt(artifacts.governance, "Governance");
  assertReceipt(artifacts.mustPass, "Must-pass");
  if (
    artifacts.publicVisibility.owner !== "public-site-content-reader-v1" ||
    artifacts.publicVisibility.subjectDigest !== artifacts.subjectDigest ||
    JSON.stringify(artifacts.publicVisibility.population) !== JSON.stringify(population) ||
    artifacts.publicVisibility.populationDigest !== siteContentSyncDigest(population)
  ) {
    throw new Error("Public-visibility gate output does not match the exact release population.");
  }
  if (
    artifacts.governance.owner !== "site-content-governance-registry-v1" ||
    artifacts.governance.subjectDigest !== artifacts.subjectDigest ||
    JSON.stringify(artifacts.governance.population) !== JSON.stringify(population) ||
    artifacts.governance.registryVersion !== plan.registryVersion ||
    artifacts.governance.staticManifestDigest !== plan.staticManifestDigest ||
    artifacts.governance.sourceStatus !== "current" ||
    artifacts.governance.validationStatus !== "locally_reviewed"
  ) {
    throw new Error("Governance gate output does not match the canonical registry population.");
  }
  if (
    artifacts.mustPass.owner !== "rag-programme-eval-v1" ||
    artifacts.mustPass.subjectDigest !== artifacts.subjectDigest ||
    artifacts.mustPass.caseSetFingerprint !== SITE_CONTENT_MUST_PASS_CASE_SET_FINGERPRINT ||
    JSON.stringify(artifacts.mustPass.evaluatedCaseIds) !== JSON.stringify(SITE_CONTENT_MUST_PASS_CASE_IDS) ||
    artifacts.mustPass.failedCaseIds.length !== 0 ||
    !digestPattern(artifacts.mustPass.runDigest) ||
    artifacts.mustPass.gatePolicyDigest !== SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST ||
    artifacts.mustPass.gateDecisionDigest !== SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST
  ) {
    throw new Error("Must-pass gate output does not match the canonical evaluated case population.");
  }
  const publicAt = timestamp(artifacts.publicVisibility.observedAt, options.now, "Public visibility");
  const governanceAt = timestamp(artifacts.governance.observedAt, options.now, "Governance");
  const mustPassAt = timestamp(artifacts.mustPass.observedAt, options.now, "Must-pass");
  const recoveryVerifiedAt = Date.parse(plan.recoveryEvidence?.verifiedAt ?? "");
  if (
    !Number.isFinite(recoveryVerifiedAt) ||
    governanceAt < recoveryVerifiedAt ||
    mustPassAt < governanceAt ||
    publicAt < mustPassAt
  ) {
    throw new Error("Release gate artifact chronology is invalid.");
  }
  const withoutDigest = {
    ...artifacts,
    version: "site-content-release-verification-v2" as const,
  };
  return Object.freeze({ ...withoutDigest, digest: siteContentSyncDigest(withoutDigest) });
}

export function assertSiteContentReleaseVerificationEvidence(
  input: unknown,
  planInput: unknown,
  options: { now: Date },
): SiteContentReleaseVerificationEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Canonical site-content release verification evidence is required.");
  }
  const evidence = input as SiteContentReleaseVerificationEvidence;
  const { digest, ...artifacts } = evidence;
  if (!digestPattern(digest) || siteContentSyncDigest(artifacts) !== digest) {
    throw new Error("Release verification evidence digest mismatch.");
  }
  const verified = verifySiteContentReleaseGateArtifacts(
    planInput,
    { ...artifacts, version: "site-content-release-gate-artifacts-v1" },
    options,
  );
  if (verified.digest !== digest) throw new Error("Release verification evidence canonicalization mismatch.");
  return evidence;
}
