/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDashboardBulkActions } from "@/components/clinical-dashboard/use-dashboard-bulk-actions";

function fixture(count: number, failSecond = false) {
  const batches: string[][] = [];
  const options = {
    selectedDocumentIds: Array.from({ length: count }, (_, i) => `doc-${i}`),
    authorizationHeader: {},
    isAuthEpochCurrent: () => true,
    markSessionExpired: vi.fn(),
    refresh: vi.fn(async () => {}),
    setIndexingActive: vi.fn(),
    setUserStartedIngestion: vi.fn(),
    authBoundFetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { documentIds } = JSON.parse(String(init?.body)) as { documentIds: string[] };
      batches.push(documentIds);
      return {
        requestEpoch: 1,
        response: Response.json(
          failSecond && batches.length === 2
            ? { error: "Second batch failed" }
            : { results: documentIds.map(() => ({ ok: true })) },
          { status: failSecond && batches.length === 2 ? 500 : 200 },
        ),
      };
    }),
  };
  return { options, batches };
}

describe("active dashboard bulk reindex hook", () => {
  it.each([10, 11, 23])("batches %i selected documents within the server cap and totals all results", async (count) => {
    const { options, batches } = fixture(count);
    const { result } = renderHook(() => useDashboardBulkActions(options));
    await act(() => result.current.bulkReindexSelected("full"));
    expect(batches.flat()).toEqual(options.selectedDocumentIds);
    expect(batches.every((batch) => batch.length <= 10)).toBe(true);
    expect(result.current.bulkActionStatus).toContain(`${count} queue requests succeeded; 0 failed`);
    expect(options.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.bulkActionBusy).toBe(false);
  });

  it("refreshes queued work after a later batch fails and stops further submissions", async () => {
    const { options, batches } = fixture(23, true);
    const { result } = renderHook(() => useDashboardBulkActions(options));
    await act(() => result.current.bulkReindexSelected("full"));
    expect(batches.map((batch) => batch.length)).toEqual([10, 10]);
    expect(result.current.bulkActionStatus).toBe(
      "Second batch failed (bulk reindex: 10 succeeded; 0 failed; 13 not queued).",
    );
    expect(options.setIndexingActive).toHaveBeenCalledWith(true);
    expect(options.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the plain error when the first batch fails", async () => {
    const { options } = fixture(5);
    options.authBoundFetch.mockImplementationOnce(async () => ({
      requestEpoch: 1,
      response: Response.json({ error: "First batch failed" }, { status: 500 }),
    }));
    const { result } = renderHook(() => useDashboardBulkActions(options));
    await act(() => result.current.bulkReindexSelected("full"));
    expect(result.current.bulkActionStatus).toBe("First batch failed");
    expect(options.refresh).not.toHaveBeenCalled();
  });
});
