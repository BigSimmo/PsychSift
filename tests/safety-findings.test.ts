import { describe, expect, it } from "vitest";

import { extractSafetyFindings } from "@/lib/rag/safety-findings";

describe("extractSafetyFindings performance and robustness (#747FC0)", () => {
  it("processes large 200,000-character blocks without regex backtracking stalls", () => {
    const hostileInputs = [
      `transfer of ${"a".repeat(200_000)}`,
      "transfer of a b c d ".repeat(10_000),
      `transfer${" ".repeat(200_000)}x`,
      "transferred of the the the into ".repeat(6_000),
    ];

    for (const content of hostileInputs) {
      const started = performance.now();
      const findings = extractSafetyFindings({
        answer: "Clinical safety assessment.",
        confidence: "high",
        citations: [],
        sources: [
          {
            id: "hostile-1",
            document_id: "doc-hostile",
            content,
            title: "Hostile Document",
            file_name: "test.pdf",
            page_number: 1,
            chunk_index: 0,
            similarity: 0.95,
            source_strength: "strong",
            section_heading: null,
            image_ids: [],
          },
        ],
        grounded: true,
      });

      const elapsed = performance.now() - started;
      // Must finish in linear time, well under 2000 ms (previously stalled ~89 seconds)
      expect(elapsed).toBeLessThan(2000);
      expect(Array.isArray(findings)).toBe(true);
    }
  });

  it("extracts findings from standard-sized content properly", () => {
    const findings = extractSafetyFindings({
      answer: "Clinical safety assessment.",
      confidence: "high",
      citations: [],
      sources: [
        {
          id: "chunk-contra-1",
          document_id: "doc-clozapine",
          content: "Contraindication: Known hypersensitivity to clozapine or any component of the formulation.",
          title: "Clozapine Monograph",
          file_name: "clozapine.pdf",
          page_number: 2,
          chunk_index: 1,
          similarity: 0.9,
          source_strength: "strong",
          section_heading: null,
          image_ids: [],
        },
      ],
      grounded: true,
    });

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.kind).toBe("contraindication");
  });
});
