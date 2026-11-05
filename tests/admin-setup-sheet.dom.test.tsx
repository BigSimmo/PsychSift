/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearOnCallEntryCache } from "@/lib/on-call/entry-cache-keys";
import { AdminSetupSheet } from "@/components/admin/admin-setup-sheet";

const created = (title: string) => ({
  entry: {
    id: "00000000-0000-4000-8000-00000000aaaa",
    section: "logistics",
    slug: "s",
    title,
    subtitle: null,
    body: null,
    details: { kind: "compliance", category: title },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    isOwn: true,
  },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function fillDates() {
  fireEvent.change(screen.getByLabelText("Registration expiry"), { target: { value: "2027-09-30" } });
  fireEvent.change(screen.getByLabelText("Indemnity expiry"), { target: { value: "2027-06-30" } });
}

describe("AdminSetupSheet", () => {
  it("stops its bulk save after an account transition without delivering the old row", async () => {
    let release!: (response: Response) => void;
    const request = vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<AdminSetupSheet open onClose={onClose} existingEntries={[]} onCreated={onCreated} />);
    fillDates();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(request).toHaveBeenCalledTimes(1);
    clearOnCallEntryCache();
    await act(async () => {
      release(json(created("Registration"), 201));
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("echoes each date back in words, creates both rows, and stores nothing on the device", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(created("Registration"), 201))
      .mockResolvedValueOnce(json(created("Indemnity"), 201));
    const onClose = vi.fn();
    render(<AdminSetupSheet open onClose={onClose} existingEntries={[]} onCreated={vi.fn()} />);
    fillDates();
    expect(screen.getByText("Thu 30 Sep 2027")).toBeTruthy();
    expect(screen.getByText("Wed 30 Jun 2027")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/on-call/entries")).toHaveLength(2);
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps the typed values and retries only the row that failed", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(created("Registration"), 201))
      .mockResolvedValueOnce(json({ error: { message: "Could not save." } }, 500))
      .mockResolvedValueOnce(json(created("Indemnity"), 201));
    const onClose = vi.fn();
    render(<AdminSetupSheet open onClose={onClose} existingEntries={[]} onCreated={vi.fn()} />);
    fillDates();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Retry" });
    expect((screen.getByLabelText("Indemnity expiry") as HTMLInputElement).value).toBe("2027-06-30");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const posts = fetchMock.mock.calls.filter(([url]) => url === "/api/on-call/entries");
    expect(posts).toHaveLength(3);
    expect(JSON.parse(String(posts[2][1]?.body))).toMatchObject({
      title: "Indemnity insurance declaration",
      details: { requirementId: "professional-indemnity-insurance" },
    });
  });

  it("'Later' closes without creating anything", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const onClose = vi.fn();
    render(<AdminSetupSheet open onClose={onClose} existingEntries={[]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an already-recorded requirement as recorded rather than a field", () => {
    const existing = [
      {
        id: "00000000-0000-4000-8000-00000000bbbb",
        section: "logistics" as const,
        slug: "registration-1",
        title: "Medical registration",
        subtitle: null,
        body: null,
        details: { kind: "compliance", category: "Registration", expiresOn: "2027-09-30" },
        linkedDocumentIds: [],
        tags: [],
        isPersonal: true,
        includeOnCard: false,
        sortOrder: 0,
        lastVerifiedAt: null,
        isOwn: true,
      },
    ];
    render(<AdminSetupSheet open onClose={vi.fn()} existingEntries={existing} onCreated={vi.fn()} />);
    expect(screen.queryByLabelText("Registration expiry")).toBeNull();
    expect(screen.getByText(/already recorded/i)).toBeTruthy();
    expect(screen.getByLabelText("Indemnity expiry")).toBeTruthy();
  });
});
