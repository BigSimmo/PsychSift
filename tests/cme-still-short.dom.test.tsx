import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CmeEntryForm } from "@/components/cme/cme-entry-form";
import { stillShortCategories } from "@/components/cme/cme-still-short";
import { createAustralianRanzcpPreset } from "@/lib/cme/presets";
import type { CmeEntry } from "@/lib/cme/types";

// Idea 4, work-mode redesign, owner request 6 Oct 2026: a "Still short" tag on
// the categories an hours target is still short in. A hint only.
const SET = createAustralianRanzcpPreset(2026, "2026-01-02");

function entry(id: string, date: string, allocations: CmeEntry["allocations"], archivedAt?: string): CmeEntry {
  return {
    id,
    date,
    title: id,
    allocations,
    reflection: "",
    costCents: null,
    transcribed: false,
    routineId: null,
    documentId: null,
    buckets: [],
    ...(archivedAt ? { archivedAt } : {}),
  } as CmeEntry;
}

describe("stillShortCategories", () => {
  it("names every short category, furthest from met first", () => {
    expect(stillShortCategories(SET, [])).toEqual(["reviewing", "measuring", "educational"]);
  });

  it("drops a category once its own target is met", () => {
    const entries = [entry("a", "2026-03-01", [{ category: "educational", hours: 13 }])];
    expect(stillShortCategories(SET, entries)).toEqual(["reviewing", "measuring"]);
  });

  it("names only the category below its own floor when the other has reached it", () => {
    const entries = [
      entry("a", "2026-03-01", [{ category: "educational", hours: 13 }]),
      entry("b", "2026-03-02", [{ category: "reviewing", hours: 22 }]),
    ];
    expect(stillShortCategories(SET, entries)).toEqual(["measuring"]);
  });

  it("is empty when every hours target is met, so the tag never shows", () => {
    const entries = [
      entry("a", "2026-03-01", [{ category: "educational", hours: 13 }]),
      entry("b", "2026-03-02", [
        { category: "reviewing", hours: 20 },
        { category: "measuring", hours: 6 },
      ]),
    ];
    expect(stillShortCategories(SET, entries)).toEqual([]);
  });

  it("is empty with no targets set", () => {
    expect(stillShortCategories(null, [])).toEqual([]);
  });

  it("ignores archived activities and other years", () => {
    const entries = [
      entry("a", "2026-03-01", [{ category: "educational", hours: 13 }], "2026-03-05T00:00:00Z"),
      entry("b", "2025-03-01", [{ category: "educational", hours: 13 }]),
    ];
    expect(stillShortCategories(SET, entries)).toContain("educational");
  });
});

describe("Still short tag on the entry form", () => {
  it("tags short categories as a description and never preselects one", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} stillShort={["measuring"]} />);
    const chip = screen.getByRole("button", { name: "Outcomes" });
    expect(chip).toHaveAccessibleDescription("Still short");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("cme-entry-still-short-measuring")).toHaveTextContent("Still short");
    expect(screen.queryByTestId("cme-entry-still-short-educational")).not.toBeInTheDocument();
    for (const name of ["Educational", "Reviewing", "Outcomes", "Split hours"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("shows no tag when nothing is short", () => {
    render(<CmeEntryForm onSubmit={vi.fn()} />);
    expect(screen.queryByText("Still short")).not.toBeInTheDocument();
  });
});
