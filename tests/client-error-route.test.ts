import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureEvent = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureEvent }));

import { POST } from "@/app/api/client-error/route";
import { resetClientErrorRateLimitForTests } from "@/lib/observability/client-error-intake";
import { privacySafeErrorEvent } from "@/lib/observability/error-tracking";

const validReport = {
  type: "TypeError",
  mechanism: "onerror",
  section: "/my-day",
  frames: [{ filename: "/_next/static/chunks/a.js", function: "renderCard", lineno: 1, colno: 2 }],
};

function post(body: unknown, ip = "203.0.113.1") {
  return POST(
    new Request("https://psychiatry.tools/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("/api/client-error", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.us.sentry.io/1");
    resetClientErrorRateLimitForTests();
    captureEvent.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("forwards a valid report as a browser event that the scrubber keeps safe", async () => {
    const response = await post(validReport);
    expect(response.status).toBe(204);
    expect(captureEvent).toHaveBeenCalledTimes(1);
    const event = captureEvent.mock.calls[0]?.[0];
    expect(event.tags).toEqual({ service: "browser", route_path: "/my-day" });
    const scrubbed = privacySafeErrorEvent(event);
    expect(scrubbed.exception?.values?.[0]?.value).toBe("Unhandled browser error");
    expect(scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe("/_next/static/chunks/a.js");
  });

  it("keeps distinct minified faults in one section apart after scrubbing", async () => {
    await post({
      ...validReport,
      frames: [{ filename: "/_next/static/chunks/12345.js", function: "a", lineno: 3, colno: 10 }],
    });
    await post({
      ...validReport,
      frames: [{ filename: "/_next/static/chunks/67890.js", function: "b", lineno: 100, colno: 10 }],
    });
    const [first, second] = captureEvent.mock.calls.map(([event]) => privacySafeErrorEvent(event).fingerprint);
    expect(first?.[0]).toBe("browser");
    expect(first).not.toEqual(second);
  });

  it("rejects extra fields and free text", async () => {
    expect((await post({ ...validReport, message: "Jane Doe" })).status).toBe(400);
    expect((await post({ ...validReport, type: "Jane Doe" })).status).toBe(400);
    expect((await post({ ...validReport, section: "/my-day?q=Jane" })).status).toBe(400);
    expect(
      (await post({ ...validReport, frames: [{ filename: "https://evil.example/a.js", lineno: 1 }] })).status,
    ).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("does nothing outside production or without a DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    expect((await post(validReport)).status).toBe(204);
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.us.sentry.io/1");
    vi.stubEnv("NODE_ENV", "development");
    expect((await post(validReport)).status).toBe(204);
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it("rate-limits one address to 10 a minute", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) statuses.push((await post(validReport)).status);
    expect(statuses.slice(0, 10).every((status) => status === 204)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await post(validReport, "203.0.113.2")).status).toBe(204);
  });
});
