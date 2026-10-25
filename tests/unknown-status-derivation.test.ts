import { describe, expect, it } from "vitest";
import {
  UNKNOWN_STATUS_DERIVATION_VERSION,
  deriveUnknownStatus,
  parseIsoDate,
  unknownStatusDerivationBasis,
} from "../src/lib/unknown-status-derivation";

const NOW = new Date("2026-07-08T00:00:00+08:00");

describe("deriveUnknownStatus", () => {
  it("infers a review date one cycle after publication and marks recent docs current", () => {
    const result = deriveUnknownStatus("2025-01-01", { now: NOW });
    expect(result).toEqual({ kind: "derived", reviewDate: "2028-01-01", status: "current" });
  });

  it("marks docs review_due when the inferred review date has passed", () => {
    const result = deriveUnknownStatus("2020-06-01", { now: NOW });
    expect(result).toEqual({ kind: "derived", reviewDate: "2023-06-01", status: "review_due" });
  });

  it("treats the inferred review date as end-of-day in Perth (boundary is inclusive)", () => {
    // publication + 3y lands exactly on 'today' → still current, not review_due.
    const result = deriveUnknownStatus("2023-07-08", { now: NOW });
    expect(result).toEqual({ kind: "derived", reviewDate: "2026-07-08", status: "current" });
  });

  it("honours a custom review cycle length", () => {
    const result = deriveUnknownStatus("2024-01-01", { reviewCycleYears: 1, now: NOW });
    expect(result).toEqual({ kind: "derived", reviewDate: "2025-01-01", status: "review_due" });
  });

  it("lands a leap-day publication on 28 February in a non-leap review year", () => {
    const shortened = deriveUnknownStatus("2024-02-29", { now: NOW });
    expect(shortened).toEqual({ kind: "derived", reviewDate: "2027-02-28", status: "current" });
    if (shortened.kind === "derived") expect(parseIsoDate(shortened.reviewDate)).not.toBeNull();

    const leapToLeap = deriveUnknownStatus("2020-02-29", { reviewCycleYears: 4, now: NOW });
    expect(leapToLeap).toEqual({ kind: "derived", reviewDate: "2024-02-29", status: "review_due" });
  });

  it("skips documents with no publication date", () => {
    expect(deriveUnknownStatus(null, { now: NOW })).toEqual({ kind: "skip", reason: "no_publication_date" });
    expect(deriveUnknownStatus("", { now: NOW })).toEqual({ kind: "skip", reason: "no_publication_date" });
  });

  it("skips unparseable or non-calendar publication dates", () => {
    expect(deriveUnknownStatus("June 2024", { now: NOW })).toEqual({
      kind: "skip",
      reason: "unparseable_publication_date",
    });
    expect(deriveUnknownStatus("2024-13-01", { now: NOW })).toEqual({
      kind: "skip",
      reason: "unparseable_publication_date",
    });
    expect(deriveUnknownStatus("2024-02-30", { now: NOW })).toEqual({
      kind: "skip",
      reason: "unparseable_publication_date",
    });
  });

  it("refuses to fabricate a status from a future (mis-extracted) publication date", () => {
    expect(deriveUnknownStatus("2028-04-01", { now: NOW })).toEqual({
      kind: "skip",
      reason: "future_publication_date",
    });
  });
});

describe("shared derivation stamps", () => {
  it("exposes a stable version stamp", () => {
    expect(UNKNOWN_STATUS_DERIVATION_VERSION).toBe("unknown_status_cycle_v1");
  });

  it("builds a basis string that names the cycle length", () => {
    expect(unknownStatusDerivationBasis()).toContain("3-year");
    expect(unknownStatusDerivationBasis(5)).toContain("5-year");
    expect(unknownStatusDerivationBasis()).toContain("no explicit review date");
  });
});
describe("parseIsoDate", () => {
  it("parses strict ISO dates and rejects everything else", () => {
    expect(parseIsoDate("2025-01-31")).toEqual({ year: 2025, month: 1, day: 31 });
    expect(parseIsoDate("2025-1-1")).toBeNull();
    expect(parseIsoDate("2025-02-29")).toBeNull();
    expect(parseIsoDate(20250101)).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });
});
