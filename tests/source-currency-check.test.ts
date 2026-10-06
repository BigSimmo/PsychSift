import { describe, expect, it } from "vitest";

import type { ClinicalSourceClientEntry } from "@/lib/sources/catalogue-types";
import { deriveSourceCurrencyCheck, perthToday } from "@/lib/sources/currency-check";

function entry(overrides: Partial<ClinicalSourceClientEntry> = {}): ClinicalSourceClientEntry {
  return {
    id: "src_a",
    sourceId: "src_a",
    title: "A guideline",
    aliases: [],
    version: "1",
    publisher: "Example publisher",
    publisherCode: null,
    sourceType: "guideline",
    canonicalLocation: { kind: "none" },
    geography: { scope: "wa", label: "Western Australia" },
    topics: [],
    publicationDate: null,
    reviewDate: null,
    expiryDate: null,
    documentStatus: "current",
    validationStatus: "unknown",
    contentMode: "indexed_content",
    lifecycleStatus: "active",
    supersedes: [],
    supersededBy: [],
    usedBy: [],
    rating: {
      score: 80,
      band: "B",
      dimensions: {
        accuracyAssurance: 20,
        reliability: 16,
        evidenceQuality: 16,
        currency: 15,
        australianApplicability: 10,
        traceability: 3,
      },
    },
    warnings: [],
    ...overrides,
  };
}

const TODAY = "2026-10-05";

describe("deriveSourceCurrencyCheck", () => {
  it("counts every source by its recorded status against the real total", () => {
    const check = deriveSourceCurrencyCheck(
      [
        entry({ id: "a" }),
        entry({ id: "b", documentStatus: "review_due" }),
        entry({ id: "c", documentStatus: "outdated" }),
        entry({ id: "d", documentStatus: "unknown" }),
        entry({ id: "e" }),
      ],
      TODAY,
    );
    expect(check.total).toBe(5);
    expect(check.counts).toEqual({ current: 2, review_due: 1, outdated: 1, unknown: 1 });
  });

  it("builds six month columns starting with the current month", () => {
    const check = deriveSourceCurrencyCheck([], TODAY);
    expect(check.months.map((month) => month.key)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
    expect(check.months.map((month) => month.label)).toEqual(["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]);
  });

  it("places only forward dates inside the window on the timeline, soonest first", () => {
    const check = deriveSourceCurrencyCheck(
      [
        entry({ id: "expires-nov", title: "Expires in November", expiryDate: "2026-11-20" }),
        entry({ id: "review-oct", title: "Review due in October", reviewDate: "2026-10-12" }),
        // A past review date says when the source was last reviewed, never when it is due.
        entry({ id: "reviewed-past", reviewDate: "2026-01-01" }),
        // Today's review date is not "coming up"; it has been reached.
        entry({ id: "reviewed-today", reviewDate: TODAY }),
        // Past the six-month window.
        entry({ id: "expires-later", expiryDate: "2027-04-01" }),
        // Unreadable dates never become a timeline entry.
        entry({ id: "bad-date", expiryDate: "2026-13-40" }),
      ],
      TODAY,
    );
    expect(check.upcoming.map((item) => [item.entry.id, item.kind, item.date])).toEqual([
      ["review-oct", "review", "2026-10-12"],
      ["expires-nov", "expires", "2026-11-20"],
    ]);
    expect(check.months[0].items.map((item) => item.entry.id)).toEqual(["review-oct"]);
    expect(check.months[1].items.map((item) => item.entry.id)).toEqual(["expires-nov"]);
  });

  it("prefers the expiry date when a source records both", () => {
    const check = deriveSourceCurrencyCheck(
      [entry({ id: "both", expiryDate: "2026-12-01", reviewDate: "2026-11-01" })],
      TODAY,
    );
    expect(check.upcoming).toHaveLength(1);
    expect(check.upcoming[0]).toMatchObject({ kind: "expires", date: "2026-12-01" });
  });

  it("lists outdated sources before review-due ones and keeps superseded sources separate", () => {
    const check = deriveSourceCurrencyCheck(
      [
        entry({ id: "due-b", title: "Beta", documentStatus: "review_due" }),
        entry({ id: "out", title: "Zeta", documentStatus: "outdated" }),
        entry({ id: "due-a", title: "Alpha", documentStatus: "review_due" }),
        entry({ id: "replaced", title: "Old version", documentStatus: "outdated", supersededBy: ["src_new"] }),
        entry({ id: "fine" }),
      ],
      TODAY,
    );
    expect(check.needsReview.map((item) => item.id)).toEqual(["out", "due-a", "due-b"]);
    expect(check.replaced.map((item) => item.id)).toEqual(["replaced"]);
  });
});

describe("perthToday", () => {
  it("reads the calendar date in Perth, not UTC", () => {
    // 20:00 UTC on 4 October is 04:00 on 5 October in Perth (UTC+8).
    expect(perthToday(new Date("2026-10-04T20:00:00.000Z"))).toBe("2026-10-05");
  });
});
