import { describe, expect, it } from "vitest";

import { withBestPracticePrescriptionEvidence } from "../src/lib/rag/rag-best-practice-prescription-evidence";
import { chooseValidatedExtractiveShortCircuit } from "../src/lib/rag/rag-extractive-first";
import type { SearchResult } from "../src/lib/types";

// Live canaries 38383361787 and 38419027058: the fast four-chunk selection carried only the AKG
// procedure's p4 legislative/monitoring chunks, so the measured extractive-first builder never saw
// its program-use + medication-profile pair and the query fell through to model generation.

const QUERY = "What does the best practice prescription document require?";
const DOC = "best-practice-prescription-akg";

function chunk(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: "chunk",
    document_id: DOC,
    title: "Best Practice Prescription(AKG)",
    file_name: "Best Practice Prescription (AKG).pdf",
    page_number: 4,
    chunk_index: 0,
    section_heading: null,
    content: "",
    image_ids: [],
    similarity: 0.6,
    hybrid_score: 0.6,
    images: [],
    ...overrides,
  };
}

const legislative = chunk({
  id: "p4-legislative",
  content:
    "7. Legislative context The following documents are required to give effect to this procedure: Medicines and Poisons Act 2014; Mental Health Act 2014.",
});
const monitoring = chunk({
  id: "p4-monitoring",
  content:
    "Monitoring activities include: Quarterly auditing of medical records and Best Practice Prescription Program profiles to identify if staff have complied with history taking and record keeping requirements.",
});
const otherDocument = chunk({
  id: "co-payment",
  document_id: "co-payment-fsh",
  title: "Exemption from Patient Prescription Co-Payment(FSH)",
  file_name: "Exemption from Patient Prescription Co-Payment (FSH).pdf",
  content: "Patients may be exempt from the prescription co-payment when eligibility criteria are documented.",
});
const programUse = chunk({
  id: "p1-program-use",
  page_number: 1,
  content: `Best Practice Prescription Program is an electronic program implemented in the AHS outpatient mental health clinics that is used for the following activities:
• Prescription generation (replacing handwritten prescriptions*)
• Maintenance of electronic medication profiles (replacing paper-based profiles)
• Internal and external correspondence generation
• Recording other relevant clinical information (e.g.: allergies/ adverse drug reactions).`,
});
const profile = chunk({
  id: "p2-profile",
  page_number: 2,
  content: `The prescriber is responsible for the following: • At the first clinic appointment, medical officers are to inquire with the consumer (or carer) about their current medications and the medical officer or care co-ordinator may need to verify this information with the consumers own medications or a suitable alternative source (e.g.: General Practitioner).
• The details (i.e.: medication name, formulation, route, dose and directions for use) of each psychiatric and non-psychiatric medication must be entered into the Best Practice Prescription Program medication profile.`,
});

const selected = [legislative, monitoring, otherDocument];
const candidates = [legislative, monitoring, otherDocument, programUse, profile];

function shortCircuit(results: SearchResult[], query = QUERY) {
  return chooseValidatedExtractiveShortCircuit({
    query,
    queryClass: "document_lookup",
    results,
    route: { mode: "fast", reason: "strong_routine_retrieval" },
    sourceBacked: true,
    gateStatus: "passed",
  });
}

describe("withBestPracticePrescriptionEvidence", () => {
  it("reproduces the miss: the live p4-only selection cannot short-circuit", () => {
    expect(shortCircuit(selected)?.reasonMarker).not.toBe(
      "validated_best_practice_prescription_requirements_extractive_first",
    );
  });

  it("appends the same-document program-use and profile chunks so the deterministic answer fires", () => {
    const topped = withBestPracticePrescriptionEvidence({
      query: QUERY,
      queryClass: "document_lookup",
      selected,
      candidates,
    });
    expect(topped.map((result) => result.id)).toEqual([
      ...selected.map((result) => result.id),
      "p1-program-use",
      "p2-profile",
    ]);
    expect(shortCircuit(topped)).toEqual({
      reasonMarker: "validated_best_practice_prescription_requirements_extractive_first",
    });
  });

  it("leaves every other query untouched", () => {
    const other = "What does the clozapine prescribing document require?";
    expect(
      withBestPracticePrescriptionEvidence({ query: other, queryClass: "document_lookup", selected, candidates }),
    ).toBe(selected);
    expect(
      withBestPracticePrescriptionEvidence({
        query: QUERY,
        queryClass: "unsupported_or_general",
        selected,
        candidates,
      }),
    ).toBe(selected);
  });

  it("adds nothing when the pair is already selected or cannot be formed from one document", () => {
    const complete = [programUse, profile];
    expect(
      withBestPracticePrescriptionEvidence({
        query: QUERY,
        queryClass: "document_lookup",
        selected: complete,
        candidates,
      }),
    ).toBe(complete);
    const split = [legislative, programUse, { ...profile, document_id: "different-procedure" }];
    expect(
      withBestPracticePrescriptionEvidence({
        query: QUERY,
        queryClass: "document_lookup",
        selected: [legislative],
        candidates: split,
      }),
    ).toEqual([legislative]);
  });

  it("only adds the missing half when one role is already selected", () => {
    const topped = withBestPracticePrescriptionEvidence({
      query: QUERY,
      queryClass: "document_lookup",
      selected: [legislative, programUse],
      candidates,
    });
    expect(topped.map((result) => result.id)).toEqual(["p4-legislative", "p1-program-use", "p2-profile"]);
  });
});
