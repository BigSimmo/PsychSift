import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnswerPayload } from "@/components/clinical-dashboard/search-utils";
import { GeneratedSummaryPanel } from "@/components/document-viewer/generated-summary-panel";

/**
 * The document-scoped answer used to render `summary.answer` alone under a
 * fixed "From indexed passages" line, whatever the pipeline said about it. These
 * pin that it now reads the same grounding signals as the main answer surface.
 * Synthetic payloads only.
 */

const documentId = "doc-synthetic";

function citation(page: number, overrides: Record<string, unknown> = {}) {
  return {
    chunk_id: `chunk-${page}`,
    document_id: documentId,
    title: "Synthetic monitoring protocol",
    file_name: "synthetic.pdf",
    page_number: page,
    chunk_index: page,
    ...overrides,
  };
}

function payload(overrides: Partial<AnswerPayload> = {}): AnswerPayload {
  return {
    answer: "Synthetic summary text.",
    grounded: true,
    confidence: "high",
    citations: [citation(7), citation(3), citation(7)],
    sources: [],
    ...overrides,
  } as AnswerPayload;
}

function renderPanel(summary: AnswerPayload, onOpenPage = vi.fn()) {
  render(
    <GeneratedSummaryPanel
      loadingSummary={false}
      summary={summary}
      summaryError={null}
      summaryProgressStartedAt={null}
      summaryProgressEvents={[]}
      stopSummary={vi.fn()}
      generatedSummaryRef={createRef<HTMLElement>()}
      generatedAnswerIsSummary
      generatedSummaryText={summary.answer}
      documentId={documentId}
      onOpenPage={onOpenPage}
    />,
  );
  return { onOpenPage, panel: screen.getByTestId("generated-clinical-summary") };
}

afterEach(() => cleanup());

describe("GeneratedSummaryPanel grounding signals", () => {
  it("keeps the indexed-passages description for a grounded answer and links each cited page once", () => {
    const { onOpenPage, panel } = renderPanel(payload());

    expect(panel.getAttribute("data-answer-state")).toBe("ready");
    expect(panel.textContent).toContain("From indexed passages, cleaned for practical use.");
    const pageButtons = screen.getAllByRole("button", { name: /^Open page / });
    expect(pageButtons.map((button) => button.textContent)).toEqual(["p. 3", "p. 7"]);

    fireEvent.click(screen.getByRole("button", { name: "Open page 7" }));
    expect(onOpenPage).toHaveBeenCalledWith(7);
  });

  it("drops the indexed-passages claim and shows the ungrounded notice when grounded is false", () => {
    const { panel } = renderPanel(payload({ grounded: false, confidence: "unsupported", citations: [] }));

    expect(panel.getAttribute("data-answer-state")).toBe("ungrounded");
    expect(panel.textContent).not.toContain("From indexed passages");
    expect(panel.textContent).toContain("could not be shown to support every claim");
    expect(screen.queryByRole("navigation", { name: "Cited pages" })).toBeNull();
  });

  it("discloses a non-production demo fallback", () => {
    const { panel } = renderPanel(payload({ fallbackMode: "non_production_demo" }));

    expect(panel.textContent).toContain("Synthetic demo only: this is not clinical guidance.");
    expect(panel.textContent).not.toContain("From indexed passages");
  });

  it("shows safety warnings with a link to their page, and skips pages from another document", () => {
    const { onOpenPage } = renderPanel(
      payload({
        citations: [citation(2), citation(9, { document_id: "doc-other" })],
        safetyWarnings: [
          {
            id: "warning-1",
            kind: "monitoring",
            label: "Monitoring",
            text: "Synthetic monitoring caveat.",
            citation: citation(4),
            href: "/documents/doc-synthetic?page=4",
          },
        ],
      } as Partial<AnswerPayload>),
    );

    const warnings = screen.getByTestId("generated-summary-warnings");
    expect(warnings.textContent).toContain("Monitoring:");
    expect(warnings.textContent).toContain("Synthetic monitoring caveat.");
    fireEvent.click(screen.getByRole("button", { name: "Open page 4" }));
    expect(onOpenPage).toHaveBeenCalledWith(4);
    expect(screen.queryByRole("button", { name: "Open page 9" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open page 2" })).toBeTruthy();
  });
});
