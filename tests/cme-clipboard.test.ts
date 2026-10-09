import { describe, expect, it } from "vitest";

import { formatEntryForCpdHome } from "@/lib/cme/clipboard";
import { DEMO_CME_ENTRIES, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import type { CmeEntry } from "@/lib/cme/types";

/**
 * `DEMO_CME_ENTRIES` (Task 3) gives every demo activity exactly one
 * allocation — most real activities do sit in a single category, and that is
 * what the corpus was built to look like. A multi-allocation entry is a real,
 * separately-supported shape (design-decisions.md §3: "an entry allocates
 * hours; it does not pick one box"), so it is exercised here with a fixture
 * built directly from the type rather than skipped because the corpus does
 * not happen to contain one.
 */
const multiAllocationEntry: CmeEntry = {
  ...DEMO_CME_ENTRIES[0]!,
  id: "cme-clipboard-test-multi",
  title: "Peer review group — combined session",
  allocations: [
    { category: "reviewing", hours: 1 },
    { category: "measuring", hours: 0.5 },
  ],
};

describe("copy for your CPD home", () => {
  it("puts every field on the clipboard in the portal's own order, one per line", () => {
    const entry = multiAllocationEntry;
    const text = formatEntryForCpdHome(entry, DEMO_CME_YEAR);
    const lines = text.split("\n");
    expect(lines[0]).toBe(`Date: ${entry.date}`);
    expect(lines[1]).toBe(`Activity: ${entry.title}`);
    expect(lines[2]).toMatch(/^Hours: /);
    expect(text).toContain("Reviewing performance");
    expect(text).toContain("Measuring outcomes");
  });

  it("writes one line per allocation, because a portal takes them separately", () => {
    const entry = multiAllocationEntry;
    const text = formatEntryForCpdHome(entry, DEMO_CME_YEAR);
    for (const allocation of entry.allocations) {
      expect(text).toMatch(new RegExp(`${allocation.hours}`));
    }
  });

  it("never puts the entry's cost on the clipboard", () => {
    const entry: CmeEntry = { ...multiAllocationEntry, costCents: 15_000 };
    const text = formatEntryForCpdHome(entry, DEMO_CME_YEAR);
    expect(text).not.toMatch(/150|cost/i);
  });

  it("formats a real demo entry — a single allocation is the common case", () => {
    const entry = DEMO_CME_ENTRIES[0]!;
    const text = formatEntryForCpdHome(entry, DEMO_CME_YEAR);
    const lines = text.split("\n");
    expect(lines[0]).toBe(`Date: ${entry.date}`);
    expect(lines[1]).toBe(`Activity: ${entry.title}`);
    expect(text).toContain(`Year: ${DEMO_CME_YEAR.year}`);
  });

  it("formats a real demo entry with multiple allocations from DEMO_CME_ENTRIES", () => {
    const multiEntry = DEMO_CME_ENTRIES.find((e) => e.allocations.length > 1);
    expect(multiEntry).toBeDefined();
    if (!multiEntry) return;
    const text = formatEntryForCpdHome(multiEntry, DEMO_CME_YEAR);
    expect(text).toContain("Reviewing performance");
    expect(text).toContain("Measuring outcomes");
  });
});
