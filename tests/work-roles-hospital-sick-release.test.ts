import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  auth: vi.fn(),
  roles: vi.fn(),
  read: vi.fn(),
  rate: vi.fn(),
  demo: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireAuthenticatedUser: mocks.auth,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/lib/api-rate-limit", () => ({
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({ error: "Limited" }, { status: 429 }),
}));
vi.mock("@/lib/work-roles/server", () => ({ loadWorkRoleContext: mocks.roles }));
vi.mock("@/lib/work-roles/hospital-sick", () => ({ readHospitalSickCalls: mocks.read }));

import { GET } from "@/app/api/work/hospital/sick/route";
import { PublicApiError } from "@/lib/http";
import { AuthenticationError } from "@/lib/supabase/auth";

const hospitalId = "11111111-1111-4111-8111-111111111111";
const user = { id: "synthetic-workforce", appMetadata: {} };
const context = { userId: user.id, ready: true, grants: [{ role: "workforce", hospitalId, serviceIds: ["team"] }] };
const client = { synthetic: true };
const request = () => new Request(`https://example.invalid/api/work/hospital/sick?hospitalId=${hospitalId}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "");
  mocks.demo.mockReturnValue(false);
  mocks.admin.mockReturnValue(client);
  mocks.auth.mockResolvedValue(user);
  mocks.roles.mockResolvedValue(context);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.read.mockResolvedValue({
    hospital: { id: hospitalId, name: "Synthetic Hospital" },
    teams: [],
    calls: [{ id: "synthetic-report", name: "Dr Synthetic Private Staff", status: "needs-cover" }],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("hospital sick real-staff release boundary", () => {
  it.each(["", "false", "TRUE"])("holds production without reading named staff data (flag %j)", async (flag) => {
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", flag);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Dr Synthetic Private Staff");
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.roles).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("preserves authentication, current role loading and requested hospital when explicitly enabled", async () => {
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), client);
    expect(mocks.roles).toHaveBeenCalledWith(client, user);
    expect(mocks.read).toHaveBeenCalledWith(client, context, hospitalId);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("still denies an unauthenticated enabled request", async () => {
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
    mocks.auth.mockRejectedValue(new AuthenticationError());
    expect((await GET(request())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("preserves the reader's hospital-role denial after enablement", async () => {
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
    mocks.read.mockRejectedValue(new PublicApiError("Role required", 403, { code: "work_role_required" }));
    expect((await GET(request())).status).toBe(403);
  });

  it("still rate limits an enabled request before loading staff roles or reports", async () => {
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
    mocks.rate.mockResolvedValue({ limited: true });
    expect((await GET(request())).status).toBe(429);
    expect(mocks.roles).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("never reads real staff in demo mode even with the release flag", async () => {
    vi.stubEnv("ROSTER_TEAM_RELEASE_ENABLED", "true");
    mocks.demo.mockReturnValue(true);
    expect((await GET(request())).status).toBe(503);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
