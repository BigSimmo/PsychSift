import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  active: vi.fn(),
  swap: vi.fn(),
  open: vi.fn(),
  previous: vi.fn(),
  night: vi.fn(),
  settings: vi.fn(),
  subscriptions: vi.fn(),
  remove: vi.fn(),
  send: vi.fn(),
  vapid: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    WEB_PUSH_PUBLIC_KEY: "public",
    WEB_PUSH_PRIVATE_KEY: "private",
    WEB_PUSH_SUBJECT: "mailto:operator@example.org",
  },
}));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, setVapidDetails: mocks.vapid } }));
vi.mock("@/lib/roster/team/repository", () => ({ rosterRead: mocks.read }));
vi.mock("@/lib/roster/settings", () => ({ fetchRosterSettings: mocks.settings }));
vi.mock("@/lib/roster/alerts/night", () => ({ recipientsOnNightNow: mocks.night }));
vi.mock("@/lib/roster/alerts/recipients", () => ({
  activeRecipientIds: mocks.active,
  swapParties: mocks.swap,
  openParties: mocks.open,
  previousOpenHolder: mocks.previous,
}));
vi.mock("@/lib/roster/alerts/subscriptions", () => ({
  subscriptionsForOwners: mocks.subscriptions,
  removeGoneSubscription: mocks.remove,
}));

import { dispatchRosterAlerts } from "@/lib/roster/alerts/dispatch";

const SERVICE = "5e000000-0000-4000-8000-000000000001";
const ALEX = "5e000000-0000-4000-8000-000000000002";
const MEI = "5e000000-0000-4000-8000-000000000003";
const SAM = "5e000000-0000-4000-8000-000000000004";
const SWAP = "5e000000-0000-4000-8000-000000000005";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/example";
const client = {} as Parameters<typeof dispatchRosterAlerts>[0];

function event(action: "swap.create" | "swap.approve", actorId = ALEX) {
  return {
    serviceId: SERVICE,
    actorId,
    action:
      action === "swap.create"
        ? { action, giveAssignmentId: "5e000000-0000-4000-8000-000000000006", counterpartyId: SAM }
        : { action, swapId: SWAP },
    result: { swapId: SWAP, status: action === "swap.create" ? "requested" : "approved" },
  } as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockImplementation(async (_client, _actor, _service, what: string) =>
    what === "overview" ? { managers: [], settings: { rules: {} } } : { assignments: [] },
  );
  mocks.active.mockImplementation(async (_client, _service, ids: string[]) => new Set(ids));
  mocks.swap.mockResolvedValue({ requesterId: MEI, counterpartyId: SAM });
  mocks.night.mockResolvedValue(new Set());
  mocks.settings.mockResolvedValue({ alerts: { changes: true, requests: true } });
  mocks.subscriptions.mockImplementation(async (_client, ids: string[]) =>
    ids.map((ownerId) => ({
      id: `${ownerId}-sub`,
      owner_id: ownerId,
      endpoint: ENDPOINT,
      p256dh: "abcdefghij",
      auth: "abcdefghij",
    })),
  );
  mocks.send.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

describe("generic phone alerts", () => {
  it("sends only the type code for a swap request", async () => {
    await dispatchRosterAlerts(client, event("swap.create"));
    expect(mocks.subscriptions).toHaveBeenCalledWith(client, [SAM]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[1]).toBe(JSON.stringify({ t: "request" }));
    expect(mocks.send.mock.calls[0]?.[2]).toEqual({ TTL: 21600 });
  });

  it("holds a request during the recipient's night but lets a roster change through", async () => {
    mocks.night.mockResolvedValue(new Set([SAM]));
    await dispatchRosterAlerts(client, event("swap.create"));
    expect(mocks.send).not.toHaveBeenCalled();
    await dispatchRosterAlerts(client, event("swap.approve"));
    expect(mocks.send.mock.calls.map((call) => call[1])).toEqual([
      JSON.stringify({ t: "changed" }),
      JSON.stringify({ t: "changed" }),
    ]);
  });

  it("drops a 410 subscription without logging identifying data", async () => {
    const log = vi.spyOn(console, "error");
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));
    await dispatchRosterAlerts(client, event("swap.create"));
    expect(mocks.remove).toHaveBeenCalledWith(client, expect.objectContaining({ endpoint: ENDPOINT }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/example|fcm\.googleapis|Mei|Sam/i);
    log.mockRestore();
  });

  it("never alerts the person who acted", async () => {
    await dispatchRosterAlerts(client, event("swap.approve", MEI));
    expect(mocks.subscriptions).toHaveBeenCalledWith(client, [SAM]);
  });

  it("offers a newly posted gap, but never re-sends the offer for a replayed post", async () => {
    const OPEN = "5e000000-0000-4000-8000-000000000007";
    const gap = {
      action: "open.post",
      startsAt: "2026-11-20T00:00:00.000Z",
      endsAt: "2026-11-20T08:30:00.000Z",
      shiftCode: "D",
      kind: "day",
      postKey: "5e000000-0000-4000-8000-000000000008",
    } as const;
    mocks.open.mockResolvedValue({
      starts_at: gap.startsAt,
      ends_at: gap.endsAt,
      min_grade: null,
      assignment_id: null,
      posted_by: ALEX,
      claimed_by: null,
    });
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: ALEX,
      action: gap,
      result: { openShiftId: OPEN, status: "open" },
    });
    expect(mocks.open).toHaveBeenCalledWith(client, SERVICE, OPEN);

    vi.clearAllMocks();
    await dispatchRosterAlerts(client, {
      serviceId: SERVICE,
      actorId: ALEX,
      action: gap,
      result: { openShiftId: OPEN, status: "open", replayed: true },
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
