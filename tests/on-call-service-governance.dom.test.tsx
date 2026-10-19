/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceGovernancePanel } from "@/components/on-call/service-governance-panel";
import type { ServiceDetail, ServiceEntry } from "@/lib/on-call/service-model";

const entry: ServiceEntry = {
  id: "entry",
  revision: 3,
  publishedRevision: 1,
  status: "pending_review",
  authorId: "author",
  reviewedBy: null,
  reviewedAt: null,
  reviewComment: "Clarify the source",
  updatedAt: "2026-09-22T00:00:00Z",
  content: {
    siteId: null,
    section: "resources",
    kind: "clinical",
    title: "Synthetic clinical reference",
    body: "Blank synthetic reference",
    phone: "",
    sources: [{ label: "Official reference", url: "https://example.org/reference" }],
    orientationPhase: "first_shift",
  },
  publishedContent: {
    siteId: null,
    section: "resources",
    kind: "clinical",
    title: "Earlier reference",
    body: "Earlier approved copy",
    phone: "",
    sources: [],
    orientationPhase: "first_shift",
  },
};
const detail: ServiceDetail = {
  service: { id: "service", name: "Synthetic service" },
  membership: { role: "member", clinicalReviewer: true },
  sites: [],
  entries: [entry],
  members: [],
  invitations: [],
  reports: [],
  orientation: [],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Independent service review", () => {
  it("exposes the source and loaded revision for a different designated reviewer", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <ServiceGovernancePanel detail={detail} actorId="reviewer" canEdit={false} onEdit={vi.fn()} onAction={action} />,
    );
    expect(screen.getByRole("link", { name: "Official reference" })).toHaveAttribute(
      "href",
      "https://example.org/reference",
    );
    expect(screen.getByText(/Clarify the source/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw entry from handbook" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Approve revision" }));
    expect(action).toHaveBeenCalledWith({
      action: "entry.review",
      entryId: "entry",
      expectedRevision: 3,
      decision: "approve",
      comment: "",
    });
  });
  it("never offers authors approval of their own revision", () => {
    render(
      <ServiceGovernancePanel detail={detail} actorId="author" canEdit={false} onEdit={vi.fn()} onAction={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Approve revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw entry from handbook" })).toBeNull();
  });
  it("allows an editor to repair a draft and confirms withdrawal of the whole entry", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true });
    const edit = vi.fn();
    const confirm = vi.spyOn(window, "confirm");
    render(
      <ServiceGovernancePanel
        detail={{ ...detail, membership: { role: "editor", clinicalReviewer: false } }}
        actorId="author"
        canEdit
        onEdit={edit}
        onAction={action}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit entry" }));
    expect(edit).toHaveBeenCalledWith(entry);
    // F-36: the app's own confirmation sheet, not the browser's native confirm().
    await user.click(screen.getByRole("button", { name: "Withdraw entry from handbook" }));
    const firstDialog = await screen.findByRole("dialog", { name: "Withdraw entry" });
    expect(firstDialog).toHaveTextContent(
      'Members will stop seeing "Synthetic clinical reference" in the service handbook, including any revision approved earlier.',
    );
    await user.click(within(firstDialog).getAllByRole("button", { name: "Cancel" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Withdraw entry" })).toBeNull());
    expect(action).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Withdraw entry from handbook" }));
    const secondDialog = await screen.findByRole("dialog", { name: "Withdraw entry" });
    await user.click(within(secondDialog).getByRole("button", { name: "Withdraw entry" }));
    expect(action).toHaveBeenCalledWith({ action: "entry.withdraw", entryId: "entry", expectedRevision: 3 });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Withdraw entry" })).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });
});
