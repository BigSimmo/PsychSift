import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MobileEvidenceSheetContent } from "@/components/clinical-dashboard/visual-evidence";
import type { AnswerRenderModel } from "@/lib/answer-render-policy";
import type { RagAnswer } from "@/lib/types";
import type { AnswerEvidenceMapRow } from "@/lib/ward-output";

const answer: RagAnswer = {
  answer: "Use the source-backed monitoring plan.",
  grounded: true,
  confidence: "medium",
  citations: [],
  sources: [],
};

const renderModel: AnswerRenderModel = {
  answerText: answer.answer,
  trust: "medium",
  supportLabelTrust: "medium",
  allowedBlocks: ["evidenceMap", "quoteCards", "visualEvidence"],
  primarySources: [],
  reviewSources: [],
  evidenceRows: [],
  quoteCards: [],
  visualEvidence: [],
  relatedDocuments: [],
  bestSource: null,
  warnings: ["Confirm the monitoring interval against the cited guideline."],
  tables: [],
  copyText: answer.answer,
};

const missingSourceRow: AnswerEvidenceMapRow = {
  id: "monitoring-gap",
  section: "Monitoring interval",
  detail: "Confirm the interval against the source guideline.",
  supportLevel: "partial",
  citationCount: 0,
  sourceStatus: "Source unavailable",
  bestSourceLabel: "",
  bestLinkedPassage: "",
};

function evidenceSheetProps() {
  return {
    answer,
    sources: [],
    renderModel,
    visualEvidence: [],
    answerEvidenceMapRows: [missingSourceRow],
    demoMode: false,
    pendingFeedback: null,
    copiedQuotes: false,
    onCopyQuotes: vi.fn(),
    onSubmitFeedback: vi.fn(),
    onScopeDocument: vi.fn(),
  };
}

describe("MobileEvidenceSheetContent tabs (jsdom)", () => {
  it("renders the bounded retrieval-gate warning without raw diagnostics", () => {
    render(<MobileEvidenceSheetContent {...evidenceSheetProps()} answer={{ ...answer, retrievalGateBlocked: true }} />);

    expect(screen.getByText(/retrieval confidence gate was triggered/i)).toBeVisible();
  });

  it("explains the review purpose and identifies claim support without decorative placeholders", () => {
    render(<MobileEvidenceSheetContent {...evidenceSheetProps()} />);

    expect(screen.getByText(/check which claims are backed by the retrieved sources/i)).toBeVisible();
    expect(screen.getByRole("img", { name: "Partial support" })).toBeVisible();
    expect(screen.getByText("Is the answer supported?")).toBeVisible();
    expect(screen.getByText(/this sends feedback for review; it does not change the answer/i)).toBeVisible();
  });

  it("uses unique stable tab and panel ids with reciprocal ARIA associations", () => {
    const props = evidenceSheetProps();
    const { rerender } = render(<MobileEvidenceSheetContent {...props} />);
    const tablist = screen.getByRole("tablist", { name: "Evidence sections" });
    const initialTabIds = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.id);

    for (const tab of within(tablist).getAllByRole("tab")) {
      const panelId = tab.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;

      expect(tab.id).not.toBe("");
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    }

    const unavailableRow = screen.getByTestId("evidence-map-source-unavailable");
    expect(unavailableRow).toHaveTextContent("Source unavailable");
    expect(within(unavailableRow).queryByRole("link")).not.toBeInTheDocument();

    rerender(<MobileEvidenceSheetContent {...props} />);
    expect(
      within(screen.getByRole("tablist", { name: "Evidence sections" }))
        .getAllByRole("tab")
        .map((tab) => tab.id),
    ).toEqual(initialTabIds);

    rerender(
      <>
        <MobileEvidenceSheetContent {...props} />
        <MobileEvidenceSheetContent {...evidenceSheetProps()} />
      </>,
    );
    const allTabIds = screen.getAllByRole("tab").map((tab) => tab.id);
    const allPanelIds = screen.getAllByRole("tabpanel", { hidden: true }).map((panel) => panel.id);

    expect(new Set(allTabIds).size).toBe(allTabIds.length);
    expect(new Set(allPanelIds).size).toBe(allPanelIds.length);
  });

  it("roves one tab stop and auto-activates Left, Right, Home, and End destinations", async () => {
    const user = userEvent.setup();
    render(<MobileEvidenceSheetContent {...evidenceSheetProps()} />);

    const claims = screen.getByRole("tab", { name: /^Claims/ });
    const quotes = screen.getByRole("tab", { name: /^Quotes/ });
    const images = screen.getByRole("tab", { name: /^Images/ });
    const gaps = screen.getByRole("tab", { name: /^Gaps/ });

    expect(claims).toHaveAttribute("aria-selected", "true");
    expect(claims).toHaveAttribute("tabindex", "0");
    for (const tab of [quotes, images, gaps]) {
      expect(tab).toHaveAttribute("tabindex", "-1");
    }

    claims.focus();
    await user.keyboard("{ArrowRight}");
    expect(quotes).toHaveFocus();
    expect(quotes).toHaveAttribute("aria-selected", "true");
    expect(quotes).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("mobile-evidence-panel-quotes")).not.toHaveAttribute("hidden");

    await user.keyboard("{End}");
    expect(gaps).toHaveFocus();
    expect(gaps).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(claims).toHaveFocus();
    expect(claims).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(gaps).toHaveFocus();
    expect(gaps).toHaveAttribute("aria-selected", "true");
    expect(claims).toHaveAttribute("tabindex", "-1");
  });
});
