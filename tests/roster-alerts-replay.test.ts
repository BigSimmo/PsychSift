import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  active: vi.fn(),
  open: vi.fn(),
  night: vi.fn(),
  candidates: vi.fn(),
  send: vi.fn(),
  configured: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/roster/team/repository", () => ({ rosterRead: mocks.read }));
vi.mock("@/lib/roster/team/eligibility", () => ({ openShiftCandidates: mocks.candidates }));
vi.mock("@/lib/roster/alerts/night", () => ({ recipientsOnNightNow: mocks.night }));
vi.mock("@/lib/roster/alerts/recipients", () => ({
  activeRecipientIds: mocks.active,
  swapParties: vi.fn(),
  openParties: mocks.open,
  previousOpenHolder: vi.fn(),
}));
vi.mock("@/lib/roster/alerts/send", () => ({
  sendRosterAlerts: mocks.send,
  webPushConfigured: mocks.configured,
}));

import { dispatchRosterAlerts } from "@/lib/roster/alerts/dispatch";

const SERVICE = "5e000000-0000-4000-8000-000000000101";
const MANAGER = "5e000000-0000-4000-8000-000000000102";
const DOCTOR = "5e000000-0000-4000-8000-000000000103";

function makeOpenPostAction(postKey: string) {
  return {
    action: "open.post" as const,
    startsAt: "2026-11-20T00:00:00.000Z",
    endsAt: "2026-11-20T08:30:00.000Z",
    shiftCode: "D",
    kind: "day" as const,
    postKey,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.read.mockImplementation(async (_client, _actor, _service, what: string) =>
    what === "overview" ? { managers: [], settings: { rules: {} } } : { assignments: [] },
  );
  mocks.open.mockResolvedValue({
    starts_at: "2026-11-20T00:00:00.000Z",
    ends_at: "2026-11-20T08:30:00.000Z",
    min_grade: null,
    assignment_id: null,
    posted_by: MANAGER,
    claimed_by: null,
  });
  mocks.candidates.mockReturnValue([{ userId: DOCTOR }]);
  mocks.active.mockImplementation(async (_client, _service, ids: string[]) => new Set(ids));
  mocks.night.mockResolvedValue(new Set());
  mocks.send.mockResolvedValue({ sent: 1, skipped: 0, failed: 0 });
});

describe("R22: durable open.post alert delivery tracking and replay recovery", () => {
  it("retries alert delivery on an idempotent replay when the initial open.post alert delivery failed, then suppresses further replays", async () => {
    const OPEN_SHIFT_ID = "5e000000-0000-4000-8000-000000000201";
    const client = {} as Parameters<typeof dispatchRosterAlerts>[0];
    const action = makeOpenPostAction("5e000000-0000-4000-8000-000000000301");

    // 1. Initial open.post: push delivery fails (failed > 0).
    mocks.send.mockResolvedValueOnce({ sent: 0, skipped: 0, failed: 1 });
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open" },
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    // 2. First replay (replayed: true): because initial delivery failed, replay retries and succeeds.
    mocks.send.mockResolvedValueOnce({ sent: 1, skipped: 0, failed: 0 });
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open", replayed: true },
    });
    expect(mocks.send).toHaveBeenCalledTimes(2);

    // 3. Second replay (replayed: true): delivery is now recorded, so no duplicate alert is sent.
    vi.clearAllMocks();
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open", replayed: true },
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("retries alert delivery on replay when sendRosterAlerts threw on the initial open.post", async () => {
    const OPEN_SHIFT_ID = "5e000000-0000-4000-8000-000000000202";
    const client = {} as Parameters<typeof dispatchRosterAlerts>[0];
    const action = makeOpenPostAction("5e000000-0000-4000-8000-000000000302");

    mocks.send.mockRejectedValueOnce(new Error("Push gateway timeout"));
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open" },
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);

    mocks.send.mockResolvedValueOnce({ sent: 1, skipped: 0, failed: 0 });
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open", replayed: true },
    });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("consults and upserts roster_open_post_alerts so cross-instance replays recover undelivered alerts and skip delivered ones", async () => {
    const OPEN_SHIFT_ID = "5e000000-0000-4000-8000-000000000203";
    const action = makeOpenPostAction("5e000000-0000-4000-8000-000000000303");

    let persistedRow: { open_shift_id: string } | null = null;
    const maybeSingle = vi.fn(async () => ({ data: persistedRow, error: null }));
    const upsert = vi.fn(async (values: { open_shift_id: string }) => {
      persistedRow = { open_shift_id: values.open_shift_id };
      return { error: null };
    });
    const client = {
      from: vi.fn((table: string) => {
        if (table === "roster_open_post_alerts") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle,
                }),
              }),
            }),
            upsert,
          };
        }
        return {};
      }),
    } as unknown as Parameters<typeof dispatchRosterAlerts>[0];

    // Simulate a replay arriving on a fresh server instance where the initial post committed in SQL
    // but crashed before recording roster_open_post_alerts (persistedRow is null).
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open", replayed: true },
    });

    expect(maybeSingle).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        service_id: SERVICE,
        open_shift_id: OPEN_SHIFT_ID,
      }),
      { onConflict: "service_id,open_shift_id" },
    );

    // Subsequent replay sees the delivered state and skips sending.
    vi.clearAllMocks();
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open", replayed: true },
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends the offer alert once when two requests for the same open shift arrive together", async () => {
    const OPEN_SHIFT_ID = "5e000000-0000-4000-8000-000000000401";
    const client = {} as Parameters<typeof dispatchRosterAlerts>[0];
    const action = makeOpenPostAction("5e000000-0000-4000-8000-000000000501");
    const event = {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open" },
    };

    await Promise.all([dispatchRosterAlerts(client, event), dispatchRosterAlerts(client, event)]);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("keeps the alert retryable when the durable delivery record cannot be written", async () => {
    const OPEN_SHIFT_ID = "5e000000-0000-4000-8000-000000000402";
    const action = makeOpenPostAction("5e000000-0000-4000-8000-000000000502");
    const upsert = vi.fn().mockResolvedValue({ error: { message: "write failed" } });
    const client = {
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        upsert,
      })),
    } as unknown as Parameters<typeof dispatchRosterAlerts>[0];

    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open" },
    });
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: MANAGER,
      action,
      result: { openShiftId: OPEN_SHIFT_ID, status: "open", replayed: true },
    });

    // The first delivery was never recorded durably, so the replay sends again.
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
