import "server-only";
import { z } from "zod";
import { createRegisteredPublishedAdminSourcePlanResolver } from "@/lib/registered-published-admin-source-plan";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { awaitWithCallerSignal } from "@/lib/rag/rag-abort-signal";
import {
  publishedOriginalSectionMetadataForResult,
  validateCheckedPublishedOriginalSectionLayout,
  type RegisteredPublishedOriginalSectionLayoutLookup,
} from "@/lib/rag/rag-source-block";
import { createPublishedAdminTextSectionLayoutLoader } from "../../worker/published-admin-source-layout";

type RegisteredPublicSourceRpc = Parameters<typeof createRegisteredPublishedAdminSourcePlanResolver>[0]["rpc"] &
  Parameters<typeof createPublishedAdminTextSectionLayoutLoader>[0]["rpc"];

type RegisteredPublicAnswerInput = {
  requesterId?: string;
  accessScope: RetrievalAccessScope;
  explicitDocumentIds?: readonly string[];
  resolvedDocumentIds?: readonly string[];
  summaryMode?: boolean;
  signal?: AbortSignal;
};

type RegisteredPublicAnswerOptions = {
  skipCache: true;
  loadRegisteredPublishedOriginalSectionLayout: RegisteredPublishedOriginalSectionLayoutLookup;
};

const registrationLookupTimeoutMs = 2_500;
const sourceLayoutTimeoutMs = 5_000;

function bindingFailure(): never {
  const error = new Error("Complete original-section layout binding could not be confirmed.");
  error.name = "OriginalSectionLayoutBindingError";
  throw error;
}

/** Bounds awaiting and prevents late completion from granting authority; not physical SQL cancellation. */
async function boundedRead<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  callerSignal?.throwIfAborted();
  const deadline = new AbortController();
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(
    () => deadline.abort(new DOMException("Published original source read timed out.", "TimeoutError")),
    timeoutMs,
  );
  try {
    const pending = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation(signal);
    });
    const value = await awaitWithCallerSignal(pending, signal);
    signal.throwIfAborted();
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Server-only composition. No explicit document is needed: nomination happens only AFTER
 * ordinary ranking/selection, from the entire detached selected set and genuine V2 facts.
 * The callback conservatively bypasses answer and retrieval caches to obtain current request-local
 * authority. This is a first-TXT tradeoff, not a publication-safe cache implementation.
 */
export function registeredPublicAnswerOptions(
  input: RegisteredPublicAnswerInput,
): RegisteredPublicAnswerOptions | undefined {
  const requesterId = input.requesterId;
  if (!requesterId || !input.accessScope.includePublic || input.summaryMode) return;
  if (input.accessScope.ownerId !== requesterId || !z.uuid().safeParse(requesterId).success) return bindingFailure();

  // Detach server restrictions once; never derive identity/restrictions from callback rows.
  const explicitDocumentIds = input.explicitDocumentIds && [...input.explicitDocumentIds];
  const resolvedDocumentIds = input.resolvedDocumentIds && [...input.resolvedDocumentIds];
  const requestSignal = input.signal;
  const loadRegisteredPublishedOriginalSectionLayout: RegisteredPublishedOriginalSectionLayoutLookup = async ({
    selectedResults,
    signal: phaseSignal,
  }) => {
    requestSignal?.throwIfAborted();
    phaseSignal?.throwIfAborted();
    const signal =
      requestSignal && phaseSignal ? AbortSignal.any([requestSignal, phaseSignal]) : (requestSignal ?? phaseSignal);
    try {
      const claimsV2 = selectedResults.some((row) => {
        const metadata = row.source_metadata;
        return (
          metadata &&
          typeof metadata === "object" &&
          "publication_manifest_version" in metadata &&
          metadata.publication_manifest_version === 2
        );
      });
      // Wholly ordinary private/non-V2 rows retain baseline behavior without service-role reads.
      if (!claimsV2) return null;
      if (selectedResults.length < 1 || selectedResults.length > 6) return bindingFailure();
      const documentId = selectedResults[0].document_id;
      if (
        !z.uuid().safeParse(documentId).success ||
        (explicitDocumentIds !== undefined && !explicitDocumentIds.includes(documentId)) ||
        (resolvedDocumentIds !== undefined && !resolvedDocumentIds.includes(documentId))
      )
        return bindingFailure();
      const identities = new Set<string>();
      const facts = selectedResults.map((row) => {
        if (
          row.document_id !== documentId ||
          !z.uuid().safeParse(row.id).success ||
          identities.has(row.id) ||
          (row.corpus_scope !== undefined && row.corpus_scope !== "australian_public")
        )
          return bindingFailure();
        identities.add(row.id);
        return publishedOriginalSectionMetadataForResult(row);
      });
      const generationId = facts[0].index_generation_id as string;
      const publicationApprovalId = facts[0].publication_approval_id as string;
      if (
        facts.some(
          (fact) => fact.index_generation_id !== generationId || fact.publication_approval_id !== publicationApprovalId,
        )
      )
        return bindingFailure();

      // Real registration plus real supplier validation are authority. Retrieval facts only nominate.
      const supabase = createAdminClient();
      // The captured generated Database types predate these two implemented RPCs.
      // Adapt only their existing consumer contracts; keep unknown output, validation and SDK abort support.
      const rpc = supabase.rpc.bind(supabase) as unknown as RegisteredPublicSourceRpc;
      const resolvePlan = createRegisteredPublishedAdminSourcePlanResolver({ rpc });
      const plan = await boundedRead(
        (lookupSignal) => resolvePlan({ requesterId, documentId, signal: lookupSignal }),
        signal,
        registrationLookupTimeoutMs,
      );
      signal?.throwIfAborted();
      if (
        plan === null ||
        plan.documentId !== documentId ||
        plan.generationId !== generationId ||
        plan.publicationApprovalId !== publicationApprovalId
      )
        return bindingFailure();
      const readLayout = createPublishedAdminTextSectionLayoutLoader({
        requesterId,
        documentId,
        sourceExpectation: plan.sourceExpectation,
        sourceSectionLayout: plan.sourceSectionLayout,
        rpc,
      });
      return await boundedRead(
        async (layoutSignal) => {
          const request = {
            requesterId,
            documentId,
            expectedIndexGenerationId: generationId,
            publicationApprovalId,
            selectedResults,
            signal: layoutSignal,
          };
          const projection = await readLayout(request);
          layoutSignal.throwIfAborted();
          return validateCheckedPublishedOriginalSectionLayout(request, projection);
        },
        signal,
        sourceLayoutTimeoutMs,
      );
    } catch {
      // Preserve actual caller cancellation. All eligible supplier failures stay named and honest.
      signal?.throwIfAborted();
      return bindingFailure();
    }
  };
  return { skipCache: true, loadRegisteredPublishedOriginalSectionLayout };
}
