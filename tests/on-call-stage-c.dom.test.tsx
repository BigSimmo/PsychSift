/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceEntryEditor } from "@/components/on-call/service-entry-editor";
import { ServiceAdminPanel } from "@/components/on-call/service-admin-panel";
import { ServiceHandbook } from "@/components/on-call/service-handbook";
import { resolveHandbookPhone } from "@/lib/on-call/number-resolver";
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

  it("asks before removing a member, and says so when the admin is removing themselves", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const [admin, editor] = demoServiceDetail.members;
    render(<ServiceAdminPanel detail={demoServiceDetail} actorId={admin.id} onAction={action} />);
    const removeButtons = screen.getAllByRole("button", { name: "Remove member" });
    await userEvent.click(removeButtons[1]!);
    expect(action).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(`Member ${editor.id.slice(-8)} will lose access`);
    await userEvent.click(within(dialog).getAllByRole("button", { name: "Cancel" })[0]!);
    expect(action).not.toHaveBeenCalled();

    await userEvent.click(removeButtons[0]!);
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Remove yourself" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove yourself" }));
    expect(action).toHaveBeenCalledWith({ action: "member.revoke", memberId: admin.id });
  });

  it("resyncs a member's role when the saved role changes", () => {
    const view = render(<ServiceAdminPanel detail={demoServiceDetail} onAction={vi.fn()} />);
    const [, editor] = demoServiceDetail.members;
    expect(screen.getByLabelText("Role", { selector: `#service-member-${editor.id}-role` })).toHaveValue("editor");
    view.rerender(
      <ServiceAdminPanel
        detail={{
          ...demoServiceDetail,
          members: demoServiceDetail.members.map((member) =>
            member.id === editor.id ? { ...member, role: "member" as const } : member,
          ),
        }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Role", { selector: `#service-member-${editor.id}-role` })).toHaveValue("member");
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
  it("says the hospital hours were saved after the reload brings the new times back", async () => {
    const site = demoServiceDetail.sites.find((item) => item.id === DEMO_SITE_ID)!;
    let detail = { ...demoServiceDetail, entries: [] };
    const props = { selectedSiteId: DEMO_SITE_ID, canEdit: true, onEdit: vi.fn(), onAdd: vi.fn() };
    const action = vi.fn(async (sent: { afterHoursStart?: string | null; afterHoursEnd?: string | null }) => {
      // The real page reloads detail before the action resolves.
      detail = {
        ...detail,
        sites: detail.sites.map((item) =>
          item.id === site.id
            ? { ...item, afterHoursStart: sent.afterHoursStart, afterHoursEnd: sent.afterHoursEnd }
            : item,
        ),
      };
      view.rerender(<ServiceHandbook {...props} detail={detail} onAction={action as never} />);
      return { ok: true };
    });
    const view = render(<ServiceHandbook {...props} detail={detail} onAction={action as never} />);
    const hours = screen.getByTestId("service-site-hours");
    await userEvent.clear(within(hours).getByLabelText("After hours starts"));
    await userEvent.type(within(hours).getByLabelText("After hours starts"), "18:30");
    await userEvent.clear(within(hours).getByLabelText("After hours ends"));
    await userEvent.type(within(hours).getByLabelText("After hours ends"), "07:30");
    await userEvent.click(within(hours).getByRole("button", { name: "Save hospital hours" }));
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ action: "site.update", afterHoursStart: "18:30", afterHoursEnd: "07:30" }),
    );
    expect(await screen.findByText("Hospital hours saved.")).toBeInTheDocument();
    expect(within(screen.getByTestId("service-site-hours")).getByLabelText("After hours starts")).toHaveValue("18:30");
  });

  it("offers a Call button only for a published number, never a draft or withdrawn one", () => {
    const entry = demoServiceDetail.entries.find(
      (entry) =>
        entry.content.kind === "operational" &&
        resolveHandbookPhone(entry.content.phone).tel &&
        !entry.content.steps &&
        !entry.content.cover,
    )!;
    const props = { selectedSiteId: DEMO_SITE_ID, canEdit: true, onEdit: vi.fn(), onAdd: vi.fn(), onAction: vi.fn() };
    const card = () => screen.getByTestId(`service-entry-${entry.id}`);
    const view = render(<ServiceHandbook {...props} detail={{ ...demoServiceDetail, entries: [entry] }} />);
    expect(
      within(card()).getByRole("link", { name: new RegExp(`^Call .*, ${entry.content.title}$`) }),
    ).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "Flag incorrect entry" })).toBeInTheDocument();

    const draft = { ...entry, status: "draft" as const, publishedRevision: null, publishedContent: null };
    view.rerender(<ServiceHandbook {...props} detail={{ ...demoServiceDetail, entries: [draft] }} />);
    expect(within(card()).queryByRole("link", { name: /^Call / })).toBeNull();
    expect(
      within(card()).getByText(`Phone or extension: ${entry.content.phone}`, { exact: false }),
    ).toBeInTheDocument();
    expect(within(card()).getByText("Not published")).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "Flag incorrect entry" })).toBeNull();

    view.rerender(
      <ServiceHandbook {...props} detail={{ ...demoServiceDetail, entries: [{ ...entry, status: "withdrawn" }] }} />,
    );
    expect(within(card()).queryByRole("link", { name: /^Call / })).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Flag incorrect entry" })).toBeNull();
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
