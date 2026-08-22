import { describe, expect, it } from "vitest";
import {
  GenerationQualityError,
  generationQualityFailureDiagnostics,
  summarizeGenerationQualityAnswerShape,
} from "../src/lib/rag/rag-generation-quality-diagnostics";

describe("generation quality diagnostics (#231)", () => {
  it("keeps the error message byte-identical to the legacy plain Error", () => {
    const error = new GenerationQualityError("post_finalize", "numeric_faithfulness_gap", {
      answer_chars: 0,
      answer_words: 0,
      first_sentence_chars: 0,
      first_sentence_terminated: false,
      section_count: 0,
      citation_count: 0,
      distinct_cited_document_count: 0,
      quote_card_count: 0,
      conflict_or_gap_count: 0,
      unverified_numeric_token_count: 0,
      grounded: false,
      confidence: null,
    });
    // The flattening classifier and every routing-reason assertion depend on this exact text.
    expect(error.message).toBe("OpenAI generation quality gate failed: numeric_faithfulness_gap");
    // The message still matches the legacy `/quality gate/` classification branch.
    expect(/\bvalidation|quality gate|schema|parse|json\b/.test(error.message.toLowerCase())).toBe(true);
  });

  it("summarizes a rejected answer as provider-safe counts with no prose", () => {
    const shape = summarizeGenerationQualityAnswerShape({
      answer: "Start lithium carbonate at 250 mg once daily. Review levels after five days.",
      grounded: true,
      confidence: "high",
      answerSections: [{ body: "Monitoring detail." }],
      citations: [
        { chunk_id: "chunk-a", document_id: "doc-1" },
        { chunk_id: "chunk-b", document_id: "doc-1" },
        { chunk_id: "chunk-c", document_id: "doc-2" },
      ],
      quoteCards: [{}],
      conflictsOrGaps: [],
      unverifiedNumericTokens: ["500 mg"],
    });

    expect(shape).toEqual({
      answer_chars: 76,
      answer_words: 13,
      first_sentence_chars: 45,
      first_sentence_terminated: true,
      section_count: 1,
      citation_count: 3,
      distinct_cited_document_count: 2,
      quote_card_count: 1,
      conflict_or_gap_count: 0,
      unverified_numeric_token_count: 1,
      grounded: true,
      confidence: "high",
    });
    // Provider safety: the shape must never carry the answer text itself.
    expect(JSON.stringify(shape)).not.toContain("lithium");
  });

  it("handles an unterminated single-fragment answer", () => {
    const shape = summarizeGenerationQualityAnswerShape({
      answer: "  monitoring thresholds ",
      citations: [],
    });
    expect(shape.first_sentence_terminated).toBe(false);
    expect(shape.first_sentence_chars).toBe(shape.answer_chars);
    expect(shape.answer_words).toBe(2);
    expect(shape.grounded).toBe(false);
    expect(shape.confidence).toBeNull();
  });

  it("extracts diagnostics only from GenerationQualityError instances", () => {
    const shape = summarizeGenerationQualityAnswerShape({ answer: "", citations: [] });
    const error = new GenerationQualityError("strong_gate", "low_yield_answer", shape);
    expect(generationQualityFailureDiagnostics(error)).toEqual({
      stage: "strong_gate",
      gateReason: "low_yield_answer",
      answerShape: shape,
    });
    expect(generationQualityFailureDiagnostics(new Error("OpenAI generation quality gate failed: x"))).toBeNull();
    expect(generationQualityFailureDiagnostics("provider_timeout")).toBeNull();
    expect(generationQualityFailureDiagnostics(undefined)).toBeNull();
  });

  it("records eight-section incompleteness as bounded shape data without section prose", () => {
    const shape = summarizeGenerationQualityAnswerShape({
      answer: "A complete synthetic lead that remains safe to summarize.",
      answerSections: Array.from({ length: 8 }, (_, index) => ({
        heading: `Synthetic section ${index + 1}`,
        body: `Synthetic protected body ${index + 1}`,
      })),
      citations: [],
    });
    const error = new GenerationQualityError("strong_gate", "max_output_tokens", shape);

    expect(generationQualityFailureDiagnostics(error)).toMatchObject({
      stage: "strong_gate",
      gateReason: "max_output_tokens",
      answerShape: { section_count: 8 },
    });
    expect(JSON.stringify(generationQualityFailureDiagnostics(error))).not.toContain("Synthetic protected body");
  });
});
