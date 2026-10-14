import {
  createIngestionProviderEgressContext,
  type IngestionProviderEgressContext,
  type IngestionProviderEgressRequest,
} from "@/lib/ingestion-provider-egress";
import type { ProviderEgressBinding, ProviderEgressPurpose } from "@/lib/document-ingress-safety";

// TEST ONLY: these observations describe synthetic fixtures, never production scan evidence.
export function syntheticIngestionEgress(
  overrides: Partial<ProviderEgressBinding> = {},
  onLoad?: (request: IngestionProviderEgressRequest) => void,
): IngestionProviderEgressContext {
  const binding: ProviderEgressBinding = {
    admissionEventId: "synthetic-admission",
    documentId: "synthetic-document",
    generationId: "synthetic-generation",
    jobId: "synthetic-job",
    attemptId: "synthetic-attempt",
    leaseId: "synthetic-lease",
    contentSha256: `sha256:${"a".repeat(64)}`,
    authorityDigest: `sha256:${"b".repeat(64)}`,
    ...overrides,
  };
  return createIngestionProviderEgressContext({
    binding,
    loadCurrent: async (request) => {
      onLoad?.(request);
      const clean = (current: ProviderEgressBinding, purpose: ProviderEgressPurpose) => ({
        binding: current,
        policyVersion: "synthetic-test-only-v1",
        purpose,
        admission: "current",
        ownerScope: "permitted",
        rights: "permitted",
        purposeClearance: "permitted",
        scanner: {
          verdict: "clean",
          scannerVersion: "synthetic-test-only-v1",
          contentSha256: current.contentSha256,
        },
        activeContent: "absent",
        identifiers: "absent",
        hiddenText: "consistent",
        encryption: "not_encrypted",
        source: "eligible",
        indexLicence: "permitted",
        sourcePolicy: "matched",
      });
      return {
        sourceBinding: binding,
        sourceObservations: clean(binding, request.purpose),
        observations: clean({ ...binding, contentSha256: request.payloadSha256 }, request.purpose),
      };
    },
  });
}
