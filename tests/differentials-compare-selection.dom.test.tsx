import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDifferentialRecord, getPresentationWorkflow } from "@/lib/differentials";
import type { DocumentMatch } from "@/lib/types";

const unrelatedDocumentMatch: DocumentMatch = {
  document_id: "unrelated-source",
  title: "Unrelated indexed source",
  file_name: "unrelated.pdf",
  labels: [],
  summarySnippet: "The query matched this document without linking it to a ranked differential.",
  bestPages: [1],
  bestChunkIds: ["unrelated-chunk"],
  imageCount: 0,
  tableCount: 0,
  matchReason: "query overlap",
  score: 0.8,
};

const catalogState = vi.hoisted(() => ({
  status: "loading" as "loading" | "ready" | "error" | "unauthorized" | "refetching",
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

type CatalogueRecord = NonNullable<ReturnType<typeof getDifferentialRecord>>;

/** The record's sections with its "Why it fits" items replaced — the source of
 *  a diagnosis result's own clinical cues. */
function withFitItems(record: CatalogueRecord, items: string[]): CatalogueRecord["sections"] {
  return record.sections.map((section) => (section.id === "why-it-fits" ? { ...section, items } : section));
}

describe("DifferentialsHome compare selection URL handoff", () => {
  beforeEach(() => {
    catalogState.status = "loading";
    catalogState.matches = { diagnoses: [], presentations: [] };
    window.history.replaceState(
      null,
      "",
      "/differentials?q=Pain&run=1&ids=medical-gi-endocrine-painful-organic-cause,bpsd-as-unmet-need-delirium-pain-mimic",
    );
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("keeps bookmarked ids while the catalogue is loading, then hydrates them", async () => {
    const topNoise = getDifferentialRecord("anorexia-nervosa");
    const keptA = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    const keptB = getDifferentialRecord("bpsd-as-unmet-need-delirium-pain-mimic");
    expect(topNoise && keptA && keptB).toBeTruthy();

    const { rerender } = render(
      <DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />,
    );

    expect(screen.getByTestId("differentials-results-loading")).toBeVisible();
    expect(window.location.search).toContain("ids=medical-gi-endocrine-painful-organic-cause");
    expect(window.location.search).toContain("bpsd-as-unmet-need-delirium-pain-mimic");

    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [
        { record: topNoise!, score: 20, reasons: ["title"] },
        { record: keptA!, score: 12, reasons: ["title"] },
        { record: keptB!, score: 11, reasons: ["title"] },
      ],
      presentations: [],
    };

    await act(async () => {
      rerender(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId("differentials-search-results")).toBeVisible();
    });

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("ids")?.split(",").sort()).toEqual(
        ["bpsd-as-unmet-need-delirium-pain-mimic", "medical-gi-endocrine-painful-organic-cause"].sort(),
      );
    });

    const selectedControls = screen.getAllByRole("checkbox", { name: /^Remove .+ from comparison$/ });
    expect(selectedControls.length).toBeGreaterThanOrEqual(2);
    for (const control of selectedControls) expect(control).toBeChecked();
  });

  it("shows a filter-specific empty state and restores all results", async () => {
    const diagnosis = getDifferentialRecord("anorexia-nervosa");
    expect(diagnosis).toBeTruthy();
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [{ record: diagnosis!, score: 20, reasons: ["title"] }],
      presentations: [],
    };

    render(<DifferentialsHome query="Anorexia" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText("Anorexia nervosa").length).toBeGreaterThan(0);
    });

    await act(async () => {
      screen.getByTestId("differential-filter-trigger-phone").click();
    });
    await act(async () => {
      screen.getByRole("radio", { name: "Presentations (0)" }).click();
    });
    await act(async () => {
      screen.getByTestId("differential-filter-panel-done").click();
    });

    expect(screen.getByTestId("differentials-filter-empty-results")).toBeVisible();
    expect(screen.getByRole("heading", { name: "No presentations in this result set" })).toBeVisible();
    expect(screen.queryByText(/No catalogue matches/)).not.toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Show all results" }).click();
    });

    expect(screen.queryByTestId("differentials-filter-empty-results")).not.toBeInTheDocument();
    expect(screen.getAllByText("Anorexia nervosa").length).toBeGreaterThan(0);
  });

  it("narrows by clinical urgency independently of result type, and clears both together", async () => {
    const emergent = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    const urgent = getDifferentialRecord("acute-dystonia");
    expect(emergent?.status).toBe("emergent");
    expect(urgent?.status).toBe("urgent");
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [
        { record: emergent!, score: 20, reasons: ["title"] },
        { record: urgent!, score: 12, reasons: ["title"] },
      ],
      presentations: [],
    };

    render(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText(emergent!.title).length).toBeGreaterThan(0);
      expect(screen.getAllByText(urgent!.title).length).toBeGreaterThan(0);
    });

    await act(async () => {
      screen.getByTestId("differential-filter-trigger-phone").click();
    });
    expect(screen.getByRole("heading", { name: "Clinical urgency" })).toBeVisible();
    await act(async () => {
      screen.getByRole("radio", { name: "Emergent (1)" }).click();
    });
    await act(async () => {
      screen.getByTestId("differential-filter-panel-done").click();
    });

    expect(screen.getAllByText(emergent!.title).length).toBeGreaterThan(0);
    expect(screen.queryByText(urgent!.title)).not.toBeInTheDocument();

    // A no-longer-active urgency filter narrowing the result type to zero
    // reports the combined reason, not just the result-type half of it.
    await act(async () => {
      screen.getByTestId("differential-filter-trigger-phone").click();
    });
    await act(async () => {
      screen.getByRole("radio", { name: "Presentations (0)" }).click();
    });
    await act(async () => {
      screen.getByTestId("differential-filter-panel-done").click();
    });
    expect(
      screen.getByRole("heading", { name: "No presentations at Emergent priority in this result set" }),
    ).toBeVisible();

    await act(async () => {
      screen.getByRole("button", { name: "Show all results" }).click();
    });

    expect(screen.queryByTestId("differentials-filter-empty-results")).not.toBeInTheDocument();
    expect(screen.getAllByText(emergent!.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(urgent!.title).length).toBeGreaterThan(0);
  });

  it("keeps the submitted query when opening a presentation comparison", async () => {
    const presentation = getPresentationWorkflow("acute-confusion-encephalopathy");
    expect(presentation).toBeTruthy();
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [],
      presentations: [{ workflow: presentation!, score: 20, reasons: ["title"] }],
    };

    render(<DifferentialsHome query="acute confusion" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    await waitFor(() => {
      const presentationLinks = screen.getAllByRole("link", { name: /Acute confusion/i });
      expect(presentationLinks.length).toBeGreaterThan(0);
      for (const link of presentationLinks) {
        expect(link).toHaveAttribute(
          "href",
          "/differentials/presentations/acute-confusion-encephalopathy?q=acute+confusion",
        );
      }
    });
  });

  it("keeps guided best matches in accent styling, shows only clinical cues, and ranks them after A–Z sorting", async () => {
    const alphabeticalFirst = getDifferentialRecord("acute-dystonia");
    const relevanceBest = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    expect(alphabeticalFirst && relevanceBest).toBeTruthy();
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [
        { record: relevanceBest!, score: 20, reasons: ["title"] },
        { record: alphabeticalFirst!, score: 12, reasons: ["title"] },
      ],
      presentations: [],
    };

    render(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    const bestMatch = await screen.findByTestId("differential-best-match-card");
    expect(bestMatch).toHaveClass("border-[color:var(--clinical-accent-border)]");
    expect(bestMatch).not.toHaveClass("border-[color:var(--success-border)]");

    const resultRow = screen.getByTestId("differential-compact-result");
    // Cues are the diagnosis's own "Why it fits" items, never the presentation
    // group's title, candidate list or hinge held in currentPresentation.
    const clinicalCues = (alphabeticalFirst!.sections.find((section) => section.id === "why-it-fits")?.items ?? [])
      .map((value) => value.trim())
      .filter(
        (value) =>
          value && value !== alphabeticalFirst!.subtitle.trim() && value !== alphabeticalFirst!.clinicalHinge.trim(),
      )
      .flatMap((value) => value.split(/\s*\/\s*/))
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4);
    const investigation = alphabeticalFirst!.investigations.find((step) => step.trim());
    expect(clinicalCues).not.toHaveLength(0);
    expect(investigation).toBeTruthy();
    for (const cue of clinicalCues) {
      expect(within(resultRow).getByText(cue, { exact: false })).toBeInTheDocument();
    }
    expect(resultRow).not.toHaveTextContent(investigation!);
    expect(resultRow).not.toHaveTextContent(/clinical hinge/i);

    await act(async () => {
      screen.getByRole("button", { name: "A–Z" }).click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("differential-best-match-rank")).toHaveTextContent("2");
    });
  });

  it("does not present query-wide source matches as verification of the ranked differential", async () => {
    const relevanceBest = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    expect(relevanceBest).toBeTruthy();
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [{ record: relevanceBest!, score: 20, reasons: ["title"] }],
      presentations: [],
    };

    render(
      <DifferentialsHome
        query="Pain"
        loading={false}
        searchSubmitted
        documentMatches={[unrelatedDocumentMatch]}
        evidenceQuery="Pain"
        onRunSearch={vi.fn()}
      />,
    );

    const bestMatch = await screen.findByTestId("differential-best-match-card");
    expect(bestMatch).toHaveClass("border-[color:var(--clinical-accent-border)]");
    expect(bestMatch).not.toHaveClass("border-[color:var(--success-border)]");
  });

  it("does not render an empty reasoning panel for a sparse catalogue record", async () => {
    const record = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    expect(record).toBeTruthy();
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [
        {
          record: {
            ...record!,
            subtitle: "",
            clinicalHinge: "",
            currentPresentation: [" "],
            sections: withFitItems(record!, [" "]),
            investigations: [" "],
          },
          score: 20,
          reasons: ["title"],
        },
      ],
      presentations: [],
    };

    render(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    await screen.findByTestId("differential-best-match-card");
    expect(screen.queryAllByTestId("differential-best-match-panel")).toHaveLength(0);
  });

  it("does not claim catalogue results exist when the catalogue fails or returns no matches", async () => {
    catalogState.status = "error";
    const { rerender } = render(
      <DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />,
    );

    expect(screen.getByTestId("differentials-source-status")).toHaveTextContent(
      "Indexed sources have not been checked",
    );
    expect(screen.queryByText(/showing reviewed catalogue results/i)).not.toBeInTheDocument();

    catalogState.status = "ready";
    rerender(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    expect(screen.queryByText(/showing reviewed catalogue results/i)).not.toBeInTheDocument();
  });

  it("renders duplicate clinical cues without duplicate React keys", async () => {
    const record = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    const lead = getDifferentialRecord("acute-dystonia");
    expect(record && lead).toBeTruthy();
    const repeatedCue = "severe abdominal pain";
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [
        { record: lead!, score: 20, reasons: ["title"] },
        {
          record: { ...record!, sections: withFitItems(record!, [repeatedCue, repeatedCue]) },
          score: 12,
          reasons: ["title"],
        },
      ],
      presentations: [],
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);
      await screen.findByTestId("differential-best-match-card");
      expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("drops blank and less-specific duplicate cues from the reasoning panel", async () => {
    const record = getDifferentialRecord("medical-gi-endocrine-painful-organic-cause");
    expect(record).toBeTruthy();
    catalogState.status = "ready";
    catalogState.matches = {
      diagnoses: [
        {
          record: { ...record!, sections: withFitItems(record!, ["pain", "severe pain", " "]) },
          score: 20,
          reasons: ["title"],
        },
      ],
      presentations: [],
    };

    render(<DifferentialsHome query="Pain" loading={false} searchSubmitted onRunSearch={vi.fn()} />);

    const lookForSections = await screen.findAllByText("Look for");
    expect(lookForSections).not.toHaveLength(0);
    for (const heading of lookForSections) {
      expect(heading.parentElement).toHaveTextContent("severe pain");
      expect(heading.parentElement).not.toHaveTextContent("pain · severe pain");
    }
  });
});
