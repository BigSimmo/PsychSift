import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeRagAnswerQuality } from "../src/lib/rag/rag-extractive-answer";
import { renderSourceBoundAlcoholSummary } from "../src/lib/rag/rag-source-bound-alcohol-summary";
import {
  buildActiveCommunityEdProcedureAnswer,
  buildCommunityHomeVisitRequirementsAnswer,
  buildBestPracticePrescriptionRequirementsAnswer,
} from "../src/lib/rag/rag-source-bound-policy-procedures";
import type { RagAnswer, SearchResult } from "../src/lib/types";

vi.mock("../src/lib/rag/rag-source-bound-alcohol-summary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/rag/rag-source-bound-alcohol-summary")>();
  return { ...actual, renderSourceBoundAlcoholSummary: vi.fn(() => null) };
});

function source(id: string, title: string, content: string): SearchResult {
  return {
    id,
    document_id: "procedure-document",
    title,
    file_name: `${title}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content,
    image_ids: [],
    images: [],
    similarity: 0.9,
  } as SearchResult;
}

describe("alcohol summary query admission", () => {
  beforeEach(() => vi.mocked(renderSourceBoundAlcoholSummary).mockClear());

  const text = "Healthy adults should drink less alcohol.";
  const evidence = source("adult", "Alcohol advice", text);
  const input = (): RagAnswer => ({
    answer: text,
    grounded: true,
    confidence: "low",
    preformatted: true,
    citations: [
      {
        chunk_id: evidence.id,
        document_id: evidence.document_id,
        title: evidence.title,
        file_name: evidence.file_name,
        page_number: 1,
        chunk_index: 0,
        provenance: "model_selected",
      },
    ],
    sources: [evidence],
    routingMode: "strong",
    responseMode: "clinical_pathway",
  });

  it.each([
    "What alcohol advice applies to healthy adults?",
    "What alcohol advice applies during pregnancy?",
    "What alcohol advice applies while breastfeeding?",
    "What alcohol advice applies to people under 18?",
    "What alcohol advice applies to healthy adults only, not people under 18, pregnancy or breastfeeding?",
    "Summarise the source document.",
  ])("keeps %s on ordinary finalization", (query) => {
    const result = finalizeRagAnswerQuality(input(), query, "unsupported_or_general", [evidence]);
    expect(renderSourceBoundAlcoholSummary).not.toHaveBeenCalled();
    expect(result.answer).toBe(text);
    expect(result.grounded).toBe(true);
  });

  it("still invokes recovery for the approved four-population question", () => {
    finalizeRagAnswerQuality(
      input(),
      "What does the NHMRC summary recommend about alcohol for healthy adults, people under 18, pregnancy and breastfeeding?",
      "unsupported_or_general",
      [evidence],
    );
    expect(renderSourceBoundAlcoholSummary).toHaveBeenCalledOnce();
    expect(renderSourceBoundAlcoholSummary).toHaveBeenCalledWith(expect.objectContaining({ answer: text }), [evidence]);
  });

  it.each([
    "Summarise the alcohol guideline for healthy adults only.",
    "Summarise the alcohol guideline during pregnancy.",
  ])("keeps narrow guideline scope on ordinary finalization despite broad classification: %s", (query) => {
    finalizeRagAnswerQuality(input(), query, "broad_summary", [evidence]);
    expect(renderSourceBoundAlcoholSummary).not.toHaveBeenCalled();
  });
});

const procedures = [
  {
    name: "active-community ED",
    title: "Active Community Patients Emergency Department",
    build: buildActiveCommunityEdProcedureAnswer,
    first:
      "The consumer will be triaged by the Triage Nurse at the AHS ED. The ED Mental Health Liaison Nurse (EDMHLN) will provide a mental health assessment as required. EDMHLN will identify via PSOLIS. EDMHLN will check PSOLIS for a Treatment Support Discharge Plan (TSD)/crisis plan. EDMHLN will contact the relevant community mental health team, EMHS CRHTT team and request collateral information.",
    second:
      "Consumers active with Armadale Mental Health Service (AMHS) are assessed by the most appropriate mental health clinician available. They are provided with information on how to access their relevant treating team during office hours and provided with information regarding out of hours emergency contacts.",
  },
  {
    name: "home visits",
    title: "Community Home Visit (AKG)",
    build: buildCommunityHomeVisitRequirementsAnswer,
    first:
      "All clinical staff are to complete a Community Home Visit Log prior to leaving the workplace. Designated OAC clerical staff will review the log.",
    second:
      "Leschen clerical reception staff will take responsibility for safety monitoring. The clinician will inform Leschen clerical reception staff on their return to the workplace and update the community home visit log.",
  },
  {
    name: "prescription program",
    title: "Best Practice Prescription Program (AKG)",
    build: buildBestPracticePrescriptionRequirementsAnswer,
    first:
      "Best Practice Prescription Program is an electronic program. Prescription generation. Maintenance of electronic medication profiles. Internal and external correspondence generation. Recording other relevant clinical information including allergies/adverse drug reactions.",
    second:
      "At the first clinic appointment, medical officers are to inquire about their current medications and verify this information with the General Practitioner. The medication name, formulation, route, dose and directions for use for each psychiatric and non-psychiatric medication must be entered.",
  },
];

describe.each(procedures)("$name source-context admission", ({ title, build, first, second }) => {
  const results = (prefix = "", position = 0) => [
    source("first", title, `${position === 0 ? prefix : ""}${first}`),
    source("second", title, `${position === 1 ? prefix : ""}${second}`),
  ];

  it("retains the affirmative source and ordinary clinical prohibitions", () => {
    const result = build({ query: title, results: results("Do not leave the patient alone. ") });
    expect(result).not.toBeNull();
    expect(result?.citationChunkIds).toEqual(["first", "second"]);
  });

  it.each([
    "Current procedure",
    "Historical symptoms and current clinical assessment",
    "Clinical procedure — do not leave the patient alone",
  ])("retains an ordinary governing section heading: %s", (heading) => {
    const inputs = results("Do not leave the patient alone. ").map((result) => ({
      ...result,
      section_heading: heading,
    }));
    const result = build({ query: title, results: inputs });
    expect(result).not.toBeNull();
    expect(result?.citationChunkIds).toEqual(["first", "second"]);
  });

  it.each([
    "Historical instructions",
    "Rejected procedure",
    "Superseded policy",
    "Quoted for comparison",
    "Quoted procedure for comparison",
    "Historical",
    "Rejected",
    "Superseded",
  ])("refuses an adverse governing section heading: %s", (heading) => {
    for (const position of [0, 1]) {
      const inputs = results().map((result, index) => ({
        ...result,
        section_heading: index === position ? heading : "Current procedure",
      }));
      expect(build({ query: title, results: inputs })).toBeNull();
    }
  });

  it.each([
    "REJECTED PROCEDURE — do not follow the following instructions: ",
    "The following procedure was rejected. ",
    "Historical instructions: ",
    "Quoted procedure for comparison: ",
    "Quoted: ",
    "Quoted for comparison: ",
  ])("refuses governing context: %s", (prefix) => {
    for (const position of [0, 1]) {
      expect(build({ query: title, results: results(prefix, position) })).toBeNull();
    }
  });
});
