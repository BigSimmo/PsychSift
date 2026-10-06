import { describe, expect, it } from "vitest";

import formsCatalog from "../data/forms-catalog.json";
import formsContentReview from "../data/forms-content-review.json";
import { buildSheet } from "../scripts/build-forms-content-review-sheet";
import { finalizeClinicalReview, reviewProblems } from "../scripts/lib/clinical-record-review-contract.mjs";

import { reviewedSourceNote } from "@/components/forms/form-detail-page";
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

type CatalogForm = { form: string; purpose?: string; maker?: string; safetyPearl?: string; sourceNote?: string };
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
    // Josh confirmed the submitted sign-offs on 2026-10-02. Form 2 was revised and
    // then signed on 2026-10-06, so no form remains drafted.
    expect([...drafted]).toEqual([]);

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
   * Seven forms' catalogue sourceNote is only the pre-review caveat: "Operational guidance
   * drafted from the Mental Health Act 2014 (WA) and the approved form. Awaiting clinical
   * review." (pinned in data/forms-catalog.json; never edited by this component). The Act/cue
   * row on the form's Source info tab falls back to sourceNote whenever the form has no
   * sourceFacts.sectionCue, so that caveat would otherwise keep showing forever, even after
   * the form is clinically reviewed. reviewedSourceNote suppresses it, and only it, once
   * contentReviewStatus is "reviewed" — any other sourceNote text is unaffected.
   */
  it("stops showing the 'awaiting clinical review' sourceNote once a form is reviewed, but leaves every other sourceNote alone", () => {
    const AWAITING =
      "Operational guidance drafted from the Mental Health Act 2014 (WA) and the approved form. Awaiting clinical review.";
    const affected = catalogForms.filter((entry) => entry.sourceNote === AWAITING).map((entry) => entry.form);
    expect(affected).toEqual(PREVIOUSLY_UNCOVERED);

    // Drafted (today's real state for all seven): the caveat still shows.
    expect(reviewedSourceNote({ sourceNote: AWAITING, contentReviewStatus: "drafted" })).toBe(AWAITING);
    expect(reviewedSourceNote({ sourceNote: AWAITING })).toBe(AWAITING);

    // Reviewed: the caveat is suppressed so the row falls through to "Not listed" rather than
    // a stale "awaiting review" claim about signed-off guidance.
    expect(reviewedSourceNote({ sourceNote: AWAITING, contentReviewStatus: "reviewed" })).toBeUndefined();

    // A genuinely informative sourceNote (unrelated to the review caveat) is never suppressed,
    // reviewed or not.
    const realNote = "Official title and availability checked against the Office of the Chief Psychiatrist register.";
    expect(reviewedSourceNote({ sourceNote: realNote, contentReviewStatus: "reviewed" })).toBe(realNote);
    expect(reviewedSourceNote({ sourceNote: realNote, contentReviewStatus: "drafted" })).toBe(realNote);

    // No sourceNote at all: nothing to suppress, nothing to show.
    expect(reviewedSourceNote({ contentReviewStatus: "reviewed" })).toBeUndefined();
    expect(reviewedSourceNote(null)).toBeUndefined();
    expect(reviewedSourceNote(undefined)).toBeUndefined();
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
      // The only way out of "drafted" is an owner sign-off through `npm run clinical:review`,
      // and the pin test below holds every reviewed row to a complete, current attestation.
      expect(["drafted", "reviewed"], entry.code).toContain(entry.status);
    }
  });

  /**
   * A sign-off attests specific text. The content pin (`reviewedContentSha256`) covers the
   * review row and the form's operational guidance in data/forms-catalog.json, so a later
   * edit to either fails here -- in the unit suite, not only in `check:forms-review-sheet`.
   */
  it("holds every reviewed form row to a complete, current sign-off pin", () => {
    expect(reviewProblems(formsContentReview.forms, "form", { catalog: formsCatalog })).toEqual([]);
  });

  it("fails the pin once a signed form's guidance is edited after sign-off", () => {
    const row = {
      ...formsContentReview.forms.find((entry) => entry.code === "3C")!,
      status: "drafted",
      reviewedBy: null,
      reviewedAt: null,
      reviewedContentSha256: null,
    };
    const signed = finalizeClinicalReview(row, "form", {
      reviewedBy: "Dr Alex Morgan",
      reviewedAt: "2026-09-24T12:00:00.000Z",
      context: { catalog: formsCatalog },
      now: new Date("2026-09-25T00:00:00.000Z"),
    });
    expect(reviewProblems([signed], "form", { catalog: formsCatalog, now: new Date("2026-09-25") })).toEqual([]);

    const edited = structuredClone(formsCatalog) as { forms: { form: string; clock: string }[] };
    const entry = edited.forms.find((form) => form.form === "3C")!;
    entry.clock = `${entry.clock} Resets when the form is signed.`;
    expect(reviewProblems([signed], "form", { catalog: edited, now: new Date("2026-09-25") }).join("\n")).toContain(
      "content changed since sign-off",
    );
  });

  it("shows each form's sign-off pin state on the review sheet", () => {
    const sheet = buildSheet();
    expect(sheet.match(/\*\*Sign-off pin\*\*/g)?.length).toBe(formsContentReview.forms.length);
    expect(sheet).toContain("npm run clinical:review");
    expect(sheet).toContain("**54 of 54 forms have clinician sign-off.**");
    expect(sheet).not.toContain("None of it carries");
  });
});
