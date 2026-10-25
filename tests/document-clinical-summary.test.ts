import { describe, expect, it } from "vitest";
import { buildDocumentClinicalSummaryModel } from "@/components/document-viewer/document-clinical-summary";
import type { ClinicalDocument, ClinicalDocumentSummaryProfile, DocumentSummaryProfileItem } from "@/lib/types";

function item(
  text: string,
  pages: number[],
  support: DocumentSummaryProfileItem["support"] = "direct",
): DocumentSummaryProfileItem {
  return {
    text,
    pages,
    support,
    evidence_type: "text",
    source_chunk_ids: ["chunk-1"],
    source_image_ids: [],
  };
}

function profile(overrides: Partial<ClinicalDocumentSummaryProfile> = {}): ClinicalDocumentSummaryProfile {
  return {
    overview: "Safe lithium care requires baseline tests, timed monitoring, and urgent action for toxicity.",
    applies_to: [],
    key_clinical_actions: [item("Check renal, thyroid and calcium status before treatment.", [4])],
    medication_dose_monitoring: [],
    thresholds_timing: [item("Take trough levels 12 hours after the last dose.", [6])],
    escalation_risk_warnings: [item("Withhold lithium and urgently assess suspected toxicity.", [9])],
    required_forms_documentation: [],
    not_covered: [],
    important_tables_images: [],
    best_questions: [],
    source_quality_notes: [],
    ...overrides,
  };
}

function documentWithProfile(summaryProfile: ClinicalDocumentSummaryProfile): ClinicalDocument {
  return {
    id: "document-1",
    title: "Lithium monitoring protocol",
    file_name: "lithium-monitoring.pdf",
    created_at: "2026-07-24T00:00:00.000Z",
    summary: {
      id: "summary-1",
      document_id: "document-1",
      summary: "Stored summary fallback.",
      clinical_specifics: { profile: summaryProfile },
    },
  } as ClinicalDocument;
}

describe("buildDocumentClinicalSummaryModel", () => {
  it("orders source-backed priorities by safety, monitoring, then clinical action", () => {
    const model = buildDocumentClinicalSummaryModel(documentWithProfile(profile()));

    expect(model.summary).toContain("baseline tests");
    expect(model.priorities.map((priority) => priority.title)).toEqual([
      "Escalation and safety",
      "Timing and monitoring",
      "Key clinical action",
    ]);
    expect(model.priorities.map((priority) => priority.page)).toEqual([9, 6, 4]);
    expect(model.sourceBacked).toBe(true);
  });

  it("skips unsupported and duplicate profile items", () => {
    const repeated = "Take trough levels 12 hours after the last dose.";
    const model = buildDocumentClinicalSummaryModel(
      documentWithProfile(
        profile({
          escalation_risk_warnings: [item("Unsupported warning.", [3], "not_found")],
          thresholds_timing: [item(repeated, [6])],
          key_clinical_actions: [item(repeated, [6])],
        }),
      ),
    );

    expect(model.priorities).toHaveLength(1);
    expect(model.priorities[0]).toMatchObject({ title: "Timing and monitoring", page: 6 });
  });

  it("never shows an applies-to scope statement as a key clinical action", () => {
    const scope = "Adults prescribed lithium in the synthetic shared-care pathway.";
    const model = buildDocumentClinicalSummaryModel(
      documentWithProfile(profile({ key_clinical_actions: [], applies_to: [item(scope, [2])] })),
    );

    const scopePriority = model.priorities.find((priority) => priority.text === scope);
    expect(scopePriority).toMatchObject({ id: "scope", title: "Applies to", label: "Scope", tone: "scope", page: 2 });
    expect(model.priorities.some((priority) => priority.title === "Key clinical action")).toBe(false);
  });

  it("keeps the clinical action, not the scope, when the document has both", () => {
    const model = buildDocumentClinicalSummaryModel(
      documentWithProfile(profile({ applies_to: [item("Adults in the synthetic pathway.", [2])] })),
    );

    expect(model.priorities.map((priority) => priority.title)).toEqual([
      "Escalation and safety",
      "Timing and monitoring",
      "Key clinical action",
    ]);
  });

  it("handles persisted profile items without a pages array", () => {
    const legacyItem = {
      ...item("Take a trough level after the last dose.", []),
      pages: undefined,
    } as unknown as DocumentSummaryProfileItem;
    const model = buildDocumentClinicalSummaryModel(
      documentWithProfile(
        profile({
          thresholds_timing: [legacyItem],
        }),
      ),
    );

    expect(model.priorities.find((priority) => priority.title === "Timing and monitoring")?.page).toBeNull();
  });

  it("ignores malformed persisted profile groups and items", () => {
    const malformed = profile({
      thresholds_timing: { text: "not an array" },
      medication_dose_monitoring: [null, "invalid", { support: "direct" }],
      escalation_risk_warnings: [null, item("Escalate valid safety concerns.", [7])],
    } as unknown as Partial<ClinicalDocumentSummaryProfile>);

    const model = buildDocumentClinicalSummaryModel(documentWithProfile(malformed));

    expect(model.priorities.map((priority) => priority.text)).toEqual([
      "Escalate valid safety concerns.",
      "Check renal, thyroid and calcium status before treatment.",
    ]);
  });

  it("keeps text-only persisted profile items unverified", () => {
    const textOnlyItem = {
      text: "Review monitoring after dose changes.",
      pages: [5],
    } as DocumentSummaryProfileItem;
    const model = buildDocumentClinicalSummaryModel(
      documentWithProfile(
        profile({
          escalation_risk_warnings: [],
          thresholds_timing: [textOnlyItem],
          key_clinical_actions: [],
        }),
      ),
    );

    expect(model.priorities).toHaveLength(1);
    expect(model.priorities[0]?.support).toBeNull();
    expect(model.sourceBacked).toBe(false);
  });

  it("does not surface generic source-review copy as the high-yield summary", () => {
    const model = buildDocumentClinicalSummaryModel(
      documentWithProfile(profile({ overview: "Source-backed review of the indexed document." })),
    );

    expect(model.summary).toBe("Stored summary fallback.");
  });
});
