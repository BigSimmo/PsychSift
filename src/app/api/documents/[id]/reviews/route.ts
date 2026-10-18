import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import {
  checkIngestionMutationSafety,
  hasActiveAgentEnrichmentJob,
  ingestionMutationSafetyPayload,
} from "@/lib/ingestion-mutation-safety";
import { withOwnerReadScope } from "@/lib/public-api-access";
import { invalidateRagCachesForOwner } from "@/lib/rag/rag";
import {
  BMJ_THIRD_PARTY_ATTESTATION_POLICY_VERSION,
  bmjThirdPartyAttestationRejectionReasons,
  isValidReviewDate,
  sourceReviewDecisionSchema,
} from "@/lib/source-review";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    decision: sourceReviewDecisionSchema,
    reason: z.string().trim().min(3).max(2000),
    evidenceReferences: z.array(z.string().trim().min(1).max(500)).max(30).optional().default([]),
    reviewDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isValidReviewDate, "Review date must be a valid date that is not in the future.")
      .nullable()
      .optional()
      .default(null),
    replacementDocumentId: z.string().uuid().nullable().optional().default(null),
    policyVersion: z.string().trim().max(120).nullable().optional().default(null),
    reviewerQualification: z.string().trim().max(500).nullable().optional().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.decision === "approved" || value.decision === "locally_reviewed") && !value.evidenceReferences.length) {
      context.addIssue({
        code: "custom",
        path: ["evidenceReferences"],
        message: "Evidence is required for promotion.",
      });
    }
    if (value.decision === "superseded" && !value.replacementDocumentId) {
      context.addIssue({ code: "custom", path: ["replacementDocumentId"], message: "A replacement is required." });
    }
    if (value.decision === "third_party_reference_attested") {
      if (!value.evidenceReferences.length) {
        context.addIssue({
          code: "custom",
          path: ["evidenceReferences"],
          message: "Attestation evidence is required.",
        });
      }
      if (!value.reviewDate) {
        context.addIssue({ code: "custom", path: ["reviewDate"], message: "An attestation review date is required." });
      }
      if (value.policyVersion !== BMJ_THIRD_PARTY_ATTESTATION_POLICY_VERSION) {
        context.addIssue({
          code: "custom",
          path: ["policyVersion"],
          message: "The current BMJ third-party attestation policy version is required.",
        });
      }
      if (!value.reviewerQualification?.trim()) {
        context.addIssue({
          code: "custom",
          path: ["reviewerQualification"],
          message: "Reviewer qualification is required.",
        });
      }
    }
  });

function isSourceReviewV2Unavailable(error: { code?: string | null; message: string }) {
  const message = error.message.toLowerCase();
  return (
    error.code === "PGRST202" ||
    (message.includes("record_source_review_v2") &&
      (message.includes("schema cache") || message.includes("could not find") || message.includes("does not exist")))
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, paramsSchema, "Invalid document id.");
    if (isDemoMode())
      return publicErrorResponse("Source reviews are unavailable in demo mode.", 400, {
        code: "demo_mode_unavailable",
      });

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });
    const body = await parseJsonBody(request, bodySchema, "Invalid source review.");
    const rateLimit = await consumeApiRateLimit({ supabase, ownerId: user.id, bucket: "source_review" });
    if (rateLimit.limited) return rateLimitJsonResponse("Too many source review requests. Retry shortly.", rateLimit);

    const { data: document, error: documentError } = await withOwnerReadScope(
      supabase.from("documents").select("id,status,owner_id,metadata").eq("id", id),
      user.id,
    ).maybeSingle();
    if (documentError) throw new Error(documentError.message);
    if (!document || (document.owner_id !== null && document.owner_id !== user.id)) {
      return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
    }

    const promotesSource = body.decision === "approved" || body.decision === "locally_reviewed";
    const attestsThirdPartyReference = body.decision === "third_party_reference_attested";
    if (promotesSource && document.owner_id === null && (!body.reviewDate || !body.reviewerQualification?.trim())) {
      return publicErrorResponse(
        "Public-corpus source promotion requires a review date and reviewer qualification.",
        400,
        { code: "public_source_review_incomplete" },
      );
    }
    if ((promotesSource || attestsThirdPartyReference) && document.status !== "indexed") {
      return publicErrorResponse(
        attestsThirdPartyReference
          ? "Third-party reference attestation requires completed document indexing."
          : "Source promotion requires completed document indexing.",
        409,
        { code: "source_indexing_incomplete" },
      );
    }

    if (attestsThirdPartyReference) {
      const rejectionReasons = bmjThirdPartyAttestationRejectionReasons({
        documentStatus: document.status,
        metadata: document.metadata,
        evidenceReferences: body.evidenceReferences,
        reviewDate: body.reviewDate,
        policyVersion: body.policyVersion,
        reviewerQualification: body.reviewerQualification,
      });
      if (rejectionReasons.length) {
        return publicErrorResponse(
          "Third-party reference attestation requires an indexed, unverified BMJ source with compatible publisher and jurisdiction metadata.",
          409,
          { code: "bmj_attestation_ineligible" },
        );
      }
    }

    if (promotesSource || attestsThirdPartyReference) {
      const safety = await checkIngestionMutationSafety({
        supabase,
        documentIds: [id],
        action: attestsThirdPartyReference ? "Third-party source attestation" : "Source promotion",
        checkActiveJobs: true,
        staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
      });
      if (!safety.ok) return NextResponse.json(ingestionMutationSafetyPayload(safety), { status: safety.status });

      const enrichmentActive = await hasActiveAgentEnrichmentJob({
        supabase,
        documentId: id,
        staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
      });
      if (enrichmentActive) {
        return publicErrorResponse(
          attestsThirdPartyReference
            ? "Third-party source attestation is paused while enrichment is active."
            : "Source promotion is paused while enrichment is active.",
          409,
          { code: "enrichment_active" },
        );
      }
    }

    const legacyReviewParams = {
      p_document_id: id,
      p_reviewer_id: user.id,
      p_decision: body.decision,
      p_reason: body.reason,
      p_evidence_references: body.evidenceReferences,
      p_review_date: body.reviewDate,
      p_replacement_document_id: body.replacementDocumentId,
    };
    const requiresV2 = document.owner_id === null || attestsThirdPartyReference;
    const { data, error } = requiresV2
      ? await supabase.rpc("record_source_review_v2", {
          ...legacyReviewParams,
          p_policy_version: body.policyVersion,
          p_reviewer_qualification: body.reviewerQualification,
        })
      : await supabase.rpc("record_source_review", legacyReviewParams);
    if (error) {
      if (requiresV2 && isSourceReviewV2Unavailable(error)) {
        return publicErrorResponse(
          "Public source review is unavailable until the reviewed governance migration is applied.",
          503,
          { code: "source_review_v2_unavailable" },
        );
      }
      if (/^document not found\.?$/i.test(error.message.trim())) {
        return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
      }
      throw new PublicApiError("Source review could not be recorded.", 400, { code: "source_review_rejected" });
    }

    // Public documents participate in every owner's retrieval view, so a
    // public-corpus governance change must clear all local and shared scopes.
    // These clears reclaim entries; the fresh database scope revision fences
    // every cache hit even on another replica or when shared deletion fails.
    if (document.owner_id === null) invalidateRagCachesForOwner();
    else invalidateRagCachesForOwner(user.id);
    return NextResponse.json({ review: data }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    if (error instanceof PublicApiError) return jsonError(error, error.status);
    return jsonError(error, 500);
  }
}
