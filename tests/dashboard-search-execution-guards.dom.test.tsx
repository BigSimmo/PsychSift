/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// It calls no React hooks (see its doc comment), so a test can call it as a plain function.
import { useDashboardSearchExecution as dashboardSearchExecution } from "@/components/clinical-dashboard/use-dashboard-search-execution";
import type { AppModeId } from "@/lib/app-modes";

// The design audit (19 Oct 2026, D-01 to D-03) found three ways the dashboard's search left the
// reader guessing: its own timeout and an expired sign-in were dropped as if superseded, a client
// network retry showed the server's "revising the draft" step, and a search outside Answer could
// put a patient detail into the address bar, recent searches or a request line.

type Deps = Parameters<typeof dashboardSearchExecution>[0];

function harness(searchMode: AppModeId) {
  let epoch = 0;
  const controllers = new Set<AbortController>();
  const router = { push: vi.fn(), replace: vi.fn() };
  const fixed: Partial<Deps> = {
    router: router as unknown as Deps["router"],
    auth: { session: null },
    query: "",
    searchMode,
    queryMode: "auto" as Deps["queryMode"],
    requestQueryMode: "auto" as Deps["requestQueryMode"],
    scopeFilters: {} as Deps["scopeFilters"],
    selectedDocumentIds: [],
    clientDemoMode: true,
    authorizationHeader: {},
    canRunSearch: true,
    mainRef: { current: null },
    searchRequestSeqRef: { current: 0 },
    searchAbortRef: { current: null },
    answerTimedOutRef: { current: false },
    answerProgressEventsRef: { current: [] },
    latestAnswerTurnRef: { current: null },
    latestAnswerSnapshotMetadataRef: { current: null },
    answerTurnSeqRef: { current: 0 },
    autoRunSearchSignatureRef: { current: null },
    modeChangeFromUiRef: { current: false },
    // What the auth provider does on a 401: abort every registered request and move the epoch.
    markSessionExpired: vi.fn(() => {
      epoch += 1;
      for (const controller of controllers) controller.abort();
    }),
    registerAuthRequest: (controller: AbortController) => {
      controllers.add(controller);
      return { epoch, release: () => controllers.delete(controller) };
    },
    isAuthEpochCurrent: (value: number) => value === epoch,
  };
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  const deps = new Proxy(fixed, {
    get(target, key: string) {
      if (key in target) return target[key as keyof Deps];
      if (!spies.has(key)) spies.set(key, vi.fn());
      return spies.get(key);
    },
  }) as Deps;
  const spy = (name: string) => {
    if (!spies.has(name)) spies.set(name, vi.fn());
    return spies.get(name)!;
  };
  return { execution: dashboardSearchExecution(deps), router, spy };
}

function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dashboard search: errors that end a request still reach the screen", () => {
  it("shows the answer timeout instead of silently clearing the spinner", async () => {
    await import("@/lib/clinical-question-patient-check");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const { execution, spy } = harness("answer");
    const run = execution.executeSearch("lithium monitoring", "answer");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await run;
    expect(spy("setError")).toHaveBeenCalledWith("Answer generation timed out. Please try again.");
    expect(spy("setLoading")).toHaveBeenLastCalledWith(false);
  });

  it("shows the sign-in message when the session ends mid-answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { execution, spy } = harness("answer");
    await execution.executeSearch("lithium monitoring", "answer");
    const message = spy("setError").mock.calls.at(-1)?.[0] as string;
    expect(message).toMatch(/sign/i);
    expect(spy("setErrorKind")).toHaveBeenLastCalledWith("session-expired");
    expect(spy("setLoading")).toHaveBeenLastCalledWith(false);
  });

  it("shows the sign-in message for a document search without a keyword retry", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { execution, spy } = harness("documents");
    await execution.executeSearch("what is the recommended lithium monitoring", "documents");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spy("setErrorKind")).toHaveBeenLastCalledWith("session-expired");
  });

  it("stays silent when the reader pressed Stop", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const { execution, spy } = harness("answer");
    const run = execution.executeSearch("lithium monitoring", "answer");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    execution.stopSearch();
    await run;
    expect(spy("setError").mock.calls.filter(([value]) => value !== null)).toEqual([]);
  });

  it("reports a long Retry-After at once instead of waiting past the watchdog", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Too many requests." }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "40" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { execution, spy } = harness("answer");
    await execution.executeSearch("lithium monitoring", "answer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spy("setError").mock.calls.at(-1)?.[0]).toBeTruthy();
  });

  it("keeps the current answer step during a client retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { execution, spy } = harness("answer");
    const run = execution.executeSearch("lithium monitoring", "answer");
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    const stages = spy("setAnswerProgressEvents")
      .mock.calls.flatMap(([events]) => (Array.isArray(events) ? events : []))
      .map((event: { stage: string }) => event.stage);
    expect(stages).not.toContain("retrying");
    expect(spy("setAnswerProgress")).toHaveBeenCalledWith(expect.stringMatching(/^Retrying/));
  });
});

describe("dashboard search: patient details are held back in every mode", () => {
  it("does not navigate a DSM search that holds a date of birth", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { execution, router, spy } = harness("dsm");
    await execution.ask("dob: 01/02/1960 bipolar criteria");
    expect(router.push).not.toHaveBeenCalled();
    expect(spy("rememberRecentQuery")).not.toHaveBeenCalled();
    expect(spy("setActionNotice")).toHaveBeenCalledWith({
      tone: "warning",
      message: expect.stringMatching(/^This search looks like it holds a patient detail/),
    });
  });

  it("does not put a medication search with a date of birth in the address bar", async () => {
    const { execution, router } = harness("prescribing");
    await execution.ask("dob: 01/02/1960 lithium");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("removes a refused question from a deep link's address", async () => {
    window.history.replaceState(null, "", "/?mode=answer&q=dob%3A+01%2F02%2F1960+lithium&run=1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { execution } = harness("answer");
    await execution.ask("dob: 01/02/1960 lithium");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?mode=answer");
  });

  it("removes a refused question from a deep link that uses the older query alias", async () => {
    window.history.replaceState(null, "", "/?mode=answer&query=dob%3A+01%2F02%2F1960+lithium&run=1");
    vi.stubGlobal("fetch", vi.fn());
    const { execution } = harness("answer");
    await execution.ask("dob: 01/02/1960 lithium");
    expect(window.location.search).toBe("?mode=answer");
  });

  it("removes a refused question from a Documents deep link, which runs without ask()", async () => {
    window.history.replaceState(null, "", "/documents/search?q=dob%3A+01%2F02%2F1960+lithium&run=1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { execution } = harness("documents");
    await execution.executeSearch("dob: 01/02/1960 lithium", "documents");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("keeps the address of the answer on screen when a new draft is refused", async () => {
    window.history.replaceState(null, "", "/?mode=answer&q=lithium&run=1");
    vi.stubGlobal("fetch", vi.fn());
    const { execution } = harness("answer");
    await execution.ask("dob: 01/02/1960 lithium");
    expect(window.location.search).toBe("?mode=answer&q=lithium&run=1");
  });

  it("still lets an ordinary DSM search through", async () => {
    const { execution, router } = harness("dsm");
    await execution.ask("bipolar criteria");
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
