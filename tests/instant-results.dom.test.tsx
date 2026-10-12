/** @vitest-environment jsdom */

import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResultRowsPlaceholder } from "@/components/clinical-dashboard/result-rows-placeholder";
import { useMedicationCatalog } from "@/components/clinical-dashboard/use-medication-catalog";
import {
  medicationCatalogueWarmupUrl,
  resetModeResultsWarmupForTests,
  useModeResultsWarmup,
  warmModeResults,
} from "@/components/clinical-dashboard/use-mode-results-warmup";

/**
 * Results that feel instant (site recommendations 2026-10-12, item 6). These change WHEN
 * results appear, never which results or their order, so every case here is about timing
 * and loading presentation only.
 */

const authSession = vi.hoisted(() => ({
  authorizationHeader: undefined as Record<string, string> | undefined,
  markSessionExpired: vi.fn(),
  session: null,
  status: "signed_out" as "signed_out" | "loading" | "authenticated",
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ records: [], total: 0 })));
  vi.stubGlobal("fetch", fetchMock);
  resetModeResultsWarmupForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("medication catalogue request timing", () => {
  it("sends the first request of a freshly opened results view without the typing debounce", async () => {
    vi.useFakeTimers();
    renderHook(() => useMedicationCatalog("lithium"));
    // Zero-delay timer: nothing waits out the 250 ms keystroke pause on a submitted search.
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/medications?q=lithium");
  });

  it("still debounces later query changes, so typing does not send a request per keystroke", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ query }) => useMedicationCatalog(query), {
      initialProps: { query: "lithium" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ query: "lithium l" });
    rerender({ query: "lithium le" });
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/medications?q=lithium+le");
  });
});

describe("medication catalogue request while sign-in resolves", () => {
  afterEach(() => {
    authSession.status = "signed_out";
  });

  it("waits out the pause while sign-in is loading, then sends the resolved request at once", async () => {
    vi.useFakeTimers();
    authSession.status = "loading";
    const { rerender } = renderHook(() => useMedicationCatalog("lithium"));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    // No anonymous zero-delay request while the session is still resolving.
    expect(fetchMock).not.toHaveBeenCalled();

    authSession.status = "signed_out";
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("mode results warm-up", () => {
  it("warms the medication catalogue once, with no query text and no model-backed route", () => {
    expect(warmModeResults("prescribing")).toBe(true);
    expect(warmModeResults("prescribing")).toBe(false);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([medicationCatalogueWarmupUrl]);
    expect(medicationCatalogueWarmupUrl).not.toMatch(/[?&]q=/);
    expect(urls.some((url) => url.startsWith("/api/search") || url.startsWith("/api/answer"))).toBe(false);
  });

  it("makes no data request for documents, whose search is retrieval-backed", () => {
    expect(warmModeResults("documents")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for a mode with no warm-up", () => {
    expect(warmModeResults("dsm")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts after the page goes idle and is cancelled if the home closes first", async () => {
    vi.useFakeTimers();
    const first = renderHook(() => useModeResultsWarmup("prescribing"));
    first.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).not.toHaveBeenCalled();

    renderHook(() => useModeResultsWarmup("prescribing"));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("result rows placeholder", () => {
  it("is one named status region whose shimmer rows are hidden from assistive technology", () => {
    render(<ResultRowsPlaceholder label="Loading medication results" rows={3} testId="placeholder" />);
    const region = screen.getByRole("status", { name: "Loading medication results" });
    expect(region).toBe(screen.getByTestId("placeholder"));
    expect(region).not.toHaveAttribute("aria-live");
    const rows = region.querySelectorAll(":scope > [aria-hidden]");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("Loading medication results")).toHaveClass("sr-only");
  });
});
