import { describe, expect, it } from "vitest";
import { capPerDocumentCrowding, packedContextCacheKey, selectModelContextResults } from "../src/lib/rag/rag";
import { australianSourcePolicyVersion } from "../src/lib/australian-source-catalogue";
import type { RagQueryClass, SearchResult } from "../src/lib/types";

function source(index: number, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: `chunk-${index}`,
    document_id: `doc-${index}`,
    title: `Guideline ${index}`,
    file_name: `guideline-${index}.pdf`,
    page_number: index,
    chunk_index: index,
    section_heading: "Overview",
    content: `Clinical source text ${index}.`,
    image_ids: [],
    similarity: 0.9 - index * 0.01,
    hybrid_score: 0.9 - index * 0.01,
    images: [],
    source_metadata: {
      source_title: `Guideline ${index}`,
      publisher: "Local health service",
      publisher_code: "LOCAL",
      jurisdiction: "local",
      publication_date: "2025-01-01",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      corpus_scope: "uploaded_local",
      source_role: "local_guideline",
      content_mode: "indexed_content",
      change_state: "unchanged",
      licence_policy: "public_index_permitted",
    },
    ...overrides,
  };
}

function governedSource(
  index: number,
  args: {
    documentId: string;
    publisherCode: string;
    publisher: string;
    jurisdiction: string;
    validation?: "unverified" | "locally_reviewed" | "approved";
  },
) {
  return source(index, {
    document_id: args.documentId,
    source_metadata: {
      source_title: `Guideline ${index}`,
      publisher: args.publisher,
      publisher_code: args.publisherCode,
      jurisdiction: args.jurisdiction,
      version: null,
      publication_date: null,
      review_date: null,
      uploaded_at: null,
      indexed_at: null,
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: args.validation ?? "approved",
      extraction_quality: "good",
      corpus_scope: "uploaded_local",
      source_role: "local_guideline",
      content_mode: "indexed_content",
      change_state: "unchanged",
      licence_policy: "public_index_permitted",
    },
  });
}

function australianCatalogueSource(
  index: number,
  sourceMetadata: {
    key: string;
    publisherCode: string;
    publisher: string;
    jurisdiction: string;
    sourceRole: "clinical_guideline" | "reference_link" | "regulatory" | "subsidy";
    contentMode: "indexed_content" | "link_only";
    licencePolicy: "public_index_permitted" | "metadata_link_only";
  },
) {
  return source(index, {
    source_metadata: {
      source_title: `${sourceMetadata.publisher} source`,
      publisher: sourceMetadata.publisher,
      publisher_code: sourceMetadata.publisherCode,
      jurisdiction: sourceMetadata.jurisdiction,
      publication_date: "2025-01-01",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      corpus_scope: "australian_public",
      source_role: sourceMetadata.sourceRole,
      content_mode: sourceMetadata.contentMode,
      source_catalogue_key: sourceMetadata.key,
      source_policy_version: australianSourcePolicyVersion,
      change_state: "unchanged",
      licence_policy: sourceMetadata.licencePolicy,
    },
  });
}

function withRelevance(result: SearchResult, verdict: NonNullable<SearchResult["relevance"]>["verdict"]): SearchResult {
  return {
    ...result,
    relevance: {
      verdict,
      label: verdict,
      matchedTerms: verdict === "none" ? [] : ["lithium"],
      missingTerms: [],
      directSourceCount: verdict === "direct" ? 1 : 0,
      weakSourceCount: verdict === "direct" ? 0 : 1,
      score: verdict === "direct" ? 1 : verdict === "partial" ? 0.7 : verdict === "nearby" ? 0.4 : 0,
      supportReason: `${verdict} test evidence`,
      isSourceBacked: verdict === "direct" || verdict === "partial",
      coverageScore: verdict === "direct" ? 1 : 0.5,
      rankScore: verdict === "direct" ? 1 : 0.5,
      titleMatchedTerms: [],
      contentMatchedTerms: verdict === "none" ? [] : ["lithium"],
      metadataMatchedTerms: [],
      chips: [],
    },
  };
}

function waGovernedSource(index: number, documentId: string) {
  const fsh = documentId === "wa-doc-1";
  return governedSource(index, {
    documentId,
    publisherCode: fsh ? "FSH" : "EMHS",
    publisher: fsh ? "Fiona Stanley Fremantle Hospitals Group" : "East Metropolitan Health Service",
    jurisdiction: "Australia/WA",
  });
}

function bmjSupplementarySource(index: number) {
  return governedSource(index, {
    documentId: "bmj-doc",
    publisherCode: "BMJ",
    publisher: "BMJ Best Practice",
    jurisdiction: "International",
    validation: "unverified",
  });
}

const results = Array.from({ length: 12 }, (_, index) => source(index + 1));

function select(args: {
  routeMode: "unsupported" | "extractive" | "fast" | "strong";
  queryClass: RagQueryClass;
  crossDocument?: boolean;
}) {
  return selectModelContextResults({
    routeMode: args.routeMode,
    queryClass: args.queryClass,
    crossDocument: args.crossDocument ?? false,
    results,
  });
}

describe("RAG model context budgeting", () => {
  const allQueryClasses: readonly RagQueryClass[] = [
    "document_lookup",
    "table_threshold",
    "medication_dose_risk",
    "comparison",
    "broad_summary",
    "unsupported_or_general",
  ];
  const pbs = australianCatalogueSource(90, {
    key: "pbs",
    publisherCode: "PBS",
    publisher: "Pharmaceutical Benefits Scheme",
    jurisdiction: "Australia/National",
    sourceRole: "subsidy",
    contentMode: "indexed_content",
    licencePolicy: "public_index_permitted",
  });
  const etg = australianCatalogueSource(91, {
    key: "etg-complete",
    publisherCode: "TG",
    publisher: "Therapeutic Guidelines",
    jurisdiction: "Australia/National",
    sourceRole: "reference_link",
    contentMode: "link_only",
    licencePolicy: "metadata_link_only",
  });
  const amh = australianCatalogueSource(92, {
    key: "australian-medicines-handbook",
    publisherCode: "AMH",
    publisher: "Australian Medicines Handbook",
    jurisdiction: "Australia/National",
    sourceRole: "reference_link",
    contentMode: "link_only",
    licencePolicy: "metadata_link_only",
  });

  it.each(allQueryClasses)("filters PBS and eTG/AMH out of production model context for %s", (queryClass) => {
    const local = source(89);
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass,
      crossDocument: queryClass === "comparison",
      results: [pbs, etg, amh, local],
    });

    expect(selected.map((result) => result.id)).toEqual([local.id]);
  });

  it("uses dose-or-monitoring eligibility only for the two verified numeric query classes", () => {
    const tga = australianCatalogueSource(93, {
      key: "tga",
      publisherCode: "TGA",
      publisher: "Therapeutic Goods Administration",
      jurisdiction: "Australia/National",
      sourceRole: "regulatory",
      contentMode: "indexed_content",
      licencePolicy: "public_index_permitted",
    });

    for (const queryClass of ["table_threshold", "medication_dose_risk"] as const) {
      expect(
        selectModelContextResults({ routeMode: "strong", queryClass, crossDocument: false, results: [tga] }).map(
          (result) => result.id,
        ),
      ).toEqual([tga.id]);
    }
    for (const queryClass of ["document_lookup", "comparison", "broad_summary", "unsupported_or_general"] as const) {
      expect(
        selectModelContextResults({ routeMode: "strong", queryClass, crossDocument: false, results: [tga] }),
      ).toEqual([]);
    }
  });

  it("limits routine fast generation to the top four sources", () => {
    const selected = select({ routeMode: "fast", queryClass: "document_lookup" });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
  });

  it("keeps broader context for synthesis-heavy fast routes", () => {
    expect(select({ routeMode: "fast", queryClass: "comparison" })).toHaveLength(12);
    expect(select({ routeMode: "fast", queryClass: "broad_summary" })).toHaveLength(12);
    expect(select({ routeMode: "fast", queryClass: "document_lookup", crossDocument: true })).toHaveLength(12);
  });

  it("bounds high-risk supplementary-only context without dropping all available evidence", () => {
    const selected = select({ routeMode: "fast", queryClass: "medication_dose_risk" });

    expect(selected).toHaveLength(6);
    expect(selected.map((result) => result.id)).toEqual([
      "chunk-1",
      "chunk-2",
      "chunk-3",
      "chunk-4",
      "chunk-5",
      "chunk-6",
    ]);
  });

  it("does not limit strong generation or non-model routes", () => {
    expect(select({ routeMode: "strong", queryClass: "document_lookup" })).toHaveLength(12);
    expect(select({ routeMode: "extractive", queryClass: "document_lookup" })).toHaveLength(12);
    expect(select({ routeMode: "unsupported", queryClass: "unsupported_or_general" })).toHaveLength(12);
  });

  it("caps a crowding document to three chunks in the model context but keeps other docs (P9)", () => {
    const crowded: SearchResult[] = [
      source(1), // doc-1
      { ...source(2), document_id: "doc-1", id: "a2" },
      { ...source(3), document_id: "doc-1", id: "a3" },
      { ...source(4), document_id: "doc-1", id: "a4" }, // 4th from doc-1 → dropped
      { ...source(5), document_id: "doc-1", id: "a5" }, // 5th from doc-1 → dropped
      { ...source(6), document_id: "doc-2", id: "b1" },
    ];
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "broad_summary",
      crossDocument: false,
      results: crowded,
    });
    const perDoc = selected.reduce<Record<string, number>>((acc, r) => {
      acc[r.document_id] = (acc[r.document_id] ?? 0) + 1;
      return acc;
    }, {});
    expect(perDoc["doc-1"]).toBe(3);
    expect(perDoc["doc-2"]).toBe(1);
    // Order preserved, no reranking.
    expect(selected.map((r) => r.id)).toEqual(["chunk-1", "a2", "a3", "b1"]);
  });

  it("never starves a genuinely single-document answer", () => {
    const singleDoc: SearchResult[] = Array.from({ length: 6 }, (_, index) => ({
      ...source(index + 1),
      document_id: "doc-only",
      id: `only-${index + 1}`,
    }));
    expect(capPerDocumentCrowding(singleDoc)).toHaveLength(6);
  });

  it("uses four validated Australian passages across two documents without supplementary padding", () => {
    const highRiskResults = [
      governedSource(1, {
        documentId: "wa-doc-1",
        publisherCode: "FSH",
        publisher: "Fiona Stanley Fremantle Hospitals Group",
        jurisdiction: "Australia/WA",
      }),
      governedSource(2, {
        documentId: "wa-doc-2",
        publisherCode: "EMHS",
        publisher: "East Metropolitan Health Service",
        jurisdiction: "Australia/WA",
      }),
      governedSource(3, {
        documentId: "wa-doc-1",
        publisherCode: "FSH",
        publisher: "WA Health",
        jurisdiction: "Australia/WA",
      }),
      governedSource(4, {
        documentId: "wa-doc-2",
        publisherCode: "EMHS",
        publisher: "East Metropolitan Health Service",
        jurisdiction: "Australia/WA",
      }),
      governedSource(5, {
        documentId: "bmj-doc",
        publisherCode: "BMJ",
        publisher: "BMJ Best Practice",
        jurisdiction: "International",
        validation: "unverified",
      }),
    ];

    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "medication_dose_risk",
      crossDocument: false,
      results: highRiskResults,
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
    expect(new Set(selected.map((result) => result.document_id))).toEqual(new Set(["wa-doc-1", "wa-doc-2"]));
  });

  it("retains a direct supplementary passage when four Australian passages are only nearby", () => {
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "medication_dose_risk",
      crossDocument: false,
      results: [
        withRelevance(bmjSupplementarySource(1), "direct"),
        withRelevance(waGovernedSource(2, "wa-doc-1"), "nearby"),
        withRelevance(waGovernedSource(3, "wa-doc-2"), "nearby"),
        withRelevance(waGovernedSource(4, "wa-doc-1"), "nearby"),
        withRelevance(waGovernedSource(5, "wa-doc-2"), "nearby"),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4", "chunk-5"]);
  });

  it("excludes supplementary padding before a 3+1 Australian distribution is diversity-capped", () => {
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "medication_dose_risk",
      crossDocument: false,
      results: [
        withRelevance(waGovernedSource(1, "wa-doc-1"), "partial"),
        withRelevance(waGovernedSource(2, "wa-doc-1"), "partial"),
        withRelevance(waGovernedSource(3, "wa-doc-1"), "partial"),
        withRelevance(waGovernedSource(4, "wa-doc-2"), "partial"),
        withRelevance(bmjSupplementarySource(5), "partial"),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-4"]);
  });

  it("uses Australian-only context when four passages match supplementary relevance", () => {
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "table_threshold",
      crossDocument: false,
      results: [
        withRelevance(waGovernedSource(1, "wa-doc-1"), "direct"),
        withRelevance(waGovernedSource(2, "wa-doc-2"), "direct"),
        withRelevance(waGovernedSource(3, "wa-doc-1"), "direct"),
        withRelevance(waGovernedSource(4, "wa-doc-2"), "direct"),
        withRelevance(bmjSupplementarySource(5), "direct"),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
  });

  it("keeps supplementary evidence when authoritative Australian coverage is not sufficient", () => {
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "table_threshold",
      crossDocument: false,
      results: [
        governedSource(1, {
          documentId: "wa-doc",
          publisherCode: "WACHS",
          publisher: "WA Country Health Service",
          jurisdiction: "Australia/WA",
        }),
        governedSource(2, {
          documentId: "national-doc",
          publisherCode: "TGA",
          publisher: "Therapeutic Goods Administration",
          jurisdiction: "Australia/National",
          validation: "unverified",
        }),
        governedSource(3, {
          documentId: "bmj-doc",
          publisherCode: "BMJ",
          publisher: "BMJ Best Practice",
          jurisdiction: "International",
          validation: "unverified",
        }),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
  });

  it("does not promote a known international code with conflicting WA metadata", () => {
    const conflict = governedSource(1, {
      documentId: "conflict-doc",
      publisherCode: "BMJ",
      publisher: "BMJ Best Practice",
      jurisdiction: "Australia/WA",
    });
    const waSources = [2, 3, 4, 5].map((index) =>
      governedSource(index, {
        documentId: index % 2 === 0 ? "wa-doc-1" : "wa-doc-2",
        publisherCode: index % 2 === 0 ? "FSH" : "EMHS",
        publisher: index % 2 === 0 ? "Fiona Stanley Fremantle Hospitals Group" : "East Metropolitan Health Service",
        jurisdiction: "Australia/WA",
      }),
    );

    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "medication_dose_risk",
      crossDocument: false,
      results: [conflict, ...waSources],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-2", "chunk-3", "chunk-4", "chunk-5"]);
  });

  it.each(["document_lookup", "comparison", "broad_summary", "unsupported_or_general"] as const)(
    "prefers equally relevant Australian passages for %s answers without dropping supplementary evidence",
    (queryClass) => {
      const selected = selectModelContextResults({
        routeMode: "strong",
        queryClass,
        crossDocument: queryClass === "comparison",
        results: [
          withRelevance(bmjSupplementarySource(1), "direct"),
          withRelevance(waGovernedSource(2, "wa-doc-1"), "direct"),
          withRelevance(waGovernedSource(3, "wa-doc-2"), "direct"),
        ],
      });

      expect(selected.map((result) => result.id)).toEqual(["chunk-2", "chunk-3", "chunk-1"]);
    },
  );

  it("keeps a more relevant international passage ahead of weaker Australian evidence", () => {
    const selected = selectModelContextResults({
      routeMode: "strong",
      queryClass: "broad_summary",
      crossDocument: false,
      results: [
        withRelevance(waGovernedSource(1, "wa-doc-1"), "partial"),
        withRelevance(bmjSupplementarySource(2), "direct"),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-2", "chunk-1"]);
  });

  it("keeps a higher-ranked supplementary passage inside the routine fast budget", () => {
    const selected = selectModelContextResults({
      routeMode: "fast",
      queryClass: "document_lookup",
      crossDocument: false,
      results: [
        withRelevance(bmjSupplementarySource(1), "direct"),
        withRelevance(waGovernedSource(2, "wa-doc-1"), "direct"),
        withRelevance(waGovernedSource(3, "wa-doc-2"), "direct"),
        withRelevance(waGovernedSource(4, "wa-doc-1"), "direct"),
        withRelevance(waGovernedSource(5, "wa-doc-2"), "direct"),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-2", "chunk-3", "chunk-4", "chunk-1"]);
  });

  it("applies the document crowding cap before fixing the routine fast budget", () => {
    const selected = selectModelContextResults({
      routeMode: "fast",
      queryClass: "document_lookup",
      crossDocument: false,
      results: [
        source(1, { document_id: "crowded-doc" }),
        source(2, { document_id: "crowded-doc" }),
        source(3, { document_id: "crowded-doc" }),
        source(4, { document_id: "crowded-doc" }),
        source(5, { document_id: "other-doc" }),
      ],
    });

    expect(selected.map((result) => result.id)).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-5"]);
  });

  it("uses a stable context pack cache key for matching retry inputs", () => {
    const key = packedContextCacheKey(results, "broad_summary", { crossDocument: true });
    const sameInputs = packedContextCacheKey([...results], "broad_summary", { crossDocument: true });
    const differentInputs = packedContextCacheKey(results.slice(0, 6), "broad_summary", { crossDocument: true });

    expect(sameInputs).toBe(key);
    expect(differentInputs).not.toBe(key);
  });

  it("includes document-scope for stricter packed context reuse", () => {
    const keyA = packedContextCacheKey(results, "document_lookup", {
      crossDocument: false,
      documentIds: ["doc-1", "doc-2"],
    });
    const keyB = packedContextCacheKey(results, "document_lookup", {
      crossDocument: false,
      documentIds: ["doc-3"],
    });

    expect(keyA).not.toBe(keyB);
  });

  it("reuses packed context keys for the same document filter regardless of order", () => {
    const keyA = packedContextCacheKey(results, "document_lookup", {
      crossDocument: false,
      documentIds: ["doc-2", "doc-1", "doc-1"],
    });
    const keyB = packedContextCacheKey(results, "document_lookup", {
      crossDocument: false,
      documentIds: ["doc-1", "doc-2"],
    });

    expect(keyA).toBe(keyB);
  });
});
