import { describe, expect, it } from "vitest";
import { planUnreviewedDocumentsMigration } from "../scripts/dry-run-migrate-unreviewed-documents";

describe("planUnreviewedDocumentsMigration", () => {
  it("identifies bulk-imported locally_reviewed documents without reviewers as migration candidates", () => {
    const docs = [
      {
        id: "doc-1",
        title: "WA Clinical Protocol 1",
        file_name: "wa-protocol-1.pdf",
        metadata: {
          clinical_validation_status: "locally_reviewed",
          // No reviewer marker
        },
      },
      {
        id: "doc-2",
        title: "WA Clinical Protocol 2",
        file_name: "wa-protocol-2.pdf",
        metadata: {
          clinical_validation_status: "locally_reviewed",
          clinical_validation_evidence: {
            basis: "bulk_imported",
          },
        },
      },
      {
        id: "doc-3",
        title: "WA Clinical Protocol 3 (Reviewed by Dr Smith)",
        file_name: "wa-protocol-3.pdf",
        metadata: {
          clinical_validation_status: "locally_reviewed",
          governance_updated_by: "dr_smith",
          provenance_basis: "reviewer_verified",
        },
      },
      {
        id: "doc-4",
        title: "Approved Guideline",
        file_name: "approved-guideline.pdf",
        metadata: {
          clinical_validation_status: "approved",
        },
      },
    ];

    const plan = planUnreviewedDocumentsMigration(docs);

    expect(plan.totalInspected).toBe(4);
    expect(plan.candidateCount).toBe(2);
    expect(plan.preservedReviewedCount).toBe(1);
    expect(plan.otherCount).toBe(1);

    const candidates = plan.candidates.filter((c) => c.action === "migrate");
    expect(candidates.map((c) => c.id)).toEqual(["doc-1", "doc-2"]);
    expect(candidates[0].proposedStatus).toBe("imported_unreviewed");

    const preserved = plan.candidates.filter((c) => c.action === "preserve");
    expect(preserved.map((c) => c.id)).toEqual(["doc-3"]);
    expect(preserved[0].hasRecordedReviewer).toBe(true);

    expect(plan.sqlMigration).toContain("imported_unreviewed");
    expect(plan.sqlMigration).toContain("clinical_validation_status");
  });
});
