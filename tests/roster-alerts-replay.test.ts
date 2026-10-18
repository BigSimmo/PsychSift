import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ drain: vi.fn(), configured: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/roster/alerts/outbox", () => ({ drainRosterOfferAlerts: m.drain }));
vi.mock("@/lib/roster/alerts/send", () => ({ webPushConfigured: m.configured, sendRosterAlerts: m.send }));
import { dispatchRosterAlerts } from "@/lib/roster/alerts/dispatch";
const client = {} as Parameters<typeof dispatchRosterAlerts>[0];
const event = {
  serviceId: "service",
  actorId: "actor",
  action: {
    action: "open.post",
    startsAt: "2026-11-20T00:00:00Z",
    endsAt: "2026-11-20T08:30:00Z",
    shiftCode: "D",
    kind: "day",
    postKey: "key",
  },
  result: { openShiftId: "opening", status: "open" },
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  m.configured.mockReturnValue(true);
  m.drain.mockResolvedValue(undefined);
});
describe("durable open.post dispatch", () => {
  it("asks the outbox to deliver the committed opening", async () => {
    await dispatchRosterAlerts(client, event);
    expect(m.drain).toHaveBeenCalledWith(client, "opening");
  });
  it("lets replay recover pending devices using the durable claim", async () => {
    await dispatchRosterAlerts(client, { ...event, result: { ...event.result, replayed: true } });
    expect(m.drain).toHaveBeenCalledOnce();
  });
  it("keeps the roster save successful when durable delivery is unavailable without a fan-out fallback", async () => {
    m.drain.mockRejectedValue(new Error("missing schema"));
    await expect(dispatchRosterAlerts(client, event)).resolves.toBeUndefined();
    expect(m.send).not.toHaveBeenCalled();
  });
  it("does not deliver expired/cancelled posts", async () => {
    await dispatchRosterAlerts(client, { ...event, result: { ...event.result, status: "expired" } });
    expect(m.drain).not.toHaveBeenCalled();
  });
});
