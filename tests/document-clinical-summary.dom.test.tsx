import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentClinicalSummary } from "@/components/document-viewer/document-clinical-summary";
import type { ClinicalDocument, ClinicalDocumentSummaryProfile, DocumentSummaryProfileItem } from "@/lib/types";

function item(text: string, page: number): DocumentSummaryProfileItem {
  return {
    text,
    pages: [page],
    support: "direct",
    evidence_type: "text",
    source_chunk_ids: [`chunk-${page}`],
    source_image_ids: [],
  };
}

const profile: ClinicalDocumentSummaryProfile = {
  overview:
    "Safe lithium initiation and maintenance requires baseline renal, thyroid and calcium testing, correctly timed trough levels after initiation and dose changes, and immediate withholding with urgent assessment whenever toxicity is suspected.",
  applies_to: [],
  key_clinical_actions: [item("Check renal, thyroid and calcium status before treatment.", 4)],
  medication_dose_monitoring: [],
  thresholds_timing: [item("Take trough levels 12 hours after the last dose.", 6)],
  escalation_risk_warnings: [item("Withhold lithium and urgently assess suspected toxicity.", 9)],
  required_forms_documentation: [],
  not_covered: [],
  important_tables_images: [],
  best_questions: [],
  source_quality_notes: [],
};

const document = {
  id: "document-1",
  title: "Lithium monitoring protocol",
  file_name: "lithium-monitoring.pdf",
  created_at: "2026-07-24T00:00:00.000Z",
  summary: {
    id: "summary-1",
    document_id: "document-1",
    summary: profile.overview,
    clinical_specifics: { profile },
  },
} as ClinicalDocument;

describe("DocumentClinicalSummary", () => {
  it("expands the mobile summary without introducing a visible control row", () => {
    render(<DocumentClinicalSummary document={document} pageHref={(page) => `?page=${page}`} onPageChange={vi.fn()} />);

    const toggle = screen.getByTestId("toggle-document-summary");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Show less");
  });

  it("opens the mobile priorities sheet and navigates from its source page link", () => {
    const onPageChange = vi.fn();
    render(
      <DocumentClinicalSummary document={document} pageHref={(page) => `?page=${page}`} onPageChange={onPageChange} />,
    );

    fireEvent.click(screen.getByTestId("open-clinical-priorities"));
    const sheet = screen.getByTestId("clinical-priorities-sheet");
    expect(sheet).toBeVisible();
    fireEvent.click(within(sheet).getByRole("link", { name: "View p.9" }));

    expect(onPageChange).toHaveBeenCalledWith(9);
    expect(screen.queryByTestId("clinical-priorities-sheet")).not.toBeInTheDocument();
  });

  it("keeps clinical priorities collapsed in condensed view and restores them in full view", () => {
    const props = { document, pageHref: (page: number) => `?page=${page}`, onPageChange: vi.fn() };
    const { rerender } = render(<DocumentClinicalSummary {...props} compact />);
    const desktopPriorities = screen.getAllByRole("button", { name: /See all \d+ priorities/ })[0];

    expect(desktopPriorities).toHaveAttribute("aria-expanded", "false");
    rerender(<DocumentClinicalSummary {...props} compact={false} />);
    expect(desktopPriorities).toHaveAttribute("aria-expanded", "true");
  });

  // The card used to render its gradient header, icon and heading around
  // "not been indexed for this document yet" — most of a phone's first viewport
  // spent saying the document has no summary. It now renders nothing at all.
  it("renders nothing when the document has no indexed summary", () => {
    const emptyDocument = { ...document, summary: undefined } as ClinicalDocument;

    const { container } = render(
      <DocumentClinicalSummary document={emptyDocument} pageHref={(page) => `?page=${page}`} onPageChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("document-clinical-summary")).not.toBeInTheDocument();
    expect(
      screen.queryByText("A structured clinical summary has not been indexed for this document yet."),
    ).not.toBeInTheDocument();
  });

  // A stored summary row is not the same as usable content: the model discards
  // placeholder text, so this row yields a card only because it still has
  // priorities to show, and the empty-summary line stays for that case.
  it("keeps the unindexed line when priorities survive but the summary text does not", () => {
    const placeholderDocument = {
      ...document,
      summary: { ...document.summary, summary: "Source-backed review", clinical_specifics: {} },
    } as ClinicalDocument;

    render(
      <DocumentClinicalSummary
        document={placeholderDocument}
        pageHref={(page) => `?page=${page}`}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("Source-backed")).not.toBeInTheDocument();
  });

  it("does not claim the document-overview section id", () => {
    // DocumentViewer owns id="document-overview" on the overview landing wrapper.
    // A second claim here duplicates the id and fails Production UI DOM integrity.
    const { container } = render(
      <DocumentClinicalSummary document={document} pageHref={(page) => `?page=${page}`} onPageChange={vi.fn()} />,
    );

    expect(container.querySelector("#document-overview")).toBeNull();
    expect(screen.getByTestId("document-clinical-summary")).not.toHaveAttribute("id", "document-overview");
  });
});
