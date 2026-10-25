import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDifferentialRecord, getPresentationWorkflow } from "@/lib/differentials";

/**
 * The desktop interpretation rail. Two contracts live here:
 *
 * 1. The "Highest urgency" rows size their status badge to its content. A fixed
 *    5.25rem track clipped "Emergent" mid-word, which is the one label in the
 *    rail that must stay readable at a glance.
 * 2. "Check next" aggregates the investigations the ranked differentials name,
 *    most-shared first, and never invents one of its own.
 * 3. Both cards read the filtered result set, so the rail never describes a
 *    wider list than the one on screen. If a lens hides every emergent, the
 *    urgency card stays and says so instead of vanishing. The rail is lg-only,
 *    so the same notice also renders in the main column below lg.
 */

const catalogState = vi.hoisted(() => ({
  status: "ready" as "loading" | "ready" | "error" | "unauthorized" | "refetching",
  matches: {
    diagnoses: [] as Array<{
      record: NonNullable<ReturnType<typeof getDifferentialRecord>>;
      score: number;
      reasons: string[];
    }>,
    presentations: [] as Array<{
      workflow: NonNullable<ReturnType<typeof getPresentationWorkflow>>;
      score: number;
      reasons: string[];
    }>,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/clinical-dashboard/use-differential-catalog", () => ({
  useDifferentialSearch: () => ({
    status: catalogState.status,
    matches: catalogState.matches,
    demoMode: true,
    error: null,
  }),
}));

vi.mock("@/components/use-result-sort", async () => {
  const { useState } = await import("react");
  return {
    useResultSort: () => useState<"relevance" | "alpha">("relevance"),
  };
});

vi.mock("@/components/clinical-dashboard/universal-search-also-matches", () => ({
  UniversalSearchAlsoMatches: () => null,
}));

import { DifferentialsHome } from "@/components/clinical-dashboard/differentials-home";

function renderWith(
  diagnosisSlugs: string[],
  { presentationId, query = "lithium" }: { presentationId?: string; query?: string } = {},
) {
  const records = diagnosisSlugs.map((slug) => {
    const record = getDifferentialRecord(slug);
    expect(record, `missing fixture ${slug}`).toBeTruthy();
    return record!;
  });
  catalogState.status = "ready";
  catalogState.matches = {
    diagnoses: records.map((record, index) => ({ record, score: 20 - index, reasons: ["title"] })),
    presentations: presentationId
      ? [{ workflow: getPresentationWorkflow(presentationId)!, score: 25, reasons: ["title"] }]
      : [],
  };
  render(<DifferentialsHome query={query} loading={false} searchSubmitted onRunSearch={vi.fn()} />);
}

describe("differentials interpretation rail", () => {
  beforeEach(() => {
    catalogState.status = "loading";
    catalogState.matches = { diagnoses: [], presentations: [] };
    window.history.replaceState(null, "", "/differentials?q=lithium&run=1");
  });

  it("sizes the highest-urgency badge column to its content so Emergent is never clipped", async () => {
    renderWith(["lithium-adverse-effects-toxicity", "serotonin-syndrome"]);

    const urgency = await screen.findByTestId("differentials-highest-urgency");
    const rows = within(urgency).getAllByRole("link");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(within(row).getByTestId("differential-status-badge")).toHaveTextContent("Emergent");
      // A fixed rem track is the defect: it cannot grow with the label.
      expect(row.className).not.toMatch(/grid-cols-\[[\d.]+rem_/);
      expect(row.className).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    }
  });

  it("drops the highest-urgency card when nothing in the result set is emergent", async () => {
    renderWith(["acute-dystonia"], { query: "dystonia" });

    await waitFor(() => {
      expect(screen.getAllByText("Acute dystonia").length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("differentials-highest-urgency")).not.toBeInTheDocument();
    expect(screen.queryByTestId("differentials-urgency-hidden-by-filters")).not.toBeInTheDocument();
  });

  it("ranks shared investigations first and attributes a single-source one to its differential", async () => {
    // Acute dystonia leads on score but contributes only Thyroid function tests,
    // which the two toxicity differentials do not share.
    renderWith(["acute-dystonia", "lithium-adverse-effects-toxicity", "serotonin-syndrome"]);

    const card = await screen.findByTestId("differentials-shared-next-steps");
    const items = within(card)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");

    expect(items).toEqual([
      "ECG / QT assessmentShared by 2 differentials",
      "Urea, electrolytes, creatinineShared by 2 differentials",
      "Airway and stridor assessmentFrom Acute dystonia",
      "Medication history and timeline (dopamine receptor antagonist exposure)From Acute dystonia",
    ]);
  });

  it("excludes presentation review checklists, which are the same workflow stages on every presentation", async () => {
    renderWith(["lithium-adverse-effects-toxicity"], {
      presentationId: "acute-confusion-encephalopathy",
      query: "acute confusion",
    });

    const card = await screen.findByTestId("differentials-shared-next-steps");
    expect(within(card).queryByText(/Stabilise and rule out immediate threats/)).not.toBeInTheDocument();
    expect(within(card).getByText("ECG / QT assessment")).toBeVisible();
  });

  it("makes both rail cards follow the urgency lens", async () => {
    renderWith(["lithium-adverse-effects-toxicity", "acute-dystonia"]);

    const card = await screen.findByTestId("differentials-shared-next-steps");
    expect(within(card).getByText("Airway and stridor assessment")).toBeVisible();
    expect(within(card).getByText("ECG / QT assessment")).toBeVisible();
    expect(screen.getByTestId("differentials-highest-urgency")).toBeVisible();
    expect(screen.queryByTestId("differentials-urgency-hidden-by-filters")).not.toBeInTheDocument();

    // Narrowing to High leaves only the urgent differential. Check next follows
    // that list. Highest urgency must not vanish: it stays with a notice that
    // the lens hid the emergent, without putting the hidden row back on screen.
    await act(async () => {
      screen.getByTestId("differential-filter-trigger-phone").click();
    });
    await act(async () => {
      screen.getByRole("radio", { name: "High (1)" }).click();
    });
    await act(async () => {
      screen.getByTestId("differential-filter-panel-done").click();
    });

    const urgency = screen.getByTestId("differentials-highest-urgency");
    expect(urgency).toBeVisible();
    expect(within(urgency).getByTestId("differentials-urgency-hidden-by-filters")).toHaveTextContent(
      "1 emergent differential is hidden by the active filters.",
    );
    expect(within(urgency).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).getByText("Airway and stridor assessment")).toBeVisible();
    expect(within(card).queryByText("ECG / QT assessment")).not.toBeInTheDocument();

    await act(async () => {
      within(urgency).getByRole("button", { name: "Show all results" }).click();
    });
    const restored = screen.getByTestId("differentials-highest-urgency");
    expect(screen.queryByTestId("differentials-urgency-hidden-by-filters")).not.toBeInTheDocument();
    expect(within(restored).getByTestId("differential-status-badge")).toHaveTextContent("Emergent");
    expect(within(restored).getByRole("link")).toBeVisible();
  });

  it("says in the main column, not only the desktop rail, when the lens hides an emergent", async () => {
    renderWith(["lithium-adverse-effects-toxicity", "acute-dystonia"]);

    await screen.findByTestId("differentials-highest-urgency");
    expect(screen.queryByTestId("differentials-hidden-emergent-phone-notice")).not.toBeInTheDocument();

    await act(async () => {
      screen.getByTestId("differential-filter-trigger-phone").click();
    });
    await act(async () => {
      screen.getByRole("radio", { name: "High (1)" }).click();
    });
    await act(async () => {
      screen.getByTestId("differential-filter-panel-done").click();
    });

    // The rail is lg-only, so phones depend on this main-column notice.
    const notice = screen.getByTestId("differentials-hidden-emergent-phone-notice");
    expect(notice).toHaveTextContent("1 emergent differential is hidden by the active filters.");
    expect(notice.className).toContain("lg:hidden");

    await act(async () => {
      within(notice).getByRole("button", { name: "Show all results" }).click();
    });
    expect(screen.queryByTestId("differentials-hidden-emergent-phone-notice")).not.toBeInTheDocument();
  });

  it("hides the check-next card when no ranked differential names an investigation", async () => {
    renderWith(["acute-psychosis"], { query: "psychosis" });

    await waitFor(() => {
      expect(screen.getAllByText("Acute psychosis").length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("differentials-shared-next-steps")).not.toBeInTheDocument();
  });
});
