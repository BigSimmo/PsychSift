// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StagedAnswerResultSurface } from "@/components/clinical-dashboard/answer-result-surface";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import type { ClientRagAnswerPayload, ClientSearchResult } from "@/lib/answer-client-payload";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const SOURCES: ClientSearchResult[] = [
  {
    id: "chunk-1",
    document_id: "doc-1",
    title: "WA Clozapine Monitoring Protocol",
    file_name: "wa-clozapine-protocol.pdf",
    page_number: 12,
    chunk_index: 0,
    similarity: 0.92,
    section_heading: null,
    image_ids: [],
    content: "Monitor absolute neutrophil count weekly for the first 18 weeks of treatment.",
    source_strength: "strong",
    source_metadata: normalizeSourceMetadata({
      document_status: "current",
      clinical_Readiness: "approved",
    }),
  },
];

const ANSWER: ClientRagAnswerPayload = {
  answer: "Monitor absolute neutrophil count weekly for the first 18 weeks of treatment.",
  grounded: true,
  confidence: "high",
  citations: [
    {
      chunk_id: "chunk-1",
      document_id: "doc-1",
      title: "WA Clozapine Monitoring Protocol",
      file_name: "wa-clozapine-protocol.pdf",
      page_number: 12,
      chunk_index: 0,
    },
  ],
  sources: SOURCES,
  strongSupportLabelCapped: false,
};

function renderSurface({
  restoredSavedAt = null,
  restoredNow,
  onRecheckAnswer,
  generating = false,
}: {
  restoredSavedAt?: number | null;
  restoredNow?: number;
  onRecheckAnswer?: () => void;
  generating?: boolean;
} = {}) {
  const renderModel = buildAnswerRenderModel(ANSWER, {
    sources: SOURCES,
  });

  return render(
    <StagedAnswerResultSurface
      answer={ANSWER}
      query="clozapine anc monitoring"
      bestSource={null}
      renderModel={renderModel}
      weakEvidence={false}
      sources={SOURCES}
      demoMode={false}
      safetyFindings={[]}
      copiedAnswer={false}
      pendingFeedback={null}
      onCopyAnswer={vi.fn()}
      onSubmitFeedback={vi.fn()}
      generating={generating}
      restoredSavedAt={restoredSavedAt}
      restoredNow={restoredNow}
      onRecheckAnswer={onRecheckAnswer}
    />,
  );
}

describe("StagedAnswerResultSurface restored answer age disclosure and recheck action (R32)", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not render the restored answer notice on a live answer", () => {
    renderSurface({ restoredSavedAt: null });
    expect(screen.queryByTestId("restored-answer-notice")).not.toBeInTheDocument();
  });

  it("discloses when an answer was restored from sessionStorage and triggers onRecheckAnswer when Recheck now is clicked", () => {
    const onRecheckAnswer = vi.fn();
    const savedAt = 1_700_000_000_000;
    const now = savedAt + 25 * 60_000;

    renderSurface({
      restoredSavedAt: savedAt,
      restoredNow: now,
      onRecheckAnswer,
    });

    const notice = screen.getByTestId("restored-answer-notice");
    expect(notice).toHaveTextContent("Restored from earlier in this tab (25 minutes ago)");
    expect(notice).toHaveTextContent("library documents may have changed since this answer was generated");

    const recheckBtn = screen.getByTestId("restored-answer-recheck");
    expect(recheckBtn).toBeEnabled();
    fireEvent.click(recheckBtn);
    expect(onRecheckAnswer).toHaveBeenCalledTimes(1);
  });

  it("disables the Recheck now button while a generation is already in flight", () => {
    const savedAt = 1_700_000_000_000;
    renderSurface({
      restoredSavedAt: savedAt,
      restoredNow: savedAt + 5 * 60_000,
      onRecheckAnswer: vi.fn(),
      generating: true,
    });

    expect(screen.getByTestId("restored-answer-recheck")).toBeDisabled();
  });
});
