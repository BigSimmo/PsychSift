/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnCallDemoContentControl, useOnCallDemoContentState } from "@/components/on-call/on-call-demo-content-control";
import {
  ON_CALL_DEMO_ENTRY_COUNT,
  ON_CALL_DEMO_SLUGS,
  ON_CALL_DEMO_SLUGS_BY_SECTION,
} from "@/lib/on-call/demo-content-identity";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";

/**
 * The example-content loader is the only way a signed-in reader can see these
 * pages holding anything, so the control has to be right about four things:
 * who it offers itself to, WHOSE content it is reporting on, which request it
 * sends, and what it leaves behind afterwards.
 *
 * It cannot be exercised end to end here — writing needs a database and an
 * account, and this suite has neither — so the request is asserted at the
 * fetch boundary.
 */

const originalFetch = globalThis.fetch;
const clearCacheMock = vi.hoisted(() => vi.fn());

const previewFlag = vi.hoisted(() => ({ active: false }));
const setPreviewMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/on-call/entry-cache-keys", () => ({
  clearOnCallEntryCache: clearCacheMock,
  onCallEntryCacheChangedEvent: "clinical-kb-on-call-entries-cache-changed",
  isOnCallDemoPreviewActive: () => previewFlag.active,
  setOnCallDemoPreviewActive: setPreviewMock,
}));

// The hook reconciles the server's `signedOut` flag with the session the
// browser already knows about, so it reads the auth provider directly.
const authState = vi.hoisted(() => ({ status: "loading" as string }));
vi.mock("@/lib/supabase/client", () => ({ useAuthSession: () => authState }));

const cacheEntriesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/on-call/entry-store", () => ({ cacheOnCallEntries: cacheEntriesMock }));

/**
 * The control asks `GET` what THIS account holds before it renders anything,
 * then sends the mutation. Both go through the same mock, so a test says what
 * the account holds and then reads the mutation off the second call.
 */
function mockFetch(owned: number, mutation: { ok?: boolean; payload?: unknown } = { ok: true }) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init?: { method?: string }) => {
    if (!init?.method) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ loaded: owned, total: ON_CALL_DEMO_ENTRY_COUNT }),
      } as Response);
    }
    return Promise.resolve({
      ok: mutation.ok ?? true,
      json: async () => mutation.payload ?? {},
    } as Response);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  clearCacheMock.mockClear();
  setPreviewMock.mockClear();
  cacheEntriesMock.mockClear();
  previewFlag.active = false;
  authState.status = "loading";
  // jsdom has no navigation; the control reloads on success and would throw.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/**
 * The hook and the control, wired exactly as `OnCallHome` wires them. Testing
 * them separately would leave the seam between them — which is where the
 * "offer Remove to someone who owns nothing" bug lived — uncovered.
 */
function Harness({ signedOut, demoMode }: { signedOut: boolean; demoMode: boolean }) {
  const state = useOnCallDemoContentState(signedOut, demoMode);
  return <OnCallDemoContentControl state={state} />;
}

describe("the example-content control", () => {
  it("offers a signed-out reader no control, writes nothing and asks the server nothing", () => {
    // Changed 2026-10-04: signed out, the pages now fill themselves from an
    // invented sample held in memory (see `useOnCallEntries`), so the old
    // "Preview with example content" control, which wrote the corpus into this
    // device's cache, is gone. Nor may the account controls appear: they could
    // only 401.
    const fetchMock = mockFetch(0);
    render(<Harness signedOut demoMode={false} />);

    expect(screen.queryByTestId("on-call-demo-preview-start")).toBeNull();
    expect(screen.queryByTestId("on-call-demo-preview-clear")).toBeNull();
    expect(screen.queryByTestId("on-call-demo-content-load")).toBeNull();
    expect(cacheEntriesMock).not.toHaveBeenCalled();
    expect(setPreviewMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers nothing in demo mode", () => {
    // Demo mode already IS this corpus, served from memory, and the route
    // refuses to write there. Either control could only fail.
    const fetchMock = mockFetch(ON_CALL_DEMO_ENTRY_COUNT);
    render(<Harness signedOut={false} demoMode />);
    expect(screen.queryByTestId("on-call-demo-content-load")).toBeNull();
    expect(screen.queryByTestId("on-call-demo-content-remove")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("decides Load or Remove from what THIS account holds, not from the page", async () => {
    // The shared read returns every non-personal row across all accounts, so
    // example rows another account loaded are on this reader's page too.
    // Deciding from those would offer Remove to someone who owns none of
    // them, and their DELETE would remove nothing and change nothing.
    mockFetch(0);
    const empty = render(<Harness signedOut={false} demoMode={false} />);
    expect(await screen.findByTestId("on-call-demo-content-load")).toBeVisible();
    expect(screen.queryByTestId("on-call-demo-content-remove")).toBeNull();
    empty.unmount();

    mockFetch(ON_CALL_DEMO_ENTRY_COUNT);
    render(<Harness signedOut={false} demoMode={false} />);
    expect(await screen.findByTestId("on-call-demo-content-remove")).toBeVisible();
    expect(screen.queryByTestId("on-call-demo-content-load")).toBeNull();
  });

  it("says that loading publishes, before it loads", async () => {
    // The shared read selects `is_personal = false` across every account, so
    // most of these rows become readable by anyone signed in to the site. That
    // consequence is the reason this sentence exists, and a silent button
    // would be the defect.
    mockFetch(0);
    render(<Harness signedOut={false} demoMode={false} />);
    expect(await screen.findByText(/anyone signed in to this site can read them/i)).toBeVisible();
    expect(screen.getByText(/Removing them is one tap/i)).toBeVisible();
    expect(screen.getByText(new RegExp(`${ON_CALL_DEMO_ENTRY_COUNT} example entries`))).toBeVisible();
  });

  it("loads with a POST and removes with a DELETE", async () => {
    const loadFetch = mockFetch(0);
    const loaded = render(<Harness signedOut={false} demoMode={false} />);
    fireEvent.click(await screen.findByTestId("on-call-demo-content-load"));
    await waitFor(() => expect(loadFetch).toHaveBeenCalledTimes(2));
    expect(loadFetch.mock.calls[1][0]).toBe("/api/on-call/demo-content");
    expect(loadFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
    loaded.unmount();

    const removeFetch = mockFetch(ON_CALL_DEMO_ENTRY_COUNT);
    render(<Harness signedOut={false} demoMode={false} />);
    fireEvent.click(await screen.findByTestId("on-call-demo-content-remove"));
    await waitFor(() => expect(removeFetch).toHaveBeenCalledTimes(2));
    expect(removeFetch.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("clears the cached entries before reloading, or the removal looks like it did nothing", async () => {
    // `useOnCallEntries` returns `cached?.entries` ahead of the fetched
    // result, and deliberately refuses to let an empty response overwrite a
    // non-empty cache — a rule that protects a shift when a session expires.
    // Here it means a successful DELETE followed by a bare reload renders the
    // same ninety-four rows off the stale cache, with the same Remove button
    // still sitting there. The clear has to happen, and it has to happen
    // BEFORE the reload.
    const fetchMock = mockFetch(ON_CALL_DEMO_ENTRY_COUNT);
    render(<Harness signedOut={false} demoMode={false} />);
    fireEvent.click(await screen.findByTestId("on-call-demo-content-remove"));
    await waitFor(() => expect(clearCacheMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.reload).toHaveBeenCalledTimes(1));
    expect(
      clearCacheMock.mock.invocationCallOrder[0],
      "the cache must be cleared before the reload, not after it",
    ).toBeLessThan(
      (window.location.reload as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0],
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says nothing was written when the load is refused", async () => {
    // A failed load must not leave a reader wondering whether half of it
    // landed: the route writes in one upsert, so "nothing was added" is true.
    mockFetch(0, { ok: false });
    render(<Harness signedOut={false} demoMode={false} />);
    fireEvent.click(await screen.findByTestId("on-call-demo-content-load"));
    expect(await screen.findByText(/Nothing was added/i)).toBeVisible();
    expect(clearCacheMock).not.toHaveBeenCalled();
  });

  it("reports a part-finished removal honestly rather than claiming nothing went", async () => {
    // The delete runs one statement per section and cannot wrap them in a
    // transaction, so a failure part-way leaves earlier sections already gone.
    // Telling the reader "nothing was deleted" would be false, and would send
    // them away believing a half-removed corpus was intact.
    mockFetch(ON_CALL_DEMO_ENTRY_COUNT, {
      ok: false,
      payload: {
        error:
          "That did not finish. 12 example entries were removed before it stopped — press Remove again to clear the rest.",
        message:
          "That did not finish. 12 example entries were removed before it stopped — press Remove again to clear the rest.",
        code: "demo_content_removal_partial",
      },
    });
    render(<Harness signedOut={false} demoMode={false} />);
    fireEvent.click(await screen.findByTestId("on-call-demo-content-remove"));
    expect(await screen.findByText(/12 example entries were removed/i)).toBeVisible();
    expect(screen.queryByText(/Nothing was deleted/i)).toBeNull();
  });
});

describe("what the loader claims to own", () => {
  it("covers the whole corpus and nothing else", () => {
    expect(ON_CALL_DEMO_ENTRY_COUNT).toBe(DEMO_ON_CALL_ENTRIES.length);

    // The load button spells the count in words, because the client cannot
    // import the corpus to read it — that would ship a kilobyte of fixture
    // identity to a page which renders none of it, and the bundle budget is
    // measured. A spelled number is therefore a copy of a fact, and a copy
    // drifts: grow the corpus by one entry and the sentence a reader is
    // deciding on becomes false, silently and on the live site.
    //
    // So the copy is pinned here rather than trusted. If this fails, the
    // corpus changed size and `on-call-demo-content-control.tsx` needs the
    // new number written out in the load sentence.
    expect(ON_CALL_DEMO_ENTRY_COUNT, "the load button says 'Ninety-four example entries' — update that copy too").toBe(
      94,
    );
    expect(new Set(ON_CALL_DEMO_SLUGS)).toEqual(new Set(DEMO_ON_CALL_ENTRIES.map((entry) => entry.slug)));
  });

  it("groups every slug under the section it actually belongs to", () => {
    // This is what stops the delete matching on half of the table's compound
    // key. A slug filed under the wrong section would either miss its own row
    // or reach one that is not the loader's to remove.
    const grouped = ON_CALL_DEMO_SLUGS_BY_SECTION.flatMap(([section, slugs]) =>
      slugs.map((slug) => `${section}/${slug}`),
    );
    const corpus = DEMO_ON_CALL_ENTRIES.map((entry) => `${entry.section}/${entry.slug}`);
    expect(grouped.sort()).toEqual(corpus.sort());
  });

  it("keeps every example slug recognisable as one", () => {
    // The home decides whether to offer "Remove" with a `demo-` prefix test
    // rather than by shipping ninety-four strings to the browser. That test is
    // only honest while the corpus actually uses the prefix.
    for (const slug of ON_CALL_DEMO_SLUGS) {
      expect(slug, `${slug} would not be recognised as example content`).toMatch(/^demo-/);
    }
  });
});
