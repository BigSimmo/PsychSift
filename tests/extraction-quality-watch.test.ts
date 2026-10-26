import { describe, expect, it } from "vitest";

import { describeExtractionQuality } from "../scripts/ingestion-autopilot";
import { assessExtractionQuality, extractionQualityCountsFrom } from "@/lib/extraction-quality-watch";

describe("extraction quality watch (audit 2026-10-24 EM-N6)", () => {
  it("raises nothing for a healthy library", () => {
    expect(assessExtractionQuality({ good: 40, partial: 8, poor: 2, unknown: 5 })).toEqual({
      assessed: 50,
      poorShare: 0.04,
      warning: null,
    });
  });

  it("warns when a fifth or more of assessed documents read poorly", () => {
    const verdict = assessExtractionQuality({ good: 6, partial: 2, poor: 2, unknown: 0 });
    expect(verdict.poorShare).toBe(0.2);
    expect(verdict.warning).toBe("2 of 10 assessed documents (20%) have a poor extraction");
  });

  it("does not judge a share across too few documents", () => {
    expect(assessExtractionQuality({ good: 1, partial: 0, poor: 2, unknown: 0 }).warning).toBeNull();
  });

  it("warns on a rise over a supplied baseline even below the absolute threshold", () => {
    const verdict = assessExtractionQuality(
      { good: 88, partial: 0, poor: 12, unknown: 0 },
      { baselinePoorShare: 0.05 },
    );
    expect(verdict.warning).toBe("poor extractions rose from 5% to 12% of 100 assessed documents");
    expect(
      assessExtractionQuality({ good: 94, partial: 0, poor: 6, unknown: 0 }, { baselinePoorShare: 0.05 }).warning,
    ).toBeNull();
  });

  it("warns on a rise of exactly the threshold despite floating-point rounding", () => {
    expect(
      assessExtractionQuality({ good: 85, partial: 0, poor: 15, unknown: 0 }, { baselinePoorShare: 0.1 }).warning,
    ).toBe("poor extractions rose from 10% to 15% of 100 assessed documents");
  });

  it("never lets an unreadable count read as no poor documents", () => {
    expect(assessExtractionQuality({ good: 10, partial: 0, poor: null, unknown: 0 })).toEqual({
      assessed: null,
      poorShare: null,
      warning: "extraction quality counts unavailable",
    });
  });

  it("treats unknown as not assessed", () => {
    expect(assessExtractionQuality({ good: 0, partial: 0, poor: 0, unknown: 30 })).toEqual({
      assessed: 0,
      poorShare: null,
      warning: null,
    });
  });

  it("reads counts from a reindex-health payload and skips older payloads", () => {
    expect(extractionQualityCountsFrom({ jobs_failed: 0 })).toBeNull();
    expect(
      extractionQualityCountsFrom({
        quality_extraction_good: 3,
        quality_extraction_partial: 1,
        quality_extraction_poor: null,
        quality_extraction_unknown: 0,
      }),
    ).toEqual({ good: 3, partial: 1, poor: null, unknown: 0 });
  });

  it("gives the autopilot one plain line for its run summary", () => {
    const counts = (poor: number) => ({
      quality_extraction_good: 10,
      quality_extraction_partial: 0,
      quality_extraction_poor: poor,
      quality_extraction_unknown: 0,
    });
    expect(describeExtractionQuality({ counts: counts(1) })).toBe(
      "[autopilot] extraction quality: 1 poor of 11 assessed",
    );
    expect(describeExtractionQuality({ counts: counts(5) })).toBe(
      "[autopilot] WARNING extraction quality: 5 of 15 assessed documents (33%) have a poor extraction",
    );
    expect(describeExtractionQuality({ counts: {} })).toBeNull();
  });

  it("warns on a poor recent batch that the whole-library share hides", () => {
    const health = {
      counts: {
        quality_extraction_good: 10_000,
        quality_extraction_partial: 0,
        quality_extraction_poor: 100,
        quality_extraction_unknown: 0,
        quality_recent_extraction_good: 20,
        quality_recent_extraction_partial: 0,
        quality_recent_extraction_poor: 100,
        quality_recent_extraction_unknown: 0,
      },
    };
    expect(describeExtractionQuality(health)).toMatch(
      /^\[autopilot\] WARNING extraction quality \(recently assessed\)/,
    );
  });
});
