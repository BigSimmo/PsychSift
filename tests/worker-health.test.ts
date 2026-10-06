import { describe, it, expect, beforeEach, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  probe: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("node:http", () => ({ createServer: mocks.createServer }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("../src/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("../src/lib/supabase/health", () => ({ probeSupabaseHealth: mocks.probe }));

import {
  createHealthCheckServer,
  computeOverallHealthStatus,
  recordClaimProcessed,
  getLastClaimProcessedAt,
  setLastClaimProcessedAtForTests,
  resetHealthStateForTests,
} from "../worker/health";

describe("worker health status computation", () => {
  beforeEach(() => {
    resetHealthStateForTests();
  });

  it("reports 'ok' when there are no errors and no claims have run yet", () => {
    const status = computeOverallHealthStatus(false, null);
    expect(status).toBe("ok");
  });

  it("reports 'ok' when there are no errors and the last claim was recent", () => {
    const now = Date.now();
    const recentClaim = new Date(now - 60 * 1000); // 1 minute ago
    const status = computeOverallHealthStatus(false, recentClaim, now);
    expect(status).toBe("ok");
  });

  it("reports 'degraded' when there are no errors but the last claim is stale (> 5 minutes)", () => {
    const now = Date.now();
    const staleClaim = new Date(now - 6 * 60 * 1000); // 6 minutes ago
    const status = computeOverallHealthStatus(false, staleClaim, now);
    expect(status).toBe("degraded");
  });

  it("reports 'error' when hasErrors is true, even if no claims have run", () => {
    const status = computeOverallHealthStatus(true, null);
    expect(status).toBe("error");
  });

  it("reports 'error' when hasErrors is true, even if a recent claim processed", () => {
    const now = Date.now();
    const recentClaim = new Date(now - 30 * 1000); // 30 seconds ago
    const status = computeOverallHealthStatus(true, recentClaim, now);
    expect(status).toBe("error");
  });

  it("CRITICAL: reports 'error' (NOT 'degraded') when hasErrors is true and claims are stale", () => {
    // If Supabase or python_venv fails while claims are also stale,
    // the probe must return 'error' (503) so orchestration recognizes a dead worker.
    const now = Date.now();
    const staleClaim = new Date(now - 10 * 60 * 1000); // 10 minutes ago
    const status = computeOverallHealthStatus(true, staleClaim, now);
    expect(status).toBe("error");
  });

  it("tracks last claim timestamp via recordClaimProcessed", () => {
    expect(getLastClaimProcessedAt()).toBeNull();
    const before = new Date();
    recordClaimProcessed();
    const after = new Date();

    const recorded = getLastClaimProcessedAt();
    expect(recorded).not.toBeNull();
    expect(recorded!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(recorded!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("allows overriding and resetting test state", () => {
    const mockDate = new Date("2026-10-01T12:00:00Z");
    setLastClaimProcessedAtForTests(mockDate);
    expect(getLastClaimProcessedAt()).toEqual(mockDate);

    resetHealthStateForTests();
    expect(getLastClaimProcessedAt()).toBeNull();
  });
});

describe("worker health HTTP status mapping", () => {
  async function requestHealth() {
    let handler: (req: unknown, res: unknown) => Promise<void> = async () => {};
    mocks.createServer.mockImplementation((h) => {
      handler = h;
      return {};
    });
    createHealthCheckServer();
    const res = { writeHead: vi.fn(), end: vi.fn() };
    await handler({ method: "GET", url: "/health" }, res);
    return { code: res.writeHead.mock.calls[0][0] as number, body: JSON.parse(res.end.mock.calls[0][0]) };
  }

  beforeEach(() => {
    resetHealthStateForTests();
    mocks.probe.mockReset().mockResolvedValue({ ok: true, checkedAt: new Date().toISOString() });
    mocks.execFile.mockReset().mockImplementation((_bin, _args, _opts, cb) => cb(null));
  });

  it("returns 200 ok when dependencies are healthy", async () => {
    const { code, body } = await requestHealth();
    expect(code).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("returns 200 degraded when only the last claim is stale", async () => {
    setLastClaimProcessedAtForTests(new Date(Date.now() - 10 * 60 * 1000));
    const { code, body } = await requestHealth();
    expect(code).toBe(200);
    expect(body.status).toBe("degraded");
  });

  it("returns 503 error when Supabase fails, even with a stale claim", async () => {
    mocks.probe.mockRejectedValue(new Error("down"));
    setLastClaimProcessedAtForTests(new Date(Date.now() - 10 * 60 * 1000));
    const { code, body } = await requestHealth();
    expect(code).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.supabase.status).toBe("error");
  });

  it.each(["unavailable", "query"])("returns 503 when the Supabase probe returns a %s failure", async (failureKind) => {
    mocks.probe.mockResolvedValue({
      ok: false,
      checkedAt: new Date().toISOString(),
      failureKind,
      message: "Supabase is temporarily unavailable: private provider detail",
      rawMessage: "private provider detail",
    });
    setLastClaimProcessedAtForTests(new Date(Date.now() - 10 * 60 * 1000));

    const { code, body } = await requestHealth();

    expect(code).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.supabase.status).toBe("error");
    expect(JSON.stringify(body)).not.toContain("private provider detail");
  });

  it("returns 503 error when the Python venv is unavailable", async () => {
    mocks.execFile.mockImplementation((_bin, _args, _opts, cb) => cb(new Error("ENOENT")));
    const { code, body } = await requestHealth();
    expect(code).toBe(503);
    expect(body.checks.python_venv.status).toBe("error");
  });
});
