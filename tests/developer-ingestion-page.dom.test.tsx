/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DeveloperIngestionPage from "@/app/(admin)/admin/developer-hub/ingestion/page";

// PanelPageShell's back control is a ContextualBackLink, which calls
// next/navigation's useRouter for its history-aware click handler. Outside an
// app-router tree that throws "invariant expected app router to be mounted",
// so every render here needs the router mocked, same as every other panel
// page test (for example `developer-panel-page-shell.dom.test.tsx`).
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/developer-hub/ingestion",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function readyPayload(overrides: Record<string, unknown> = {}) {
  return {
    jobs: [],
    activeJobCount: 0,
    failedJobCount: 0,
    hasActiveJobs: false,
    pollAfterMs: null,
    pagination: { limit: 100, offset: 0, total: 0, nextOffset: 0, hasMore: false },
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("developer ingestion page — shell and freshness (plan §8)", () => {
  it("renders inside the shared shell with its own freshness label, never a build-time date", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload()));
    render(<DeveloperIngestionPage />);

    expect(screen.getByTestId("developer-ingestion")).toBeInTheDocument();
    expect(screen.getByTestId("developer-ingestion-back")).toHaveAttribute("href", "/admin/developer-hub");

    // The shell's own stamp is rendered at server-render time, before the
    // client panel has fetched anything — so it says "read live on demand" (#XKS6FD),
    // not invent a build-time content date the way every Phase 1/2 panel does.
    const shellStamp = screen.getByTestId("developer-hub-freshness");
    expect(shellStamp).toHaveTextContent(/Ingestion jobs read live on demand/i);

    await screen.findByTestId("developer-ingestion-empty");
  });

  it("shows a loading state before the first response resolves", () => {
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    render(<DeveloperIngestionPage />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("renders its own live-updating checked-at line once data has been fetched, distinct from the shell stamp", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload()));
    render(<DeveloperIngestionPage />);

    const checkedAt = await screen.findByTestId("developer-ingestion-checked-at");
    expect(checkedAt).toHaveTextContent(/checked/i);
    expect(screen.getByTestId("developer-hub-freshness")).toHaveTextContent(/read live on demand/i);
  });

  // #L14: this client-rendered line followed the browser clock while the
  // shell's server-rendered stamp followed the container clock (UTC on
  // Railway), an unlabelled eight-hour gap on the one page that polls live.
  // Both now pin Australia/Perth and print the zone name.
  it("prints the timezone on the live checked-at line, pinned to Australia/Perth", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload()));
    render(<DeveloperIngestionPage />);

    const checkedAt = await screen.findByTestId("developer-ingestion-checked-at");
    expect(checkedAt).toHaveTextContent(/AWST/);
  });
});

describe("developer ingestion page — the four states (plan §4)", () => {
  it("demo mode: explains the database isn't connected, and never claims 'no jobs'", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload({ demoMode: true })));
    render(<DeveloperIngestionPage />);

    const demo = await screen.findByTestId("developer-ingestion-demo");
    expect(demo).toHaveTextContent(/not connected to a database/i);
    // Falsifying edit: collapsing the demo branch into the empty-ready branch
    // (i.e. treating `demoMode: true` as just another zero-job response) makes
    // this fail, because the empty-state copy says "No ingestion jobs".
    expect(screen.queryByText(/No ingestion jobs/i)).not.toBeInTheDocument();
  });

  it("401: explains that live job state needs an administrator sign-in, with a link to sign in", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Authentication required." }, 401));
    render(<DeveloperIngestionPage />);

    const unauthorized = await screen.findByTestId("developer-ingestion-unauthorized");
    expect(unauthorized).toHaveTextContent(/administrator sign-in/i);
    // Falsifying edit: rendering the explanation without a real navigable link
    // (e.g. plain text mentioning "sign in") makes this query find nothing.
    expect(within(unauthorized).getByRole("link")).toBeInTheDocument();
  });

  it("403 (signed in without administrator rights) reads as the same explanation as 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Forbidden." }, 403));
    render(<DeveloperIngestionPage />);
    expect(await screen.findByTestId("developer-ingestion-unauthorized")).toHaveTextContent(/administrator sign-in/i);
  });

  it("genuinely zero rows: says 'No ingestion jobs' in words", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload()));
    render(<DeveloperIngestionPage />);
    expect(await screen.findByTestId("developer-ingestion-empty")).toHaveTextContent(/No ingestion jobs/i);
  });

  it("network failure: says the check itself failed, not that there are no jobs", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<DeveloperIngestionPage />);

    const errorState = await screen.findByTestId("developer-ingestion-fetch-error");
    expect(errorState).toHaveTextContent(/could not reach/i);
    // Falsifying edit: a catch block that renders the empty-state branch
    // instead of its own would make this pass silently — assert the two are
    // textually distinct.
    expect(errorState).not.toHaveTextContent(/No ingestion jobs/i);
  });

  it("a 500 response falls into the same fetch-failed bucket as a network error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Request failed." }, 500));
    render(<DeveloperIngestionPage />);
    expect(await screen.findByTestId("developer-ingestion-fetch-error")).toHaveTextContent(/could not be reached/i);
  });

  it("malformed JSON body on 200 response reports parse error rather than network failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Not JSON</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    render(<DeveloperIngestionPage />);
    const errorState = await screen.findByTestId("developer-ingestion-fetch-error");
    expect(errorState).toHaveTextContent("Malformed response from ingestion endpoint");
    expect(errorState).toHaveTextContent(/could not be parsed as json/i);
    expect(errorState).not.toHaveTextContent(/could not reach the ingestion jobs endpoint/i);
  });

  it("an unexpected payload shape degrades to the fetch-failed state rather than inventing zero jobs", async () => {
    // Never a real server response, but proves the panel does not silently
    // treat a malformed body as "zero jobs" — degrading conservatively per
    // AGENTS.md rather than guessing.
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: "not-an-array" }));
    render(<DeveloperIngestionPage />);
    const errorState = await screen.findByTestId("developer-ingestion-fetch-error");
    expect(errorState).toHaveTextContent(/unexpected shape/i);
    // The endpoint was reached; a shared "could not reach" wrapper would
    // collapse this into the network/500 copy this panel exists to keep
    // separate.
    expect(errorState).not.toHaveTextContent(/could not reach/i);
    expect(errorState).not.toHaveTextContent(/No ingestion jobs/i);
  });

  // Same failure as the case above, reached without a Content-Type header: a proxy
  // error page served as a bare 200. Both must read as a parse failure, never as the
  // network copy, which is what separates "the endpoint answered wrongly" from "the
  // endpoint is down".
  it("a 200 error page with no content type also reports a parse failure, not a network failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html><body>502 Bad Gateway</body></html>", { status: 200 }));
    render(<DeveloperIngestionPage />);
    const errorState = await screen.findByTestId("developer-ingestion-fetch-error");
    expect(errorState).toHaveTextContent("Malformed response from ingestion endpoint");
    expect(errorState).toHaveTextContent(/could not be parsed as json/i);
    expect(errorState).not.toHaveTextContent(/could not reach the ingestion jobs endpoint/i);
  });
});

describe("developer ingestion page — counts render as given", () => {
  it("shows the server's own activeJobCount rather than recomputing a length that could disagree", async () => {
    // Deliberately mismatched: only 2 rows in this page are active-status, but
    // the query-wide server count reports 7 because five active jobs are on
    // later pages. Falsifying edit: replacing `state.activeJobCount` with
    // `active.length` in the component turns this red (it would show "2").
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        readyPayload({
          jobs: [
            { id: "job-1", status: "pending", document_id: "doc-1" },
            { id: "job-2", status: "processing", document_id: "doc-2" },
          ],
          activeJobCount: 7,
          hasActiveJobs: true,
          pollAfterMs: 5000,
          pagination: { limit: 100, offset: 0, total: 105, nextOffset: 100, hasMore: true },
        }),
      ),
    );
    render(<DeveloperIngestionPage />);

    const tile = await screen.findByTestId("developer-ingestion-count-active-value");
    expect(tile).toHaveTextContent("7");
  });

  // #L15: the tile used to derive from bucketJobs(state.jobs), i.e. only the
  // current page, so older failures beyond the newest 100 rows vanished from
  // the number — the direction this tile's own doc comment says it must not
  // fail in. Deliberately mismatched, same shape as the activeJobCount case
  // above: only 1 row on this page is failed-status, but the query-wide
  // server count reports 12.
  it("shows the server's own failedJobCount rather than recomputing a page-scoped length that could disagree (#L15)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        readyPayload({
          jobs: [{ id: "job-1", status: "failed", document_id: "doc-1" }],
          failedJobCount: 12,
          pagination: { limit: 100, offset: 0, total: 105, nextOffset: 100, hasMore: true },
        }),
      ),
    );
    render(<DeveloperIngestionPage />);

    const tile = await screen.findByTestId("developer-ingestion-count-failed-value");
    expect(tile).toHaveTextContent("12");
  });
});

describe("developer ingestion page — unrecognised status bucket (plan §5, Ruling I2)", () => {
  it("buckets an unrecognised status under its own heading, verbatim, without dropping it from the total", async () => {
    const jobs = [
      { id: "job-pending", status: "pending", document_id: "doc-1" },
      { id: "job-completed", status: "completed", document_id: "doc-2" },
      { id: "job-failed", status: "failed", document_id: "doc-3", error_message: "OCR timed out" },
      { id: "job-weird", status: "queued_manual_review", document_id: "doc-4" },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload({ jobs, activeJobCount: 1, hasActiveJobs: false })));
    render(<DeveloperIngestionPage />);

    // Falsifying edit: `bucketJobs` dropping the `other` computation (or the
    // page rendering `null` unconditionally for the other section instead of
    // only when empty) makes the row below unreachable and this query throws.
    const other = await screen.findByTestId("developer-ingestion-other");
    // The exact free-text status must appear verbatim, not summarised away.
    expect(other).toHaveTextContent("queued_manual_review");
    expect(within(other).getAllByRole("listitem")).toHaveLength(1);

    // The recognised buckets still show their own rows — nothing was
    // reclassified into "other" that the panel does recognise.
    expect(screen.getByTestId("developer-ingestion-job-job-pending")).toBeInTheDocument();
    expect(screen.getByTestId("developer-ingestion-job-job-completed")).toBeInTheDocument();
    expect(screen.getByTestId("developer-ingestion-job-job-failed")).toHaveTextContent("OCR timed out");
  });

  it("omits the unrecognised-status section entirely when every job's status is recognised", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        readyPayload({
          jobs: [{ id: "job-1", status: "completed", document_id: "doc-1" }],
          activeJobCount: 0,
        }),
      ),
    );
    render(<DeveloperIngestionPage />);
    await screen.findByTestId("developer-ingestion-job-job-1");
    expect(screen.queryByTestId("developer-ingestion-other")).not.toBeInTheDocument();
  });
});

describe("developer ingestion page — poll cadence (plan §3, Ruling I1)", () => {
  it("polls again after the server-given cadence while jobs remain active, and stops once none are", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        readyPayload({
          jobs: [{ id: "job-1", status: "processing", document_id: "doc-1" }],
          activeJobCount: 1,
          hasActiveJobs: true,
          pollAfterMs: 5000,
        }),
      ),
    );
    render(<DeveloperIngestionPage />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(
      jsonResponse(readyPayload({ jobs: [], activeJobCount: 0, hasActiveJobs: false, pollAfterMs: null })),
    );

    // Falsifying edit: hardcoding a poll interval instead of reading
    // `state.pollAfterMs` (Ruling I1 point 1 — "a value the server hands us
    // rather than a number this panel invents") would still fire at 5000ms
    // here, so this alone would not catch that regression; the next
    // assertion (no third call after the server says inactive) is what does.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // Falsifying edit: an effect that reschedules unconditionally (ignoring
    // `hasActiveJobs`/`pollAfterMs === null`) would call fetch a third time
    // here.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never polls when the server reports no active jobs", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(jsonResponse(readyPayload()));
    render(<DeveloperIngestionPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("developer ingestion page — retry on failed jobs (owner panel plan v2 item 4)", () => {
  const failedJob = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "failed",
    document_id: "doc-1",
    error_message: "OCR timed out",
    documents: { title: "Lithium monitoring guideline", file_name: "lithium.pdf" },
  };

  function failedPayload() {
    return readyPayload({ jobs: [failedJob, { id: "job-done", status: "completed", document_id: "doc-2" }] });
  }

  async function renderWithFailedJob() {
    fetchMock.mockResolvedValueOnce(jsonResponse(failedPayload()));
    render(<DeveloperIngestionPage />);
    await screen.findByTestId(`developer-ingestion-job-${failedJob.id}`);
  }

  function retryCalls() {
    return fetchMock.mock.calls.filter(([input]) => String(input).includes("/retry"));
  }

  it("offers Retry on failed jobs only", async () => {
    await renderWithFailedJob();
    expect(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`)).toBeInTheDocument();
    expect(within(screen.getByTestId("developer-ingestion-job-job-done")).queryByRole("button")).toBeNull();
  });

  it("pressing Retry opens an in-page confirm naming the document and the credit cost, without a browser dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await renderWithFailedJob();

    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));

    const confirm = screen.getByTestId(`developer-ingestion-retry-confirm-${failedJob.id}`);
    expect(confirm).toHaveTextContent(
      "Retry indexing Lithium monitoring guideline? This re-runs indexing for this document and may use OpenAI credit.",
    );
    expect(within(confirm).getByRole("button", { name: "Retry indexing" })).toBeEnabled();
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(confirmSpy).not.toHaveBeenCalled();
    // Opening the confirm alone must never reach the server.
    expect(retryCalls()).toHaveLength(0);
  });

  it("Cancel closes the confirm and sends nothing", async () => {
    await renderWithFailedJob();
    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByTestId(`developer-ingestion-retry-confirm-${failedJob.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`)).toBeInTheDocument();
    expect(retryCalls()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("confirming POSTs once to the job's retry route, same-origin, and disables the buttons while it runs", async () => {
    await renderWithFailedJob();
    let resolveRetry: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRetry = resolve;
        }),
    );

    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    const confirmButton = screen.getByRole("button", { name: "Retry indexing" });
    fireEvent.click(confirmButton);
    // A second press while the first is in flight must not send a second POST.
    fireEvent.click(confirmButton);

    expect(await screen.findByText("Retrying…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry indexing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    const calls = retryCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`/api/ingestion/jobs/${failedJob.id}/retry`);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");

    fetchMock.mockResolvedValueOnce(jsonResponse(failedPayload()));
    await act(async () => {
      resolveRetry(jsonResponse({ job: { id: failedJob.id, status: "pending" } }));
    });
    await screen.findByTestId(`developer-ingestion-retry-queued-${failedJob.id}`);
  });

  it("on success shows 'Queued for indexing' on that row and refetches the job list", async () => {
    await renderWithFailedJob();
    fetchMock.mockResolvedValueOnce(jsonResponse({ job: { id: failedJob.id, status: "pending" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        readyPayload({
          jobs: [{ ...failedJob, status: "pending", error_message: null }],
          activeJobCount: 1,
          hasActiveJobs: false,
        }),
      ),
    );

    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Retry indexing" }));

    const queued = await screen.findByTestId(`developer-ingestion-retry-queued-${failedJob.id}`);
    expect(queued).toHaveTextContent("Queued for indexing");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2][0])).toBe("/api/ingestion/jobs");
    // After the refetch the job is pending, so it sits under Active, keeps its
    // outcome line, and no longer offers Retry.
    const active = await screen.findByTestId("developer-ingestion-active-list");
    await waitFor(() =>
      expect(within(active).getByTestId(`developer-ingestion-job-${failedJob.id}`)).toHaveTextContent(
        "Queued for indexing",
      ),
    );
    expect(screen.queryByTestId(`developer-ingestion-retry-${failedJob.id}`)).not.toBeInTheDocument();
  });

  it("401 says an administrator sign-in is needed, not the developer key", async () => {
    await renderWithFailedJob();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Authentication required." }, 401));

    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Retry indexing" }));

    expect(await screen.findByTestId(`developer-ingestion-retry-error-${failedJob.id}`)).toHaveTextContent(
      "Sign in as an administrator to retry. The developer key alone can't change anything.",
    );
    // No refetch after a refusal.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("409 shows the server's own reason", async () => {
    await renderWithFailedJob();
    const reason = "This job is still being processed by a worker. Wait for it to finish or go stale before retrying.";
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: reason, message: reason, code: "ingestion_job_active" }, 409),
    );

    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Retry indexing" }));

    expect(await screen.findByTestId(`developer-ingestion-retry-error-${failedJob.id}`)).toHaveTextContent(reason);
    // The row offers Retry again after a refusal.
    expect(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`)).toBeInTheDocument();
  });

  it("429 asks the reader to wait, and any other failure says 'Retry failed' with the message", async () => {
    await renderWithFailedJob();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Too many ingestion administration requests." }, 429));
    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Retry indexing" }));
    expect(await screen.findByTestId(`developer-ingestion-retry-error-${failedJob.id}`)).toHaveTextContent(
      "Too many requests. Try again shortly.",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Request failed." }, 500));
    fireEvent.click(screen.getByTestId(`developer-ingestion-retry-${failedJob.id}`));
    fireEvent.click(screen.getByRole("button", { name: "Retry indexing" }));
    await waitFor(() =>
      expect(screen.getByTestId(`developer-ingestion-retry-error-${failedJob.id}`)).toHaveTextContent(
        "Retry failed: Request failed.",
      ),
    );
  });
});
