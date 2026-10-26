/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentVisualsPanel } from "@/components/document-viewer/document-visuals-panel";
import type { TableFactRow } from "@/components/document-viewer/types";

// A failed table review used to set the viewer's load error, which swapped the PDF preview for the
// "could not load" frame. It is now reported beside the table tools instead.

const fact = {
  id: "synthetic-fact-1",
  page_number: 3,
  table_title: "Synthetic monitoring table",
  row_label: "Baseline",
  clinical_parameter: null,
  threshold_value: null,
  action: null,
  metadata: {},
  source_image_id: null,
} as unknown as TableFactRow;

function renderPanel(tableReviewError: string | null) {
  return render(
    <DocumentVisualsPanel
      loading={false}
      document={null}
      canUseAdministrativeApis
      clinicalImages={[]}
      auditImages={[]}
      tableFacts={[fact]}
      reviewingTableFactId={null}
      tableReviewError={tableReviewError}
      onReviewTableFact={vi.fn()}
      activePage={1}
      onSelectPage={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("DocumentVisualsPanel table review errors", () => {
  it("shows a failed review beside the table tools", () => {
    renderPanel("Table review update failed.");
    expect(screen.getByRole("alert", { hidden: true })).toHaveTextContent("Table review update failed.");
  });

  it("shows nothing when the last review succeeded", () => {
    renderPanel(null);
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();
  });
});
