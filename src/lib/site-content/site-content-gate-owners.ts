import { createHmac, timingSafeEqual } from "node:crypto";

import {
  compareRagProgrammeRuns,
  parseRagProgrammeFixture,
  ragProgrammeGatePolicy,
  type RagProgrammeRun,
} from "@/lib/rag/rag-programme-eval";
import { siteContentSha256, type StaticSiteContentManifest } from "@/lib/site-content/site-content-manifest";
import {
  assertSiteContentSyncPlan,
  bindSiteContentProjection,
  siteContentSyncCanonicalJson,
  siteContentSyncDigest,
  type SiteContentSyncPlan,
  type SiteContentProjectionBinding,
} from "@/lib/site-content/site-content-sync";

type Digest = `sha256:${string}`;
type PopulationEntry = Readonly<{ logicalId: string; contentHash: Digest }>;
type GateSubject = Readonly<{ projectRef: string; releaseId: string; planDigest: Digest; releaseDigest: Digest }>;

export const SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST = siteContentSyncDigest(ragProgrammeGatePolicy);
export const SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST = siteContentSyncDigest({
  decision: "GO",
  reasons: [],
});

type ReceiptAuthority = Readonly<{
  subject: GateSubject;
  subjectDigest: Digest;
  observedAt: string;
  mac: string;
}>;

export type SiteContentGovernanceOwnerReceipt = ReceiptAuthority &
  Readonly<{
    version: "site-content-governance-owner-receipt-v1";
    owner: "site-content-governance-registry-v1";
    population: PopulationEntry[];
    projectionBindings: SiteContentProjectionBinding[];
    registryVersion: string;
    staticManifestDigest: Digest;
    legacyReconciliationDigest: Digest;
    legacyDispositionsDigest: Digest;
    sourceStatus: "current";
    validationStatus: "locally_reviewed";
    manifestOutputDigest: Digest;
  }>;

export type SiteContentMustPassOwnerReceipt = ReceiptAuthority &
  Readonly<{
    version: "site-content-must-pass-owner-receipt-v1";
    owner: "rag-programme-eval-v1";
    caseSetFingerprint: Digest;
    populationFingerprint: Digest;
    evaluatedCaseIds: string[];
    failedCaseIds: [];
    baselineRunDigest: Digest;
    candidateRunDigest: Digest;
    gatePolicyDigest: Digest;
    gateDecisionDigest: Digest;
  }>;

export type SiteContentGateOwnerReceipt = SiteContentGovernanceOwnerReceipt | SiteContentMustPassOwnerReceipt;

function subjectFor(plan: SiteContentSyncPlan): GateSubject {
  return {
    projectRef: plan.projectRef,
    releaseId: plan.candidateReleaseId,
    planDigest: plan.planDigest,
    releaseDigest: plan.releaseDigest,
  };
}

function populationFor(plan: SiteContentSyncPlan): PopulationEntry[] {
  return plan.operations
    .filter((operation) => operation.operation !== "tombstone")
    .map(({ logicalId, contentHash }) => ({ logicalId, contentHash }))
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

function sign<T extends object>(value: T, secret: string) {
  if (secret.length < 32) throw new Error("Independent gate-owner secret is not configured safely.");
  return createHmac("sha256", secret).update(siteContentSyncCanonicalJson(value)).digest("hex");
}

function canonicalObservedAt(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Gate-owner observation time is invalid.");
  return now.toISOString();
}

export function createSiteContentGovernanceOwnerReceipt(
  planInput: unknown,
  manifest: StaticSiteContentManifest,
  options: { now: Date; secret: string; publications: unknown[] },
): SiteContentGovernanceOwnerReceipt {
  const plan = assertSiteContentSyncPlan(planInput);
  const digestPayload = {
    version: manifest.version,
    registryVersion: manifest.registryVersion,
    records: manifest.records,
  };
  if (
    manifest.version !== "clinical-kb-site-static-manifest-v1" ||
    siteContentSha256(digestPayload) !== manifest.staticManifestDigest ||
    manifest.registryVersion !== plan.registryVersion ||
    manifest.staticManifestDigest !== plan.staticManifestDigest
  ) {
    throw new Error("Governance owner manifest identity does not match the canonical release plan.");
  }
  const population = manifest.records
    .filter((record) => record.eligible)
    .map((record) => {
      if (record.sourceStatus !== "current" || !["locally_reviewed", "approved"].includes(record.validationStatus)) {
        throw new Error("Governance owner manifest contains an ineligible claimed population.");
      }
      return { logicalId: record.logicalId, contentHash: record.contentHash as Digest };
    })
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  if (JSON.stringify(population) !== JSON.stringify(populationFor(plan))) {
    throw new Error("Governance owner manifest population does not match the canonical release plan.");
  }
  const projectionBindings = options.publications
    .map(bindSiteContentProjection)
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  if (
    new Set(projectionBindings.map((entry) => entry.logicalId)).size !== projectionBindings.length ||
    JSON.stringify(projectionBindings.map(({ logicalId, contentHash }) => ({ logicalId, contentHash }))) !==
      JSON.stringify(population)
  ) {
    throw new Error("Governance owner publications do not match the canonical release population.");
  }
  const subject = subjectFor(plan);
  const withoutMac = {
    version: "site-content-governance-owner-receipt-v1" as const,
    owner: "site-content-governance-registry-v1" as const,
    subject,
    subjectDigest: siteContentSyncDigest(subject),
    observedAt: canonicalObservedAt(options.now),
    population,
    projectionBindings,
    registryVersion: plan.registryVersion,
    staticManifestDigest: plan.staticManifestDigest,
    legacyReconciliationDigest: plan.legacyReconciliationDigest,
    legacyDispositionsDigest: siteContentSyncDigest(plan.legacyDispositions),
    sourceStatus: "current" as const,
    validationStatus: "locally_reviewed" as const,
    manifestOutputDigest: siteContentSyncDigest(digestPayload),
  };
  return Object.freeze({ ...withoutMac, mac: sign(withoutMac, options.secret) });
}

export function createSiteContentMustPassOwnerReceipt(
  planInput: unknown,
  fixtureInput: unknown,
  baseline: RagProgrammeRun,
  candidate: RagProgrammeRun,
  options: { now: Date; secret: string },
): SiteContentMustPassOwnerReceipt {
  const plan = assertSiteContentSyncPlan(planInput);
  const fixture = parseRagProgrammeFixture(fixtureInput);
  const decision = compareRagProgrammeRuns(baseline, candidate, fixture.population);
  if (decision.decision !== "GO" || decision.reasons.length !== 0 || candidate.cases.some((entry) => !entry.passed)) {
    throw new Error("Canonical RAG programme must-pass owner output did not pass.");
  }
  const evaluatedCaseIds = fixture.cases.map((entry) => entry.id);
  const candidateCaseIds = candidate.cases.map((entry) => entry.id).sort();
  if (JSON.stringify(candidateCaseIds) !== JSON.stringify([...evaluatedCaseIds].sort())) {
    throw new Error("Canonical RAG programme evaluated case population mismatch.");
  }
  const subject = subjectFor(plan);
  const withoutMac = {
    version: "site-content-must-pass-owner-receipt-v1" as const,
    owner: "rag-programme-eval-v1" as const,
    subject,
    subjectDigest: siteContentSyncDigest(subject),
    observedAt: canonicalObservedAt(options.now),
    caseSetFingerprint: fixture.caseSetFingerprint as Digest,
    populationFingerprint: fixture.population.populationFingerprint as Digest,
    evaluatedCaseIds,
    failedCaseIds: [] as [],
    baselineRunDigest: siteContentSyncDigest(baseline),
    candidateRunDigest: siteContentSyncDigest(candidate),
    gatePolicyDigest: SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST,
    gateDecisionDigest: siteContentSyncDigest(decision),
  };
  return Object.freeze({ ...withoutMac, mac: sign(withoutMac, options.secret) });
}

export function verifySiteContentGateOwnerReceipt(
  input: unknown,
  options: { now: Date; secret: string },
): input is SiteContentGateOwnerReceipt {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const receipt = input as SiteContentGateOwnerReceipt;
    const { mac, ...withoutMac } = receipt;
    const observedAt = Date.parse(receipt.observedAt);
    if (
      !/^[a-f0-9]{64}$/.test(mac) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.observedAt) ||
      !Number.isFinite(observedAt) ||
      new Date(observedAt).toISOString() !== receipt.observedAt ||
      observedAt > options.now.getTime() + 5 * 60 * 1000 ||
      observedAt < options.now.getTime() - 5 * 60 * 1000 ||
      receipt.subjectDigest !== siteContentSyncDigest(receipt.subject)
    ) {
      return false;
    }
    if (
      receipt.owner === "rag-programme-eval-v1" &&
      (receipt.version !== "site-content-must-pass-owner-receipt-v1" ||
        receipt.gatePolicyDigest !== SITE_CONTENT_RAG_PROGRAMME_GATE_POLICY_DIGEST ||
        receipt.gateDecisionDigest !== SITE_CONTENT_RAG_PROGRAMME_GATE_DECISION_DIGEST)
    ) {
      return false;
    }
    const expected = sign(withoutMac, options.secret);
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
