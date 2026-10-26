import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rosterGet: vi.fn(), logError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/roster/shifts/route", () => ({ GET: mocks.rosterGet, POST: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));

import { GET } from "@/app/api/on-call/shifts/route";

const request = () => new Request("https://psychiatry.tools/api/on-call/shifts");

describe("GET /api/on-call/shifts fails closed", () => {
  beforeEach(() => {
    mocks.rosterGet.mockReset();
    mocks.logError.mockReset();
  });

  it("returns a generic 502 when the roster body cannot be parsed", async () => {
    mocks.rosterGet.mockResolvedValue(new Response("<html>upstream secret detail</html>", { status: 200 }));
    const response = await GET(request());
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("upstream");
    expect(JSON.parse(text)).toMatchObject({
      error: "Shifts are temporarily unavailable.",
      code: "roster_unavailable",
    });
    expect(mocks.logError).toHaveBeenCalledTimes(1);
  });

  it("still hides the sample roster", async () => {
    mocks.rosterGet.mockResolvedValue(Response.json({ sample: true, shifts: [{ id: "x" }] }));
    const response = await GET(request());
    expect(await response.json()).toEqual({ shifts: [], latestImport: null });
  });

  it("passes a real roster through unchanged", async () => {
    mocks.rosterGet.mockResolvedValue(Response.json({ shifts: [{ id: "a" }], latestImport: null }));
    const response = await GET(request());
    expect(await response.json()).toEqual({ shifts: [{ id: "a" }], latestImport: null });
  });
});
