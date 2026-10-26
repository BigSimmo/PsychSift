import { describe, expect, it } from "vitest";
import {
  dedupeSummarySentences,
  formatDocumentSummary,
  stripSummaryBoilerplate,
} from "../src/lib/document-summary-formatting";

// Verbatim shape of a real stored summary: protective marking + document title
// + reference code + Scope/Site/Disciplines run glued ahead of the content,
// passages repeated, inline numbered headings, mid-word truncated tail.
const messyLithiumSummary =
  "OFFICIAL Guideline Lithium Therapy- Initiation and Continuation Reference #: FSFHG-HW-GUI-0017 Scope Site " +
  "Service/Department/Unit Disciplines Fiona Stanley Hospital Hospital Wide Medical, Nursing, Pharmacy " +
  "Fremantle Hospital Lithium is a high-risk medication with a narrow therapeutic index. Careful patient " +
  "selection and monitoring is required to minimise the risk of lithium toxicity. 1. Introduction Hospital " +
  "Wide Medical, Nursing, Pharmacy Fremantle Hospital Lithium is a high-risk medication with a narrow " +
  "therapeutic index. Careful patient selection and monitoring is required to minimise the risk of lithium " +
  "toxicity. 1. Introduction Lithium has an established role in the treatment of a number of psychiatric " +
  "conditions, including prophylaxis of bipolar disorder (BD), acute mania and treatment-resistant depression. " +
  "The therapeutic effect occurs gradually and may take up to three weeks. Lithium is a narrow therapeutic " +
  "index drug. It is handled by the body in a similar way to sodium; most risk factors for toxicity relate to " +
  "changes in sodium levels and fluid status. therapeutic effect occurs gradually and may take up to three " +
  "weeks. Lithium is a narro";

describe("stripSummaryBoilerplate", () => {
  it("removes the glued document-header run while keeping the first clinical sentence", () => {
    const stripped = stripSummaryBoilerplate(
      "Guideline Lithium Therapy- Initiation and Continuation Reference #: FSFHG- Scope Site " +
        "Service/Department/Unit Disciplines Fiona Stanley Hospital Hospital Wide Medical, Nursing, Pharmacy " +
        "Fremantle Hospital Lithium is a high-risk medication with a narrow therapeutic index.",
    );
    expect(stripped).toBe("Lithium is a high-risk medication with a narrow therapeutic index.");
  });

  it("is idempotent", () => {
    const once = stripSummaryBoilerplate(
      "OFFICIAL Guideline Falls Prevention Reference #: ABCD-1234 Scope Site All adult inpatients must have a falls risk assessment.",
    );
    expect(stripSummaryBoilerplate(once)).toBe(once);
  });

  it("never strips sentences carrying clinical thresholds or actions", () => {
    const clinical = "Withhold lithium if the level is above 1.2 mmol/L and review within 24 hours.";
    expect(stripSummaryBoilerplate(clinical)).toBe(clinical);
    // A title-cased clinical opener is not consumed as a proper-noun run.
    const serumOpener = "Scope Serum Lithium Levels must be checked 12 hours post dose.";
    expect(stripSummaryBoilerplate(serumOpener)).toContain("must be checked 12 hours post dose");
  });

  it("leaves ordinary prose that merely mentions a document type untouched", () => {
    const prose = "Guideline recommendations include gradual titration and regular monitoring.";
    expect(stripSummaryBoilerplate(prose)).toBe(prose);
  });

  it("reverts rather than stripping a summary down to nothing", () => {
    const allBoilerplate =
      "Guideline North Metropolitan Health Service Community Directory And Contact Register Of Sites";
    expect(stripSummaryBoilerplate(allBoilerplate)).toBe(allBoilerplate);
  });
});

describe("dedupeSummarySentences", () => {
  it("drops exact and containment repeats, keeping the first occurrence", () => {
    const deduped = dedupeSummarySentences([
      "Lithium is a high-risk medication with a narrow therapeutic index.",
      "Careful patient selection and monitoring is required to minimise the risk of toxicity.",
      "Lithium is a high-risk medication with a narrow therapeutic index.",
      "careful patient selection and monitoring is required to minimise the risk of toxicity",
    ]);
    expect(deduped).toEqual([
      "Lithium is a high-risk medication with a narrow therapeutic index.",
      "Careful patient selection and monitoring is required to minimise the risk of toxicity.",
    ]);
  });

  it("keeps the later sentence when it extends a kept one with a threshold", () => {
    const deduped = dedupeSummarySentences([
      "Serum lithium levels should be checked 12 hours post dose.",
      "Check renal and thyroid function every six months.",
      "Serum lithium levels should be checked 12 hours post dose and lithium withheld if the level is above 1.5 mmol/L.",
    ]);
    expect(deduped).toEqual([
      "Serum lithium levels should be checked 12 hours post dose and lithium withheld if the level is above 1.5 mmol/L.",
      "Check renal and thyroid function every six months.",
    ]);
  });

  it("never replaces a complete sentence with a longer one cut off mid-thought", () => {
    const deduped = dedupeSummarySentences([
      "Serum lithium levels should be checked 12 hours post dose.",
      "Serum lithium levels should be checked 12 hours post dose and lithium withh",
    ]);
    expect(deduped).toEqual(["Serum lithium levels should be checked 12 hours post dose."]);
  });

  it("keeps short sentences that merely share a prefix", () => {
    const deduped = dedupeSummarySentences(["Monitor sodium.", "Monitor sodium and fluid status closely."]);
    expect(deduped).toHaveLength(2);
  });
});

describe("formatDocumentSummary", () => {
  it("keeps a later section's sentence that extends an earlier one, with its threshold", () => {
    const formatted = formatDocumentSummary(
      "Serum lithium levels should be checked 12 hours post dose. Check renal function regularly. " +
        "2. Monitoring Serum lithium levels should be checked 12 hours post dose and lithium withheld if the level is above 1.5 mmol/L.",
    );
    const text = [formatted.lead ?? "", ...formatted.sections.flatMap((section) => section.items)].join(" ");
    expect(text).toContain("withheld if the level is above 1.5 mmol/L");
    expect(text.match(/Serum lithium levels should be checked/g)).toHaveLength(1);
  });

  it("turns the messy stored summary into a structured, deduplicated model", () => {
    const formatted = formatDocumentSummary(messyLithiumSummary);

    expect(formatted.isEmpty).toBe(false);
    expect(formatted.lead).toContain("Lithium is a high-risk medication");

    const allText = [formatted.lead, ...formatted.sections.flatMap((section) => [section.heading, ...section.items])]
      .filter(Boolean)
      .join(" ");

    // Boilerplate gone.
    expect(allText).not.toContain("Reference #");
    expect(allText).not.toContain("FSFHG");
    expect(allText).not.toContain("Service/Department/Unit");
    expect(allText).not.toContain("Hospital Wide");
    expect(allText).not.toMatch(/^OFFICIAL/);

    // Repeats collapsed to a single occurrence.
    expect(allText.match(/high-risk medication with a narrow therapeutic index/g)).toHaveLength(1);
    expect(allText.match(/Careful patient selection/g)).toHaveLength(1);

    // Inline numbered heading became a real (merged) section.
    const introSections = formatted.sections.filter((section) => section.heading === "Introduction");
    expect(introSections).toHaveLength(1);
    expect(introSections[0].items.join(" ")).toContain("established role in the treatment");

    // Mid-word truncated tail removed and flagged.
    expect(allText).not.toMatch(/narro$/);
    expect(formatted.truncatedTail).toBe(true);
  });

  it("handles empty and null input", () => {
    expect(formatDocumentSummary(null).isEmpty).toBe(true);
    expect(formatDocumentSummary("   ").isEmpty).toBe(true);
    expect(formatDocumentSummary(undefined).sections).toEqual([]);
  });

  it("keeps a clean summary intact as lead plus key points", () => {
    const formatted = formatDocumentSummary(
      "This guideline covers clozapine initiation. Baseline FBC must be obtained before the first dose. " +
        "Weekly monitoring continues for 18 weeks.",
    );
    expect(formatted.lead).toBe(
      "This guideline covers clozapine initiation. Baseline FBC must be obtained before the first dose.",
    );
    expect(formatted.sections).toHaveLength(1);
    expect(formatted.sections[0].heading).toBeNull();
    expect(formatted.sections[0].items).toEqual(["Weekly monitoring continues for 18 weeks."]);
    expect(formatted.truncatedTail).toBe(false);
  });

  it("does not treat numbered cross-references as headings", () => {
    const formatted = formatDocumentSummary(
      "Doses are titrated based on serum lithium levels (refer to section 1.9. Therapeutic Drug Monitoring), tolerability and clinical response.",
    );
    expect(formatted.sections.every((section) => section.heading === null)).toBe(true);
  });

  it("keeps a complete final sentence that merely lacks terminal punctuation", () => {
    // Regression: an unpunctuated but complete, unique final sentence must not be
    // fabricated into an ellipsis, truncated, or flagged as trimmed.
    const formatted = formatDocumentSummary(
      "This guideline covers clozapine initiation. Weekly monitoring continues for 18 weeks",
    );
    const allText = [formatted.lead, ...formatted.sections.flatMap((s) => s.items)].filter(Boolean).join(" ");
    expect(allText).toContain("Weekly monitoring continues for 18 weeks");
    expect(allText).not.toMatch(/…$/);
    expect(formatted.truncatedTail).toBe(false);
  });

  it("drops a no-ellipsis final fragment that is a cut-off repeat of a full sentence", () => {
    // "…is a narro" is a prefix of the earlier full "…is a narrow therapeutic
    // index drug." sentence — a truncated repeat that must be removed and flagged,
    // even without a trailing ellipsis.
    const formatted = formatDocumentSummary(
      "Lithium is a narrow therapeutic index drug. Monitor serum levels every three months. Lithium is a narro",
    );
    const allText = [formatted.lead, ...formatted.sections.flatMap((s) => s.items)].filter(Boolean).join(" ");
    expect(allText).toContain("narrow therapeutic index drug");
    expect(allText).not.toMatch(/is a narro$/);
    expect(formatted.truncatedTail).toBe(true);
  });

  it("repairs an explicit trailing-ellipsis truncation", () => {
    const formatted = formatDocumentSummary(
      "Baseline renal and thyroid function must be checked. Doses are titrated to serum lithium levels which should be measured where poss...",
    );
    const allText = [formatted.lead, ...formatted.sections.flatMap((s) => s.items)].filter(Boolean).join(" ");
    expect(allText).not.toMatch(/where poss/);
    expect(formatted.truncatedTail).toBe(true);
  });
});
