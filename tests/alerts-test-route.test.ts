import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: vi.fn(),
  rate: vi.fn(),
  send: vi.fn(),
  vapid: vi.fn(),
  rows: [] as { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, setVapidDetails: mocks.vapid } }));
vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  env: {
    WEB_PUSH_PUBLIC_KEY: "public-key",
    WEB_PUSH_PRIVATE_KEY: "private-key",
    WEB_PUSH_SUBJECT: "mailto:operator@example.org",
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { POST } from "@/app/api/alerts/test/route";

const ME = "5e000000-0000-4000-8000-000000000001";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/this-phone";
const queries: { op: string; filters: [string, unknown][] }[] = [];

function from() {
  const q = {
    op: "read",
    filters: [] as [string, unknown][],
    select() {
      this.op = "select";
      return this;
    },
    delete() {
      this.op = "delete";
      return this;
    },
    eq(name: string, value: unknown) {
      this.filters.push([name, value]);
      return this;
    },
    limit() {
      return this;
    },
    then(resolve: (value: { error: null; data: unknown[] }) => void) {
      const owner = this.filters.find(([name]) => name === "owner_id")?.[1];
      const endpoint = this.filters.find(([name]) => name === "endpoint")?.[1];
      resolve({
        error: null,
        data:
          this.op === "select" ? mocks.rows.filter((row) => row.owner_id === owner && row.endpoint === endpoint) : [],
      });
    },
  };
  queries.push(q);
  return q;
}

function req(body: unknown) {
  return new Request("http://x/api/alerts/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  mocks.rows = [{ id: "row-1", owner_id: ME, endpoint: ENDPOINT, p256dh: "abcdefghij", auth: "abcdefghij" }];
  mocks.from.mockImplementation(from);
  mocks.auth.mockResolvedValue({ id: ME });
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.send.mockResolvedValue({});
});

describe("Send test alert", () => {
  it("sends one type-only test push to the device that asked", async () => {
    const response = await POST(req({ endpoint: ENDPOINT }));
    expect(await response.json()).toEqual({ sent: 1 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [target, payload] = mocks.send.mock.calls[0]!;
    expect(target).toMatchObject({ endpoint: ENDPOINT });
    // The lock-screen words live in the service worker; the payload is the code only.
    expect(JSON.parse(payload as string)).toEqual({ t: "test" });
  });

  it("never sends to a device this account does not own", async () => {
    mocks.rows = [{ ...mocks.rows[0]!, owner_id: "someone-else" }];
    expect(await (await POST(req({ endpoint: ENDPOINT }))).json()).toEqual({ sent: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("refuses an unsafe endpoint or an owner in the body", async () => {
    expect((await POST(req({ endpoint: "https://example.org/collect" }))).status).toBe(400);
    expect((await POST(req({ endpoint: ENDPOINT, ownerId: "x" }))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("drops a subscription the push service says is gone, and reports nothing sent", async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    expect(await (await POST(req({ endpoint: ENDPOINT }))).json()).toEqual({ sent: 0 });
    expect(queries.some((query) => query.op === "delete")).toBe(true);
  });

  it("needs a signed-in account", async () => {
    const { AuthenticationError } = await import("@/lib/supabase/auth");
    mocks.auth.mockRejectedValue(new AuthenticationError());
    expect((await POST(req({ endpoint: ENDPOINT }))).status).toBe(401);
  });
});
