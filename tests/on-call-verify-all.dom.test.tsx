/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnCallSectionPage } from "@/components/on-call/on-call-section-page";
import { universalHeaderTrailingSlotId } from "@/lib/mode-home-composer";
import { clearOnCallEntryCache } from "@/lib/on-call/entry-cache-keys";
import { cacheOnCallEntries } from "@/lib/on-call/entry-store";
import { type OnCallEntry } from "@/lib/on-call/entry-model";

vi.mock("next/navigation", () => ({
  usePathname: () => "/on-call/contacts",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/account-data-provider", () => ({
  useAccountData: () => ({ isAuthenticated: true, isSaved: () => false, setFavourite: vi.fn(async () => true) }),
}));

vi.mock("@/components/clinical-dashboard/account-setup-dialog", () => ({ AccountSetupDialog: () => null }));
vi.mock("@/lib/on-call/linked-documents", () => ({
  useOnCallLinkedDocuments: () => ({}),
  useOnCallLinkedDocumentsState: () => ({ documents: {}, loading: false }),
}));

const storeState = vi.hoisted(() => ({
  entries: [] as OnCallEntry[],
  loading: false,
  isOffline: false,
  signedOut: false,
  cachedAt: null as string | null,
}));

vi.mock("@/lib/on-call/entry-store", () => ({
  useOnCallEntries: () => storeState,
  cacheOnCallEntries: vi.fn(),
  readCachedOnCallEntries: () => ({ entries: storeState.entries }),
}));

const STALE_AT = new Date("2024-01-01T00:00:00.000Z").toISOString();

function staleContact(slug: string, role: string): OnCallEntry {
  return {
    id: `11111111-1111-4111-8111-${({ one: "000000000001", two: "000000000002", three: "000000000003" } as Record<string, string>)[slug]}`,
    slug,
    section: "contacts",
    title: role,
    subtitle: null,
    body: null,
    details: { role, phone: "5100" },
    linkedDocumentIds: [],
    tags: ["Admin"],
    isPersonal: false,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: STALE_AT,
    updatedAt: "2026-11-05T12:00:00.123456+00:00",
  };
}

const THREE_STALE = [
  staleContact("one", "Bed management"),
  staleContact("two", "Switchboard"),
  staleContact("three", "Pharmacy"),
];

afterEach(() => {
  cleanup();
  document.getElementById(universalHeaderTrailingSlotId)?.remove();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Every On Call surface — the home and the seven section pages — reaches its
  // page menu through the universal header's trailing slot, and that portal
  // renders NOTHING when the host is absent. So the slot has to exist before a
  // standalone render can open the menu at all.
  const slot = document.createElement("div");
  slot.id = universalHeaderTrailingSlotId;
  document.body.append(slot);
  storeState.entries = [...THREE_STALE];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const id = String(url).split("/").at(-2);
      return {
        ok: true,
        json: async () => ({
          entry: { ...THREE_STALE.find((entry) => entry.id === id)!, lastVerifiedAt: "2026-09-13T00:00:00.000Z" },
        }),
      } as unknown as Response;
    }),
  );
});

/**
 * The page menu, from the universal header's trailing slot.
 *
 * It used to open from the in-page header's own ellipsis. That row is gone —
 * the mode pill above names the page and carries its actions, so a header row
 * holding one ellipsis was 48px spent on a duplicate — and the section pages
 * now portal the SAME menu the mode home already uses. Same rows, same testids,
 * one trigger.
 */
async function openMenuAndVerifyAll() {
  fireEvent.click(screen.getByTestId("on-call-page-menu-trigger"));
  fireEvent.click(screen.getByTestId("on-call-page-menu-verify-all"));
}

describe("Mark all as still correct", () => {
  it("refuses a versionless legacy row before starting bulk verification", async () => {
    storeState.entries = [{ ...THREE_STALE[0], updatedAt: undefined }];
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    expect(fetch).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
  });

  it("keeps prior confirmations when a later bulk row has no version", async () => {
    storeState.entries = [THREE_STALE[0], { ...THREE_STALE[1], updatedAt: undefined }];
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    const written = vi.mocked(cacheOnCallEntries).mock.calls.at(-1)?.[0];
    expect(written?.[0].lastVerifiedAt).toBe("2026-09-13T00:00:00.000Z");
    expect(written?.[1]).toEqual(storeState.entries[1]);
  });

  it("stops before the next bulk request when the account changes", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    expect(fetch).toHaveBeenCalledTimes(1);
    clearOnCallEntryCache();
    await act(async () => {
      release(new Response(JSON.stringify({ entry: THREE_STALE[0] }), { status: 200 }));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cacheOnCallEntries).not.toHaveBeenCalled();
  });

  it.each([
    ["missing entry", {}],
    ["incomplete entry", { entry: { id: "one" } }],
    ["wrong returned id", { entry: { ...THREE_STALE[0], id: "99999999-9999-4999-8999-999999999999" } }],
  ])("stops and reports a successful response with %s", async (_name, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Bed management/));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cacheOnCallEntries).not.toHaveBeenCalled();
  });

  it("keeps the first durable confirmation when the next successful response is invalid", async () => {
    const confirmed = { ...THREE_STALE[0], lastVerifiedAt: "2026-11-05T00:00:00.000Z" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ entry: confirmed }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })),
    );
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Switchboard/));
    expect(fetch).toHaveBeenCalledTimes(2);
    const lastWrite = vi.mocked(cacheOnCallEntries).mock.calls.at(-1)?.[0];
    expect(lastWrite).toEqual([confirmed, THREE_STALE[1], THREE_STALE[2]]);
  });

  it("preserves an intervening edit when delayed bulk confirmations commit", async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ entry: { ...THREE_STALE[0], lastVerifiedAt: "2026-11-05T12:00:00Z" } }))
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        )
        .mockResolvedValueOnce(Response.json({ entry: { ...THREE_STALE[2], lastVerifiedAt: "2026-11-05T12:00:00Z" } })),
    );
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const edited = {
      ...THREE_STALE[0],
      title: "Newer synthetic edit",
      details: { role: "Newer synthetic edit", phone: "6200" },
    };
    storeState.entries = [edited, THREE_STALE[1], THREE_STALE[2]];
    await act(async () => {
      release(Response.json({ entry: { ...THREE_STALE[1], lastVerifiedAt: "2026-11-05T12:00:00Z" } }));
    });
    await waitFor(() => expect(cacheOnCallEntries).toHaveBeenCalled());
    expect(vi.mocked(cacheOnCallEntries).mock.calls.at(-1)?.[0][0]).toEqual(edited);
    expect(screen.getByRole("alert")).toHaveTextContent(/changed|removed/i);
  });

  it.each([409, 428])(
    "explains reload recovery when verification refuses a stale or missing version (%s)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status })),
      );
      render(<OnCallSectionPage view="contacts" />);
      await openMenuAndVerifyAll();
      expect(await screen.findByRole("alert")).toHaveTextContent(/Reload and review the latest entry/i);
      expect(cacheOnCallEntries).not.toHaveBeenCalled();
    },
  );

  it("confirms every overdue entry in the view", async () => {
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3));
    for (const entry of THREE_STALE) {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(`/api/on-call/entries/${entry.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: entry.updatedAt }),
      });
    }
  });

  it("writes ALL the confirmations, not only the last one", async () => {
    // The bug this test exists for: `cacheOnCallEntries` overwrites the whole
    // cache rather than merging, so folding each result onto the render's own
    // `entries` snapshot in a loop discards every confirmation but the last.
    // Three successful writes then left two rows still under "Needs checking"
    // until a reload — the write happened and the page said it had not.
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(vi.mocked(cacheOnCallEntries)).toHaveBeenCalled());

    const lastWrite = vi.mocked(cacheOnCallEntries).mock.calls.at(-1)?.[0] ?? [];
    expect(lastWrite).toHaveLength(3);
    for (const written of lastWrite) {
      expect(written.lastVerifiedAt, `${written.slug} was not stamped`).toBe("2026-09-13T00:00:00.000Z");
    }
  });

  it("keeps what it confirmed when one request fails, and says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes(`/api/on-call/entries/${THREE_STALE[1].id}/`))
          return { ok: false, json: async () => ({}) } as unknown as Response;
        const id = String(url).split("/").at(-2);
        return {
          ok: true,
          json: async () => ({
            entry: { ...THREE_STALE.find((entry) => entry.id === id)!, lastVerifiedAt: "2026-09-13T00:00:00.000Z" },
          }),
        } as unknown as Response;
      }),
    );

    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("Switchboard");

    // The one that did succeed before the failure is still recorded: a partial
    // run must not be rolled back into "nothing happened".
    const lastWrite = vi.mocked(cacheOnCallEntries).mock.calls.at(-1)?.[0] ?? [];
    expect(lastWrite.find((entry) => entry.slug === "one")?.lastVerifiedAt).toBe("2026-09-13T00:00:00.000Z");
    expect(lastWrite.find((entry) => entry.slug === "three")?.lastVerifiedAt).toBe(STALE_AT);
  });

  // Regression, 2026-09-24: shared rows from other accounts were included,
  // the server refused them, and the loop stopped at the first one.
  it("confirms only the reader's own overdue rows, never another account's", async () => {
    storeState.entries = THREE_STALE.map((entry) => (entry.slug === "two" ? { ...entry, isOwn: false } : entry));
    render(<OnCallSectionPage view="contacts" />);
    await openMenuAndVerifyAll();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith(`/api/on-call/entries/${THREE_STALE[1].id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: THREE_STALE[1].updatedAt }),
    });
    expect(screen.getAllByRole("button", { name: /^Edit / }).length).toBeGreaterThan(0);
  });

  it("shows no edit or verify control on a row another account shared", () => {
    storeState.entries = THREE_STALE.map((entry) => ({ ...entry, isOwn: false }));
    render(<OnCallSectionPage view="contacts" />);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /still correct/i })).toBeNull();
    fireEvent.click(screen.getByTestId("on-call-page-menu-trigger"));
    expect(screen.queryByTestId("on-call-page-menu-verify-all")).not.toBeInTheDocument();
  });

  it("offers nothing to confirm when nothing is overdue", () => {
    storeState.entries = THREE_STALE.map((entry) => ({ ...entry, lastVerifiedAt: "2026-09-01T00:00:00.000Z" }));
    render(<OnCallSectionPage view="contacts" />);
    fireEvent.click(screen.getByTestId("on-call-page-menu-trigger"));
    expect(screen.queryByTestId("on-call-page-menu-verify-all")).not.toBeInTheDocument();
  });
});
