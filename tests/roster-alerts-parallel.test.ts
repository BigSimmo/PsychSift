import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), subscriptions: vi.fn(), remove: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    WEB_PUSH_PUBLIC_KEY: "public",
    WEB_PUSH_PRIVATE_KEY: "private",
    WEB_PUSH_SUBJECT: "mailto:operator@example.org",
  },
}));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, setVapidDetails: vi.fn() } }));
vi.mock("@/lib/roster/settings", () => ({ fetchRosterSettings: mocks.settings }));
vi.mock("@/lib/roster/alerts/subscriptions", () => ({
  subscriptionsForOwners: mocks.subscriptions,
  removeGoneSubscription: mocks.remove,
  ownerSubscriptionFor: vi.fn(),
}));

import { ROSTER_ALERT_PARALLEL, sendRosterAlerts } from "@/lib/roster/alerts/send";

const client = {} as Parameters<typeof sendRosterAlerts>[0];
const ids = Array.from({ length: 40 }, (_, i) => `5e000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

/** A mock that resolves on the next tick and records the most calls in flight at once. */
function tracked<T>(answer: (arg: unknown) => T) {
  const state = { now: 0, most: 0 };
  const fn = async (arg: unknown) => {
    state.now += 1;
    state.most = Math.max(state.most, state.now);
    await new Promise((resolve) => setTimeout(resolve, 1));
    state.now -= 1;
    return answer(arg);
  };
  return { fn, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
});

describe("roster alerts for a large team", () => {
  it("reads settings and pushes a few at a time, never one by one and never all at once", async () => {
    const settings = tracked(() => ({ alerts: { changes: true, requests: true } }));
    mocks.settings.mockImplementation((_client: unknown, owner: string) => settings.fn(owner));
    mocks.subscriptions.mockResolvedValue(
      ids.map((owner, i) => ({ owner_id: owner, endpoint: `https://push.example/${i}`, p256dh: "k", auth: "a" })),
    );
    const pushes = tracked(() => undefined);
    mocks.send.mockImplementation((sub: unknown) => pushes.fn(sub));

    const totals = await sendRosterAlerts(client, ids, "changed");

    expect(totals).toEqual({ sent: 40, skipped: 0, failed: 0 });
    expect(mocks.settings).toHaveBeenCalledTimes(40);
    expect(mocks.send).toHaveBeenCalledTimes(40);
    for (const state of [settings.state, pushes.state]) {
      expect(state.most).toBeGreaterThan(1);
      expect(state.most).toBeLessThanOrEqual(ROSTER_ALERT_PARALLEL);
    }
    expect(mocks.send.mock.calls[0]?.[2]).toMatchObject({ timeout: 10_000 });
  });

  it("keeps sending to everyone else when some reads and pushes fail", async () => {
    mocks.settings.mockImplementation(async (_client: unknown, owner: string) => {
      if (owner === ids[3]) throw new Error("unavailable");
      return { alerts: { changes: true, requests: true } };
    });
    mocks.subscriptions.mockImplementation(async (_client: unknown, owners: string[]) =>
      owners.map((owner) => ({ owner_id: owner, endpoint: `https://push.example/${owner}`, p256dh: "k", auth: "a" })),
    );
    mocks.send.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith(ids[5]!)) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });

    const totals = await sendRosterAlerts(client, ids, "changed");

    expect(totals).toEqual({ sent: 38, skipped: 0, failed: 2 });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
