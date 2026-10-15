// Deno requires explicit local extensions; Node accepts this type-only import.
import type { ProviderEgressBinding } from "./document-ingress-safety.ts";
import { createIngestionProviderEgressContext } from "./ingestion-provider-egress.ts";

/** This adapter cannot authorize dispatch; refuse before claiming work from its queue. */
export const ingestionProviderEgressAvailability = Object.freeze({
  available: false,
  code: "provider_egress_adapter_unavailable",
});

/** Runtime has no trusted scanner adapter yet. Unknown observations never become clean findings. */
export function createUnavailableIngestionProviderEgressContext(args: {
  binding: ProviderEgressBinding;
  loadCurrentSourceBinding: () => Promise<ProviderEgressBinding>;
}) {
  return createIngestionProviderEgressContext({
    binding: args.binding,
    async loadCurrent(request) {
      const sourceBinding = await args.loadCurrentSourceBinding();
      const unavailable = (binding: ProviderEgressBinding) => ({
        binding,
        purpose: request.purpose,
        policyVersion: "ingestion-safety-adapter-unconfigured-v1",
        scanner: {
          verdict: "unavailable",
          scannerVersion: "unconfigured",
          contentSha256: binding.contentSha256,
        },
        // Admission, rights and ancillary safety findings require a trusted adapter.
        // Omission is intentional and is rejected by the existing safety evaluator.
      });
      return {
        sourceBinding,
        sourceObservations: unavailable(sourceBinding),
        observations: unavailable({ ...sourceBinding, contentSha256: request.payloadSha256 }),
      };
    },
  });
}
