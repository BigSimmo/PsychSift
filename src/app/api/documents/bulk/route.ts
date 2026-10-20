import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { hasWaDocumentControlEndorsement } from "@/lib/clinical-validation-basis";
import { normalizeDocumentLabelForStorage } from "@/lib/document-tags";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { safeErrorLogDetails } from "@/lib/privacy";
import { sourceAuthorityForPublisherCode } from "@/lib/source-authority-registry";
import { BMJ_THIRD_PARTY_ATTESTATION_BASIS } from "@/lib/source-review";
import { invalidateRagCachesForOwner } from "@/lib/rag/rag";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, TablesUpdate } from "@/lib/supabase/database.types";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const nullableText = z.union([z.string().trim().max(240), z.null()]).optional();
const bulkMetadataSchema = z
  .object({
    documentIds: z.array(z.string().uuid()).min(1).max(200),
    metadata: z
      .object({
        sourceStatus: z.enum(["current", "review_due", "outdated", "unknown"]).optional(),
        validationStatus: z.enum(["unverified", "locally_reviewed", "approved"]).optional(),
        extractionQuality: z.enum(["good", "partial", "poor", "unknown"]).optional(),
        reviewDate: nullableText,
        publicationDate: nullableText,
        jurisdiction: nullableText,
        publisher: nullableText,
        publisherCode: nullableText,
        sourceType: nullableText,
        collection: nullableText,
        category: nullableText,
      })
      .optional()
      .default({}),
    titleEdit: z
      .object({
        // Preserve intentional spacing at the title boundary. `editTitle` trims the
        // completed title, so outer whitespace is still discarded safely.
        prefix: z.string().max(40).optional(),
        suffix: z.string().max(40).optional(),
        find: z.string().trim().max(80).optional(),
        replace: z.string().trim().max(80).optional(),
      })
      .optional()
      .default({}),
    labels: z
      .object({
        add: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              label_type: z.enum([
                "site",
                "topic",
                "document_type",
                "medication",
                "risk",
                "setting",
                "workflow",
                "population",
                "service",
                "clinical_action",
                "care_phase",
                "document_intent",
                "content_feature",
                "custom",
              ]),
              confidence: z.number().min(0).max(1).optional(),
            }),
          )
          .max(50)
          .optional()
          .default([]),
        remove: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              label_type: z.enum([
                "site",
                "topic",
                "document_type",
                "medication",
                "risk",
                "setting",
                "workflow",
                "population",
                "service",
                "clinical_action",
                "care_phase",
                "document_intent",
                "content_feature",
                "custom",
              ]),
            }),
          )
          .max(50)
          .optional()
          .default([]),
      })
      .optional()
      .default({ add: [], remove: [] }),
  })
  .superRefine((value, context) => {
    if (value.metadata.sourceStatus !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["metadata", "sourceStatus"],
        message: "Bulk source-governance changes are not allowed; use an auditable source review.",
      });
    }
    if (value.metadata.validationStatus !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["metadata", "validationStatus"],
        message: "Bulk validation-governance changes are not allowed; use an auditable source review.",
      });
    }
  });

// Bounded optimistic-concurrency attempts for a metadata read-modify-write (F-08).
const DOCUMENT_METADATA_WRITE_ATTEMPTS = 3;

type BulkEditableDocument = { id: string; title: string; metadata: Json; updated_at: string };
type BulkWriteOutcome = "updated" | "changed" | "missing" | "reviewed";

// Fixed client-facing reasons for a document the bulk edit could not safely write.
const bulkConflictMessages: Record<Exclude<BulkWriteOutcome, "updated">, string> = {
  changed: "This document changed while the edit was saving (for example, indexing finished). Retry the edit.",
  missing: "This document was removed while the edit was saving.",
  reviewed:
    "Identity or provenance edits are unavailable for reviewed sources; record an auditable source-review disposition first.",
};

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

const identityOrProvenanceMetadataKeys = [
  "extractionQuality",
  "reviewDate",
  "publicationDate",
  "jurisdiction",
  "publisher",
  "publisherCode",
  "sourceType",
  "collection",
  "category",
] as const satisfies ReadonlyArray<keyof z.infer<typeof bulkMetadataSchema>["metadata"]>;

function requestsIdentityOrProvenanceEdit(value: z.infer<typeof bulkMetadataSchema>) {
  return (
    identityOrProvenanceMetadataKeys.some((key) => Object.hasOwn(value.metadata, key)) ||
    Object.keys(value.titleEdit).length > 0
  );
}

function hasProtectedSourceGovernance(metadataValue: unknown) {
  const metadata = metadataRecord(metadataValue);
  const evidence = metadataRecord(metadata.clinical_validation_evidence);
  const disposition = metadata.governance_disposition;
  return (
    metadata.document_status === "current" ||
    metadata.clinical_validation_status === "locally_reviewed" ||
    metadata.clinical_validation_status === "approved" ||
    metadata.provenance_basis === "reviewer_verified" ||
    disposition === "locally_reviewed" ||
    disposition === "approved" ||
    disposition === BMJ_THIRD_PARTY_ATTESTATION_BASIS ||
    evidence.basis === BMJ_THIRD_PARTY_ATTESTATION_BASIS ||
    hasWaDocumentControlEndorsement(metadata)
  );
}

function setMetadataValue(metadata: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined) return;
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    delete metadata[key];
    return;
  }
  metadata[key] = typeof value === "string" ? value.trim() : value;
}

function editTitle(title: string, edit: z.infer<typeof bulkMetadataSchema>["titleEdit"]) {
  let next = title;
  if (edit.find) next = next.replaceAll(edit.find, edit.replace ?? "");
  if (edit.prefix && !next.startsWith(edit.prefix)) next = `${edit.prefix}${next}`;
  if (edit.suffix && !next.endsWith(edit.suffix)) next = `${next}${edit.suffix}`;
  return next.trim().slice(0, 180);
}

export async function POST(request: Request) {
  try {
    if (isDemoMode())
      return publicErrorResponse("Bulk edits are unavailable in demo mode.", 400, { code: "demo_mode_unavailable" });

    const parsed = await parseJsonBody(request, bulkMetadataSchema, "Bulk edit payload is invalid.");

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });

    const rateLimit = await consumeApiRateLimit({
      supabase,
      ownerId: user.id,
      bucket: "document_admin",
      allowInMemoryFallbackOnUnavailable: true,
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Too many document administration requests. Retry shortly.", rateLimit);
    }

    const ids = Array.from(new Set(parsed.documentIds));
    const publisherCode = parsed.metadata.publisherCode;
    const hasPublisherCodeValue =
      publisherCode !== undefined && publisherCode !== null && publisherCode.trim().length > 0;
    // Validate once before the per-document loop so unknown codes return HTTP 400 instead of
    // being swallowed into generic per-document failures that still look like a 2xx success.
    const resolvedAuthority = hasPublisherCodeValue ? sourceAuthorityForPublisherCode(publisherCode) : null;
    if (hasPublisherCodeValue && !resolvedAuthority) {
      throw new PublicApiError("Unknown publisher code.", 400);
    }
    const clearPublisherCode =
      // Explicit null/empty publisherCode means delete the stored code.
      (publisherCode !== undefined && !hasPublisherCodeValue) ||
      // Manual publisher/jurisdiction edits replace authority identity; leave a stale code
      // and classification will keep prioritizing it over the corrected fields.
      (!hasPublisherCodeValue &&
        (parsed.metadata.publisher !== undefined || parsed.metadata.jurisdiction !== undefined));

    const { data: documents, error: documentsError } = await supabase
      .from("documents")
      .select("id,title,metadata,updated_at")
      .eq("owner_id", user.id)
      .in("id", ids);
    if (documentsError) throw new Error(documentsError.message);
    if (!documents?.length)
      return publicErrorResponse("No selected documents were found.", 404, { code: "documents_not_found" });

    // Authority and title fields are part of the identity that was reviewed.
    // Carrying a prior promotion or attestation across such an edit would make
    // the new identity look reviewed without an append-only event. There is no
    // event-backed atomic demotion in this generic route, so fail closed before
    // labels or document rows are mutated.
    if (
      requestsIdentityOrProvenanceEdit(parsed) &&
      documents.some((document) => hasProtectedSourceGovernance(document.metadata))
    ) {
      return publicErrorResponse(
        "Identity or provenance edits are unavailable for reviewed sources; record an auditable source-review disposition first.",
        409,
        { code: "reviewed_source_edit_blocked" },
      );
    }

    const foundIds = new Set(documents.map((document) => document.id));
    const missingDocumentIds = ids.filter((id) => !foundIds.has(id));
    const results: Array<{ documentId: string; updated: boolean; error?: string }> = [];
    const now = new Date().toISOString();

    const labelsToAdd = parsed.labels.add
      .map((label) => normalizeDocumentLabelForStorage({ ...label, source: "manual" }))
      .filter((label): label is NonNullable<typeof label> => Boolean(label));
    if (labelsToAdd.length) {
      const labelRows = documents.flatMap((document) =>
        labelsToAdd.map((label) => ({
          owner_id: user.id,
          document_id: document.id,
          label: label.label,
          label_type: label.label_type,
          confidence: label.confidence,
          source: "manual",
          metadata: { added_by_bulk_edit: true, updated_at: now },
        })),
      );
      const { error: labelError } = await supabase.from("document_labels").upsert(labelRows, {
        onConflict: "document_id,label_type,label,source",
      });
      if (labelError) throw new Error(labelError.message);
    }

    for (const label of parsed.labels.remove) {
      const normalized = normalizeDocumentLabelForStorage({ ...label, source: "manual" });
      if (!normalized) continue;
      const { error: removeError } = await supabase
        .from("document_labels")
        .delete()
        .eq("owner_id", user.id)
        .in(
          "document_id",
          documents.map((document) => document.id),
        )
        .eq("label", normalized.label)
        .eq("label_type", normalized.label_type);
      if (removeError) throw new Error(removeError.message);
    }

    const editsIdentityOrProvenance = requestsIdentityOrProvenanceEdit(parsed);
    const buildUpdatePayload = (document: BulkEditableDocument) => {
      const metadata = metadataRecord(document.metadata);
      setMetadataValue(metadata, "extraction_quality", parsed.metadata.extractionQuality);
      setMetadataValue(metadata, "review_date", parsed.metadata.reviewDate);
      setMetadataValue(metadata, "publication_date", parsed.metadata.publicationDate);
      if (resolvedAuthority) {
        setMetadataValue(metadata, "publisher_code", resolvedAuthority.codes[0]);
        setMetadataValue(metadata, "publisher", resolvedAuthority.publisher);
        setMetadataValue(metadata, "jurisdiction", resolvedAuthority.jurisdictions[0] ?? null);
      } else {
        if (clearPublisherCode) {
          setMetadataValue(metadata, "publisher_code", null);
        }
        setMetadataValue(metadata, "jurisdiction", parsed.metadata.jurisdiction);
        setMetadataValue(metadata, "publisher", parsed.metadata.publisher);
      }
      setMetadataValue(metadata, "source_type", parsed.metadata.sourceType);
      setMetadataValue(metadata, "collection", parsed.metadata.collection);
      setMetadataValue(metadata, "category", parsed.metadata.category);
      metadata.bulk_metadata_updated_at = now;
      metadata.bulk_metadata_updated_by = user.id;

      const nextTitle = editTitle(document.title, parsed.titleEdit);
      const updatePayload: TablesUpdate<"documents"> = { metadata: metadata as Json };
      if (nextTitle && nextTitle !== document.title) updatePayload.title = nextTitle;
      return updatePayload;
    };

    for (const document of documents) {
      try {
        // F-08: metadata carries the committed index pointer (mirrored by the generated
        // `index_generation_id` column) and the ingestion worker may commit a new one
        // between the read above and this write. Writing the whole object back
        // unconditionally would restore the stale pointer, so each write matches the
        // row's `updated_at` (bumped by the documents_updated_at trigger on every
        // update). A concurrent commit makes the write match no row; re-read the
        // document and rebuild the edit on the fresh metadata, a bounded number of times.
        let current: BulkEditableDocument = document;
        let outcome: BulkWriteOutcome = "changed";
        for (let attempt = 0; attempt < DOCUMENT_METADATA_WRITE_ATTEMPTS; attempt += 1) {
          if (attempt > 0) {
            const { data: fresh, error: freshError } = await supabase
              .from("documents")
              .select("id,title,metadata,updated_at")
              .eq("id", document.id)
              .eq("owner_id", user.id)
              .maybeSingle();
            if (freshError) throw new Error(freshError.message);
            if (!fresh) {
              outcome = "missing";
              break;
            }
            // The fresh row may have been promoted to a reviewed source meanwhile; keep
            // the fail-closed identity rule from the pre-check above.
            if (editsIdentityOrProvenance && hasProtectedSourceGovernance(fresh.metadata)) {
              outcome = "reviewed";
              break;
            }
            current = fresh;
          }

          const { data: updatedRows, error: updateError } = await supabase
            .from("documents")
            .update(buildUpdatePayload(current))
            .eq("id", document.id)
            .eq("owner_id", user.id)
            .eq("updated_at", current.updated_at)
            .select("id");
          if (updateError) throw new Error(updateError.message);
          if (updatedRows?.length) {
            outcome = "updated";
            break;
          }
        }

        if (outcome === "updated") {
          results.push({ documentId: document.id, updated: true });
        } else {
          logger.warn("Bulk document edit skipped a document that changed concurrently", {
            ownerId: user.id,
            documentId: document.id,
            outcome,
          });
          results.push({ documentId: document.id, updated: false, error: bulkConflictMessages[outcome] });
        }
      } catch (error) {
        // Never surface the raw DB error text (constraint names, column details) to the client;
        // log the sanitized detail server-side and return a generic per-document failure (S10/D5).
        logger.error("Bulk document edit failed for a document", {
          ownerId: user.id,
          documentId: document.id,
          ...safeErrorLogDetails(error),
        });
        results.push({
          documentId: document.id,
          updated: false,
          error: "Bulk edit failed for this document.",
        });
      }
    }

    invalidateRagCachesForOwner(user.id);
    return NextResponse.json({
      ok: results.every((result) => result.updated),
      updatedCount: results.filter((result) => result.updated).length,
      missingDocumentIds,
      results,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    if (error instanceof PublicApiError) return jsonError(error, error.status);
    return jsonError(error, 500);
  }
}
