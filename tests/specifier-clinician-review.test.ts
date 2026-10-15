import { describe, expect, it, vi } from "vitest";

import {
  definitionReviewApprovalDefect,
  dictionaryDefinitionReviewIssues,
  dictionaryDefinitionReviews,
  isDefinitionReviewClinicallyApproved,
  type DictionaryDefinitionReview,
} from "@/lib/dictionary-editorial/definition-reviews";
import {
  isSpecifierClinicianReviewed,
  specifierClinicianReviewLabel,
  type SpecifierReview,
} from "@/lib/specifiers-content";

/**
 * The display and queue side of the two sign-off kinds `npm run clinical:review`
 * writes into native fields: `review.{clinicianReviewStatus, reviewedBy, reviewedAt,
 * reviewedContentSha256}` on a specifier, and `clinicalApproval` on a dictionary
 * definition review. Every check here fails closed: a partial attestation reads as
 * pending and stays in the queue.
 */

const PIN = "a".repeat(64);

// The queue reads module-level JSON, so the two modules it reads sign-off state from
// are replaced with small in-memory fixtures. The predicates stay the real ones, so this
// proves the queue filters through exactly the decision the pages render.
vi.mock("@/lib/specifiers-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/specifiers-content")>();
  const review = (rowKey: string, signed: Partial<SpecifierReview> = {}): SpecifierReview => ({
    rowKey,
    contentHash: "00000000",
    sourceVerificationStatus: "source-verified",
    clinicianReviewStatus: "clinician-review-pending",
    changedSinceReview: false,
    ...signed,
  });
  const signed = {
    clinicianReviewStatus: "clinician-reviewed",
    reviewedBy: "Dr Alex Example",
    reviewedAt: "2026-09-26T03:00:00.000Z",
    reviewedContentSha256: "a".repeat(64),
  };
  const item = (slug: string, reviewFields: SpecifierReview) => ({
    slug,
    label: slug,
    groupLabel: "Group",
    disorderName: "Disorder",
    icd11Context: "",
    categoryId: "c",
    categoryName: "Category",
    definition: null,
    definitionStatus: "defined" as const,
    review: reviewFields,
  });
  const items = [
    item("pending-item", review("r:pending")),
    item("signed-item", review("r:signed", signed)),
    // Status says reviewed but no reviewer: must stay in the queue.
    item("partial-item", review("r:partial", { clinicianReviewStatus: "clinician-reviewed" })),
  ];
  const universals = [
    { title: "Pending universal", description: "", review: review("u:pending") },
    { title: "Signed universal", description: "", review: review("u:signed", signed) },
  ];
  return {
    ...actual,
    specifierCatalogItems: () => items,
    loadSpecifiersContent: () => ({
      ...actual.loadSpecifiersContent(),
      stats: { ...actual.loadSpecifiersContent().stats, itemsPendingClinicianReview: 2 },
      universalSpecifiers: universals,
    }),
  };
});

vi.mock("@/lib/dictionary-editorial/definition-reviews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dictionary-editorial/definition-reviews")>();
  const proposed = actual.dictionaryDefinitionReviews.filter((review) => review.proposedWording !== null);
  const [approved, pending, malformed] = proposed;
  return {
    ...actual,
    dictionaryDefinitionReviews: [
      {
        ...approved,
        clinicalApproval: {
          status: "approved",
          reviewer: "Dr Alex Example",
          reviewedAt: "2026-09-26T03:00:00.000Z",
          reviewedContentSha256: "a".repeat(64),
        },
      },
      // The unsigned fixture must stay unsigned when the shipped proposal is approved.
      { ...pending, clinicalApproval: undefined },
      {
        ...malformed,
        clinicalApproval: { status: "approved", reviewer: "", reviewedAt: "x", reviewedContentSha256: "" },
      },
    ],
  };
});

describe("specifierClinicianReviewLabel", () => {
  const base = {
    clinicianReviewStatus: "clinician-review-pending",
  } as const;

  it("reads pending for an unsigned entry", () => {
    expect(specifierClinicianReviewLabel(base)).toBe("Pending qualified review");
    expect(isSpecifierClinicianReviewed(base)).toBe(false);
  });

  it("names the reviewer and the Perth date for a complete sign-off, scoped to the definition", () => {
    const review = {
      clinicianReviewStatus: "clinician-reviewed",
      reviewedBy: "Dr Alex Example",
      // 20:30 UTC on the 25th is 04:30 on the 26th in Perth (UTC+8).
      reviewedAt: "2026-09-25T20:30:00.000Z",
      reviewedContentSha256: PIN,
    };
    expect(isSpecifierClinicianReviewed(review)).toBe(true);
    expect(specifierClinicianReviewLabel(review)).toBe("Definition reviewed by Dr Alex Example on 26 September 2026");
  });

  it("fails closed on a malformed or unparseable date", () => {
    for (const reviewedAt of ["not a date", "2026-13-45T00:00:00Z", "26/09/2026", "", null, undefined]) {
      const review = { clinicianReviewStatus: "clinician-reviewed", reviewedBy: "Dr Alex Example", reviewedAt };
      expect(specifierClinicianReviewLabel(review), String(reviewedAt)).toBe("Pending qualified review");
    }
  });

  it("fails closed on a missing or blank reviewer", () => {
    for (const reviewedBy of [undefined, null, "", "   "]) {
      const review = { clinicianReviewStatus: "clinician-reviewed", reviewedBy, reviewedAt: "2026-09-26T03:00:00Z" };
      expect(specifierClinicianReviewLabel(review), String(reviewedBy)).toBe("Pending qualified review");
    }
  });

  it("fails closed when the reviewer is a product or role name, not a named clinician", () => {
    for (const reviewedBy of ["PsychSift", "Dr Example", "System", "Clinician"]) {
      const review = { clinicianReviewStatus: "clinician-reviewed", reviewedBy, reviewedAt: "2026-09-26T03:00:00Z" };
      expect(isSpecifierClinicianReviewed(review), reviewedBy).toBe(false);
      expect(specifierClinicianReviewLabel(review), reviewedBy).toBe("Pending qualified review");
    }
  });

  it("does not treat reviewer fields on a pending status as a sign-off", () => {
    const review = {
      clinicianReviewStatus: "clinician-review-pending",
      reviewedBy: "Dr Alex Example",
      reviewedAt: "2026-09-26T03:00:00Z",
    };
    expect(specifierClinicianReviewLabel(review)).toBe("Pending qualified review");
  });
});

describe("dictionary definition review clinicalApproval", () => {
  const approval = {
    status: "approved",
    reviewer: "Dr Alex Example",
    reviewedAt: "2026-09-26T03:00:00.000Z",
    reviewedContentSha256: PIN,
  };

  it("accepts a well-formed approval", () => {
    expect(definitionReviewApprovalDefect(approval)).toBeNull();
    expect(isDefinitionReviewClinicallyApproved({ clinicalApproval: approval as never })).toBe(true);
  });

  it("rejects each malformed shape", () => {
    expect(definitionReviewApprovalDefect(null)).toMatch(/object/);
    expect(definitionReviewApprovalDefect({ ...approval, status: "pending" })).toMatch(/status/);
    expect(definitionReviewApprovalDefect({ ...approval, reviewer: " " })).toMatch(/reviewer/);
    expect(definitionReviewApprovalDefect({ ...approval, reviewedAt: "yesterday" })).toMatch(/reviewedAt/);
    expect(definitionReviewApprovalDefect({ ...approval, reviewedContentSha256: "abc" })).toMatch(/Sha256/);
    expect(definitionReviewApprovalDefect({ ...approval, extra: true })).toMatch(/unexpected field/);
    expect(isDefinitionReviewClinicallyApproved({})).toBe(false);
  });

  it("lets the structural check accept an approved proposal and reject a malformed or misplaced one", () => {
    const proposed = dictionaryDefinitionReviews.find((review) => review.proposedWording !== null)!;
    const signed = { ...proposed, clinicalApproval: approval } as DictionaryDefinitionReview;
    // The mocked set above deliberately carries a malformed approval, so check the
    // approved record on its own.
    expect(dictionaryDefinitionReviewIssues([signed])).toEqual([]);
    // Approval does not change the publication controls.
    expect(signed.publicationAllowed).toBe(false);
    expect(signed.applyAutomatically).toBe(false);
    expect(
      dictionaryDefinitionReviewIssues([{ ...signed, clinicalApproval: { ...approval, reviewer: "" } } as never]),
    ).toEqual([expect.stringMatching(/reviewer must name/)]);
    expect(dictionaryDefinitionReviewIssues([{ ...signed, proposedWording: null }])).toEqual([
      expect.stringMatching(/only recorded against a proposed rewrite/),
    ]);
  });
});

describe("sign-off queue drops only complete sign-offs", () => {
  it("removes signed specifier items and universals, keeping pending and partial ones", async () => {
    const { loadSignOffQueue } = await import("@/lib/developer-area/sign-off-queue");
    const specifiers = loadSignOffQueue().families.find((family) => family.id === "specifiers")!;
    expect(specifiers.rows.map((row) => row.key)).toEqual([
      "specifier:pending-item",
      "specifier:partial-item",
      "specifier-universal:u:pending",
    ]);
    expect(specifiers.note).toContain("a further 1 of the 2 universal specifiers");
  });

  it("removes an approved definition review and keeps a pending or malformed one", async () => {
    const { loadSignOffQueue } = await import("@/lib/developer-area/sign-off-queue");
    const dictionary = loadSignOffQueue().families.find((family) => family.id === "dictionary")!;
    const definitionRows = dictionary.rows.filter((row) => row.key.startsWith("dictionary-definition:"));
    const [approved, pending, malformed] = dictionaryDefinitionReviews;
    expect(definitionRows.map((row) => row.id)).toEqual([pending!.id, malformed!.id]);
    expect(definitionRows.some((row) => row.id === approved!.id)).toBe(false);
  });
});
