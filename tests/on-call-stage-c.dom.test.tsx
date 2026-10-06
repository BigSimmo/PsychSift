/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceEntryEditor } from "@/components/on-call/service-entry-editor";
import { ServiceAdminPanel } from "@/components/on-call/service-admin-panel";
import { ServiceHandbook } from "@/components/on-call/service-handbook";
import { demoServiceDetail, DEMO_SITE_ID } from "@/lib/on-call/service-demo";

afterEach(cleanup);
describe("Stage C editor controls", () => {
  it("sends an edited staff name for independent review and supports returning to role-only cover", async () => {
    const entry = demoServiceDetail.entries.find((entry) => entry.content.section === "cover")!;
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceEntryEditor
        entry={entry}
        sites={demoServiceDetail.sites}
        defaultSiteId={DEMO_SITE_ID}
        onSave={save}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole("option", { name: "Operational" })).toBeNull();
    const name = screen.getByRole("textbox", { name: /staff name/i });
    expect(name).toHaveValue("Dr Alex Example");
    await userEvent.clear(name);
    await userEvent.type(name, "Dr Sam Example");
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        section: "cover",
        kind: "clinical",
        cover: { ...entry.content.cover, staffName: "Dr Sam Example" },
        publish: true,
      }),
    );
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ cover: { ...entry.content.cover, staffName: undefined } }),
    );
  });
  it("preserves ordered ladder steps and rejects an out-of-range hospital wait", async () => {
    const entry = demoServiceDetail.entries.find((entry) => entry.content.section === "playbook")!;
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <ServiceEntryEditor
        entry={entry}
        sites={demoServiceDetail.sites}
        defaultSiteId={DEMO_SITE_ID}
        onSave={save}
        onCancel={() => {}}
      />,
    );
    const wait = screen.getByRole("spinbutton", { name: "Step 1 hospital-set wait (minutes)" });
    await userEvent.clear(wait);
    await userEvent.type(wait, "121");
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(save).not.toHaveBeenCalled();
    await userEvent.clear(wait);
    await userEvent.type(wait, "12");
    await userEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [expect.objectContaining({ order: 1, waitMinutes: 12 }), expect.objectContaining({ order: 2 })],
      }),
    );
  });
  it("offers editors Member-only invitations and names the restricted email", async () => {
    const action = vi.fn().mockResolvedValue({ code: "synthetic-code", expiresAt: "2026-09-30T00:00:00Z" });
    render(
      <ServiceAdminPanel
        detail={{ ...demoServiceDetail, membership: { role: "editor", clinicalReviewer: false } }}
        onAction={action}
      />,
    );
    expect(within(screen.getByRole("combobox", { name: "Invitation role" })).getAllByRole("option")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Invitee's email" }), "synthetic@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ role: "member", invitedEmail: "synthetic@example.org" }),
    );
    expect(screen.getByText(/This invite works only for synthetic@example.org/)).toBeInTheDocument();
  });
  it("keeps unnamed members distinguishable by a short stable id", () => {
    render(<ServiceAdminPanel detail={demoServiceDetail} onAction={vi.fn()} />);
    const [first, second] = demoServiceDetail.members;
    expect(screen.getByText(`Member ${first.id.slice(-8)}`)).toBeInTheDocument();
    expect(screen.getByText(`Member ${second.id.slice(-8)}`)).toBeInTheDocument();
  });

  it("confirms the visible published revision, while a non-reviewer cannot confirm cover", async () => {
    const entry = demoServiceDetail.entries.find((entry) => entry.content.section === "cover")!;
    const action = vi.fn().mockResolvedValue({ ok: true });
    const props = { selectedSiteId: DEMO_SITE_ID, canEdit: true, onEdit: vi.fn(), onAdd: vi.fn(), onAction: action };
    const detail = { ...demoServiceDetail, entries: [entry] };
    const view = render(<ServiceHandbook {...props} detail={detail} />);
    await userEvent.click(screen.getByRole("button", { name: "Still correct" }));
    expect(action).toHaveBeenCalledWith({
      action: "entry.confirm",
      entryId: entry.id,
      publishedRevision: entry.publishedRevision,
    });
    view.rerender(
      <ServiceHandbook {...props} detail={{ ...detail, membership: { role: "editor", clinicalReviewer: false } }} />,
    );
    expect(screen.queryByRole("button", { name: "Still correct" })).toBeNull();
    view.rerender(
      <ServiceHandbook
        {...props}
        detail={{ ...detail, entries: [{ ...entry, revision: 2, updatedAt: "2026-09-25T00:00:00Z" }] }}
      />,
    );
    expect(screen.getByText(/Draft saved 25 Sept? 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/^Updated 25/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Still correct" })).toBeNull();
  });
});

import { ServiceGovernancePanel } from "@/components/on-call/service-governance-panel";
it("shows the exact ladder and cover fields to the independent reviewer before approval", () => {
  const entries = demoServiceDetail.entries
    // The named Medicine cover row and the hospital ladder; the unnamed psychiatry cover rows are not under review here.
    .filter((entry) =>
      ["61000000-0000-4000-8000-000000000019", "61000000-0000-4000-8000-000000000020"].includes(entry.id),
    )
    .map((entry) => ({ ...entry, status: "pending_review" as const, revision: 2 }));
  render(
    <ServiceGovernancePanel
      detail={{ ...demoServiceDetail, entries }}
      actorId="independent-reviewer"
      canEdit={false}
      onEdit={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  const previews = screen.getAllByTestId("service-structured-preview");
  expect(previews).toHaveLength(2);
  expect(previews[0]).toHaveTextContent("registrar · Medicine");
  expect(previews[0]).toHaveTextContent("Staff: Dr Alex Example");
  expect(previews[0]).toHaveTextContent("00:00–23:59 (Perth)");
  expect(previews[1]).toHaveTextContent("Synthetic first role");
  expect(previews[1]).toHaveTextContent("Hospital-set wait: 10 min");
  expect(previews[1]).toHaveTextContent("5550 0043");
  expect(screen.getAllByRole("button", { name: "Approve revision" })).toHaveLength(2);
});
