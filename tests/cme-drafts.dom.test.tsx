import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CmeDraftsSection } from "@/components/cme/cme-drafts-section";
import { cmeDraftPayloadSchema, type CmeDraft } from "@/lib/cme/drafts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function draft(overrides: Partial<CmeDraft> = {}): CmeDraft {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    payload: cmeDraftPayloadSchema.parse({ title: "Grand round on delirium" }),
    waitingOn: null,
    waitingNote: null,
    followUpOn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("CmeDraftsSection", () => {
  it("renders nothing when there are no drafts", () => {
    render(<CmeDraftsSection drafts={[]} />);
    expect(screen.queryByTestId("cme-drafts-section")).toBeNull();
  });

  it("renders nothing while signed out, even with drafts on hand", () => {
    render(<CmeDraftsSection drafts={[draft()]} signedIn={false} />);
    expect(screen.queryByTestId("cme-drafts-section")).toBeNull();
    expect(screen.queryByText("Grand round on delirium")).toBeNull();
  });

  it("reports a load failure instead of silently showing nothing", () => {
    render(<CmeDraftsSection drafts={[]} loadFailed />);
    expect(screen.getByTestId("cme-drafts-load-failed")).toHaveTextContent("could not be loaded");
  });

  it("groups drafts into Yours to do (the Log tab's count) and Waiting on others, with counts, hiding empty groups", () => {
    const mine = draft({ id: "11111111-1111-4111-8111-111111111111", waitingOn: null });
    const supervisor = draft({
      id: "22222222-2222-4222-8222-222222222222",
      waitingOn: "supervisor",
      payload: cmeDraftPayloadSchema.parse({ title: "Peer review session" }),
    });
    render(<CmeDraftsSection drafts={[mine, supervisor]} />);

    expect(screen.getByTestId("cme-drafts-group-nextAction")).toHaveTextContent("Yours to do · 1");
    expect(screen.getByTestId("cme-drafts-group-supervisor")).toHaveTextContent(
      "Waiting on others: your supervisor · 1",
    );
    // Nothing is waiting on workforce, so that group is not rendered at all.
    expect(screen.queryByTestId("cme-drafts-group-workforce")).toBeNull();

    expect(
      within(screen.getByTestId("cme-drafts-group-nextAction")).getByText("Grand round on delirium"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("cme-drafts-group-supervisor")).getByText("Peer review session"),
    ).toBeInTheDocument();
  });

  it("shows the last-edited day in Perth, not UTC", () => {
    // 23:30 UTC on 9 Sep is 07:30 on 10 Sep in Perth.
    render(<CmeDraftsSection drafts={[draft({ updatedAt: "2026-09-09T23:30:00.000Z" })]} />);
    expect(screen.getByText(/Last edited/)).toHaveTextContent("10 Sep");
  });

  it("falls back to 'Untitled draft' for a blank draft", () => {
    render(<CmeDraftsSection drafts={[draft({ payload: cmeDraftPayloadSchema.parse({}) })]} />);
    expect(screen.getByText("Untitled draft")).toBeInTheDocument();
  });

  it("links Continue to the resume URL for that draft", () => {
    const item = draft();
    render(<CmeDraftsSection drafts={[item]} />);
    expect(screen.getByTestId(`cme-draft-continue-${item.id}`)).toHaveAttribute("href", `/cme/new?draft=${item.id}`);
  });

  it("marks a draft waiting for a supervisor, moving it out of Yours to do", async () => {
    const user = userEvent.setup();
    const item = draft();
    const updated: CmeDraft = { ...item, waitingOn: "supervisor" };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ draft: updated }), { status: 200 }));
    render(<CmeDraftsSection drafts={[item]} />);

    await user.selectOptions(screen.getByLabelText("Waiting on"), "supervisor");

    await waitFor(() => expect(screen.getByTestId("cme-drafts-group-supervisor")).toBeInTheDocument());
    expect(screen.queryByTestId("cme-drafts-group-nextAction")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`/api/cme/drafts/${item.id}`, expect.objectContaining({ method: "PATCH" }));
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { waitingOn: string | null };
    expect(sentBody.waitingOn).toBe("supervisor");
  });

  it("tells the reader not to put patient details in the waiting note", () => {
    render(<CmeDraftsSection drafts={[draft({ waitingOn: "supervisor", waitingNote: "Asked Dr A" })]} />);
    expect(screen.getByText("Don't include patient details.")).toBeInTheDocument();
  });

  it("keeps an unsaved waiting choice so it can be retried", async () => {
    const item = draft();
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Could not save." }), { status: 500 }),
    );
    render(<CmeDraftsSection drafts={[item]} />);

    await user.selectOptions(screen.getByLabelText("Waiting on"), "workforce");

    await waitFor(() => expect(screen.getByText("Could not save.")).toBeInTheDocument());
    expect(screen.getByLabelText("Waiting on")).toHaveValue("workforce");
    expect(screen.getByTestId("cme-drafts-group-nextAction")).toBeInTheDocument();
    expect(screen.queryByTestId("cme-drafts-group-workforce")).toBeNull();
  });

  it("deletes a draft", async () => {
    const user = userEvent.setup();
    const item = draft();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    render(<CmeDraftsSection drafts={[item]} />);

    await user.click(screen.getByTestId(`cme-draft-delete-${item.id}`));

    await waitFor(() => expect(screen.queryByTestId("cme-drafts-section")).toBeNull());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/cme/drafts/${item.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("hides the waiting controls and Delete in demo mode", () => {
    const item = draft();
    render(<CmeDraftsSection drafts={[item]} demoMode />);
    expect(screen.queryByLabelText("Waiting on")).toBeNull();
    expect(screen.queryByTestId(`cme-draft-delete-${item.id}`)).toBeNull();
    // Demo mode is still read-only display, not hidden entirely.
    expect(screen.getByText("Grand round on delirium")).toBeInTheDocument();
  });
});
