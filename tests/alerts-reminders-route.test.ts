import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: vi.fn(),
  rate: vi.fn(),
  owned: true,
  writes: [] as { op: string; table: string; value?: unknown; filters: [string, unknown][] }[],
  writeError: null as null | { message: string },
}));
vi.mock("server-only", () => ({}));
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

import { DELETE, POST } from "@/app/api/alerts/reminders/route";

const ME = "5e000000-0000-4000-8000-000000000001";
const PHONE = "https://fcm.googleapis.com/fcm/send/this-phone";

function from(table: string) {
  const write = { op: "select", table, value: undefined as unknown, filters: [] as [string, unknown][] };
  const q = {
    select() {
      return q;
    },
    upsert(value: unknown) {
      write.op = "upsert";
      write.value = value;
      return q;
    },
    delete() {
      write.op = "delete";
      return q;
    },
    eq(name: string, value: unknown) {
      write.filters.push([name, value]);
      return q;
    },
    limit() {
      return q;
    },
    maybeSingle() {
      return q;
    },
    then(resolve: (value: { error: unknown; data: unknown }) => void) {
      if (write.op !== "select") mocks.writes.push(write);
      if (table === "web_push_subscriptions") {
        const row = { id: "row-1", owner_id: ME, endpoint: PHONE, p256dh: "abcdefghij", auth: "abcdefghij" };
        resolve({ error: null, data: mocks.owned ? [row] : [] });
      } else resolve({ error: write.op === "upsert" ? mocks.writeError : null, data: null });
    },
  };
  return q;
}

function req(method: string, body: unknown) {
  return new Request("http://x/api/alerts/reminders", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned = true;
  mocks.writes = [];
  mocks.writeError = null;
  mocks.from.mockImplementation(from);
  mocks.auth.mockResolvedValue({ id: ME });
  mocks.rate.mockResolvedValue({ limited: false });
});

describe("Remind me, timed", () => {
  it("keeps only the due time, the id and the phone to buzz", async () => {
    const dueAt = inAnHour();
    expect(await (await POST(req("POST", { ref: "r1", dueAt, endpoint: PHONE }))).json()).toEqual({ queued: true });
    const upsert = mocks.writes.find((write) => write.op === "upsert");
    expect(upsert?.table).toBe("alert_reminder_times");
    expect(upsert?.value).toEqual({ owner_id: ME, ref: "r1", due_at: dueAt, endpoint: PHONE });
  });

  it("refuses the words, or an owner, in the body (owner decision 1)", async () => {
    const dueAt = inAnHour();
    expect((await POST(req("POST", { ref: "r1", dueAt, endpoint: PHONE, text: "Call ward" }))).status).toBe(400);
    expect((await POST(req("POST", { ref: "r1", dueAt, endpoint: PHONE, ownerId: "x" }))).status).toBe(400);
    expect(mocks.writes).toEqual([]);
  });

  it("queues nothing for a device this account does not own, or a time already past", async () => {
    mocks.owned = false;
    expect(await (await POST(req("POST", { ref: "r1", dueAt: inAnHour(), endpoint: PHONE }))).json()).toEqual({
      queued: false,
    });
    mocks.owned = true;
    const past = new Date(Date.now() - 1000).toISOString();
    expect(await (await POST(req("POST", { ref: "r1", dueAt: past, endpoint: PHONE }))).json()).toEqual({
      queued: false,
    });
    expect(mocks.writes).toEqual([]);
  });

  it("says plainly when the time could not be kept", async () => {
    mocks.writeError = { message: "down" };
    expect((await POST(req("POST", { ref: "r1", dueAt: inAnHour(), endpoint: PHONE }))).status).toBe(503);
  });

  it("forgets the time when the note is ticked off or removed, for this owner only", async () => {
    expect(await (await DELETE(req("DELETE", { ref: "r1" }))).json()).toEqual({ ok: true });
    expect(mocks.writes).toEqual([
      {
        op: "delete",
        table: "alert_reminder_times",
        value: undefined,
        filters: [
          ["owner_id", ME],
          ["ref", "r1"],
        ],
      },
    ]);
  });

  it("needs a signed-in account", async () => {
    const { AuthenticationError } = await import("@/lib/supabase/auth");
    mocks.auth.mockRejectedValue(new AuthenticationError());
    expect((await POST(req("POST", { ref: "r1", dueAt: inAnHour(), endpoint: PHONE }))).status).toBe(401);
  });
});
