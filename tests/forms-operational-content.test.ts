import { describe, expect, it } from "vitest";

import formsCatalog from "../data/forms-catalog.json";
import formsContentReview from "../data/forms-content-review.json";

import { FORMS_AWAITING_REVIEW_NOTE, formCatalogDetails, formContentReviewStatus } from "@/lib/form-catalog";
import { formRecords, getFormRecord } from "@/lib/forms";

/**
 * The Forms mode renders all 54 codes on the official register, but for a long time only
 * 14 of them carried real operational text. Thirty-three were seeded from a PDF indexing
 * pass that left behind its own scaffolding — "Official form source: <title>. Review the
 * source snippets and approved form before use." as the purpose, "Check the official form
 * signature block and Act sections." as the maker, and "Open the source snippets before
 * relying on the pathway." as the safety pearl. The remaining seven had no catalogue entry
 * at all and fell through to the generic fallback in `form-catalog.ts`.
 *
 * None of that told a clinician who may make the form, what it authorises, when the clock
 * starts or what it stops authorising. "Source snippets" is not even a surface this app
 * has. These tests pin the replacement text in place, and pin the review label that has to
 * travel with it: the guidance is drafted from the Act and the approved form and carries no
 * clinician sign-off, exactly as the Act-section summaries do.
 */

type CatalogForm = { form: string; purpose?: string; maker?: string; safetyPearl?: string };
const catalogForms = (formsCatalog as { forms: CatalogForm[] }).forms;

const INDEXING_SCAFFOLD = {
  purposePrefix: "Official form source:",
  maker: "Check the official form signature block and Act sections.",
  safetyPearl: "Open the source snippets before relying on the pathway.",
};

/** The seven codes the archive never indexed, so they had no catalogue entry at all. */
const PREVIOUSLY_UNCOVERED = ["1A attachment", "4D", "4E", "7C", "10H", "12C attachment", "13"];

describe("forms catalogue operational content", () => {
  it("has retired the PDF-indexing scaffolding from every catalogue entry", () => {
    const withScaffoldPurpose = catalogForms.filter((entry) =>
      entry.purpose?.startsWith(INDEXING_SCAFFOLD.purposePrefix),
    );
    const withScaffoldMaker = catalogForms.filter((entry) => entry.maker === INDEXING_SCAFFOLD.maker);
    const withScaffoldPearl = catalogForms.filter((entry) => entry.safetyPearl === INDEXING_SCAFFOLD.safetyPearl);

    expect(withScaffoldPurpose.map((entry) => entry.form)).toEqual([]);
    expect(withScaffoldMaker.map((entry) => entry.form)).toEqual([]);
    expect(withScaffoldPearl.map((entry) => entry.form)).toEqual([]);
  });

  it("gives all 54 register codes a catalogue entry rather than the generic fallback", () => {
    const codes = new Set(catalogForms.map((entry) => entry.form.trim().toLowerCase()));
    for (const code of PREVIOUSLY_UNCOVERED) {
      expect(codes.has(code.toLowerCase()), code).toBe(true);
    }
    expect(catalogForms).toHaveLength(54);
  });

  it("names a maker, a boundary and a trap for every form", () => {
    for (const record of formRecords) {
      const details = formCatalogDetails(record);
      expect(details, record.slug).toBeTruthy();
      expect(details!.maker.length, record.slug).toBeGreaterThan(12);
      expect(details!.traps.length, record.slug).toBeGreaterThan(0);
      expect(details!.boundaries?.length, record.slug).toBeGreaterThan(0);
    }
  });

  it("keeps the clock qualifier attached to the duration", () => {
    // Form 3C is the worst case in the mode: the catalogue used to carry the bare string
    // "24 hours, up to 72 hours, 72 hours", which reads as a fresh 72 hours from signing.
    // The ceiling runs from the original reception, and it does not reset.
    const details = formCatalogDetails(getFormRecord("form-3c")!);
    expect(details?.clock).not.toBe("24 hours, up to 72 hours, 72 hours");
    expect(details?.clock).toMatch(/72 hours/);
    expect(details?.clock.toLowerCase()).toMatch(/reception|original|start/);
    expect(details?.safetyPearl.toLowerCase()).toMatch(/does not reset/);
  });

  it("labels drafted guidance as awaiting clinical review, on the record and in the catalogue", () => {
    const drafted = new Set(
      (formsContentReview as { forms: { code: string; status: string }[] }).forms
        .filter((entry) => entry.status === "drafted")
        .map((entry) => entry.code.trim().toLowerCase()),
    );
    expect(drafted.size).toBeGreaterThanOrEqual(0);

    for (const record of formRecords) {
      const details = formCatalogDetails(record);
      const isDrafted = drafted.has(details!.form.trim().toLowerCase());
      expect(details!.contentReviewStatus, details!.form).toBe(isDrafted ? "drafted" : "reviewed");
      const notes = record.verification?.notes ?? [];
      expect(notes.includes(FORMS_AWAITING_REVIEW_NOTE), details!.form).toBe(isDrafted);
      expect(FORMS_AWAITING_REVIEW_NOTE.toLowerCase()).toContain("awaiting clinical review");
    }
  });

  /**
   * Status alone is not a sign-off. Flagged by Codex review on PR #2821: a hand-edit that
   * sets `status: "reviewed"` without naming a reviewer would otherwise drop the caveat and
   * present unsigned guidance about a statutory form as settled reference.
   */
  it("falls closed to drafted when a reviewed row has no usable reviewer attribution", () => {
    const signed = { status: "reviewed", reviewedBy: "Dr A Reviewer", reviewedAt: "2026-09-16" };
    expect(formContentReviewStatus(signed)).toBe("reviewed");

    for (const row of [
      { ...signed, reviewedBy: null },
      { ...signed, reviewedAt: null },
      { ...signed, reviewedBy: undefined },
      { ...signed, reviewedBy: "   " },
      { ...signed, reviewedAt: "" },
      { ...signed, reviewedBy: 12345 },
      { ...signed, reviewedAt: { at: "2026-09-16" } },
      { status: "reviewed" },
      { status: "drafted", reviewedBy: "Dr A Reviewer", reviewedAt: "2026-09-16" },
    ]) {
      expect(formContentReviewStatus(row), JSON.stringify(row)).toBe("drafted");
    }
  });

  it("carries a complete attestation on every row the register currently marks reviewed", () => {
    const rows = (formsContentReview as { forms: { status: string; reviewedBy?: unknown; reviewedAt?: unknown }[] })
      .forms;
    for (const row of rows.filter((entry) => entry.status === "reviewed")) {
      expect(formContentReviewStatus(row), JSON.stringify(row)).toBe("reviewed");
    }
  });

  it("states a checkable basis for every drafted form", () => {
    const review = formsContentReview as {
      forms: { code: string; status: string; basis: string; sections: string[] }[];
    };
    const registerCodes = new Set(catalogForms.map((entry) => entry.form.trim().toLowerCase()));
    for (const entry of review.forms) {
      expect(registerCodes.has(entry.code.trim().toLowerCase()), entry.code).toBe(true);
      expect(entry.basis.length, entry.code).toBeGreaterThan(40);
      expect(["drafted", "reviewed"]).toContain(entry.status);
    }
  });
});
