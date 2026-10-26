import { describe, expect, it } from "vitest";
import { expectedFileCoverage, expectedFileHit } from "../scripts/eval-utils";
import { parseArgs, summarizeFailures, type SearchEvalResult } from "../scripts/eval-search";

function result(overrides: Partial<SearchEvalResult> = {}): SearchEvalResult {
  return {
    id: "custom-question",
    question: "agitation and arousal",
    category: "routine",
    supported: true,
    expectedFileCount: 1,
    expectedHitTop3: true,
    expectedAllHitTop5: null,
    missingExpectedFiles: [],
    resultCount: 1,
    payloadBytes: 1200,
    topScore: 0.97,
    topFiles: ["MHSP.AgitationArousalPharmaMgt.pdf"],
    latencyMs: 300,
    retrievalStrategy: "text_fast_path",
    queryClass: "medication_dose_risk",
    searchCacheHit: false,
    embeddingSkipped: true,
    embeddingSkipReason: "text_fast_path",
    embeddingCacheHit: false,
    fallbackToEmbedding: false,
    textCandidateBudget: 40,
    textFastPathReason: "dose_evidence_text_match",
    visualEvidence: 0,
    latencyTargetMs: 2000,
    relevanceGrade: "direct",
    failures: [],
    ...overrides,
  };
}

describe("search eval thresholds", () => {
  it("does not count unsupported cases with no expected files as expected hits", () => {
    expect(
      expectedFileHit(
        [],
        [
          {
            title: "Clozapine Prescribing Administration Monitoring",
            file_name: "CG.MHSP.ClozapinePresAdminMonitor.pdf",
          },
        ],
      ),
    ).toBe(false);
    expect(
      expectedFileCoverage(
        [],
        [
          {
            title: "Clozapine Prescribing Administration Monitoring",
            file_name: "CG.MHSP.ClozapinePresAdminMonitor.pdf",
          },
        ],
      ).allHit,
    ).toBe(false);
  });

  it("requires all expected files for multi-document coverage", () => {
    const partial = expectedFileCoverage(
      ["MHSP.AdmissionCommunityPts.pdf", "MHSP.Discharge.pdf"],
      [{ title: "Discharge", file_name: "MHSP.Discharge.pdf" }],
      5,
    );

    expect(partial.anyHit).toBe(true);
    expect(partial.allHit).toBe(false);
    expect(partial.missingFiles).toEqual(["MHSP.AdmissionCommunityPts.pdf"]);
  });

  it("matches legacy eval expectations to current clinical source filenames", () => {
    expect(
      expectedFileHit(
        ["MHSP.NeurolepticSideEffect.pdf"],
        [{ title: "Neuroleptic Side Effects(AKG)", file_name: "Neuroleptic Side Effects (AKG).pdf" }],
      ),
    ).toBe(true);

    expect(
      expectedFileHit(
        ["CG.MHSP.ClozapinePresAdminMonitor.pdf"],
        [{ title: "Clozapine GP Shared Care(FSH)", file_name: "Clozapine GP Shared Care (FSH).pdf" }],
      ),
    ).toBe(true);

    expect(
      expectedFileHit(
        ["MHSP.Discharge.pdf"],
        [
          {
            title: "Admission to Discharge for Mental Health Inpatients",
            file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
          },
        ],
      ),
    ).toBe(true);

    expect(
      expectedFileHit(
        ["MHSP.Discharge.pdf"],
        [
          {
            title: "Referral, Admission and Discharge - Mental Health Hospital in the Home Policy and Procedure",
            file_name:
              "Referral, Admission and Discharge - Mental Health Hospital in the Home (MHHITH) Policy and Procedure (RKPG).pdf",
          },
        ],
      ),
    ).toBe(true);

    expect(
      expectedFileHit(
        ["MHSP.Discharge.pdf"],
        [{ title: "Criteria-Led Discharge", file_name: "Criteria-Led Discharge (NMHS).pdf" }],
      ),
    ).toBe(false);
  });

  it("does not apply full-suite aggregate hit thresholds to a targeted question run", () => {
    expect(summarizeFailures([result()])).toEqual([]);
  });

  it("still reports case-level failures for targeted question runs", () => {
    expect(summarizeFailures([result({ failures: ["expected document not in top 3"] })])).toContain(
      "supported case-level search failure(s)",
    );
  });

  it("reports multi-document case-level failures when only one expected file is present", () => {
    expect(
      summarizeFailures([
        result({
          expectedFileCount: 2,
          expectedHitTop3: true,
          expectedAllHitTop5: false,
          missingExpectedFiles: ["MHSP.AdmissionCommunityPts.pdf"],
          failures: ["expected documents missing from top 5: MHSP.AdmissionCommunityPts.pdf"],
        }),
      ]),
    ).toContain("supported case-level search failure(s)");
  });
});

describe("search eval arguments", () => {
  it("parses the known options", () => {
    const args = parseArgs(["--limit", "5", "--question", "lithium", "--json"]);
    expect(args.limit).toBe(5);
    expect(args.question).toBe("lithium");
    expect(args.json).toBe(true);
  });

  it("rejects an unknown or misspelled option instead of silently using defaults", () => {
    expect(() => parseArgs(["--limt", "5"])).toThrow("Unknown option --limt");
  });
});
