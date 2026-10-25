// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IndexingMonitor } from "@/components/clinical-dashboard/DocumentManagerPanel";
import { LiveAnnouncer, resetAnnouncerForTests } from "@/components/ui/live-announcer";
import type { IngestionJob } from "@/lib/types";

// Each job row used to carry its own polite live region with the percentage, so
// every poll during a batch queued one announcement per row for up to ten rows.

function job(id: string, title: string, status: IngestionJob["status"], progress: number): IngestionJob {
  return {
    id,
    document_id: `doc-${id}`,
    status,
    stage: "Indexing",
    progress,
    error_message: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    documents: { title, file_name: `${id}.pdf`, status: "processing" },
  };
}

function monitor(jobs: IngestionJob[]) {
  return (
    <>
      <LiveAnnouncer />
      <IndexingMonitor
        jobs={jobs}
        batches={[]}
        filter="all"
        actionId={null}
        onRetry={vi.fn()}
        onReindex={vi.fn()}
        onEnrich={vi.fn()}
      />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAnnouncerForTests();
});

afterEach(() => {
  cleanup();
  resetAnnouncerForTests();
  vi.useRealTimers();
});

describe("IndexingMonitor announcements", () => {
  it("stays quiet on progress ticks and announces when a job finishes", () => {
    const { container, rerender } = render(
      monitor([job("a", "Guideline A", "processing", 10), job("b", "Guideline B", "processing", 5)]),
    );
    const polite = () => screen.getByTestId("live-announcer-polite").textContent;

    // Only the one shared announcer region is live; the rows carry none of their own.
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(2);

    rerender(monitor([job("a", "Guideline A", "processing", 41), job("b", "Guideline B", "processing", 12)]));
    act(() => vi.advanceTimersByTime(500));
    expect(polite()).toBe("");

    rerender(monitor([job("a", "Guideline A", "completed", 100), job("b", "Guideline B", "failed", 12)]));
    act(() => vi.advanceTimersByTime(10));
    expect(polite()).toBe("Guideline A: indexing completed");
    act(() => vi.advanceTimersByTime(500));
    expect(polite()).toBe("Guideline B: indexing failed");
  });
});
