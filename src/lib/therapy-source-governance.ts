import { normalizeClinicalSourceMetadata } from "@/lib/source-metadata";
import type { ClinicalSourceMetadata } from "@/lib/types";

type TherapySourceInput = {
  title: string | null;
  sourceType: string | null;
  reference: string | null;
};

/** Adapt imported Therapy provenance without inventing currency, quality or approval. */
export function therapySourceMetadata(source: TherapySourceInput, recordReviewStatus: string): ClinicalSourceMetadata {
  return normalizeClinicalSourceMetadata({
    source_kind: "document",
    registry_record_kind: null,
    registry_record_subkind: null,
    registry_record_id: null,
    registry_record_slug: null,
    source_title: source.title ?? source.reference ?? source.sourceType,
    publisher: null,
    publisher_code: null,
    jurisdiction: null,
    version: null,
    publication_date: null,
    review_date: null,
    uploaded_at: null,
    indexed_at: null,
    uploaded_by: null,
    document_status: "unknown",
    clinical_validation_status: recordReviewStatus === "reviewed" ? "locally_reviewed" : "unverified",
    extraction_quality: "unknown",
  });
}
