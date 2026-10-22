import { describe, expect, it } from "vitest";
import {
  australianSourceTier,
  selectAustralianClinicalContext,
  summarizeAustralianSourceSelection,
} from "../src/lib/australian-source-priority";
import type { ClinicalSourceMetadata, SearchResult } from "../src/lib/types";

function relevance(verdict: "direct" | "partial") {
  return {
    verdict,
    label: verdict === "direct" ? "Direct" : "Partial",
    matchedTerms: [],
    missingTerms: [],
    directSourceCount: verdict === "direct" ? 1 : 0,
    weakSourceCount: verdict === "direct" ? 0 : 1,
    score: verdict === "direct" ? 1 : 0.5,
    supportReason: "",
    isSourceBacked: true,
    coverageScore: verdict === "direct" ? 1 : 0.5,
    rankScore: verdict === "direct" ? 1 : 0.5,
    titleMatchedTerms: [],
    contentMatchedTerms: [],
    metadataMatchedTerms: [],
    chips: [],
  } satisfies NonNullable<SearchResult["relevance"]>;
}

function result(args: {
  id: string;
  similarity: number;
  role: ClinicalSourceMetadata["source_role"];
  relevance?: SearchResult["relevance"];
}): SearchResult {
  return {
    id: args.id,
    document_id: `doc-${args.id}`,
    title: args.id,
    file_name: `${args.id}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: "Clinical evidence",
    image_ids: [],
    similarity: args.similarity,
    relevance: args.relevance,
    source_metadata: {
      source_kind: "document",
      source_title: args.id,
      publisher: "WA Health",
      publisher_code: "WAHEALTH",
      jurisdiction: "Australia/WA",
      version: "1",
      publication_date: "2026-01-01",
      review_date: "2027-01-01",
      uploaded_at: "2026-01-01T00:00:00Z",
      indexed_at: "2026-01-01T00:00:00Z",
      uploaded_by: null,
      corpus_scope: "uploaded_local",
      source_role: args.role,
      content_mode: "indexed_content",
      change_state: "unchanged",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    images: [],
  };
}

function australianResult(args: {
  id: string;
  verdict: "direct" | "partial";
  publisher: string;
  publisherCode: string;
  jurisdiction: string;
}) {
  const candidate = result({
    id: args.id,
    similarity: args.verdict === "direct" ? 1 : 0.5,
    role: "clinical_guideline",
    relevance: relevance(args.verdict),
  });
  return {
    ...candidate,
    corpus_scope: "australian_public" as const,
    source_metadata: {
      ...candidate.source_metadata!,
      corpus_scope: "australian_public" as const,
      publisher: args.publisher,
      publisher_code: args.publisherCode,
      jurisdiction: args.jurisdiction,
    },
  };
}

describe("selectAustralianClinicalContext role eligibility", () => {
  it("filters role-ineligible evidence before applying the existing relevance ordering", () => {
    const treatmentLow = result({
      id: "treatment-low",
      similarity: 0.5,
      role: "clinical_guideline",
      relevance: relevance("partial"),
    });
    const treatmentHigh = result({
      id: "treatment-high",
      similarity: 0.9,
      role: "local_guideline",
      relevance: relevance("direct"),
    });
    const subsidyDirect = result({
      id: "subsidy-direct",
      similarity: 1,
      role: "subsidy",
      relevance: relevance("direct"),
    });

    expect(
      selectAustralianClinicalContext([treatmentLow, subsidyDirect, treatmentHigh], {
        claimRole: "treatment",
        omitSupplementaryPadding: false,
      }).map((item) => item.id),
    ).toEqual(["treatment-high", "treatment-low"]);
  });

  it("preserves the existing order when all candidates are role eligible", () => {
    const partialFirst = result({
      id: "partial-first",
      similarity: 0.7,
      role: "clinical_guideline",
      relevance: relevance("partial"),
    });
    const directSecond = result({
      id: "direct-second",
      similarity: 0.6,
      role: "local_guideline",
      relevance: relevance("direct"),
    });

    const legacy = selectAustralianClinicalContext([partialFirst, directSecond], {
      omitSupplementaryPadding: false,
    }).map((item) => item.id);
    const governed = selectAustralianClinicalContext([partialFirst, directSecond], {
      claimRole: "treatment",
      omitSupplementaryPadding: false,
    }).map((item) => item.id);

    expect(governed).toEqual(legacy);
  });

  it("orders Australian evidence by relevance, authority tier, then input order", () => {
    const stateDirect = australianResult({
      id: "state-direct",
      verdict: "direct",
      publisher: "NSW Health",
      publisherCode: "NSWHEALTH",
      jurisdiction: "Australia/NSW",
    });
    const waPartial = australianResult({
      id: "wa-partial",
      verdict: "partial",
      publisher: "WA Health",
      publisherCode: "WAHEALTH",
      jurisdiction: "Australia/WA",
    });
    const waDirectFirst = australianResult({
      id: "wa-direct-first",
      verdict: "direct",
      publisher: "WA Health",
      publisherCode: "WAHEALTH",
      jurisdiction: "Australia/WA",
    });
    const waDirectSecond = australianResult({
      id: "wa-direct-second",
      verdict: "direct",
      publisher: "WA Health",
      publisherCode: "WAHEALTH",
      jurisdiction: "Australia/WA",
    });

    expect(
      selectAustralianClinicalContext([stateDirect, waPartial, waDirectFirst, waDirectSecond], {
        omitSupplementaryPadding: false,
      }).map((item) => item.id),
    ).toEqual(["wa-direct-first", "wa-direct-second", "state-direct", "wa-partial"]);
  });
});

// Owner tier rule (Josh, 2026-09-25, ledger #BFCTST): WA validated, then Australian national, then
// other Australian states, then supplementary, applied only inside a relevance band. These tests pin
// the rule itself so a change to the registry or the comparator cannot reorder tiers unnoticed.
describe("owner source tier rule (#BFCTST)", () => {
  const wa = (id: string, verdict: "direct" | "partial" = "direct") =>
    australianResult({ id, verdict, publisher: "WA Health", publisherCode: "WAHEALTH", jurisdiction: "Australia/WA" });
  const national = (id: string, verdict: "direct" | "partial" = "direct") =>
    australianResult({
      id,
      verdict,
      publisher: "Australian Commission on Safety and Quality in Health Care",
      publisherCode: "ACSQHC",
      jurisdiction: "Australia",
    });
  const state = (id: string, verdict: "direct" | "partial" = "direct") =>
    australianResult({
      id,
      verdict,
      publisher: "NSW Health",
      publisherCode: "NSWHEALTH",
      jurisdiction: "Australia/NSW",
    });
  const supplementary = (id: string, verdict: "direct" | "partial" = "direct") =>
    australianResult({
      id,
      verdict,
      publisher: "Substance Abuse and Mental Health Services Administration",
      publisherCode: "SAMHSA",
      jurisdiction: "United States",
    });
  const order = (results: SearchResult[]) =>
    selectAustralianClinicalContext(results, { omitSupplementaryPadding: false, limit: 10 }).map((item) => item.id);

  it("classifies each sample publisher into the tier the rule names", () => {
    expect(australianSourceTier(wa("wa"))).toBe("wa_validated");
    expect(australianSourceTier(national("national"))).toBe("australian_national");
    expect(australianSourceTier(state("state"))).toBe("australian_state");
    expect(australianSourceTier(supplementary("supplementary"))).toBe("supplementary");
  });

  it("puts WA ahead of national, national ahead of other states, and supplementary last at equal relevance", () => {
    expect(order([supplementary("supplementary"), state("state"), national("national"), wa("wa")])).toEqual([
      "wa",
      "national",
      "state",
      "supplementary",
    ]);
  });

  it("never lets a tier outrank a more relevant source", () => {
    expect(order([wa("wa-partial", "partial"), national("national-direct")])).toEqual([
      "national-direct",
      "wa-partial",
    ]);
    expect(order([national("national-partial", "partial"), state("state-direct")])).toEqual([
      "state-direct",
      "national-partial",
    ]);
  });

  it("drops supplementary padding once two Australian documents carry enough equally relevant evidence", () => {
    const selected = selectAustralianClinicalContext(
      [supplementary("supplementary"), wa("wa-1"), wa("wa-2"), national("national-1"), national("national-2")],
      { limit: 10 },
    ).map((item) => item.id);
    expect(selected).toEqual(["wa-1", "wa-2", "national-1", "national-2"]);
  });

  it("keeps supplementary evidence when Australian evidence is not sufficient on its own", () => {
    const selected = selectAustralianClinicalContext([supplementary("supplementary"), wa("wa-1")], { limit: 10 }).map(
      (item) => item.id,
    );
    expect(selected).toEqual(["wa-1", "supplementary"]);
  });

  it("counts WA and supplementary documents in the selection summary", () => {
    const candidates = [wa("wa-1"), national("national-1"), supplementary("supplementary")];
    const summary = summarizeAustralianSourceSelection(candidates, candidates.slice(0, 2));
    expect(summary).toMatchObject({
      candidateCount: 3,
      selectedCount: 2,
      australianCandidateCount: 2,
      waCandidateCount: 1,
      waSelectedCount: 1,
      usedSupplementaryFallback: false,
    });
  });
});
