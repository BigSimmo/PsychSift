import { assertSiteContentSyncPlan, type SiteContentSyncPlan } from "@/lib/site-content/site-content-sync";
import { assertSiteContentReleaseVerificationEvidence } from "@/lib/site-content/site-content-release-evidence";
import type { SiteContentRecoveryValidationBinding } from "@/lib/site-content/site-content-recovery-authority";

type Digest = `sha256:${string}`;
type Operation = SiteContentSyncPlan["operations"][number];

export type SiteContentAuthorityRecord = Readonly<{
  logicalId: string;
  domain: string;
  recordKind: string;
  slug: string;
  payload: unknown;
  governance: unknown;
  publicationVersion: string;
  contentHash: Digest;
  sourceLineageDigest: Digest;
}>;

type Release = {
  id: string;
  projectRef: string;
  releaseDigest: Digest;
  previousReleaseId: string | null;
  state: "active" | "retained" | "candidate" | "failed";
  plan: SiteContentSyncPlan | null;
  records: Map<string, SiteContentAuthorityRecord>;
  operations: Map<string, Operation & { status: "pending" | "complete" | "quarantined" }>;
  verification: Set<"integrity" | "public-visibility" | "governance" | "must-pass">;
};

type BindingVerifier = (purpose: string, payload: unknown, binding: SiteContentRecoveryValidationBinding) => boolean;

function sortedRecords(records: Iterable<SiteContentAuthorityRecord>) {
  return [...records].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

export function createSiteContentTransactionAuthority(options: { bindingVerifier: BindingVerifier }) {
  const releases = new Map<string, Release>();
  const publications = new Map<string, SiteContentAuthorityRecord>();
  let activeReleaseId: string | null = null;

  const requireBinding = (purpose: string, payload: unknown, binding: SiteContentRecoveryValidationBinding) => {
    if (!options.bindingVerifier(purpose, payload, binding)) throw new Error("Server validation binding rejected.");
  };

  function adoptBaseline(
    input: { plan: unknown; records: SiteContentAuthorityRecord[]; verificationEvidence: unknown },
    binding: SiteContentRecoveryValidationBinding,
  ) {
    requireBinding("adopt", input, binding);
    const plan = assertSiteContentSyncPlan(input.plan);
    assertSiteContentReleaseVerificationEvidence(input.verificationEvidence, plan);
    if (activeReleaseId || releases.size) throw new Error("Baseline adoption requires empty authority.");
    if (new Set(input.records.map((record) => record.logicalId)).size !== input.records.length) {
      throw new Error("Baseline adoption logical identities must be unique.");
    }
    const records = new Map(input.records.map((record) => [record.logicalId, record]));
    for (const record of input.records) publications.set(record.logicalId, record);
    releases.set(plan.candidateReleaseId, {
      id: plan.candidateReleaseId,
      projectRef: plan.projectRef,
      releaseDigest: plan.releaseDigest,
      previousReleaseId: null,
      state: "active",
      plan,
      records,
      operations: new Map(),
      verification: new Set(["integrity", "public-visibility", "governance", "must-pass"]),
    });
    activeReleaseId = plan.candidateReleaseId;
  }

  function beginCandidate(input: unknown, binding: SiteContentRecoveryValidationBinding) {
    const plan = assertSiteContentSyncPlan(input);
    requireBinding("begin", plan, binding);
    const active = activeReleaseId ? releases.get(activeReleaseId) : null;
    if (!active || active.id !== plan.previousReleaseId || active.projectRef !== plan.projectRef) {
      throw new Error("Candidate target/predecessor mismatch.");
    }
    const existing = releases.get(plan.candidateReleaseId);
    if (existing) {
      if (existing.state === "candidate" && existing.plan?.planDigest === plan.planDigest) return;
      throw new Error("Candidate resume identity/digest mismatch.");
    }
    const candidate: Release = {
      id: plan.candidateReleaseId,
      projectRef: plan.projectRef,
      releaseDigest: plan.releaseDigest,
      previousReleaseId: active.id,
      state: "candidate",
      plan,
      records: new Map(),
      operations: new Map(
        plan.operations.map((operation) => [
          operation.logicalId,
          { ...operation, status: operation.operation === "unchanged" ? "complete" : "pending" },
        ]),
      ),
      verification: new Set(),
    };
    for (const operation of plan.operations) {
      if (operation.operation !== "unchanged") continue;
      const prior = active.records.get(operation.logicalId);
      if (!prior || prior.contentHash !== operation.contentHash)
        throw new Error("Unchanged projection identity mismatch.");
      candidate.records.set(operation.logicalId, prior);
    }
    releases.set(candidate.id, candidate);
  }

  function publish(record: SiteContentAuthorityRecord) {
    const candidates = [...releases.values()].filter((release) => release.state === "candidate");
    if (candidates.length !== 1) throw new Error("One exact candidate is required.");
    const candidate = candidates[0]!;
    const operation = candidate.operations.get(record.logicalId);
    if (!operation || operation.operation !== "changed" || operation.contentHash !== record.contentHash) {
      throw new Error("Publication is not an exact declared changed identity.");
    }
    publications.set(record.logicalId, record);
  }

  function completeOperation(operationInput: Operation) {
    const candidate = [...releases.values()].find((release) => release.state === "candidate");
    if (!candidate || !candidate.plan) throw new Error("Candidate is unavailable.");
    const operation = candidate.operations.get(operationInput.logicalId);
    if (!operation) throw new Error("Operation is undeclared.");
    if (
      operation.operation !== operationInput.operation ||
      operation.contentHash !== operationInput.contentHash ||
      operation.status === "quarantined"
    ) {
      throw new Error("Operation identity/hash/resume mismatch.");
    }
    if (operation.operation === "changed") {
      const publication = publications.get(operation.logicalId);
      if (!publication || publication.contentHash !== operation.contentHash)
        throw new Error("Changed publication is missing.");
      candidate.records.set(operation.logicalId, publication);
    }
    operation.status = "complete";
  }

  function verifyCandidate(
    input: { plan: unknown; verificationEvidence: unknown },
    binding: SiteContentRecoveryValidationBinding,
  ) {
    const plan = assertSiteContentSyncPlan(input.plan);
    const candidate = releases.get(plan.candidateReleaseId);
    if (!candidate?.plan || candidate.state !== "candidate" || candidate.plan.planDigest !== plan.planDigest) {
      throw new Error("Candidate verification evidence binding mismatch.");
    }
    assertSiteContentReleaseVerificationEvidence(input.verificationEvidence, plan);
    requireBinding("verify", input, binding);
    candidate.verification = new Set(["integrity", "public-visibility", "governance", "must-pass"]);
  }

  function read(domain: string) {
    const active = activeReleaseId ? releases.get(activeReleaseId) : null;
    if (!active) return [];
    const pendingIds = new Set(
      [...releases.values()]
        .filter((release) => release.state === "candidate" && release.previousReleaseId === active.id)
        .flatMap((release) =>
          [...release.operations.values()]
            .filter((operation) => operation.operation !== "unchanged" || operation.status !== "complete")
            .map((operation) => operation.logicalId),
        ),
    );
    return sortedRecords(
      [...active.records.values()].filter((record) => record.domain === domain && !pendingIds.has(record.logicalId)),
    );
  }

  function partition(domain: string) {
    if (!activeReleaseId) return { activeReleaseId: null, changeEpoch: 0, state: "unavailable" as const, records: [] };
    const updating = [...releases.values()].some(
      (release) => release.state === "candidate" && release.previousReleaseId === activeReleaseId,
    );
    return {
      activeReleaseId,
      changeEpoch: [...releases.values()].filter(
        (release) => release.state === "active" || release.state === "retained",
      ).length,
      state: updating ? ("updating" as const) : ("current" as const),
      records: read(domain),
    };
  }

  function activate(
    releaseId: string,
    input: { action: "activate"; evidence: unknown; activation: unknown },
    binding: SiteContentRecoveryValidationBinding,
  ) {
    const candidate = releases.get(releaseId);
    const previous = activeReleaseId ? releases.get(activeReleaseId) : null;
    if (!candidate?.plan || candidate.state !== "candidate" || !previous)
      throw new Error("Candidate activation state mismatch.");
    requireBinding("activate", input, binding);
    const receipt = input.activation as {
      resource: { releaseId: string; releaseDigest: string };
      previousResource: { releaseId: string; releaseDigest: string };
      stateDigest: string;
    };
    if (
      receipt.resource.releaseId !== candidate.id ||
      receipt.resource.releaseDigest !== candidate.releaseDigest ||
      receipt.previousResource.releaseId !== previous.id ||
      receipt.previousResource.releaseDigest !== previous.releaseDigest ||
      receipt.stateDigest !== candidate.plan.dynamicStateDigest ||
      [...candidate.operations.values()].some((operation) => operation.status !== "complete") ||
      candidate.verification.size !== 4 ||
      candidate.records.size !== candidate.plan.expectedCounts.desired
    ) {
      throw new Error("Exact candidate population/receipt activation binding mismatch.");
    }
    previous.state = "retained";
    candidate.state = "active";
    activeReleaseId = candidate.id;
  }

  return Object.freeze({
    adoptBaseline,
    beginCandidate,
    publish,
    completeOperation,
    verifyCandidate,
    read,
    partition,
    activate,
  });
}
