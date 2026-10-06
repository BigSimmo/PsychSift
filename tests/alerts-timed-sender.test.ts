import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toDevice: vi.fn(),
  toOwners: vi.fn(),
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/roster/alerts/send", () => ({
  pushCodeToOwnerDevice: mocks.toDevice,
  pushCodeToOwners: mocks.toOwners,
  webPushConfigured: () => true,
}));

import { sendDueReminders, sendMorningBriefs } from "@/lib/alerts/timed-sender";
import type { RosterAdminClient } from "@/lib/roster/team/api";

const ME = "5e000000-0000-4000-8000-000000000001";
const PHONE = "https://fcm.googleapis.com/fcm/send/this-phone";
const perth = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`);

function query(table: string) {
  const q = {
    select: () => q,
    in: () => q,
    eq: () => q,
    gte: () => q,
    lt: () => q,
    order: () => q,
    limit: () => q,
    then: (resolve: (value: { error: null; data: unknown[] }) => void) =>
      resolve({ error: null, data: mocks.tables[table] ?? [] }),
  };
  return q;
}

const client = { from: query, rpc: mocks.rpc } as unknown as RosterAdminClient;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = {};
  mocks.toDevice.mockResolvedValue(true);
  mocks.toOwners.mockResolvedValue({ sent: 1, failed: 0 });
});

describe("due reminders", () => {
  it("buzzes only the phone that set the note, with the code alone", async () => {
    const now = perth("2026-10-07", "10:00");
    mocks.rpc.mockResolvedValue({
      error: null,
      data: [{ owner_id: ME, ref: "r1", due_at: perth("2026-10-07", "09:59").toISOString(), endpoint: PHONE }],
    });
    expect(await sendDueReminders(client, now)).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith("alert_claim_due_reminders", { p_now: now.toISOString(), p_limit: 200 });
    expect(mocks.toDevice).toHaveBeenCalledWith(client, ME, PHONE, "reminder", 900);
  });

  it("drops a note more than 30 minutes late instead of buzzing long after the moment", async () => {
    mocks.rpc.mockResolvedValue({
      error: null,
      data: [{ owner_id: ME, ref: "r1", due_at: perth("2026-10-07", "09:00").toISOString(), endpoint: PHONE }],
    });
    expect(await sendDueReminders(client, perth("2026-10-07", "10:00"))).toBe(0);
    expect(mocks.toDevice).not.toHaveBeenCalled();
  });

  it("fails loudly when the claim is unavailable", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "down" }, data: null });
    await expect(sendDueReminders(client, new Date())).rejects.toThrow();
  });
});

describe("morning brief", () => {
  const wanting = () => {
    mocks.tables.web_push_subscriptions = [{ owner_id: ME }];
    mocks.tables.user_preferences = [
      { user_id: ME, preferences: { reminders: { brief: { enabled: true, workday: "07:00", dayOff: "09:00" } } } },
    ];
  };

  it("sends once it is due and this server won the day's claim", async () => {
    wanting();
    mocks.rpc.mockResolvedValue({ error: null, data: true });
    expect(await sendMorningBriefs(client, perth("2026-10-07", "09:01"))).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith("alert_claim_morning_brief", { p_owner_id: ME, p_perth_date: "2026-10-07" });
    expect(mocks.toOwners).toHaveBeenCalledWith(client, [ME], "brief", 7200);
  });

  it("sends nothing when another server already claimed today", async () => {
    wanting();
    mocks.rpc.mockResolvedValue({ error: null, data: false });
    expect(await sendMorningBriefs(client, perth("2026-10-07", "09:01"))).toBe(0);
    expect(mocks.toOwners).not.toHaveBeenCalled();
  });

  it("waits until its time, and until 14:00 after a night", async () => {
    wanting();
    mocks.rpc.mockResolvedValue({ error: null, data: true });
    expect(await sendMorningBriefs(client, perth("2026-10-07", "08:59"))).toBe(0);
    mocks.tables.on_call_shifts = [
      {
        owner_id: ME,
        starts_at: perth("2026-10-06", "21:30").toISOString(),
        ends_at: perth("2026-10-07", "08:00").toISOString(),
        kind: "night",
      },
    ];
    expect(await sendMorningBriefs(client, perth("2026-10-07", "09:01"))).toBe(0);
    expect(await sendMorningBriefs(client, perth("2026-10-07", "14:00"))).toBe(1);
  });

  it("sends yesterday's brief that quiet hours held past midnight, once", async () => {
    mocks.tables.web_push_subscriptions = [{ owner_id: ME }];
    mocks.tables.user_preferences = [
      {
        user_id: ME,
        preferences: {
          reminders: {
            brief: { enabled: true, workday: "07:00", dayOff: "22:00" },
            quietHours: { enabled: true, start: "21:00", end: "07:00" },
          },
        },
      },
    ];
    mocks.rpc.mockResolvedValue({ error: null, data: true });
    expect(await sendMorningBriefs(client, perth("2026-10-07", "07:01"))).toBe(1);
    expect(mocks.rpc).toHaveBeenCalledWith("alert_claim_morning_brief", { p_owner_id: ME, p_perth_date: "2026-10-07" });
  });

  it("keeps sending the rest when one reminder's device check fails", async () => {
    const due = perth("2026-10-07", "09:59").toISOString();
    mocks.rpc.mockResolvedValue({
      error: null,
      data: [
        { owner_id: ME, ref: "r1", due_at: due, endpoint: PHONE },
        { owner_id: ME, ref: "r2", due_at: due, endpoint: PHONE },
      ],
    });
    mocks.toDevice.mockRejectedValueOnce(new Error("storage")).mockResolvedValueOnce(true);
    expect(await sendDueReminders(client, perth("2026-10-07", "10:00"))).toBe(1);
  });

  it("does nothing for an owner who left the brief off", async () => {
    wanting();
    mocks.tables.user_preferences = [{ user_id: ME, preferences: { reminders: { brief: { enabled: false } } } }];
    expect(await sendMorningBriefs(client, perth("2026-10-07", "09:01"))).toBe(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
