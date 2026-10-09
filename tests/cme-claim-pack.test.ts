import { describe, expect, it } from "vitest";

import { downloadClaimPackText, generateClaimPackText } from "@/components/cme/cme-claim-pack";
import type { CmeEntry } from "@/lib/cme/types";

function mockEntry(overrides: Partial<CmeEntry>): CmeEntry {
  return {
    id: "entry-default",
    date: "2026-03-01",
    title: "Conference Attendance",
    allocations: [{ category: "educational", hours: 4 }],
    reflection: "Useful clinical updates",
    costCents: 25000,
    transcribed: false,
    routineId: null,
    documentId: "doc-receipt-1",
    buckets: [],
    formalPeerReviewHours: 0,
    ...overrides,
  };
}

describe("CME Claim Pack Export (#G20QE6)", () => {
  it("returns fallback notice when no entries have claimable costs", () => {
    const text = generateClaimPackText([]);
    expect(text).toContain("No claimable expenses recorded");

    const noCostEntries = [mockEntry({ id: "e1", costCents: null }), mockEntry({ id: "e2", costCents: 0 })];
    expect(generateClaimPackText(noCostEntries)).toContain("No claimable expenses recorded");
  });

  it("excludes archived entries from claim calculation", () => {
    const entries = [
      mockEntry({ id: "e1", title: "Valid Entry", costCents: 10000, archivedAt: null }),
      mockEntry({ id: "e2", title: "Archived Entry", costCents: 50000, archivedAt: "2026-04-01" }),
    ];
    const text = generateClaimPackText(entries);
    expect(text).toContain("Valid Entry");
    expect(text).toContain("$100.00 AUD");
    expect(text).not.toContain("Archived Entry");
    expect(text).not.toContain("$500.00");
    expect(text).toContain("Total Claim Amount: $100.00 AUD (1 expense)");
  });

  it("itemizes expenses with correct date ordering and total sum", () => {
    const entries = [
      mockEntry({
        id: "e-later",
        date: "2026-06-15",
        title: "Perth Psychiatry Symposium",
        costCents: 35000,
        documentId: "rec-99",
      }),
      mockEntry({
        id: "e-earlier",
        date: "2026-02-10",
        title: "BLS Re-certification Course",
        costCents: 12050,
        documentId: "rec-42",
      }),
    ];

    const text = generateClaimPackText(entries);

    // Sorted by date: 2026-02-10 comes first
    expect(text).toMatch(
      /1\. Date: 2026-02-10.*BLS Re-certification Course[\s\S]*2\. Date: 2026-06-15.*Perth Psychiatry Symposium/,
    );
    expect(text).toContain("$120.50 AUD");
    expect(text).toContain("$350.00 AUD");
    // Total sum: $120.50 + $350.00 = $470.50
    expect(text).toContain("Total Claim Amount: $470.50 AUD (2 expenses)");
    expect(text).toContain("Receipt / Document ID: rec-42");
    expect(text).toContain("Receipt / Document ID: rec-99");
  });

  it("handles downloadClaimPackText gracefully in node/non-browser environment", () => {
    // In node.js environment, window/document is undefined
    expect(downloadClaimPackText([])).toBe(false);
  });
});
