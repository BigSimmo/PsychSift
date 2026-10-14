import type { ClinicalSourceMetadata } from "@/lib/types";

type TherapySourceInput = {
  title: string | null;
  sourceType: string | null;
  reference: string | null;
};

/**
 * A source marker the catalogue writes inline at the end of a sentence, e.g.
 * "… as unsupported self-help. (PubMed)".
 */
export const AUTHORITY_PATTERN = /(?<=[.!?])\s*\(([A-Z0-9][^().!?]{0,58})\)/g;

export type SourceCitation = { text: string; authority: string };

/**
 * Split a record's reference blob into individual citations.
 *
 * The catalogue stores every record's references as one run of prose in which
 * each citation ends with its authority in brackets. Splitting on the authority
 * marker recovers the list the author wrote.
 */
export function splitSourceCitations(text: string): { citations: SourceCitation[]; notes: string[] } {
  const citations: SourceCitation[] = [];
  const notes: string[] = [];
  let cursor = 0;

  AUTHORITY_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(AUTHORITY_PATTERN)) {
    const start = match.index ?? 0;
    const body = text.slice(cursor, start).trim();
    cursor = start + match[0].length;
    if (body) citations.push({ text: body, authority: match[1] });
  }

  const tail = text.slice(cursor).trim();
  if (tail) {
    if (!citations.length) citations.push({ text: tail, authority: "" });
    else notes.push(tail);
  }
  return { citations, notes };
}

/** Adapt imported Therapy provenance without inventing currency, quality or approval. */
export function therapySourceMetadata(source: TherapySourceInput, recordReviewStatus: string): ClinicalSourceMetadata {
  return {
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
  };
}

/** Check if a reference blob contains later-added NICE guideline citations from the 2026-10-09 sweep. */
export function isLaterAddedNiceReference(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes("9 October 2026") && text.includes("NICE");
}

export type NiceGuidelineDetails = {
  title: string;
  authorityCode: string | null;
  canonicalUrl: string | null;
};

/** Extract structured guideline details from a NICE recommendation citation. */
export function extractNiceGuidelineDetails(citationText: string, authority?: string | null): NiceGuidelineDetails {
  const urlMatch = citationText.match(/https?:\/\/[^\s)]+/)?.[0]?.replace(/[.,;:)]+$/, "") ?? null;
  const authorityCode = authority?.replace(/^NICE\s*/i, "").trim() || null;
  const titleMatch = citationText.match(/^([^,]+)/);
  const rawTitle = titleMatch ? titleMatch[1].trim() : "NICE guideline";
  const title = `NICE guideline: ${rawTitle}${authorityCode ? ` (${authorityCode})` : ""}`;

  return {
    title,
    authorityCode,
    canonicalUrl: urlMatch,
  };
}

/** Explicit source metadata for later-added NICE guideline citations. */
export function therapyNiceGuidelineMetadata(
  citation: { authority?: string; text?: string },
  recordReviewStatus: string,
): ClinicalSourceMetadata {
  const details = extractNiceGuidelineDetails(citation.text ?? "", citation.authority);
  return {
    source_kind: "guideline",
    registry_record_kind: null,
    registry_record_subkind: null,
    registry_record_id: null,
    registry_record_slug: null,
    source_title: details.title,
    publisher: "National Institute for Health and Care Excellence",
    publisher_code: "NICE",
    jurisdiction: "United Kingdom",
    version: details.authorityCode,
    publication_date: null,
    review_date: null,
    uploaded_at: null,
    indexed_at: null,
    uploaded_by: null,
    document_status: "unknown",
    clinical_validation_status: recordReviewStatus === "reviewed" ? "locally_reviewed" : "unverified",
    extraction_quality: "unknown",
    canonical_url: details.canonicalUrl,
  };
}
