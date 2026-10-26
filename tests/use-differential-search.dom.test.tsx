import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { preloadSearchPatientCheck } from "@/components/clinical-dashboard/search-patient-detail-guard";
import {
  clearDifferentialSearchCacheForTests,
  useDifferentialSearch,
} from "@/components/clinical-dashboard/use-differential-catalog";

const authSession = vi.hoisted(() => ({
  authorizationHeader: { Authorization: "Bearer differential-search-test" },
  markSessionExpired: vi.fn(),
  session: { user: { id: "user-a" } },
  status: "authenticated" as const,
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => authSession,
}));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

// Searches check typed text for patient details before they send or navigate; load the check
// once up front so the steps below see the request go out (privacy audit S1, 2026-10-26).
beforeAll(async () => {
  await preloadSearchPatientCheck();
});

beforeEach(() => {
  vi.useFakeTimers();
  clearDifferentialSearchCacheForTests();
  authSession.markSessionExpired.mockReset();
  authSession.authorizationHeader = { Authorization: "Bearer differential-search-test" };
  authSession.session = { user: { id: "user-a" } };
  authSession.status = "authenticated";
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearDifferentialSearchCacheForTests();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function advanceDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useDifferentialSearch debounce/abort/cache", () => {
  it("debounces fetches, aborts superseded keystrokes, and serves LRU cache hits", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    const presentationMatch = {
      workflow: { slug: "low-mood", title: "Low mood" },
      score: 9,
      reasons: ["title"],
    };
    const requestSignals: AbortSignal[] = [];
    fetchMock.mockImplementation((_input, init) => {
      requestSignals.push(init?.signal as AbortSignal);
      const url = String(_input);
      if (url.includes("kind=diagnosis")) {
        return Promise.resolve(jsonResponse({ matches: [diagnosisMatch], demoMode: true }));
      }
      return Promise.resolve(jsonResponse({ matches: [presentationMatch], demoMode: true }));
    });

    const { result, rerender } = renderHook(({ query }) => useDifferentialSearch(query), {
      initialProps: { query: "dep" },
    });
    expect(result.current.status).toBe("loading");
    expect(fetchMock).not.toHaveBeenCalled();

    await advanceDebounce();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({
      status: "ready",
      demoMode: true,
      matches: {
        diagnoses: [diagnosisMatch],
        presentations: [presentationMatch],
      },
    });

    rerender({ query: "depre" });
    expect(result.current.status).toBe("loading");
    await flushMicrotasks();
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(requestSignals[1]?.aborted).toBe(true);

    await advanceDebounce();
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe("ready");

    // Revisiting the first query hits the auth-keyed LRU and skips the network.
    const callsBeforeCacheHit = fetchMock.mock.calls.length;
    rerender({ query: "dep" });
    await flushMicrotasks();
    await advanceDebounce();
    await flushMicrotasks();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeCacheHit);
    expect(result.current).toMatchObject({
      status: "ready",
      matches: {
        diagnoses: [diagnosisMatch],
        presentations: [presentationMatch],
      },
    });
  });

  it("does not fetch for empty queries", async () => {
    const { result } = renderHook(() => useDifferentialSearch("   "));
    await advanceDebounce();
    expect(fetchMock).not.toHaveBeenCalled();
    // toMatchObject rather than toEqual: the hook also returns a `refetch`
    // callback, which this case is not asserting on.
    expect(result.current).toMatchObject({
      status: "ready",
      matches: { diagnoses: [], presentations: [] },
      demoMode: false,
    });
    expect(typeof result.current.refetch).toBe("function");
  });

  it("clears prior matches immediately when the auth identity changes", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((_input) => {
      const url = String(_input);
      if (url.includes("kind=diagnosis")) {
        return Promise.resolve(jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      }
      return Promise.resolve(jsonResponse({ matches: [], demoMode: false }));
    });

    const { result, rerender } = renderHook(() => useDifferentialSearch("depression"));
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);

    authSession.authorizationHeader = { Authorization: "Bearer other-user" };
    authSession.session = { user: { id: "user-b" } };
    rerender();
    expect(result.current.status).toBe("loading");
    expect(result.current.matches).toEqual({ diagnoses: [], presentations: [] });

    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
  });

  it("keeps same-query matches visible while a same-user token refresh refetches", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? { matches: [diagnosisMatch], demoMode: false }
            : { matches: [], demoMode: false },
        ),
      ),
    );

    const { result, rerender } = renderHook(() => useDifferentialSearch("depression"));
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");

    let resolveDiagnosis!: (response: Response) => void;
    let resolvePresentation!: (response: Response) => void;
    fetchMock.mockImplementation(
      (input) =>
        new Promise<Response>((resolve) => {
          if (String(input).includes("kind=diagnosis")) resolveDiagnosis = resolve;
          else resolvePresentation = resolve;
        }),
    );

    authSession.authorizationHeader = { Authorization: "Bearer refreshed-same-user" };
    rerender();
    expect(result.current.status).toBe("refetching");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);

    await advanceDebounce();
    await act(async () => {
      resolveDiagnosis(jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      resolvePresentation(jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
  });

  it("retries over the network after a warm-cache error instead of soft-succeeding", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? { matches: [diagnosisMatch], demoMode: false }
            : { matches: [], demoMode: false },
        ),
      ),
    );

    const { result } = renderHook(() => useDifferentialSearch("depression"));
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: "boom" }, 500)));
    await act(async () => {
      result.current.refetch();
    });
    await advanceDebounce();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(result.current.status).toBe("error");

    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    await act(async () => {
      result.current.refetch();
    });
    expect(result.current.status).toBe("refetching");
    expect(result.current.matches.diagnoses).toEqual([]);
    await advanceDebounce();
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[0](jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      pending[1](jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);
  });

  it("refetches after an error when the same identity refreshes credentials", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? { matches: [diagnosisMatch], demoMode: false }
            : { matches: [], demoMode: false },
        ),
      ),
    );

    const { result, rerender } = renderHook(() => useDifferentialSearch("depression"));
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: "boom" }, 500)));
    await act(async () => {
      result.current.refetch();
    });
    expect(result.current.status).toBe("refetching");
    await advanceDebounce();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(result.current.status).toBe("error");
    expect(result.current.matches.diagnoses).toEqual([]);

    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    authSession.authorizationHeader = { Authorization: "Bearer refreshed-after-error" };
    rerender();
    expect(result.current.status).toBe("loading");
    expect(result.current.matches.diagnoses).toEqual([]);
    await advanceDebounce();
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[0](jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      pending[1](jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);
  });

  it("keeps refetching across back-to-back same-identity credential refreshes", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    const refreshedMatch = {
      record: { slug: "persistent-depressive-disorder", title: "Persistent depressive disorder" },
      score: 10,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? { matches: [diagnosisMatch], demoMode: false }
            : { matches: [], demoMode: false },
        ),
      ),
    );

    const { result, rerender } = renderHook(() => useDifferentialSearch("depression"));
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");

    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));

    authSession.authorizationHeader = { Authorization: "Bearer refreshed-same-user" };
    rerender();
    expect(result.current.status).toBe("refetching");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);
    await advanceDebounce();
    expect(pending).toHaveLength(2);

    authSession.authorizationHeader = { Authorization: "Bearer refreshed-same-user-again" };
    rerender();
    expect(result.current.status).toBe("refetching");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);
    await advanceDebounce();
    expect(pending).toHaveLength(4);

    await act(async () => {
      pending[0](jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      pending[1](jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current.status).toBe("refetching");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);

    await act(async () => {
      pending[2](jsonResponse({ matches: [refreshedMatch], demoMode: false }));
      pending[3](jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
    expect(result.current.matches.diagnoses).toEqual([refreshedMatch]);
  });

  it("ignores a late previous-user refresh after the auth identity changes", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? { matches: [diagnosisMatch], demoMode: false }
            : { matches: [], demoMode: false },
        ),
      ),
    );

    const { result, rerender } = renderHook(() => useDifferentialSearch("depression"));
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");

    const pending: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    authSession.authorizationHeader = { Authorization: "Bearer refreshed-same-user" };
    rerender();
    await advanceDebounce();
    expect(pending).toHaveLength(2);

    authSession.authorizationHeader = { Authorization: "Bearer user-b" };
    authSession.session = { user: { id: "user-b" } };
    rerender();
    expect(result.current).toMatchObject({
      status: "loading",
      matches: { diagnoses: [], presentations: [] },
    });
    await advanceDebounce();
    expect(pending).toHaveLength(4);

    await act(async () => {
      pending[0](jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      pending[1](jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current).toMatchObject({
      status: "loading",
      matches: { diagnoses: [], presentations: [] },
    });

    await act(async () => {
      pending[2](jsonResponse({ matches: [], demoMode: false }));
      pending[3](jsonResponse({ matches: [], demoMode: false }));
    });
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
  });

  it("clears the search LRU on 401 so prior authorized hits cannot resurface", async () => {
    const diagnosisMatch = {
      record: { slug: "major-depressive-disorder", title: "Major depressive disorder" },
      score: 12,
      reasons: ["title"],
    };
    fetchMock.mockImplementation((_input) => {
      const url = String(_input);
      if (url.includes("kind=diagnosis")) {
        return Promise.resolve(jsonResponse({ matches: [diagnosisMatch], demoMode: false }));
      }
      return Promise.resolve(jsonResponse({ matches: [], demoMode: false }));
    });

    const { result, rerender } = renderHook(({ q }) => useDifferentialSearch(q), {
      initialProps: { q: "depression" },
    });
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("ready");
    expect(result.current.matches.diagnoses).toEqual([diagnosisMatch]);

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: "unauthorized" }, 401)));
    rerender({ q: "anxiety" });
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("unauthorized");
    expect(authSession.markSessionExpired).toHaveBeenCalled();

    // Same identity + prior query must not resurrect the pre-401 cache entry.
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: "unauthorized" }, 401)));
    rerender({ q: "depression" });
    expect(result.current.status).toBe("loading");
    expect(result.current.matches.diagnoses).toEqual([]);
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.status).toBe("unauthorized");
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("useDifferentialSearch retry", () => {
  // A Retry button that cannot re-issue the failed request is worse than none:
  // it promises recovery and silently does nothing. The hook keys on query +
  // auth identity, neither of which changes when the reader asks to try again.
  it("re-requests both catalogue endpoints when refetch is called after a failure", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: "boom" }, 500)));

    const { result } = renderHook(() => useDifferentialSearch("acute confusion"));
    await advanceDebounce();
    await flushMicrotasks();

    expect(result.current.status).toBe("error");
    const callsBeforeRetry = fetchMock.mock.calls.length;
    expect(callsBeforeRetry).toBeGreaterThan(0);

    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? {
                matches: [{ record: { slug: "delirium", title: "Delirium" }, score: 5, reasons: ["title"] }],
                demoMode: true,
              }
            : { matches: [], demoMode: true },
        ),
      ),
    );

    await act(async () => {
      result.current.refetch();
    });
    await advanceDebounce();
    await flushMicrotasks();

    const retryCalls = fetchMock.mock.calls.slice(callsBeforeRetry).map(([input]) => String(input));
    expect(retryCalls.some((url) => url.includes("kind=diagnosis"))).toBe(true);
    expect(retryCalls.some((url) => url.includes("kind=presentation"))).toBe(true);
    expect(result.current.status).toBe("ready");
  });
});

describe("useDifferentialSearch surfaces a degraded catalogue", () => {
  function respond(options: { diagnosisDegraded?: boolean; presentationDegraded?: boolean }) {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        jsonResponse(
          String(input).includes("kind=diagnosis")
            ? {
                matches: [{ record: { slug: "delirium", title: "Delirium" }, score: 5, reasons: ["title"] }],
                demoMode: true,
                ...(options.diagnosisDegraded ? { degraded: true } : {}),
              }
            : {
                matches: [{ workflow: { slug: "confusion", title: "Confusion" }, score: 4, reasons: ["title"] }],
                demoMode: true,
                ...(options.presentationDegraded ? { degraded: true } : {}),
              },
        ),
      ),
    );
  }

  it.each([
    ["the diagnosis catalogue", { diagnosisDegraded: true }],
    ["the presentation catalogue", { presentationDegraded: true }],
    ["both catalogues", { diagnosisDegraded: true, presentationDegraded: true }],
  ])("reports degraded when %s fell back to the in-bundle list", async (_label, options) => {
    respond(options);
    const { result } = renderHook(() => useDifferentialSearch("delirium"));
    await advanceDebounce();
    await flushMicrotasks();

    expect(result.current.status).toBe("ready");
    // Either half being stale makes the merged result set stale: a result card does not say
    // which catalogue it came from, so the caveat has to cover the whole list.
    expect(result.current.degraded).toBe(true);
  });

  it("reports a healthy catalogue as not degraded", async () => {
    respond({});
    const { result } = renderHook(() => useDifferentialSearch("delirium"));
    await advanceDebounce();
    await flushMicrotasks();

    expect(result.current.status).toBe("ready");
    expect(result.current.degraded).toBe(false);
  });

  it("keeps the flag on a cache hit rather than quietly healing it", async () => {
    respond({ diagnosisDegraded: true });
    const { result, rerender } = renderHook(({ query }) => useDifferentialSearch(query), {
      initialProps: { query: "delirium" },
    });
    await advanceDebounce();
    await flushMicrotasks();
    expect(result.current.degraded).toBe(true);

    rerender({ query: "psychosis" });
    await advanceDebounce();
    await flushMicrotasks();
    rerender({ query: "delirium" });
    await flushMicrotasks();

    expect(result.current.status).toBe("ready");
    expect(result.current.degraded).toBe(true);
  });
});
