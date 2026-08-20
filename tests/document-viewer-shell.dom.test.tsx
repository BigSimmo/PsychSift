import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DocumentViewer resolves a four-way shell state (loading / ready / auth-required
// / error) that decides whether a source document is shown at all. The
// auth-required branch is the private-document gate: an unauthenticated reader
// must get the sign-in shell, never document content. The state is prop-drivable
// via initialDetail / initialError, so these tests pin it without a network.

const { push, authorizationHeader, registerAuthRequest, isAuthEpochCurrent, markSessionExpired, authState } =
  vi.hoisted(() => ({
    push: vi.fn(),
    authorizationHeader: {},
    registerAuthRequest: vi.fn(() => ({ epoch: 1, release: vi.fn() })),
    isAuthEpochCurrent: vi.fn(() => true),
    markSessionExpired: vi.fn(),
    // Mutable so a test can drive an auth transition while the viewer stays
    // mounted. Reset to the signed-out default in beforeEach.
    authState: {
      status: "signed_out" as string,
      session: null as { user: { id: string; app_metadata?: Record<string, unknown> } } | null,
    },
  }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/documents/doc-1",
}));

vi.mock("@/lib/supabase/client", () => ({
  useAuthSession: () => ({
    status: authState.status,
    session: authState.session,
    isConfigured: true,
    authorizationHeader,
    registerAuthRequest,
    isAuthEpochCurrent,
    markSessionExpired,
    signInWithEmail: vi.fn(),
    signInWithPassword: vi.fn(),
    signUpWithPassword: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// Every document request is gated on a local-project identity probe
// (/api/local-project-id). No server answers it in a unit run, and when the
// probe fails the viewer replaces the error under test with its own
// "unsafe local project" message — which is exactly why this file passed on a
// workstation with the dev server up and failed in CI. Stub it as a safe local
// origin so the shell state, not the environment, decides the outcome.
vi.mock("@/lib/local-project-identity", () => ({
  readLocalProjectIdentity: async () => ({ localServer: { safeLocalOrigin: true } }),
  unsafeLocalProjectMessage: () => "This local server does not belong to this project.",
}));

// The preview is next/dynamic-loaded and never mounts synchronously in jsdom;
// it is mocked defensively so a late resolve cannot pull a real canvas into the
// test environment. The shell state, not the raster preview, is under test.
vi.mock("@/components/document-viewer/pdf-canvas-viewer", () => ({
  PdfCanvasViewer: () => null,
}));

import { DocumentViewer } from "@/components/DocumentViewer";
import type { DocumentDetailPayload } from "@/lib/document-detail-contract";

function detailPayload(): DocumentDetailPayload {
  return {
    document: {
      id: "doc-1",
      title: "Clozapine titration guideline",
      description: null,
      file_name: "clozapine-titration.pdf",
      file_type: "application/pdf",
      file_size: 204800,
      storage_path: "documents/doc-1/clozapine-titration.pdf",
      status: "indexed",
      page_count: 4,
      chunk_count: 8,
      image_count: 0,
      error_message: null,
      updated_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      labels: [],
      metadata: {},
      summary: null,
    },
    pages: [],
    images: [],
    tableFacts: [],
    chunks: [],
    demoMode: true,
    assetScope: "document",
    window: {
      requestedPage: 1,
      effectivePage: 1,
      selectedChunkId: null,
      pages: { from: 1, to: 4, limit: 4, total: 4, hasBefore: false, hasAfter: false },
      chunks: { offset: 0, limit: 8, total: 8, hasBefore: false, hasAfter: false, selectedChunkId: null },
    },
    pageWindow: { from: 1, to: 4, limit: 4, total: 4, hasBefore: false, hasAfter: false },
    chunkWindow: { offset: 0, limit: 8, total: 8, hasBefore: false, hasAfter: false, selectedChunkId: null },
  };
}

// In demo / local-no-auth mode every document is public, so the private-access
// gate is deliberately inert and the sign-in shell can never render. Whichever
// of those a runner happens to export would silently turn the gate assertion
// into a no-op, so pin both off — this test is about the gate, not the mode.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_LOCAL_NO_AUTH", "false");
  authState.status = "signed_out";
  authState.session = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DocumentViewer — shell states", () => {
  it("shows the sign-in shell (never document content) when private access is required", async () => {
    render(
      <DocumentViewer documentId="doc-1" initialPage={1} initialError="Sign in to open private source documents." />,
    );

    expect(await screen.findByText("Sign in required")).toBeVisible();
    expect(screen.getByText("Sign in to open private source documents.")).toBeVisible();
    // The private-access gate must resolve to its own shell, not the generic
    // failure shell (which would read as "broken" rather than "sign in").
    expect(screen.queryByText("Source unavailable")).toBeNull();
  });

  it("shows the unavailable shell with the failure reason for a generic load error", async () => {
    render(<DocumentViewer documentId="doc-1" initialPage={1} initialError="Document could not be loaded." />);

    expect(await screen.findByText("Source unavailable")).toBeVisible();
    expect(screen.getByText("Document could not be loaded.")).toBeVisible();
    expect(screen.queryByText("Sign in required")).toBeNull();
  });

  it("shows the ready shell with the document identity when a detail payload is supplied", async () => {
    render(<DocumentViewer documentId="doc-1" initialPage={1} initialDetail={detailPayload()} />);

    // The display title is smart-cased from "Clozapine titration guideline" and
    // rendered in the header h1. The exact filename is visible only inside the
    // document actions sheet, opened by the "Open document actions" button.
    const heading = await screen.findByRole("heading", { level: 1, name: "Clozapine Titration Guideline" });
    expect(heading).toBeVisible();

    // Open the document actions sheet and verify the exact filename is visible.
    const actionsButton = screen.getByRole("button", { name: "Open document actions" });
    expect(actionsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(actionsButton);
    expect(await screen.findByText("clozapine-titration.pdf")).toBeVisible();
    expect(actionsButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Add to scope" })).toBeNull();

    // Close the sheet before teardown so focus-restore timers settle while jsdom
    // is still alive (avoids an unhandled post-test `document` ReferenceError
    // under the coverage worker pool).
    fireEvent.click(screen.getByRole("button", { name: "Close document actions" }));
    expect(screen.queryByText("clozapine-titration.pdf")).toBeNull();

    // A supplied payload must resolve to the ready shell — neither failure shell.
    expect(screen.queryByText("Source unavailable")).toBeNull();
    expect(screen.queryByText("Sign in required")).toBeNull();
  });

  // Search/answer opens always attach ?chunk=…. Citation landing used to
  // scrollIntoView(#pdf-preview-section) whenever a chunk was present, which
  // skipped the phone overview at the top. Open at the top; the PDF still
  // targets the cited page inside its own canvas.
  it("does not auto-scroll the page to the PDF when opening with a chunk deep-link", async () => {
    const scrolledIds: string[] = [];
    vi.mocked(Element.prototype.scrollIntoView).mockImplementation(function scrollIntoView(this: Element) {
      if (this.id) scrolledIds.push(this.id);
    });

    const detail = detailPayload();
    detail.chunks = [
      {
        id: "chunk-1",
        page_number: 1,
        chunk_index: 0,
        section_heading: "Scope",
        content: "Cited passage",
        image_ids: [],
        metadata: {},
      },
    ];
    detail.window.selectedChunkId = "chunk-1";
    detail.window.chunks.selectedChunkId = "chunk-1";
    detail.chunkWindow.selectedChunkId = "chunk-1";

    render(<DocumentViewer documentId="doc-1" initialPage={1} chunkId="chunk-1" initialDetail={detail} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Clozapine Titration Guideline" })).toBeVisible();
    expect(document.getElementById("pdf-preview-section")).not.toBeNull();

    // Flush mount effects before the negative assertion. A waitFor that can
    // pass while scrolledIds is still empty would miss a late scrollIntoView.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(scrolledIds).not.toContain("pdf-preview-section");
  });

  it("opens document search on demand, ignores stale responses, and clears it on close", async () => {
    const pendingSearches: Array<{
      url: string;
      resolve: (response: Response) => void;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes("/api/documents/doc-1/search?")) {
          return Promise.resolve(new Response(JSON.stringify({ error: "Unexpected request" }), { status: 404 }));
        }
        return new Promise<Response>((resolve) => pendingSearches.push({ url, resolve }));
      }),
    );

    render(<DocumentViewer documentId="doc-1" initialPage={1} initialDetail={detailPayload()} />);
    expect(screen.queryByRole("textbox", { name: "Search within this document" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to scope" })).toBeNull();

    const searchTriggers = await screen.findAllByRole("button", { name: "Search document" });
    expect(searchTriggers).toHaveLength(2);
    const searchTrigger = searchTriggers[1]!;
    expect(searchTrigger).toHaveAttribute("aria-expanded", "false");
    expect(searchTrigger).not.toHaveAttribute("aria-controls");
    fireEvent.click(searchTrigger);
    const composerSearch = await screen.findByRole("textbox", { name: "Search within this document" });
    await waitFor(() => expect(composerSearch).toHaveFocus());
    expect(searchTrigger).toHaveAttribute("aria-expanded", "true");
    expect(searchTrigger).toHaveAttribute("aria-controls", "document-viewer-search");

    fireEvent.change(composerSearch, { target: { value: "r" } });
    expect(await screen.findByText("Enter at least 2 characters to search all indexed passages.")).toBeVisible();
    expect(pendingSearches).toHaveLength(0);

    fireEvent.change(composerSearch, { target: { value: "first query" } });
    await waitFor(() => expect(pendingSearches).toHaveLength(1));
    fireEvent.change(composerSearch, { target: { value: "second query" } });
    await waitFor(() => expect(pendingSearches).toHaveLength(2));

    pendingSearches[1]?.resolve(
      Response.json({
        query: "second query",
        results: [
          {
            id: "second-hit",
            page_number: 2,
            chunk_index: 1,
            section_heading: "Second result",
            snippet: "Second query current result",
            matched_terms: ["second", "query"],
            image_ids: [],
            score: 2,
          },
        ],
      }),
    );
    const indexedTextPanel = screen.getByTestId("source-chunk-indexed-text-panel");
    await waitFor(() => expect(indexedTextPanel).toHaveTextContent("Second query current result"));

    pendingSearches[0]?.resolve(
      Response.json({
        query: "first query",
        results: [
          {
            id: "first-hit",
            page_number: 1,
            chunk_index: 0,
            section_heading: "Stale result",
            snippet: "First query stale result",
            matched_terms: ["first", "query"],
            image_ids: [],
            score: 3,
          },
        ],
      }),
    );
    await waitFor(() => {
      expect(indexedTextPanel).not.toHaveTextContent("First query stale result");
      expect(indexedTextPanel).toHaveTextContent("Second query current result");
    });

    fireEvent.change(composerSearch, { target: { value: "closing query" } });
    await waitFor(() => expect(pendingSearches).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Close document search" }));
    expect(screen.queryByRole("textbox", { name: "Search within this document" })).toBeNull();
    expect(indexedTextPanel).not.toHaveTextContent("Second query current result");
    expect(searchTrigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(searchTrigger).toHaveFocus());

    pendingSearches[2]?.resolve(
      Response.json({
        query: "closing query",
        results: [
          {
            id: "closed-hit",
            page_number: 3,
            chunk_index: 2,
            section_heading: "Closed result",
            snippet: "A closed search must ignore this result",
            matched_terms: ["closing", "query"],
            image_ids: [],
            score: 1,
          },
        ],
      }),
    );
    await waitFor(() => expect(indexedTextPanel).not.toHaveTextContent("A closed search must ignore this result"));

    fireEvent.click(searchTrigger);
    const reopenedSearch = await screen.findByRole("textbox", { name: "Search within this document" });
    expect(reopenedSearch).toHaveValue("");
    fireEvent.keyDown(reopenedSearch, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search within this document" })).toBeNull();
    await waitFor(() => expect(searchTrigger).toHaveFocus());
  });

  // A private document's signed URL is a bearer link. The viewer holds the
  // resolved URL in its own state and used to reset it only on a *full* document
  // reload; an auth-only transition keeps the same load key, so after sign-out or
  // an account switch the previous identity's link stayed rendered until it
  // expired. Clearing the module LRU alone does not reach this state.
  it("drops the mounted signed source URL when the auth identity changes", async () => {
    authState.status = "authenticated";
    authState.session = { user: { id: "user-a" } };

    const userAUrl = "https://example.supabase.co/storage/v1/object/sign/doc-1.pdf?token=user-a";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/signed-url")) {
          return { ok: true, status: 200, json: async () => ({ url: userAUrl }) } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
      }),
    );

    const detail = detailPayload();
    const { rerender } = render(
      <DocumentViewer documentId="doc-1" initialPage={1} initialDetail={{ ...detail, demoMode: false }} />,
    );

    await waitFor(() => expect(window.document.querySelector(`a[href="${userAUrl}"]`)).not.toBeNull());

    // Same document, different clinician — the load key does not change.
    authState.session = { user: { id: "user-b" } };
    rerender(<DocumentViewer documentId="doc-1" initialPage={1} initialDetail={{ ...detail, demoMode: false }} />);

    expect(window.document.querySelector(`a[href="${userAUrl}"]`)).toBeNull();
  });

  // The signed URLs are not the only identity-bound state the viewer holds. An
  // auth-only transition leaves the document load key unchanged, so the detail
  // effect treats the refetch as a navigation and deliberately keeps the current
  // window mounted until the replacement settles. On a slow, offline, or denied
  // request that window is user A's extracted private content — title, chunks,
  // table facts, image captions — left readable to user B for as long as B's
  // request takes. This defers B's detail response indefinitely and asserts the
  // content is gone at the moment the identity changes, not when B's reply lands.
  it("clears A's extracted document content on an account switch before B's detail request settles", async () => {
    // Administrator metadata only so the extracted table-fact panel renders at
    // all; the leak under test is not administrator-specific.
    const administrator = { site_role: "administrator" };
    authState.status = "authenticated";
    authState.session = { user: { id: "user-a", app_metadata: administrator } };

    let detailRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/signed-url")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ url: null }) } as unknown as Response);
        }
        if (url.includes("/api/documents/doc-1?")) {
          detailRequests += 1;
          // Never settles: user B is offline / slow / denied.
          return new Promise<Response>(() => {});
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
      }),
    );

    const detail = detailPayload();
    const userADetail = {
      ...detail,
      demoMode: false,
      images: [
        {
          id: "image-a",
          page_number: 1,
          caption: "Clozapine neutrophil monitoring chart",
          tableLabel: "Table 2",
          tableTitle: "Clozapine neutrophil monitoring",
        },
      ],
      tableFacts: [
        {
          id: "fact-a",
          document_id: "doc-1",
          source_image_id: "image-a",
          page_number: 1,
          table_title: "Neutrophil thresholds",
          row_label: "Amber",
          clinical_parameter: "Absolute neutrophil count",
          threshold_value: "1.0-1.5 x10^9/L",
          action: "Repeat count twice weekly",
        },
      ],
      chunks: [
        {
          id: "chunk-a",
          page_number: 1,
          chunk_index: 0,
          section_heading: "Titration schedule",
          content: "User A private titration passage",
          image_ids: [],
        },
      ],
    } satisfies DocumentDetailPayload;

    const { rerender } = render(<DocumentViewer documentId="doc-1" initialPage={1} initialDetail={userADetail} />);

    // Presence, not visibility: content parked in a collapsed panel is still in
    // the DOM and still readable, so "gone" has to mean removed, not hidden.
    expect(await screen.findByRole("heading", { level: 1, name: "Clozapine Titration Guideline" })).toBeVisible();
    expect(screen.getAllByText("User A private titration passage").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Clozapine neutrophil monitoring/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Absolute neutrophil count/).length).toBeGreaterThan(0);

    // Same document, same route, different clinician — the load key is unchanged,
    // so nothing but the identity reset can drop this content.
    authState.session = { user: { id: "user-b", app_metadata: administrator } };
    rerender(<DocumentViewer documentId="doc-1" initialPage={1} initialDetail={userADetail} />);

    expect(screen.queryByRole("heading", { level: 1, name: "Clozapine Titration Guideline" })).toBeNull();
    expect(screen.queryByText("User A private titration passage")).toBeNull();
    expect(screen.queryByText(/Clozapine neutrophil monitoring/)).toBeNull();
    expect(screen.queryByText(/Absolute neutrophil count/)).toBeNull();

    // …and it must stay gone: the SSR `initialDetail` prop still holds user A's
    // payload, so the refetch triggered by the identity change must go to the
    // network for user B rather than replaying it.
    await waitFor(() => expect(detailRequests).toBeGreaterThan(0));
    expect(screen.queryByText("User A private titration passage")).toBeNull();
  });
});
