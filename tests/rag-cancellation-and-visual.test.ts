import { describe, expect, it } from "vitest";
import { searchTextChunkCandidates } from "../src/lib/rag/rag-candidate-sources";
import { packAdjacentSourceContext } from "../src/lib/rag/rag-context-pack";
import type { SearchResult } from "../src/lib/types";

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

describe("RAG cancellation propagation (R04)", () => {
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
});
