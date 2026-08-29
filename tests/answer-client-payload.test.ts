import { describe, expect, it } from "vitest";

import { toClientAnswerPayload } from "@/lib/answer-client-payload";
import { buildGovernedAnswerClientResponse, buildGovernedDemoAnswerClientResponse } from "@/lib/answer-response";
import { extractSafetyFindings } from "@/lib/clinical-safety";
import type { RagAnswer, SearchResult } from "@/lib/types";

function fullSource(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Clozapine monitoring guideline",
    file_name: "clozapine.pdf",
    page_number: 4,
    chunk_index: 7,
    section_heading: "Monitoring",
    content: "Full blood count weekly for 18 weeks. ".repeat(60),
    retrieval_synopsis: "FBC weekly for 18 weeks, then monthly.",
    image_ids: [],
    similarity: 0.82,
    corpus_scope: "clinical_kb_site",
    site_content_domain: "medications",
    source_metadata: { document_status: "current" } as SearchResult["source_metadata"],
    adjacent_context: "Preceding paragraph context. ".repeat(20),
    document_summary: "A long document summary. ".repeat(30),
    memory_cards: [{ id: "m1" } as never],
    table_facts: [{ id: "t1" } as never],
    index_unit: { unit_type: "table" } as never,
    ...overrides,
  } as SearchResult;
}

function answerWith(sources: SearchResult[]): Pick<RagAnswer, "sources"> {
  return { sources };
}

describe("toClientAnswerPayload", () => {
  it("governs empty-source real and demo answers without requiring source fields", () => {
    const answer = {
      answer: "No source details.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    } as RagAnswer;

    expect(buildGovernedAnswerClientResponse(answer).payload).toMatchObject({ sources: [], safetyWarnings: [] });
    expect(buildGovernedDemoAnswerClientResponse(answer)).toMatchObject({
      sources: [],
      safetyWarnings: [],
      demoMode: true,
    });
  });

  it("drops server-only per-source fields the client never renders", () => {
    const trimmed = toClientAnswerPayload(answerWith([fullSource()])).sources![0];
    expect(trimmed.adjacent_context).toBeUndefined();
    expect(trimmed.memory_cards).toBeUndefined();
    expect(trimmed.table_facts).toBeUndefined();
    expect(trimmed.index_unit).toBeUndefined();
    expect(trimmed.document_summary).toBeUndefined();
    expect(trimmed.corpus_scope).toBeUndefined();
    expect(trimmed.site_content_domain).toBeUndefined();
    expect(trimmed.images).toEqual([]);
  });

  it("does not serialize bulky source image objects", () => {
    const image = {
      id: "image-1",
      storage_path: "private/source/page-4.png",
      metadata: { raw: "x".repeat(8_000) },
      table_markdown: `| heading |\n| --- |\n| ${"cell ".repeat(1_000)} |`,
    } as never;
    const source = fullSource({ image_ids: ["image-1"], images: [image] });
    const trimmed = toClientAnswerPayload(answerWith([source])).sources![0];

    expect(trimmed.image_ids).toEqual(["image-1"]);
    expect(trimmed.images).toEqual([]);
    expect(JSON.stringify(trimmed)).not.toContain("private/source/page-4.png");
  });

  it("does not pass unclassified runtime fields through the route boundary", () => {
    const source = { ...fullSource(), future_server_secret: "private" } as SearchResult;
    const trimmed = toClientAnswerPayload(answerWith([source])).sources![0] as SearchResult & {
      future_server_secret?: string;
    };
    expect(trimmed.future_server_secret).toBeUndefined();
  });

  it("keeps identity, snippet, scoring, and governance fields intact", () => {
    const trimmed = toClientAnswerPayload(answerWith([fullSource()])).sources![0];
    expect(trimmed.id).toBe("chunk-1");
    expect(trimmed.title).toBe("Clozapine monitoring guideline");
    expect(trimmed.retrieval_synopsis).toBe("FBC weekly for 18 weeks, then monthly.");
    expect(trimmed.content).toBe("FBC weekly for 18 weeks, then monthly.");
    expect(trimmed.similarity).toBe(0.82);
    expect(trimmed.source_metadata).toEqual({ document_status: "current" });
    expect(trimmed.page_number).toBe(4);
  });

  it("derives safety warnings before replacing full source content with the rendered snippet", () => {
    const source = fullSource({ content: `${"Routine context. ".repeat(60)}Contraindicated in severe disease.` });
    const response = buildGovernedAnswerClientResponse({
      answer: "Review the source.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [source],
    } as RagAnswer);
    const payload = response.payload;

    expect(payload.sources![0].content).toBe(source.retrieval_synopsis);
    expect(payload.sources![0].content.length).toBeLessThan(source.content.length);
    expect(payload.safetyWarnings).toHaveLength(1);
    // Issue 9: governance provenance is retained on safety-finding citations so the
    // safety panel can badge outdated / review-due / unverified sources, consistent
    // with regular source citations (which already keep source_metadata).
    expect(payload.safetyWarnings![0].citation).toHaveProperty("source_metadata", { document_status: "current" });
    expect(extractSafetyFindings(payload)).toHaveLength(1);
  });

  it("leaves short content untouched", () => {
    const short = fullSource({ content: "Short snippet.", retrieval_synopsis: undefined });
    expect(toClientAnswerPayload(answerWith([short])).sources![0].content).toBe("Short snippet.");
  });

  it("does not mutate the original answer (caches keep the full sources)", () => {
    const source = fullSource();
    const answer = answerWith([source]);
    toClientAnswerPayload(answer);
    expect(answer.sources![0].adjacent_context).toBeTruthy();
    expect(answer.sources![0].content.length).toBeGreaterThan(700);
  });

  it("passes through answers without sources", () => {
    const empty = answerWith([]);
    expect(toClientAnswerPayload(empty)).toBe(empty);
  });

  it("materially shrinks a representative payload", () => {
    const answer = answerWith(Array.from({ length: 8 }, (_, index) => fullSource({ id: `chunk-${index}` })));
    const fullBytes = JSON.stringify(answer).length;
    const trimmedBytes = JSON.stringify(toClientAnswerPayload(answer)).length;
    expect(trimmedBytes).toBeLessThan(fullBytes * 0.8);
  });
});
