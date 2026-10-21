import { describe, expect, it } from "vitest";
import {
  frontendSourceGovernanceWarnings,
  groupSourceGovernanceWarnings,
  hasDangerSourceGovernanceWarning,
  sourceGovernanceRefusalAnswer,
  sourceGovernanceWarnings,
} from "../src/lib/source-governance";
import type { SearchResult } from "../src/lib/types";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Guideline",
    file_name: "guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: "Clinical text",
    image_ids: [],
    similarity: 0.42,
    source_metadata: {
      source_title: "Guideline",
      publisher: "Non-local publisher",
      jurisdiction: "Elsewhere",
      version: null,
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "outdated",
      clinical_validation_status: "unverified",
      extraction_quality: "poor",
    },
    indexing_quality: {
      document_id: "doc-1",
      quality_score: 0.35,
      extraction_quality: "poor",
      metrics: {},
      issues: ["short extraction"],
    },
    table_facts: [
      {
        id: "fact-1",
        document_id: "doc-1",
        source_chunk_id: "chunk-1",
        source_image_id: null,
        page_number: 1,
        table_title: "Admin table",
        row_label: null,
        clinical_parameter: null,
        threshold_value: null,
        action: null,
        metadata: { review_class: "administrative" },
      },
    ],
    images: [],
    ...overrides,
  };
}

describe("source governance warnings", () => {
  it("flags stale, unverified, low-quality, non-local, weak, and weak-table sources", () => {
    const warnings = sourceGovernanceWarnings({
      results: [result()],
      relevance: {
        verdict: "nearby",
        label: "Nearby evidence",
        matchedTerms: [],
        missingTerms: [],
        directSourceCount: 0,
        weakSourceCount: 1,
        score: 0.2,
        supportReason: "Nearby-only evidence.",
        isSourceBacked: false,
      },
    });
    const codes = warnings.map((warning) => warning.code);

    expect(codes).toContain("outdated_source");
    expect(codes).toContain("non_local_source");
    expect(codes).toContain("unverified_source");
    expect(codes).toContain("poor_extraction");
    expect(codes).toContain("low_index_quality");
    expect(codes).toContain("weak_evidence");
    expect(codes).toContain("weak_table_extraction");
  });

  it("groups repeated document-level warnings into one counted message", () => {
    const grouped = groupSourceGovernanceWarnings([
      {
        code: "unverified_source",
        severity: "warning",
        message: "One or more supporting sources have not been locally validated.",
        document_id: "doc-1",
        title: "A",
      },
      {
        code: "unverified_source",
        severity: "warning",
        message: "One or more supporting sources have not been locally validated.",
        document_id: "doc-2",
        title: "B",
      },
      {
        code: "non_local_source",
        severity: "info",
        message: "One or more supporting sources do not appear to be local WA/Perth guidance.",
        document_id: "doc-3",
        title: "C",
      },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      code: "unverified_source",
      count: 2,
      message: "2 sources have not been locally validated.",
      titles: ["A", "B"],
    });
  });

  it("identifies danger-class warnings for server-side answer refusal", () => {
    const warnings = sourceGovernanceWarnings({ results: [result()] });

    expect(hasDangerSourceGovernanceWarning(warnings)).toBe(true);
    expect(hasDangerSourceGovernanceWarning(warnings.filter((warning) => warning.severity !== "danger"))).toBe(false);
  });

  it("does not danger-refuse usable content just because review metadata is missing", () => {
    const warnings = sourceGovernanceWarnings({
      results: [
        result({
          source_metadata: undefined,
          indexing_quality: {
            document_id: "doc-1",
            quality_score: 0.92,
            extraction_quality: "good",
            metrics: {},
            issues: [],
          },
          table_facts: [],
        }),
      ],
    });

    expect(warnings).toEqual([expect.objectContaining({ code: "unverified_source", severity: "warning" })]);
    expect(hasDangerSourceGovernanceWarning(warnings)).toBe(false);
  });

  it("never hides or danger-refuses a date-less unknown-status source (leave-unknown path)", () => {
    // The automatic derivation leaves documents with no date signal at
    // document_status "unknown"; those must still surface to users, never be
    // penalised as outdated or trigger a refusal.
    const warnings = sourceGovernanceWarnings({
      results: [
        result({
          source_metadata: {
            source_title: "Undated local source",
            publisher: "WA Health",
            jurisdiction: "Australia/WA",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "unknown",
            clinical_validation_status: "locally_reviewed",
            extraction_quality: "good",
          },
          indexing_quality: {
            document_id: "doc-1",
            quality_score: 0.9,
            extraction_quality: "good",
            metrics: {},
            issues: [],
          },
          table_facts: [],
        }),
      ],
    });

    expect(warnings.map((warning) => warning.code)).not.toContain("outdated_source");
    expect(hasDangerSourceGovernanceWarning(warnings)).toBe(false);
  });

  // Audit M8: docs/clinical-governance.md says unknown source metadata is
  // treated as unverified, not current. The caveat was emitted only for the
  // literal value "unverified", so a partially-recorded document (governance
  // fields present, clinical_validation_status absent, normalised to "unknown")
  // was cited with no "not locally validated" caveat at all.
  it("treats an unknown clinical_validation_status as not locally validated (M8)", () => {
    const warnings = sourceGovernanceWarnings({
      results: [
        result({
          source_metadata: {
            source_title: "Partially recorded local source",
            publisher: "WA Health",
            jurisdiction: "Australia/WA",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "current",
            clinical_validation_status: "unknown",
            extraction_quality: "good",
          },
          indexing_quality: {
            document_id: "doc-1",
            quality_score: 0.9,
            extraction_quality: "good",
            metrics: {},
            issues: [],
          },
          table_facts: [],
        }),
      ],
    });

    expect(warnings).toEqual([
      expect.objectContaining({
        code: "unverified_source",
        severity: "warning",
        message: "One or more supporting sources have not been locally validated.",
      }),
    ]);
    // Conservative, not adverse: an unvalidated source still answers.
    expect(hasDangerSourceGovernanceWarning(warnings)).toBe(false);
    expect(frontendSourceGovernanceWarnings(warnings).map((warning) => warning.code)).toEqual(["unverified_source"]);
  });

  it("keeps the locally reviewed and approved statuses free of the validation caveat (M8)", () => {
    for (const status of ["locally_reviewed", "approved"] as const) {
      const warnings = sourceGovernanceWarnings({
        results: [
          result({
            source_metadata: {
              source_title: "Reviewed local source",
              publisher: "WA Health",
              jurisdiction: "Australia/WA",
              version: null,
              publication_date: null,
              review_date: null,
              uploaded_at: null,
              indexed_at: null,
              uploaded_by: null,
              document_status: "current",
              clinical_validation_status: status,
              extraction_quality: "good",
            },
            indexing_quality: {
              document_id: "doc-1",
              quality_score: 0.9,
              extraction_quality: "good",
              metrics: {},
              issues: [],
            },
            table_facts: [],
          }),
        ],
      });

      expect(warnings.map((warning) => warning.code)).not.toContain("unverified_source");
    }
  });

  it("surfaces review-due and unvalidated-source caveats to the frontend", () => {
    const warnings = sourceGovernanceWarnings({
      results: [
        result({
          source_metadata: {
            source_title: "Review due local source",
            publisher: "WA Health",
            jurisdiction: "Australia/WA",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "review_due",
            clinical_validation_status: "unverified",
            extraction_quality: "good",
          },
          indexing_quality: {
            document_id: "doc-1",
            quality_score: 0.9,
            extraction_quality: "good",
            metrics: {},
            issues: [],
          },
          table_facts: [],
        }),
      ],
    });

    expect(warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["review_due_source", "unverified_source"]),
    );
    // With the whole indexed corpus promoted public regardless of validation
    // status, "not locally validated" must stay visible. A source past its review
    // date is likewise a material currency caveat, so its badge is surfaced too
    // (Issue 2) — kept consistent with the render-policy copy text.
    expect(frontendSourceGovernanceWarnings(warnings).map((warning) => warning.code)).toEqual([
      "review_due_source",
      "unverified_source",
    ]);
  });

  it("surfaces only clinically material warnings to the frontend", () => {
    const warnings = sourceGovernanceWarnings({
      results: [result()],
      relevance: {
        verdict: "none",
        label: "No evidence",
        matchedTerms: [],
        missingTerms: [],
        directSourceCount: 0,
        weakSourceCount: 0,
        score: 0,
        supportReason: "No source-backed evidence.",
        isSourceBacked: false,
      },
    });
    const visibleCodes = frontendSourceGovernanceWarnings(warnings).map((warning) => warning.code);

    expect(visibleCodes).toEqual(
      expect.arrayContaining(["weak_evidence", "outdated_source", "poor_extraction", "unverified_source"]),
    );
    expect(visibleCodes).not.toContain("non_local_source");
  });

  it("surfaces registry summaries as visible info warnings", () => {
    const warnings = sourceGovernanceWarnings({
      results: [
        result({
          source_metadata: {
            source_kind: "registry_record",
            source_title: "Crisis service summary",
            publisher: "PsychSift registry",
            jurisdiction: "WA/local clinical workspace",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "current",
            clinical_validation_status: "locally_reviewed",
            extraction_quality: "good",
          },
          indexing_quality: {
            document_id: "doc-1",
            quality_score: 0.9,
            extraction_quality: "good",
            metrics: {},
            issues: [],
          },
          table_facts: [],
        }),
      ],
    });

    expect(warnings).toEqual([expect.objectContaining({ code: "registry_record_source", severity: "info" })]);
    expect(frontendSourceGovernanceWarnings(warnings).map((warning) => warning.code)).toEqual([
      "registry_record_source",
    ]);
    expect(groupSourceGovernanceWarnings(warnings)[0]?.message).toBe("1 registry summary used as supporting evidence.");
  });

  it("prioritizes safety warnings over registry info when truncating", () => {
    const warnings = sourceGovernanceWarnings({
      limit: 1,
      results: [
        result({
          source_metadata: {
            source_kind: "registry_record",
            source_title: "Registry summary",
            publisher: "PsychSift registry",
            jurisdiction: "WA/local clinical workspace",
            version: null,
            publication_date: null,
            review_date: null,
            uploaded_at: null,
            indexed_at: null,
            uploaded_by: null,
            document_status: "current",
            clinical_validation_status: "locally_reviewed",
            extraction_quality: "good",
          },
          indexing_quality: {
            document_id: "doc-1",
            quality_score: 0.9,
            extraction_quality: "good",
            metrics: {},
            issues: [],
          },
          table_facts: [],
        }),
        result(),
      ],
    });

    expect(warnings).toEqual([expect.objectContaining({ code: "outdated_source", severity: "danger" })]);
  });

  it("keeps the refusal message free of backend and source-backed wording", () => {
    expect(sourceGovernanceRefusalAnswer).not.toMatch(/source-backed|source-governance|admin|need review/i);
    expect(sourceGovernanceRefusalAnswer).toContain("matched documents are not suitable for clinical use yet");
  });
});
