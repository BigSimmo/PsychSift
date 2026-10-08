/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CmeYearInWeeks, groupCmeWeeksByMonth } from "@/components/cme/cme-year-in-weeks";
import type { CmeEntry } from "@/lib/cme/types";

function entry(id: string, date: string, hours: number, archivedAt?: string): CmeEntry {
  return {
    id,
    title: "Activity",
    date,
    allocations: [{ category: "educational", hours }],
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...(archivedAt ? { archivedAt } : {}),
  };
}

const ENTRIES = [
  entry("jan", "2026-01-05", 2),
  entry("jan-2", "2026-01-20", 1.5),
  entry("mar", "2026-03-10", 3),
  entry("archived", "2026-02-02", 9, "2026-02-03T00:00:00Z"),
  entry("last-year", "2025-12-30", 4),
];

describe("Each week (the Year page's week chart)", () => {
  it("groups the year's 53 week bars under the month each week starts in", () => {
    const months = groupCmeWeeksByMonth(ENTRIES, 2026, "2026-10-05");
    expect(months).toHaveLength(12);
    expect(months.flatMap(({ weeks }) => weeks)).toHaveLength(53);
    // 1 Jan 2026 is a Thursday: weeks start 1, 8, 15, 22, 29 Jan.
    expect(months[0]!.weeks).toHaveLength(5);
    expect(months[0]!.hours).toBe(3.5);
    // Archived and other-year activities count nothing.
    expect(months[1]!.hours).toBe(0);
    expect(months[9]!.current).toBe(true);
    expect(months.filter(({ current }) => current)).toHaveLength(1);
  });

  it("marks past, this and future weeks, and says the month totals in words", () => {
    render(<CmeYearInWeeks entries={ENTRIES} year={2026} today="2026-10-05" />);
    const bars = screen.getAllByTestId("cme-week-bar");
    expect(bars).toHaveLength(53);
    expect(bars.filter((bar) => bar.dataset.state === "now")).toHaveLength(1);
    expect(bars[0]!.dataset.state).toBe("past");
    expect(bars[0]!.dataset.hours).toBe("2");
    expect(bars.at(-1)!.dataset.state).toBe("future");
    // Only the picture is hidden; the words reach a screen reader.
    expect(bars[0]!.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText(/^Hours by month: January 3.5 h, February 0 h, March 3 h,/)).toHaveTextContent(
      /October 0 h\.$/,
    );
  });

  it("draws nothing as a zero height for a week that has not happened yet", () => {
    render(<CmeYearInWeeks entries={[]} year={2026} today="2026-01-02" />);
    const future = screen.getAllByTestId("cme-week-bar").filter((bar) => bar.dataset.state === "future");
    expect(future).toHaveLength(52);
    for (const bar of future) expect(bar.className).not.toMatch(/h-\[\d+%\]|h-full/);
  });
});
