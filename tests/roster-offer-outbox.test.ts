import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  eligible: vi.fn(),
  settings: vi.fn(),
  night: vi.fn(),
  push: vi.fn(),
  configured: vi.fn(),
  release: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/roster/alerts/offer-recipients", () => ({ offerRecipients: m.eligible }));
vi.mock("@/lib/roster/settings", () => ({ fetchRosterSettings: m.settings }));
vi.mock("@/lib/roster/alerts/night", () => ({ recipientsOnNightNow: m.night }));
vi.mock("@/lib/roster/alerts/send", () => ({ pushRosterOfferDevice: m.push, webPushConfigured: m.configured }));
vi.mock("@/lib/roster/team/release", () => ({ rosterTeamReleaseEnabled: m.release }));
import {
  drainRosterOfferAlerts,
  ROSTER_OFFER_STOP_GRACE_MS,
  startRosterOfferAlertConsumer,
} from "@/lib/roster/alerts/outbox";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(3),
  other = id(4),
  device = id(5),
  device2 = id(6);
function fixture() {
  const outcomes = new Map([
    [device, "pending"],
    [device2, "pending"],
  ]);
  let lease = false,
    initialized = false,
    complete = false;
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const op = args.p_operation;
    if (op === "claim") {
      if (lease || complete) return { data: null, error: null };
      lease = true;
      return {
        data: {
          open_shift_id: id(1),
          service_id: id(2),
          actor_id: id(9),
          lease_token: id(10),
          initialized,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
        error: null,
      };
    }
    if (op === "prepare") initialized = true;
    if (op === "devices")
      return {
        data: [...outcomes]
          .filter(([, o]) => o === "pending")
          .slice(0, 25)
          .map(([s]) => ({ subscription_id: s, owner_id: s === device ? owner : other })),
        error: null,
      };
    if (op === "ack") outcomes.set(args.p_subscription_id as string, args.p_outcome as string);
    if (op === "release") {
      lease = false;
      complete = [...outcomes.values()].every((o) => o === "sent" || o === "skipped");
    }
    return { data: true, error: null };
  });
  const maybeSingle = vi.fn(async () => ({
    data: { id: device, owner_id: owner, endpoint: "https://fcm.googleapis.com/test", p256dh: "key", auth: "auth" },
    error: null,
  }));
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle };
  const from = vi.fn(() => query);
  return {
    client: { rpc, from } as unknown as Parameters<typeof drainRosterOfferAlerts>[0],
    rpc,
    maybeSingle,
    outcomes,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.configured.mockReturnValue(true);
  m.release.mockReturnValue(true);
  m.eligible.mockResolvedValue([owner, other]);
  m.settings.mockResolvedValue({ alerts: { requests: true } });
  m.night.mockResolvedValue(new Set());
  m.push.mockResolvedValue("sent");
});
describe("durable per-device offer consumer", () => {
  it("drains a second device page within the same durable claim", async () => {
    const f = fixture();
    f.outcomes.clear();
    for (let index = 100; index < 126; index += 1) f.outcomes.set(id(index), "pending");
    await expect(drainRosterOfferAlerts(f.client)).resolves.toBe(true);
    expect(m.push).toHaveBeenCalledTimes(26);
    expect([...f.outcomes.values()]).toEqual(Array(26).fill("sent"));
    expect(f.rpc.mock.calls.filter(([, args]) => args.p_operation === "claim")).toHaveLength(1);
  });
  it("records each device separately and retries only a failed device", async () => {
    const f = fixture();
    m.push.mockResolvedValueOnce("sent").mockResolvedValueOnce("retry");
    await drainRosterOfferAlerts(f.client);
    expect(f.outcomes.get(device)).toBe("sent");
    expect(f.outcomes.get(device2)).toBe("retry");
    f.outcomes.set(device2, "pending");
    await drainRosterOfferAlerts(f.client);
    expect(m.push).toHaveBeenCalledTimes(3);
    expect(f.outcomes.get(device2)).toBe("sent");
    await drainRosterOfferAlerts(f.client);
    expect(m.push).toHaveBeenCalledTimes(3);
  });
  it("does not fall back to a whole-recipient send on missing durable schema", async () => {
    const f = fixture();
    f.rpc.mockResolvedValueOnce({ data: null, error: { message: "missing" } } as never);
    await expect(drainRosterOfferAlerts(f.client)).rejects.toThrow("claim unavailable");
    expect(m.push).not.toHaveBeenCalled();
  });
  it("two consumers share only the durable claim", async () => {
    const f = fixture();
    await Promise.all([drainRosterOfferAlerts(f.client), drainRosterOfferAlerts(f.client)]);
    expect(m.push).toHaveBeenCalledTimes(2);
  });
  it("rechecks membership/eligibility before delivery and skips revoked recipients", async () => {
    const f = fixture();
    m.eligible.mockResolvedValueOnce([owner, other]).mockResolvedValue([]);
    await drainRosterOfferAlerts(f.client);
    expect(m.push).not.toHaveBeenCalled();
    expect([...f.outcomes.values()]).toEqual(["skipped", "skipped"]);
  });
  it("respects current settings and quiet nights", async () => {
    const f = fixture();
    m.settings.mockResolvedValueOnce({ alerts: { requests: false } });
    m.night.mockResolvedValue(new Set([other]));
    await drainRosterOfferAlerts(f.client);
    expect(m.push).not.toHaveBeenCalled();
  });
  it("does not send to a removed or transferred subscription", async () => {
    const f = fixture();
    f.maybeSingle.mockResolvedValue({ data: null, error: null } as never);
    await drainRosterOfferAlerts(f.client);
    expect(m.push).not.toHaveBeenCalled();
    expect(f.client.from).toHaveBeenCalledWith("web_push_subscriptions");
  });
  it("stops before a send when lease validation fails", async () => {
    const f = fixture();
    const original = f.rpc.getMockImplementation()!;
    let reads = 0;
    f.rpc.mockImplementation(async (n, a) => {
      if (a.p_operation === "devices" && ++reads === 2) return { data: null, error: null } as never;
      return original(n, a);
    });
    await expect(drainRosterOfferAlerts(f.client)).rejects.toThrow("lease unavailable");
    expect(m.push).not.toHaveBeenCalled();
  });
  it("retries a settings failure without starving another recipient", async () => {
    const f = fixture();
    m.settings.mockRejectedValueOnce(new Error("transient"));
    await drainRosterOfferAlerts(f.client);
    expect(f.outcomes.get(device)).toBe("retry");
    expect(f.outcomes.get(device2)).toBe("sent");
    expect(m.push).toHaveBeenCalledOnce();
  });
  it("does not turn a transient opening lookup failure into an empty completed offer", async () => {
    const f = fixture();
    m.eligible.mockRejectedValueOnce(new Error("Opening check unavailable"));
    await expect(drainRosterOfferAlerts(f.client)).rejects.toThrow("Opening check unavailable");
    expect(f.rpc.mock.calls.some(([, a]) => a.p_operation === "prepare")).toBe(false);
    expect(f.rpc.mock.calls.some(([, a]) => a.p_operation === "ack")).toBe(false);
    expect(f.rpc.mock.calls.some(([, a]) => a.p_operation === "release")).toBe(true);
  });
  it("reports the original failure when releasing the lease fails too", async () => {
    const f = fixture();
    const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (n, a) => {
      if (a.p_operation === "release") return { data: null, error: { message: "lease gone" } } as never;
      return original(n, a);
    });
    m.eligible.mockRejectedValueOnce(new Error("Opening check unavailable"));
    await expect(drainRosterOfferAlerts(f.client)).rejects.toThrow("Opening check unavailable");
    expect(f.rpc.mock.calls.some(([, a]) => a.p_operation === "release")).toBe(true);
  });
  it("retries a transient per-device eligibility failure instead of terminally skipping", async () => {
    const f = fixture();
    m.eligible.mockResolvedValueOnce([owner, other]).mockRejectedValueOnce(new Error("Opening check unavailable"));
    await drainRosterOfferAlerts(f.client);
    expect(f.outcomes.get(device)).toBe("retry");
    expect(f.outcomes.get(device2)).toBe("sent");
  });
  it("does not activate during the staff release hold or missing provider setup", async () => {
    const f = fixture();
    m.release.mockReturnValue(false);
    await drainRosterOfferAlerts(f.client);
    m.release.mockReturnValue(true);
    m.configured.mockReturnValue(false);
    await drainRosterOfferAlerts(f.client);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("honours shutdown before claiming", async () => {
    const f = fixture();
    await drainRosterOfferAlerts(f.client, undefined, AbortSignal.abort());
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("stops the retry timer on shutdown", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      const controller = new AbortController();
      const stop = startRosterOfferAlertConsumer(f.client, controller.signal);
      await stop();
      const calls = f.rpc.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(f.rpc).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops an active drain at the next device when the consumer is stopped, without the worker signal firing", async () => {
    const f = fixture();
    let finishFirstPush: (outcome: "sent") => void = () => {};
    m.push.mockImplementationOnce(() => new Promise((resolve) => (finishFirstPush = resolve)));
    const workerSignal = new AbortController().signal; // never aborts, as in a --once run that just finishes
    const stop = startRosterOfferAlertConsumer(f.client, workerSignal);
    await vi.waitFor(() => expect(m.push).toHaveBeenCalledOnce());
    const stopped = stop();
    finishFirstPush("sent");
    await stopped;
    expect(m.push).toHaveBeenCalledOnce();
    expect(f.outcomes.get(device)).toBe("sent");
    expect(f.outcomes.get(device2)).toBe("pending");
    expect(f.rpc.mock.calls.some(([, a]) => a.p_operation === "release")).toBe(true);
  });
  it("does not let a stalled push hold shutdown past the grace period", async () => {
    const f = fixture();
    m.push.mockImplementationOnce(() => new Promise(() => {})); // never settles
    const stop = startRosterOfferAlertConsumer(f.client, new AbortController().signal);
    await vi.waitFor(() => expect(m.push).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    try {
      let done = false;
      const stopped = stop().then(() => (done = true));
      await vi.advanceTimersByTimeAsync(ROSTER_OFFER_STOP_GRACE_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopped;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
