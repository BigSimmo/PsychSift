import { describe, expect, it } from "vitest";

import {
  finalizeRagAnswerQuality,
  generatedAnswerQualityFailureReason,
  isBareCrossReferenceAnswer,
  sourceBackedGenerationTimeoutAnswer,
} from "../src/lib/rag/rag-extractive-answer";
import type { Citation, RagAnswer, RagQueryClass, RetrievalSelectionSummary } from "../src/lib/types";

// The exact off-topic extract observed live for "What should discharge documentation include?" —
// a bare cross-reference that trips missing_query_overlap and was being wrongly rescued to grounded
// on the strength of the cited sources' structured-chunk signals.
const RKPG_CROSS_REFERENCE =
  "Refer to the RKPG Guidelines to Writing for Clinical Policy for further information about Scope of Practice.";
// The legitimate terse paraphrase the recovery gate exists for (regression guard from
// rag-answer-fallback.test.ts): shares no literal query token yet genuinely answers the query.
const LAI_PARAPHRASE = "Depot antipsychotic follow-up is covered by the cited local pathway.";

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    chunk_id: "discharge-1",
    document_id: "discharge-doc",
    title: "Admission to Discharge for Mental Health Inpatients",
    file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
    page_number: 3,
    chunk_index: 0,
    ...overrides,
  };
}

// A source selection strong enough that, absent the cross-reference guard, the recovery gate would
// preserve the answer: required signals satisfied, a specific source signal, and structured chunks.
function strongSourceSelection(): RagAnswer["smartApiPlan"] {
  const sourceSelection = {
    candidateCount: 6,
    selectedCount: 4,
    requiredSignalsSatisfied: true,
    matchedSignals: ["document_title", "patient_education", "table"],
    missingRequiredSignals: [],
    rescueApplied: false,
    topChunkTypes: { text: 2, table: 1, flowchart: 0, medication_chart: 0, patient_education: 4 },
  } satisfies RetrievalSelectionSummary;
  // Only answerPlan.sourceSelection drives the recovery gate; the rest of the plan is irrelevant
  // here, so cast past the unrelated required fields rather than fabricating them.
  return { answerPlan: { sourceSelection } } as unknown as RagAnswer["smartApiPlan"];
}

function groundedExtractiveAnswer(text: string, overrides: Partial<RagAnswer> = {}): RagAnswer {
  return {
    answer: text,
    grounded: true,
    confidence: "low",
    citations: [citation()],
    sources: [],
    routingMode: "extractive",
    routingReason: "high_confidence_extractive_retrieval",
    smartApiPlan: strongSourceSelection(),
    ...overrides,
  };
}

describe("isBareCrossReferenceAnswer", () => {
  it("flags a bare 'refer to <document> for further information' redirect", () => {
    expect(isBareCrossReferenceAnswer(RKPG_CROSS_REFERENCE)).toBe(true);
  });

  it("flags redirect-first and 'please see … for more detail' phrasings", () => {
    expect(
      isBareCrossReferenceAnswer(
        "For further information about discharge planning, see the National Mental Health policy.",
      ),
    ).toBe(true);
    expect(isBareCrossReferenceAnswer("Please see the local operational policy for more detail.")).toBe(true);
  });

  it("sees through markdown bolding on the pointer", () => {
    expect(isBareCrossReferenceAnswer(`**${RKPG_CROSS_REFERENCE}**`)).toBe(true);
  });

  it("does NOT flag a terse paraphrase that merely lacks literal query tokens", () => {
    expect(isBareCrossReferenceAnswer(LAI_PARAPHRASE)).toBe(false);
  });

  it("does NOT flag the source-pointer generation-timeout fallback", () => {
    expect(isBareCrossReferenceAnswer(sourceBackedGenerationTimeoutAnswer())).toBe(false);
  });

  it("does NOT flag a real answer whose lead carries content and only a trailing sentence points onward", () => {
    expect(
      isBareCrossReferenceAnswer(
        "Discharge documentation should include a mental state examination, risk assessment and follow-up plan. Refer to the NMHS policy for more detail.",
      ),
    ).toBe(false);
  });

  it("does NOT flag an ordinary clinical directive", () => {
    expect(isBareCrossReferenceAnswer("Withhold clozapine and repeat the full blood count within 24 hours.")).toBe(
      false,
    );
  });

  it("does NOT flag passive clinical referral facts that point at a service, not a document", () => {
    // A directive + redirect that targets a team/person is a valid cited answer, not a document
    // cross-reference — so it must survive the guard (Codex review PR #538).
    expect(
      isBareCrossReferenceAnswer("Patients are referred to the community team for further information and support."),
    ).toBe(false);
    expect(isBareCrossReferenceAnswer("The patient should see their GP for further information.")).toBe(false);
  });
});

describe("source-backed recovery gate — cross-reference guard", () => {
  const DISCHARGE_QUERY = "What should discharge documentation include?";
  const LAI_QUERY = "What is the long acting injectable pathway?";
  const queryClass = "broad_summary" satisfies RagQueryClass;

  it("classifies the RKPG cross-reference as missing_query_overlap (the reachable-by-recovery reason)", () => {
    expect(
      generatedAnswerQualityFailureReason(groundedExtractiveAnswer(RKPG_CROSS_REFERENCE), DISCHARGE_QUERY, queryClass),
    ).toBe("missing_query_overlap");
  });

  it("does NOT rescue the off-topic cross-reference despite strong structured-chunk signals", () => {
    const answer = finalizeRagAnswerQuality(
      groundedExtractiveAnswer(RKPG_CROSS_REFERENCE),
      DISCHARGE_QUERY,
      queryClass,
    );

    expect(answer.grounded).toBe(false);
    expect(answer.routingReason).toContain("final_quality_gate:missing_query_overlap");
    expect(answer.routingReason).not.toContain("source_backed_recovery");
    expect(answer.answer).not.toMatch(/RKPG|Refer to the/i);
  });

  it("still rescues a legitimate source-backed paraphrase with the same strong signals (regression guard)", () => {
    const sourceCitation = citation({
      chunk_id: "lai-pathway-1",
      document_id: "lai-pathway",
      title: "Long acting injectable pathway",
      file_name: "lai-pathway.pdf",
    });
    const answer = finalizeRagAnswerQuality(
      groundedExtractiveAnswer(LAI_PARAPHRASE, {
        citations: [sourceCitation],
        sources: [
          {
            id: sourceCitation.chunk_id,
            document_id: sourceCitation.document_id,
            title: sourceCitation.title,
            file_name: sourceCitation.file_name,
            page_number: sourceCitation.page_number,
            chunk_index: sourceCitation.chunk_index,
            section_heading: "Follow-up",
            content: LAI_PARAPHRASE,
            image_ids: [],
            similarity: 0.9,
            images: [],
            match_explanation: { reasons: ["retrieval_signal:document_title"] },
          },
        ],
      }),
      LAI_QUERY,
      queryClass,
    );

    expect(answer.grounded).toBe(true);
    expect(answer.confidence).toBe("low");
    expect(answer.routingReason).toContain("final_quality_gate_source_backed_recovery:missing_query_overlap");
    expect(answer.answer.replace(/\*\*/g, "")).toMatch(/Depot antipsychotic follow-up/i);
  });

  it("rejects an unrelated cited chunk when only an uncited document has the title or structure signal", () => {
    const cited = citation();
    const base = {
      id: cited.chunk_id,
      document_id: cited.document_id,
      title: cited.title,
      file_name: cited.file_name,
      page_number: 1,
      chunk_index: 0,
      section_heading: null,
      content: LAI_PARAPHRASE,
      image_ids: [],
      images: [],
      similarity: 0.9,
    };
    const answer = finalizeRagAnswerQuality(
      groundedExtractiveAnswer(LAI_PARAPHRASE, {
        sources: [
          base,
          {
            ...base,
            id: "uncited",
            document_id: "uncited-doc",
            match_explanation: { reasons: ["retrieval_signal:document_title", "retrieval_signal:table"] },
          },
        ],
      }),
      LAI_QUERY,
      queryClass,
    );
    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe("unsupported");
    expect(answer.routingReason).not.toContain("source_backed_recovery");
  });

  it("does not borrow a required clinical signal from an uncited selection", () => {
    const cited = citation();
    const plan = strongSourceSelection()!;
    const input = groundedExtractiveAnswer(LAI_PARAPHRASE, {
      smartApiPlan: {
        ...plan,
        answerPlan: { ...plan.answerPlan, retrievalIntent: { requiredTermSignals: ["clinical_subject"] } },
      } as RagAnswer["smartApiPlan"],
      sources: [
        {
          id: cited.chunk_id,
          document_id: cited.document_id,
          title: cited.title,
          file_name: cited.file_name,
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          content: LAI_PARAPHRASE,
          image_ids: [],
          images: [],
          similarity: 0.9,
          match_explanation: { reasons: ["retrieval_signal:dose_amount"] },
        },
      ],
    });
    const answer = finalizeRagAnswerQuality(input, LAI_QUERY, queryClass);
    expect(answer.grounded).toBe(false);
    expect(answer.routingReason).not.toContain("source_backed_recovery");
  });

  it("does not treat source-selection signals as support when the cited source is absent", () => {
    const answer = finalizeRagAnswerQuality(groundedExtractiveAnswer(LAI_PARAPHRASE), LAI_QUERY, queryClass);
    expect(answer.grounded).toBe(false);
    expect(answer.citations).toEqual([]);
    expect(answer.routingReason).toContain("final_quality_gate:missing_query_overlap");
  });
});
