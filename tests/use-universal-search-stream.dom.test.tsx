import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  groupIsWorthShowing,
  useUniversalSearch,
  clearUniversalSearchCacheForTests,
} from "@/components/clinical-dashboard/use-universal-search";
import type { UniversalSearchGroup, UniversalSearchResponse } from "@/lib/universal-search";
import type { UniversalSearchStreamEvent } from "@/lib/universal-search-stream";

const authSession = vi.hoisted(() => ({
  authorizationHeader: { Authorization: "Bearer universal-search-test" },
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

const encoder = new TextEncoder();

function controlledNdjsonResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
      cancel(reason) {
        cancelled(reason);
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
  );

  return {
    response,
    cancelled,
    write(event: UniversalSearchStreamEvent) {
      controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    },
    close() {
      controller.close();
    },
  };
}

function searchGroup(kind: "medications" | "tools", title: string): UniversalSearchGroup {
  return {
    kind,
    total: 1,
    latencyMs: 4,
    items: [
      {
        id: `${kind}-${title.toLowerCase().replaceAll(" ", "-")}`,
        kind,
        title,
        href: `/${kind}/${title.toLowerCase().replaceAll(" ", "-")}`,
        score: 10,
      },
    ],
  };
}

async function startDebouncedRequest() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

async function flushStream() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  vi.useFakeTimers();
  clearUniversalSearchCacheForTests();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearUniversalSearchCacheForTests();
});

describe("useUniversalSearch NDJSON integration", () => {
  it("renders each ready group before committing the canonical final response", async () => {
    const query = "progressive parity query";
    const stream = controlledNdjsonResponse();
    const medicationGroup = searchGroup("medications", "Clozapine");
    const toolsGroup = searchGroup("tools", "Dose calculator");
    const final: UniversalSearchResponse = {
      query,
      groups: [toolsGroup, medicationGroup],
      tookMs: 12,
      domainOrder: ["tools", "medications"],
      contextMode: "answer",
      preferredDomains: ["tools"],
    };
    fetchMock.mockResolvedValue(stream.response);

    const { result } = renderHook(() =>
      useUniversalSearch({ query, enabled: true, contextMode: "answer", excludeDomains: ["documents"] }),
    );
    await startDebouncedRequest();

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(requestUrl.searchParams.get("stream")).toBe("ndjson");

    stream.write({ type: "group", query, group: medicationGroup });
    await flushStream();
    expect(result.current).toMatchObject({ groups: [medicationGroup], loading: true, query });

    stream.write({ type: "group", query, group: toolsGroup });
    await flushStream();
    expect(result.current.groups).toEqual([medicationGroup, toolsGroup]);
    expect(result.current.loading).toBe(true);

    stream.write({ type: "complete", response: final });
    stream.close();
    await flushStream();
    expect(result.current).toMatchObject({
      groups: final.groups,
      loading: false,
      query,
      domainOrder: final.domainOrder,
      contextMode: final.contextMode,
      preferredDomains: final.preferredDomains,
    });
  });

  it("aborts superseded streams, ignores their partial state, and caches only completed responses", async () => {
    const firstQuery = "uncached partial query";
    const secondQuery = "completed cached query";
    const firstStream = controlledNdjsonResponse();
    const secondStream = controlledNdjsonResponse();
    const thirdStream = controlledNdjsonResponse();
    const firstGroup = searchGroup("medications", "First partial");
    const secondGroup = searchGroup("tools", "Second complete");
    const streams = [firstStream, secondStream, thirdStream];
    const requestSignals: AbortSignal[] = [];
    fetchMock.mockImplementation((_input, init) => {
      requestSignals.push(init?.signal as AbortSignal);
      return Promise.resolve(streams[requestSignals.length - 1].response);
    });

    const { result, rerender } = renderHook(
      ({ query }) => useUniversalSearch({ query, enabled: true, contextMode: "answer" }),
      { initialProps: { query: firstQuery } },
    );
    await startDebouncedRequest();
    firstStream.write({ type: "group", query: firstQuery, group: firstGroup });
    await flushStream();
    expect(result.current).toMatchObject({ groups: [firstGroup], loading: true });

    rerender({ query: secondQuery });
    await flushStream();
    expect(requestSignals[0].aborted).toBe(true);
    expect(firstStream.cancelled).toHaveBeenCalledOnce();
    expect(result.current.groups).toEqual([]);

    await startDebouncedRequest();
    const completedResponse: UniversalSearchResponse = {
      query: secondQuery,
      groups: [secondGroup],
      tookMs: 8,
      contextMode: "answer",
    };
    secondStream.write({ type: "complete", response: completedResponse });
    secondStream.close();
    await flushStream();
    expect(result.current).toMatchObject({ groups: [secondGroup], loading: false, query: secondQuery });

    // The aborted first query had only a partial group, so revisiting it must fetch again.
    rerender({ query: firstQuery });
    await startDebouncedRequest();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // The completed second query is cached; returning to it aborts the third request and needs no fourth fetch.
    rerender({ query: secondQuery });
    await flushStream();
    await startDebouncedRequest();
    expect(requestSignals[2].aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ groups: [secondGroup], loading: false, query: secondQuery });
  });
});

/**
 * An empty group is noise; an empty DEGRADED group is a false absence. The catalogue could not be
 * read, the in-bundle list holds no match for this query, and dropping the group shows a confident
 * "no matches" for a question nobody answered — the same silent-absence failure as the outage that
 * prompted all of this, one layer up.
 */
describe("useUniversalSearch too-long and failed requests (#HXC4D4)", () => {
  function render(query: string) {
    return renderHook(({ q }) => useUniversalSearch({ query: q, enabled: true, contextMode: "answer" }), {
      initialProps: { q: query },
    });
  }

  it("reports a too-long query without fetching, rather than a silent empty result", async () => {
    const { result } = render("x".repeat(201));
    await startDebouncedRequest();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ groups: [], loading: false, tooLong: true });
    expect(result.current.error).toBeUndefined();
  });

  it("still searches a query of exactly 200 characters", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    const { result } = render("x".repeat(200));
    await startDebouncedRequest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.tooLong).toBeFalsy();
  });

  it("reports a non-OK response as an error, and never caches it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    const { result, rerender } = render("lithium");
    await startDebouncedRequest();
    await flushStream();

    expect(result.current).toMatchObject({ groups: [], loading: false });
    // Nothing retries the same query on its own, so the notice must not promise it.
    expect(result.current.error).toBe("Could not load matches from other areas. Edit the search to try again.");
    expect(result.current.tooLong).toBeFalsy();

    // Leave and come back to the same query: an error is not a cached answer, so it
    // refetches, and the old error does not stand in for the new request meanwhile.
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    rerender({ q: "lithium carbonate" });
    await startDebouncedRequest();
    rerender({ q: "lithium" });
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await startDebouncedRequest();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a network failure as an error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = render("lithium");
    await startDebouncedRequest();
    await flushStream();

    expect(result.current.error).toBeTruthy();
    expect(result.current.loading).toBe(false);
  });

  it("stays silent when a superseded request is aborted", async () => {
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { result, rerender } = render("lithium");
    await startDebouncedRequest();
    rerender({ q: "lithium toxicity" });
    await flushStream();

    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(true);
  });
});

describe("groupIsWorthShowing", () => {
  const group = (overrides: Partial<UniversalSearchGroup> = {}): UniversalSearchGroup => ({
    kind: "forms",
    total: 1,
    items: [{ id: "a", kind: "forms", title: "A form", href: "/forms/a", score: 1 }],
    latencyMs: 12,
    ...overrides,
  });

  it("shows a group that has results", () => {
    expect(groupIsWorthShowing(group())).toBe(true);
  });

  it("hides an ordinary empty group", () => {
    expect(groupIsWorthShowing(group({ items: [], total: 0 }))).toBe(false);
  });

  it("keeps an empty group that was served from seeds", () => {
    expect(groupIsWorthShowing(group({ items: [], total: 0, degraded: true }))).toBe(true);
  });

  it("still hides an errored group, degraded or not", () => {
    expect(groupIsWorthShowing(group({ items: [], total: 0, error: true }))).toBe(false);
    expect(groupIsWorthShowing(group({ items: [], total: 0, error: true, degraded: true }))).toBe(false);
  });
});

describe("useUniversalSearch patient-detail screening (design audit D-03)", () => {
  it("fetches no suggestions for text shaped like a labelled date of birth", async () => {
    const { result } = renderHook(() =>
      useUniversalSearch({ query: "dob: 01/02/1960 lithium", enabled: true, contextMode: "documents" }),
    );
    await startDebouncedRequest();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ groups: [], loading: false, withheld: true });
  });

  it("fetches no suggestions for a named patient once the fuller check has loaded", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    const { result, rerender } = renderHook(
      ({ query }) => useUniversalSearch({ query, enabled: true, contextMode: "prescribing" }),
      { initialProps: { query: "lithium" } },
    );
    await startDebouncedRequest();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ query: "Mr John Citizen lithium" });
    await startDebouncedRequest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ groups: [], loading: false, withheld: true });
  });
});
