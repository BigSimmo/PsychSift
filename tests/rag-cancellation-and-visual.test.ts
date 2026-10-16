import { describe, expect, it } from "vitest";
import { isClinicalImageEvidence } from "../src/lib/image-filtering";
import { attachPageVisualEvidence } from "../src/lib/rag/rag-hydration";
import { searchTextChunkCandidates } from "../src/lib/rag/rag-candidate-sources";
import { packAdjacentSourceContext } from "../src/lib/rag/rag-context-pack";
import { retainCitedExtractiveFallbackEvidence } from "../src/lib/rag/rag-extractive-answer";
import {
  withAdmissionDischargeContextPair,
  withAdmissionDischargeSideEvidence,
} from "../src/lib/rag/rag-admission-discharge-side-evidence";
import { buildSelectedEvidenceArtifacts } from "../src/lib/retrieval-selection";
import type { RagAnswer, SearchResult } from "../src/lib/types";

function makeSearchResult(overrides: Partial<SearchResult> & { id: string; document_id: string }): SearchResult {
  const { id, document_id, ...rest } = overrides;
  return {
    id,
    document_id,
    title: rest.title ?? "Clinical Guideline",
    file_name: rest.file_name ?? "clinical-guideline.pdf",
    page_number: rest.page_number ?? 1,
    chunk_index: rest.chunk_index ?? 0,
    section_heading: rest.section_heading ?? "Overview",
    content: rest.content ?? "Clinical guidance text.",
    similarity: rest.similarity ?? 0.85,
    hybrid_score: rest.hybrid_score ?? 0.85,
    image_ids: rest.image_ids ?? [],
    images: rest.images ?? [],
    ...rest,
  };
}

describe("RAG cancellation propagation, visual evidence hydration, and comparison coverage (R04, R07, R08)", () => {
  it("R04: searchTextChunkCandidates propagates AbortSignal to correct_clinical_query_terms RPC", async () => {
    const controller = new AbortController();
    let correctionAborted = false;

    const supabase = {
      rpc(name: string) {
        if (name === "match_document_chunks_text_v2" || name === "match_document_chunks_text") {
          return {
            abortSignal() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        if (name === "correct_clinical_query_terms") {
          return {
            abortSignal(signal: AbortSignal) {
              return new Promise<{ data: string | null; error: null }>((_, reject) => {
                if (signal.aborted) {
                  correctionAborted = true;
                  reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
                  return;
                }
                signal.addEventListener(
                  "abort",
                  () => {
                    correctionAborted = true;
                    reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
                  },
                  { once: true },
                );
                controller.abort(new DOMException("Timed out", "AbortError"));
              });
            },
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    };

    await expect(
      searchTextChunkCandidates({
        supabase: supabase as never,
        queryVariants: ["clozapin missed dose"],
        ownerId: "00000000-0000-0000-0000-000000000001",
        matchCount: 8,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Timed out|Aborted/);
    expect(correctionAborted).toBe(true);
  });

  it("R04: packAdjacentSourceContext propagates AbortSignal to document_chunks query and rethrows on abort", async () => {
    const controller = new AbortController();
    let abortSignalAttached = false;

    const supabase = {
      from(table: string) {
        expect(table).toBe("document_chunks");
        const builder = {
          select() {
            return builder;
          },
          in() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          abortSignal(signal: AbortSignal) {
            abortSignalAttached = true;
            controller.abort(new DOMException("Route deadline exceeded", "AbortError"));
            return Promise.reject(signal.reason);
          },
        };
        return builder;
      },
    };

    const results = [makeSearchResult({ id: "chunk-1", document_id: "doc-1", chunk_index: 2 })];
    await expect(
      packAdjacentSourceContext(supabase as never, results, "broad_summary", {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Route deadline exceeded|Aborted/);
    expect(abortSignalAttached).toBe(true);
  });

  it("R07: attachPageVisualEvidence hydrates direct chunk image_ids and ambiguous clinical tables survive filtering", async () => {
    const chunk = makeSearchResult({
      id: "clozapine-chunk-1",
      document_id: "doc-clozapine",
      title: "Clozapine Prescribing Administration Monitoring",
      page_number: 3,
      image_ids: ["img-clozapine-missed-dose"],
      source_metadata: { index_generation_id: "gen-1" } as never,
    });

    const supabase = {
      from(table: string) {
        expect(table).toBe("document_images");
        let isDirectIdQuery = false;
        const builder = {
          select() {
            return builder;
          },
          in(column: string) {
            if (column === "id") isDirectIdQuery = true;
            return builder;
          },
          eq() {
            return builder;
          },
          neq() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          abortSignal() {
            return builder;
          },
          // biome-ignore lint/suspicious/noThenProperty: Supabase PostgREST builder mock
          then(resolve: (value: unknown) => void) {
            if (isDirectIdQuery) {
              resolve({
                data: [
                  {
                    id: "img-clozapine-missed-dose",
                    document_id: "doc-clozapine",
                    page_number: 4,
                    storage_path: "docs/doc-clozapine/page-4-table.png",
                    caption: "Clozapine missed dose > 48 hours re-titration table",
                    bbox: { x: 0, y: 0, width: 100, height: 100 },
                    image_type: "clinical_table",
                    searchable: true,
                    clinical_relevance_score: 0.72,
                    source_kind: "embedded",
                    width: 800,
                    height: 600,
                    labels: ["clozapine"],
                    metadata: {
                      index_generation_id: "gen-1",
                      clinical_use_class: "ambiguous",
                      table_title: "Missed dose management",
                      table_text_snippet: "If clozapine missed > 48 hours, re-titrate from 12.5 mg.",
                    },
                  },
                ],
                error: null,
              });
            } else {
              resolve({ data: [], error: null });
            }
          },
        };
        return builder;
      },
    };

    const hydrated = await attachPageVisualEvidence(supabase as never, [chunk]);
    expect(hydrated[0]?.images?.length).toBe(1);
    expect(hydrated[0]?.images?.[0]?.id).toBe("img-clozapine-missed-dose");
    expect(isClinicalImageEvidence(hydrated[0]!.images![0]!)).toBe(true);

    const proseOnlyChunk = makeSearchResult({
      id: "clozapine-chunk-2",
      document_id: "doc-clozapine",
      title: "Clozapine Prescribing Administration Monitoring",
      page_number: 2,
      images: [],
    });
    const artifacts = buildSelectedEvidenceArtifacts(
      "Clozapine missed dose > 48 hours management",
      [proseOnlyChunk],
      hydrated,
    );
    expect(artifacts.visualEvidence.length).toBe(1);
    expect(artifacts.visualEvidence[0]?.image_id).toBe("img-clozapine-missed-dose");

    const answer: RagAnswer = {
      answer: "If clozapine is missed for more than 48 hours, re-titrate from 12.5 mg.",
      grounded: true,
      confidence: "high",
      citations: [
        {
          chunk_id: "clozapine-chunk-2",
          document_id: "doc-clozapine",
          title: "Clozapine Prescribing Administration Monitoring",
          file_name: "clozapine.pdf",
          page_number: 2,
          chunk_index: 0,
          similarity: 0.9,
        },
      ],
      sources: [proseOnlyChunk, hydrated[0]!],
      visualEvidence: artifacts.visualEvidence,
    };
    const retained = retainCitedExtractiveFallbackEvidence(answer);
    expect(retained.sources.length).toBe(1);
    expect(retained.visualEvidence?.length).toBe(1);
    expect(retained.visualEvidence?.[0]?.image_id).toBe("img-clozapine-missed-dose");
  });

  it("R08: withAdmissionDischargeSideEvidence and withAdmissionDischargeContextPair prioritize community admission and discharge documents", () => {
    const genericAdmission = makeSearchResult({
      id: "chunk-inpatient-adm",
      document_id: "doc-inpatient-adm",
      title: "Inpatient Admission Checklist",
      file_name: "inpatient-admission.pdf",
      content: "Medical clearance is required prior to admission.",
      hybrid_score: 0.91,
    });
    const communityAdmission = makeSearchResult({
      id: "chunk-community-adm",
      document_id: "doc-community-adm",
      title: "Admission of Community Patients",
      file_name: "MHSP.AdmissionCommunityPts.pdf",
      content: "A patient will only be able to come in if they meet the identified inclusion criteria for admission.",
      hybrid_score: 0.86,
    });
    const dischargeDoc = makeSearchResult({
      id: "chunk-discharge",
      document_id: "doc-discharge",
      title: "Discharge Documentation and Planning",
      file_name: "MHSP.Discharge.pdf",
      content: "Discharge planning must include ongoing care arrangements.",
      hybrid_score: 0.88,
    });

    const toppedUp = withAdmissionDischargeSideEvidence({
      query: "Compare admission requirements vs discharge planning documentation",
      queryClass: "comparison",
      selected: [genericAdmission],
      candidates: [genericAdmission, communityAdmission, dischargeDoc],
    });
    const docIds = toppedUp.map((r) => r.document_id);
    expect(docIds).toContain("doc-community-adm");
    expect(docIds).toContain("doc-discharge");

    const pair = withAdmissionDischargeContextPair({
      query: "Compare admission requirements vs discharge planning documentation",
      queryClass: "comparison",
      pair: {
        served: { results: [genericAdmission], coverage: null, coverageSelections: [] },
        strongRetry: { results: [genericAdmission], coverage: null, coverageSelections: [] },
      },
      candidates: [genericAdmission, communityAdmission, dischargeDoc],
    });
    expect(pair.served.results.some((r) => r.document_id === "doc-community-adm")).toBe(true);
    expect(pair.served.results.some((r) => r.document_id === "doc-discharge")).toBe(true);
  });
});
