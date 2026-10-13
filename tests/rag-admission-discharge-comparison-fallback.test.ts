import { describe, expect, it } from "vitest";

import {
  buildAdmissionDischargeComparisonAnswer,
  withAdmissionDischargeSideEvidence,
} from "../src/lib/rag/rag-extractive-answer";
import type { SearchResult } from "../src/lib/types";

// Regression guard for the #019 fix (shipped 2026-07-27): the admission/discharge
// comparison fallback is deliberately conservative. It emits a two-sided answer ONLY
// when each side yields a source-bound requirement fact from a distinct document
// (sourceBoundComparisonFacts + admission/dischargeRequirementBindingPatterns in
// src/lib/rag/rag-extractive-answer.ts); otherwise it returns null so the caller
// terminates at an evidence gap rather than fabricating a one-sided comparison.
//
// These tests pin that contract so a future change cannot silently:
//   - drop a source-bound side (both-bound must cite BOTH documents), or
//   - loosen the binders / emit a one-sided or same-document "comparison"
//     (single-sided and same-document inputs must stay null).
// Loosening the binders is the refuted approach here — it re-opens #019 by admitting
// non-requirement prose. This is a guard only; no behaviour is changed.

const ADMISSION_FILE = "Admission of Community Patients (AKG).pdf";
const DISCHARGE_FILE = "Discharge Planning for Community Patients (NMHS).pdf";

// Sentences that match admission/dischargeRequirementBindingPatterns respectively.
const ADMISSION_BOUND = "Medical clearance must be obtained before the admission of any community patient.";
const DISCHARGE_BOUND = "Clinicians must actively plan the effective and timely discharge of every community patient.";
// Real admission-requirement prose that does NOT match any admission binder.
const ADMISSION_UNBOUND =
  "On admission, the treating team must complete a mental state examination and confirm an available bed before the consumer is formally accepted to the unit.";

const QUERY = "Compare admission and discharge requirements";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "doc-1",
    title: overrides.title ?? "Guideline",
    file_name: overrides.file_name ?? "guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: overrides.section_heading ?? null,
    content: overrides.content ?? "General clinical source text.",
    image_ids: [],
    similarity: overrides.similarity ?? 0.6,
    hybrid_score: overrides.hybrid_score ?? 0.6,
    images: [],
    ...overrides,
  };
}

const admissionBound = result({
  id: "admission-chunk",
  document_id: "admission-community-doc",
  title: "Admission of Community Patients",
  file_name: ADMISSION_FILE,
  content: ADMISSION_BOUND,
});
const dischargeBound = result({
  id: "discharge-chunk",
  document_id: "discharge-community-doc",
  title: "Discharge Planning for Community Patients",
  file_name: DISCHARGE_FILE,
  content: DISCHARGE_BOUND,
});

describe("#019 admission/discharge comparison fallback — conservative contract", () => {
  it("cites BOTH sources when each side has a source-bound requirement fact from a distinct document", () => {
    const answer = buildAdmissionDischargeComparisonAnswer({ query: QUERY, results: [admissionBound, dischargeBound] });

    expect(answer).not.toBeNull();
    expect(answer?.citationChunkIds).toEqual(expect.arrayContaining(["admission-chunk", "discharge-chunk"]));
  });

  it("returns null (evidence gap) when only one side yields a source-bound requirement fact", () => {
    const admissionUnbound = result({
      id: "admission-chunk",
      document_id: "admission-community-doc",
      title: "Admission of Community Patients",
      file_name: ADMISSION_FILE,
      content: ADMISSION_UNBOUND, // real admission prose, but outside the requirement binders
    });

    // Intended conservative behaviour: no one-sided comparison is fabricated.
    expect(
      buildAdmissionDischargeComparisonAnswer({ query: QUERY, results: [admissionUnbound, dischargeBound] }),
    ).toBeNull();
  });

  it("returns null when both bound facts come from the same physical document (same-document trap)", () => {
    const sameDocAdmission = result({
      id: "same-admission-chunk",
      document_id: "combined-referral-doc",
      title: "Admission of Community Patients",
      file_name: ADMISSION_FILE,
      content: ADMISSION_BOUND,
    });
    const sameDocDischarge = result({
      id: "same-discharge-chunk",
      document_id: "combined-referral-doc",
      title: "Discharge Planning for Community Patients",
      file_name: DISCHARGE_FILE,
      content: DISCHARGE_BOUND,
    });

    expect(
      buildAdmissionDischargeComparisonAnswer({ query: QUERY, results: [sameDocAdmission, sameDocDischarge] }),
    ).toBeNull();
  });
});

describe("admission/discharge fallback keeps both sides in its evidence", () => {
  const dischargeOnly = [
    dischargeBound,
    result({
      id: "discharge-2",
      document_id: "discharge-2-doc",
      title: "Patient Discharge Policy",
      content: DISCHARGE_BOUND,
    }),
  ];

  it("adds the missing admission side from the eligible evidence so both sides can be cited", () => {
    const selected = withAdmissionDischargeSideEvidence({
      query: QUERY,
      queryClass: "comparison",
      selected: dischargeOnly,
      candidates: [...dischargeOnly, admissionBound],
    });

    expect(selected.map((item) => item.id)).toEqual(["discharge-chunk", "discharge-2", "admission-chunk"]);
    expect(buildAdmissionDischargeComparisonAnswer({ query: QUERY, results: selected })?.citationChunkIds).toEqual([
      "admission-chunk",
      "discharge-chunk",
    ]);
  });

  it("leaves the selection unchanged when both sides are present or the query is not this comparison", () => {
    const both = [admissionBound, dischargeBound];
    expect(
      withAdmissionDischargeSideEvidence({ query: QUERY, queryClass: "comparison", selected: both, candidates: both }),
    ).toBe(both);
    expect(
      withAdmissionDischargeSideEvidence({
        query: "Compare lithium and valproate",
        queryClass: "comparison",
        selected: dischargeOnly,
        candidates: [admissionBound],
      }),
    ).toBe(dischargeOnly);
  });

  it("does not count an admission source without a bound requirement as the admission side", () => {
    const admissionUnbound = result({
      id: "admission-unbound",
      document_id: "admission-unbound-doc",
      title: "Admission of Community Patients",
      file_name: ADMISSION_FILE,
      content: ADMISSION_UNBOUND,
    });
    const selected = withAdmissionDischargeSideEvidence({
      query: QUERY,
      queryClass: "comparison",
      selected: [admissionUnbound, dischargeBound],
      candidates: [admissionUnbound, dischargeBound, admissionBound],
    });
    expect(selected.map((item) => item.id)).toEqual(["admission-unbound", "discharge-chunk", "admission-chunk"]);
    expect(buildAdmissionDischargeComparisonAnswer({ query: QUERY, results: selected })).not.toBeNull();
  });

  it("adds a chunk with several bound requirements only once", () => {
    const multiFact = {
      ...admissionBound,
      content: `${ADMISSION_BOUND} ${ADMISSION_BOUND.replace("Medical", "Risk")}`,
    };
    const selected = withAdmissionDischargeSideEvidence({
      query: QUERY,
      queryClass: "comparison",
      selected: dischargeOnly,
      candidates: [...dischargeOnly, multiFact],
    });
    expect(selected.map((item) => item.id)).toEqual(["discharge-chunk", "discharge-2", "admission-chunk"]);
  });

  it("does not count a dual-title policy as the admission side", () => {
    const dual = result({
      id: "dual-chunk",
      document_id: "dual-doc",
      title: "Referral, Admission and Discharge Policy",
      content: DISCHARGE_BOUND,
    });
    const selected = withAdmissionDischargeSideEvidence({
      query: QUERY,
      queryClass: "comparison",
      selected: [dual, dischargeBound],
      candidates: [dual, dischargeBound, admissionBound],
    });
    expect(selected.map((item) => item.id)).toContain("admission-chunk");
  });
});
