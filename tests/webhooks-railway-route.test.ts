import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "railway-webhook-secret-value-123";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

async function loadRoute(envOverrides: Record<string, unknown>) {
  const postChatNotification = vi.fn(async () => ({
    delivered: true,
    slack: { configured: true, ok: true, status: 200 },
    discord: { configured: false, ok: false },
  }));
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  vi.doMock("@/lib/env", () => ({ env: envOverrides }));
  vi.doMock("@/lib/webhooks/chat-notify", () => ({ postChatNotification }));
  vi.doMock("@/lib/logger", () => ({ logger }));
  const route = await import("../src/app/api/webhooks/railway/route");
  return { route, postChatNotification, logger };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/webhooks/railway", () => {
  it("returns 503 when the receiver secret is unset", async () => {
    const { route } = await loadRoute({});
    const response = await route.POST(post("http://localhost/api/webhooks/railway", { status: "SUCCESS" }));
    expect(response.status).toBe(503);
  });

  it("returns 401 on a bad token header", async () => {
    const { route } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });
    const response = await route.POST(
      post("http://localhost/api/webhooks/railway", { status: "SUCCESS" }, { "x-webhook-secret": "wrong" }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects query token authentication when header authentication is enforced", async () => {
    const { route } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });
    const response = await route.POST(
      post(`http://localhost/api/webhooks/railway?token=${SECRET}`, { status: "SUCCESS" }),
    );
    expect(response.status).toBe(401);
  });

  it("skips transient statuses without notifying", async () => {
    const { route, postChatNotification } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });
    const response = await route.POST(
      post("http://localhost/api/webhooks/railway", { status: "BUILDING" }, { "x-webhook-secret": SECRET }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.skipped).toBe(true);
    expect(postChatNotification).not.toHaveBeenCalled();
  });

  it("forwards a notable deploy status to chat", async () => {
    const { route, postChatNotification } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });
    const response = await route.POST(
      post(
        "http://localhost/api/webhooks/railway",
        {
          type: "DEPLOY",
          status: "FAILED",
          project: { name: "Database" },
          environment: { name: "production" },
          service: { name: "worker" },
        },
        { "x-webhook-secret": SECRET },
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.forwarded).toBe(true);
    expect(postChatNotification).toHaveBeenCalledTimes(1);
    const notification = (postChatNotification.mock.calls[0] as unknown as [{ severity: string; title: string }])[0];
    expect(notification.severity).toBe("error");
    expect(notification.title).toContain("worker");
  });
});

/**
 * A rejected delivery must say so.
 *
 * On 2026-09-13 this endpoint answered 401 to eighteen consecutive Railway deliveries — three
 * retries each across six deploy events, including both failed production deploys — and recorded
 * nothing. The deploy alert was never dropped for want of a Slack URL, which is where the
 * investigation first looked; it was refused at authentication, because the header on the
 * Railway-side webhook no longer matched RAILWAY_WEBHOOK_SECRET on the service. The only trace
 * was a row in Railway's HTTP proxy log, which is not a place anyone watches.
 *
 * `warn` is deliberate and load-bearing in both directions: the logger forwards warn to Sentry so
 * a genuine misconfiguration is still visible, while a publicly reachable endpoint cannot be used
 * by a passing scanner to raise error-level noise.
 */
describe("a delivery this receiver turns away", () => {
  it("records a mismatched token, and says one was presented", async () => {
    const { route, logger } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });

    const response = await route.POST(
      post("http://localhost/api/webhooks/railway", { status: "FAILED" }, { "x-webhook-secret": "wrong" }),
    );

    expect(response.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, context] = logger.warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("rejected");
    expect(context).toMatchObject({ tokenPresented: true });
    // The secret must never reach the log line that reports it.
    expect(JSON.stringify({ message, context })).not.toContain("wrong");
  });

  it("distinguishes a bare probe, which presented nothing at all", async () => {
    const { route, logger } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });

    const response = await route.POST(post("http://localhost/api/webhooks/railway", { status: "FAILED" }));

    expect(response.status).toBe(401);
    expect(logger.warn.mock.calls[0]?.[1]).toMatchObject({ tokenPresented: false });
  });

  it("reports an unset receiver secret at error level, since only the operator can cause it", async () => {
    const { route, logger } = await loadRoute({});

    const response = await route.POST(post("http://localhost/api/webhooks/railway", { status: "FAILED" }));

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("stays quiet on an accepted delivery", async () => {
    const { route, logger } = await loadRoute({ RAILWAY_WEBHOOK_SECRET: SECRET });

    await route.POST(
      post("http://localhost/api/webhooks/railway", { status: "FAILED" }, { "x-webhook-secret": SECRET }),
    );

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
