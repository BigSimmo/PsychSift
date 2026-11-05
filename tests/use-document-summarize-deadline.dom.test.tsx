import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentSummarize } from "@/components/document-viewer/use-document-summarize";
import { answerRequestMaxDurationMs, answerStallTimeoutMs } from "@/components/clinical-dashboard/search-utils";

const encoder = new TextEncoder();
function streamResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel: cancelled,
    }),
  );
  return { response, cancelled, write: (text: string) => controller.enqueue(encoder.encode(text)) };
}
async function flush() {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  });
}
function renderSummary() {
  const release = vi.fn();
  const registerAuthRequest = vi.fn<(controller: AbortController) => { epoch: number; release: typeof release }>(
    () => ({
      epoch: 1,
      release,
    }),
  );
  const options = {
    documentId: "synthetic-document",
    canUsePrivateApis: true,
    clientDemoMode: false,
    viewerReady: true,
    authorizationHeader: { Authorization: "Bearer synthetic-summary" },
    registerAuthRequest,
    isAuthEpochCurrent: vi.fn(() => true),
    markSessionExpired: vi.fn(),
    generatedSummaryRef: { current: null },
  };
  return { ...renderHook(() => useDocumentSummarize(options)), options, release };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("document summary transport deadlines", () => {
  it.each(["headers", "error JSON", "stream"] as const)(
    "bounds stalled %s and releases the auth request",
    async (stage) => {
      const stream = streamResponse();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockReturnValue(
          stage === "headers"
            ? new Promise<Response>(() => undefined)
            : Promise.resolve(
                stage === "stream"
                  ? stream.response
                  : ({ ok: false, status: 503, json: () => new Promise(() => undefined) } as Response),
              ),
        );
      vi.stubGlobal("fetch", fetchMock);
      const hook = renderSummary();
      act(() => {
        void hook.result.current.summarize();
      });
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(answerStallTimeoutMs);
      });
      expect(hook.result.current.loadingSummary).toBe(false);
      expect(hook.result.current.summaryError).toMatch(/timed out.*try again/i);
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(hook.release).toHaveBeenCalledOnce();
      if (stage === "stream") expect(stream.cancelled).toHaveBeenCalledOnce();
    },
  );

  it("keeps a slow live stream alive on heartbeat bytes but bounds its total duration", async () => {
    const stream = streamResponse();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(stream.response));
    const hook = renderSummary();
    act(() => {
      void hook.result.current.summarize();
    });
    await flush();
    for (let elapsed = 0; elapsed < 150_000; elapsed += 50_000) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50_000);
      });
      stream.write(": heartbeat\n\n");
      await flush();
      expect(hook.result.current.loadingSummary).toBe(true);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(answerRequestMaxDurationMs - 150_000);
    });
    expect(hook.result.current.loadingSummary).toBe(false);
    expect(hook.result.current.summaryError).toMatch(/timed out.*try again/i);
    expect(hook.release).toHaveBeenCalledOnce();
  });

  it("keeps stop silent, releases an abort-ignoring request, and cancels its deadline", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderSummary();
    act(() => {
      void hook.result.current.summarize();
    });
    await flush();
    act(() => {
      hook.result.current.stopSummary();
    });
    await flush();
    expect(hook.release).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(answerRequestMaxDurationMs);
    });
    expect(hook.result.current.loadingSummary).toBe(false);
    expect(hook.result.current.summaryError).toBeNull();
  });

  it("suppresses a late old-epoch response and releases its auth registration on abort", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockReturnValue(
        new Promise<Response>((finish) => {
          resolve = finish;
        }),
      ),
    );
    const hook = renderSummary();
    act(() => {
      void hook.result.current.summarize();
    });
    await flush();
    hook.options.isAuthEpochCurrent.mockReturnValue(false);
    act(() => {
      hook.options.registerAuthRequest.mock.calls[0][0].abort();
    });
    await flush();
    expect(hook.release).toHaveBeenCalledOnce();
    resolve(new Response("{}", { status: 401 }));
    await flush();
    expect(hook.options.markSessionExpired).not.toHaveBeenCalled();
    expect(hook.result.current.summary).toBeNull();
    expect(hook.result.current.summaryError).toBeNull();
  });

  it("commits a normal terminal answer, cleans its deadline, and can retry after timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderSummary();
    act(() => {
      void hook.result.current.summarize();
    });
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(answerStallTimeoutMs);
    });
    const payload = { answer: "Synthetic summary.", grounded: true, confidence: "medium", citations: [], sources: [] };
    fetchMock.mockResolvedValueOnce(new Response(`event: final\ndata: ${JSON.stringify(payload)}\n\n`));
    act(() => {
      void hook.result.current.summarize();
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.result.current.summary?.answer).toBe(payload.answer);
    expect(hook.result.current.summaryError).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(answerRequestMaxDurationMs);
    });
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(false);
    expect(hook.release).toHaveBeenCalledTimes(2);
  });
});
