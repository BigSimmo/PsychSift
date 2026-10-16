import { describe, expect, it } from "vitest";
import { buildVisualEvidence } from "../src/lib/evidence";
import {
  annotateSearchResults,
  buildEvidenceRelevance,
  buildSourceRelevance,
  queryCoreTerms,
} from "../src/lib/evidence-relevance";
import type { SearchResult } from "../src/lib/types";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Clinical source",
    file_name: "source.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "Clozapine monitoring requires FBC, ANC, myocarditis review, metabolic review, and constipation planning.",
    image_ids: [],
    similarity: 0.88,
    hybrid_score: 0.88,
    source_strength: "strong",
    images: [],
    ...overrides,
  };
}

describe("evidence relevance", () => {
  it("removes generic question words from query coverage", () => {
    const terms = queryCoreTerms("What toxicity safety-net symptoms should be reviewed for lithium?");

    expect(terms).toContain("lithium");
    expect(terms).toContain("toxicity");
    expect(terms).not.toContain("what");
    expect(terms).not.toContain("should");
    expect(terms).not.toContain("for");
    expect(terms).not.toContain("reviewed");
  });

  it("treats requirement verbs as question wording, not evidence terms", () => {
    expect(queryCoreTerms("What assessment documentation is required?")).toEqual(["assessment", "documentation"]);
    expect(queryCoreTerms("What monitoring does lithium require?")).not.toContain("require");
    expect(queryCoreTerms("What monitoring is needed for valproate?")).not.toContain("needed");
    expect(queryCoreTerms("What does the infant need?")).not.toContain("need");
    expect(queryCoreTerms("What documentation requirements apply?")).toContain("requirement");
  });

  it("gives the on-topic guideline the same match level as a passage that merely says required", () => {
    const query = "What assessment documentation is required?";
    const [onTopic, offTopic] = annotateSearchResults(query, [
      result({
        id: "assessment-documentation",
        title: "Assessment Documentation",
        content:
          "Any outstanding assessments must be documented, and assessment documentation is completed on admission.",
      }),
      result({
        id: "admissions",
        title: "Admissions Policy",
        content: "Patients accepted for admission must have accompanying assessment documentation where required.",
      }),
    ]);

    expect(onTopic?.relevance?.verdict).toBe("direct");
    expect(offTopic?.relevance?.verdict).toBe("direct");
  });

  it("classifies weak lithium-style neighboring sources as nearby, not direct", () => {
    const relevance = buildEvidenceRelevance("What toxicity safety-net symptoms should be reviewed for lithium?", [
      result({
        id: "clozapine-neighbor",
        title: "Clozapine monitoring",
        content: "Monitor for toxicity symptoms, red flags, and urgent review during clozapine treatment.",
        similarity: 0.37,
        hybrid_score: 0.37,
        text_rank: 0,
        source_strength: "limited",
      }),
      result({
        id: "limited-lithium-neighbor",
        title: "Clozapine medication interactions",
        content: "The document briefly mentions lithium and general symptom review in a broader clozapine section.",
        similarity: 0.33,
        hybrid_score: 0.33,
        text_rank: 0,
        source_strength: "limited",
      }),
    ]);

    expect(relevance.verdict).toBe("nearby");
    expect(relevance.isSourceBacked).toBe(false);
    expect(relevance.missingTerms).toContain("safety");
    expect(relevance.missingTerms).toContain("net");
  });

  it("classifies strong direct concept coverage as direct", () => {
    const relevance = buildEvidenceRelevance("clozapine monitoring", [result()]);

    expect(relevance.verdict).toBe("direct");
    expect(relevance.isSourceBacked).toBe(true);
    expect(relevance.directSourceCount).toBe(1);
  });

  it("exposes missing terms for partial support", () => {
    const relevance = buildEvidenceRelevance("lithium toxicity vomiting dehydration advice", [
      result({
        title: "Lithium toxicity",
        content: "Lithium toxicity symptoms include vomiting and dehydration.",
        similarity: 0.86,
        hybrid_score: 0.86,
      }),
    ]);

    expect(relevance.verdict).toBe("partial");
    expect(relevance.isSourceBacked).toBe(true);
    expect(relevance.missingTerms).toContain("advice");
  });

  it("adds concise query coverage chips to source results", () => {
    const [source] = annotateSearchResults("lithium toxicity advice", [
      result({
        title: "Lithium toxicity",
        content: "Lithium toxicity symptoms are described.",
      }),
    ]);

    expect(source.relevance?.chips.join(" ")).toContain("matched:");
    expect(source.relevance?.chips.join(" ")).toContain("missing:");
  });

  it("prioritizes direct or partial visual evidence above nearby-only images", () => {
    const direct = result({
      id: "direct",
      document_id: "doc-direct",
      title: "Clozapine monitoring",
      content: "Clozapine monitoring table.",
      relevance: buildSourceRelevance("clozapine monitoring", result({ title: "Clozapine monitoring" })),
      images: [
        {
          id: "img-direct",
          page_number: 1,
          storage_path: "private/direct.png",
          caption: "Direct clozapine monitoring table.",
          searchable: true,
          image_type: "clinical_table",
          source_kind: "table_crop",
          tableRole: "clinical",
          clinicalUseClass: "clinical_evidence",
          clinical_relevance_score: 0.1,
        },
      ],
    });
    const nearby = result({
      id: "nearby",
      document_id: "doc-nearby",
      title: "Generic safety",
      content: "Safety monitoring table.",
      relevance: buildSourceRelevance(
        "clozapine monitoring",
        result({ title: "Generic safety", content: "Safety monitoring table." }),
      ),
      images: [
        {
          id: "img-nearby",
          page_number: 1,
          storage_path: "private/nearby.png",
          caption: "Nearby safety monitoring table.",
          searchable: true,
          image_type: "clinical_table",
          source_kind: "table_crop",
          tableRole: "clinical",
          clinicalUseClass: "clinical_evidence",
          clinical_relevance_score: 1,
        },
      ],
    });

    const cards = buildVisualEvidence([nearby, direct], 2);

    expect(cards[0].image_id).toBe("img-direct");
    expect(cards[1].relevance?.isSourceBacked).toBe(false);
  });
});
