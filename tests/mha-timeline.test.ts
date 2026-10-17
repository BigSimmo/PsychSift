import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import mhaTimeframes from "../data/mha-timeframes.json";
import {
  computeDeadline,
  formatPerthDateTime,
  hasMhaTimeline,
  isReviewedTimeframe,
  parsePerthDateTimeInput,
  sha256Hex,
  timeframeContentSha256,
  timelineFor,
  type MhaTimeframeEntry,
  type MhaTimeframesFile,
} from "@/lib/mha-timeline";

/**
 * The engine behind the form-page timeline. The fixtures below use invented quotes on purpose:
 * this file tests arithmetic and gating, never statutory content (that is the contract test's
 * job, against the pinned Act text).
 */

function entry(overrides: Partial<MhaTimeframeEntry>): MhaTimeframeEntry {
  return {
    id: "fixture",
    formCodes: ["X1"],
    trigger: "Fixture trigger",
    section: "1",
    sourceTextSha256: "a".repeat(64),
    quote: "fixture quote",
    duration: { value: 24, unit: "hours" },
    anchor: "Fixture anchor",
    status: "drafted",
    reviewedBy: null,
    reviewedAt: null,
    reviewedContentSha256: null,
    ...overrides,
  };
}

/** A correctly signed fixture: status, named reviewer, UTC time and a matching content pin. */
function reviewed(overrides: Partial<MhaTimeframeEntry>): MhaTimeframeEntry {
  const next = entry({
    status: "reviewed",
    reviewedBy: "Fixture Reviewer",
    reviewedAt: "2026-09-25T02:00:00Z",
    ...overrides,
  });
  return { ...next, reviewedContentSha256: timeframeContentSha256(next) };
}

const perth = (wallTime: string) => new Date(`${wallTime}+08:00`);

describe("computeDeadline", () => {
  it("adds hours as elapsed time", () => {
    expect(computeDeadline(entry({ duration: { value: 72, unit: "hours" } }), perth("2026-09-25T10:00:00"))).toEqual(
      perth("2026-09-28T10:00:00"),
    );
    expect(computeDeadline(entry({ duration: { value: 6, unit: "hours" } }), perth("2026-09-25T21:45:00"))).toEqual(
      perth("2026-09-26T03:45:00"),
    );
  });

  it("keeps seconds and milliseconds of the start", () => {
    expect(computeDeadline(entry({ duration: { value: 2, unit: "hours" } }), perth("2026-09-25T10:00:30.500"))).toEqual(
      perth("2026-09-25T12:00:30.500"),
    );
    expect(computeDeadline(entry({ duration: { value: 1, unit: "days" } }), perth("2026-09-25T10:00:30.500"))).toEqual(
      perth("2026-09-26T10:00:30.500"),
    );
  });

  it("adds days as Perth calendar days at the same Perth wall time", () => {
    const oneDay = entry({ duration: { value: 1, unit: "days" } });
    // Month end.
    expect(computeDeadline(oneDay, perth("2027-01-31T09:15:00"))).toEqual(perth("2027-02-01T09:15:00"));
    expect(computeDeadline(oneDay, perth("2026-09-30T23:30:00"))).toEqual(perth("2026-10-01T23:30:00"));
    // Year end.
    expect(computeDeadline(oneDay, perth("2026-12-31T18:00:00"))).toEqual(perth("2027-01-01T18:00:00"));
    // Just after Perth midnight, while the UTC calendar still reads the previous day.
    expect(computeDeadline(oneDay, perth("2026-02-01T00:30:00"))).toEqual(perth("2026-02-02T00:30:00"));
  });

  it("handles 29 February", () => {
    const oneDay = entry({ duration: { value: 1, unit: "days" } });
    expect(computeDeadline(oneDay, perth("2028-02-28T22:00:00"))).toEqual(perth("2028-02-29T22:00:00"));
    expect(computeDeadline(oneDay, perth("2028-02-29T08:00:00"))).toEqual(perth("2028-03-01T08:00:00"));
    // Not a leap year: 28 February is followed by 1 March.
    expect(computeDeadline(oneDay, perth("2027-02-28T08:00:00"))).toEqual(perth("2027-03-01T08:00:00"));
    // A multi-day span across a leap day counts it.
    expect(computeDeadline(entry({ duration: { value: 14, unit: "days" } }), perth("2028-02-20T12:00:00"))).toEqual(
      perth("2028-03-05T12:00:00"),
    );
    expect(computeDeadline(entry({ duration: { value: 14, unit: "days" } }), perth("2027-02-20T12:00:00"))).toEqual(
      perth("2027-03-06T12:00:00"),
    );
  });

  it("refuses an invalid start instant rather than returning a wrong time", () => {
    expect(() => computeDeadline(entry({}), new Date("not a date"))).toThrow(/invalid start/);
  });
});

describe("timelineFor", () => {
  const start = perth("2026-09-25T10:00:00");
  const fixtures: MhaTimeframeEntry[] = [
    reviewed({ id: "long", formCodes: ["X1"], duration: { value: 3, unit: "days" } }),
    entry({ id: "drafted-short", formCodes: ["X1", "X2"], duration: { value: 6, unit: "hours" } }),
    reviewed({ id: "mid", formCodes: ["X1"], duration: { value: 24, unit: "hours" } }),
    reviewed({ id: "other-form", formCodes: ["X2"], duration: { value: 1, unit: "hours" } }),
  ];

  it("returns only the form's entries, shortest period first", () => {
    expect(timelineFor("X1", start, fixtures).map((item) => item.entry.id)).toEqual(["drafted-short", "mid", "long"]);
    expect(timelineFor("X2", start, fixtures).map((item) => item.entry.id)).toEqual(["other-form", "drafted-short"]);
  });

  it("keeps file order for equal periods", () => {
    const tied = [
      entry({ id: "a", duration: { value: 24, unit: "hours" } }),
      entry({ id: "b", duration: { value: 1, unit: "days" } }),
      entry({ id: "c", duration: { value: 24, unit: "hours" } }),
    ];
    expect(timelineFor("X1", start, tied).map((item) => item.entry.id)).toEqual(["a", "b", "c"]);
  });

  it("matches the form code case- and space-insensitively", () => {
    expect(timelineFor(" x1 ", start, fixtures)).toHaveLength(3);
  });

  it("returns an empty list for a form with no entries", () => {
    expect(timelineFor("NOPE", start, fixtures)).toEqual([]);
  });

  it("gives a drafted entry its quote only, never a time", () => {
    const [item] = timelineFor("X1", start, fixtures);
    expect(item.entry.id).toBe("drafted-short");
    expect(item.quoteOnly).toBe(true);
    expect(item).toEqual(expect.objectContaining({ reason: "awaiting-review" }));
    expect(item).not.toHaveProperty("deadline");
  });

  it("gives a reviewed entry its computed instant", () => {
    const items = timelineFor("X1", start, fixtures);
    const mid = items.find((item) => item.entry.id === "mid");
    const long = items.find((item) => item.entry.id === "long");
    expect(mid).toEqual(expect.objectContaining({ quoteOnly: false, deadline: perth("2026-09-26T10:00:00") }));
    expect(long).toEqual(expect.objectContaining({ quoteOnly: false, deadline: perth("2026-09-28T10:00:00") }));
  });

  it("gives a reviewed entry no instant until a start is entered", () => {
    const mid = timelineFor("X1", null, fixtures).find((item) => item.entry.id === "mid");
    expect(mid).toEqual(expect.objectContaining({ quoteOnly: false, deadline: null }));
  });

  it("fails closed: a sign-off that is incomplete, not UTC, or no longer matches is treated as drafted", () => {
    const good = reviewed({ id: "good" });
    expect(isReviewedTimeframe(good)).toBe(true);
    const unsigned = [
      { ...good, id: "no-name", reviewedBy: null },
      { ...good, id: "blank-name", reviewedBy: "  " },
      { ...good, id: "no-date", reviewedAt: null },
      { ...good, id: "date-only", reviewedAt: "2026-09-25" },
      { ...good, id: "offset-time", reviewedAt: "2026-09-25T10:00:00+08:00" },
      { ...good, id: "no-pin", reviewedContentSha256: null },
      { ...good, id: "wrong-pin", reviewedContentSha256: "0".repeat(64) },
      // Edited after sign-off: the pin was computed over the old content.
      { ...good, quote: "an edited fixture quote" },
      { ...good, duration: { value: 48, unit: "hours" as const } },
      { ...good, sourceTextSha256: "b".repeat(64) },
      { ...good, status: "drafted" as const },
    ];
    for (const candidate of unsigned) expect(isReviewedTimeframe(candidate), JSON.stringify(candidate)).toBe(false);
    for (const item of timelineFor("X1", start, unsigned)) {
      expect(item).toEqual(
        expect.objectContaining({ quoteOnly: true, reason: "awaiting-review", awaitingReview: true }),
      );
    }
  });

  it("never calculates a computeAllowed:false entry, even when correctly signed", () => {
    const blocked = reviewed({ id: "blocked", computeAllowed: false });
    expect(isReviewedTimeframe(blocked)).toBe(true);
    const [item] = timelineFor("X1", start, [blocked]);
    expect(item).toEqual(expect.objectContaining({ quoteOnly: true, reason: "not-calculable", awaitingReview: false }));
    // The same entry unsigned is still not calculable, and says it is awaiting review too.
    const [drafted] = timelineFor("X1", start, [
      { ...blocked, status: "drafted" as const, reviewedBy: null, reviewedAt: null, reviewedContentSha256: null },
    ]);
    expect(drafted).toEqual(
      expect.objectContaining({ quoteOnly: true, reason: "not-calculable", awaitingReview: true }),
    );
    expect(item).not.toHaveProperty("deadline");
    // computeAllowed: true is the same as leaving it out.
    const [allowed] = timelineFor("X1", start, [reviewed({ id: "allowed", computeAllowed: true })]);
    expect(allowed).toEqual(expect.objectContaining({ quoteOnly: false, deadline: perth("2026-09-26T10:00:00") }));
  });

  it("keeps unsigned shipped timeframes quote-only and gates default calculations on sign-off", () => {
    const file = mhaTimeframes as MhaTimeframesFile;
    const codes = [...new Set(file.entries.flatMap((candidate) => candidate.formCodes))];
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(hasMhaTimeline(code)).toBe(true);
      const unsigned = file.entries.map((candidate) => ({
        ...candidate,
        status: "drafted" as const,
        reviewedBy: null,
        reviewedAt: null,
        reviewedContentSha256: null,
      }));
      for (const item of timelineFor(code, start, unsigned)) expect(item.quoteOnly).toBe(true);
      for (const item of timelineFor(code, start)) {
        const mayCalculate = isReviewedTimeframe(item.entry) && item.entry.computeAllowed !== false;
        expect(item.quoteOnly, item.entry.id).toBe(!mayCalculate);
        if (!item.quoteOnly) expect(item.deadline, item.entry.id).toBeInstanceOf(Date);
      }
    }
    expect(hasMhaTimeline("not-a-form")).toBe(false);
  });
});

describe("Perth date-time input and display", () => {
  it("reads a datetime-local value as Perth wall time", () => {
    expect(parsePerthDateTimeInput("2026-09-25T14:30")).toEqual(new Date("2026-09-25T06:30:00Z"));
    expect(parsePerthDateTimeInput("2026-09-25T00:15")).toEqual(new Date("2026-09-24T16:15:00Z"));
  });

  it("returns null for an empty or malformed value", () => {
    for (const value of ["", "2026-09-25", "2026-13-01T10:00", "2026-02-30T10:00", "2026-09-25T25:00", "junk"]) {
      expect(parsePerthDateTimeInput(value), value).toBeNull();
    }
  });

  it("formats an instant as a Perth date and 24-hour time", () => {
    expect(formatPerthDateTime(new Date("2026-09-25T06:30:00Z"))).toBe("Fri 25 Sep 2026, 14:30 (Perth time)");
    expect(formatPerthDateTime(new Date("2028-02-28T16:05:00Z"))).toBe("Tue 29 Feb 2028, 00:05 (Perth time)");
  });
});

describe("sha256Hex", () => {
  it("matches node:crypto, including multi-byte text and padding boundaries", () => {
    const samples = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(119),
      "The person’s detention — 72 hours",
      JSON.stringify({ quote: "Within 72 hours after the time", émoji: "✓" }),
      "x".repeat(1000),
    ];
    for (const sample of samples) {
      expect(sha256Hex(sample), sample.slice(0, 20)).toBe(createHash("sha256").update(sample).digest("hex"));
    }
  });
});
