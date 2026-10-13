import { describe, expect, it } from "vitest";

import therapies from "../src/data/therapies-source.json";
import {
  extractNiceGuidelineDetails,
  isLaterAddedNiceReference,
  splitSourceCitations,
  therapyNiceGuidelineMetadata,
  therapySourceMetadata,
} from "@/lib/therapy-source-governance";

describe("therapy source governance", () => {
  const source = { title: "Example guideline", sourceType: "Guideline", reference: "Ref 12" };

  it("keeps imported source currency, designation and extraction quality unknown", () => {
    expect(therapySourceMetadata(source, "needs_review")).toMatchObject({
      source_title: "Example guideline",
      registry_record_subkind: null,
      publisher: null,
      document_status: "unknown",
      clinical_validation_status: "unverified",
      extraction_quality: "unknown",
    });
  });

  it("only maps an explicitly reviewed record to local review", () => {
    expect(therapySourceMetadata(source, "reviewed").clinical_validation_status).toBe("locally_reviewed");
  });

  it("identifies later-added NICE guideline citations from the 2026-10-09 sweep", () => {
    const laterAddedSample =
      'Psychosis and schizophrenia in adults, recommendation 1.1.5.1: "Consider peer support for people with psychosis or schizophrenia to help improve service user experience and quality of life." https://www.nice.org.uk/guidance/cg178/chapter/Recommendations. (NICE CG178) These references were added on 9 October 2026 from guidelines held in the source register, each checked against the publisher\'s own recommendations page. They were not part of the original import, and the guidelines themselves are still awaiting adoption in the register.';

    expect(isLaterAddedNiceReference(laterAddedSample)).toBe(true);
    expect(isLaterAddedNiceReference("Imported reference. (PubMed)")).toBe(false);
    expect(isLaterAddedNiceReference(null)).toBe(false);
    expect(isLaterAddedNiceReference(undefined)).toBe(false);

    const laterAddedRecords = therapies.filter((t) => t.sources.some((s) => isLaterAddedNiceReference(s.reference)));
    expect(laterAddedRecords).toHaveLength(22);
  });

  it("extracts structured guideline details from a NICE recommendation citation", () => {
    const citationText =
      'Psychosis and schizophrenia in adults, recommendation 1.1.5.1: "Consider peer support." https://www.nice.org.uk/guidance/cg178/chapter/Recommendations.';
    const details = extractNiceGuidelineDetails(citationText, "NICE CG178");

    expect(details.title).toBe("NICE guideline: Psychosis and schizophrenia in adults (CG178)");
    expect(details.authorityCode).toBe("CG178");
    expect(details.canonicalUrl).toBe("https://www.nice.org.uk/guidance/cg178/chapter/Recommendations");
  });

  it("constructs explicit clinical source metadata for NICE guidelines", () => {
    const metadata = therapyNiceGuidelineMetadata(
      {
        authority: "NICE NG222",
        text: "Depression in adults: treatment and management, lists individual problem-solving. https://www.nice.org.uk/guidance/ng222/chapter/recommendations.",
      },
      "needs_review",
    );

    expect(metadata).toMatchObject({
      source_kind: "guideline",
      source_title: "NICE guideline: Depression in adults: treatment and management (NG222)",
      publisher: "National Institute for Health and Care Excellence",
      publisher_code: "NICE",
      jurisdiction: "United Kingdom",
      version: "NG222",
      clinical_validation_status: "unverified",
      canonical_url: "https://www.nice.org.uk/guidance/ng222/chapter/recommendations",
    });
  });

  it("splits citations and extracts trailing non-clinical notes", () => {
    const text =
      "Recommendation 1. (NICE NG222) Recommendation 2. (NICE NG225) These references were added on 9 October 2026.";
    const { citations, notes } = splitSourceCitations(text);

    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({ text: "Recommendation 1.", authority: "NICE NG222" });
    expect(citations[1]).toEqual({ text: "Recommendation 2.", authority: "NICE NG225" });
    expect(notes).toEqual(["These references were added on 9 October 2026."]);
  });
});
