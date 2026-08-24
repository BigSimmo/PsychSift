import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadRoute(role: "anonymous" | "authenticated" | "administrator") {
  const rpc = vi.fn(async () => ({ data: { candidateReleaseId: "release-1" }, error: null }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
  vi.doMock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc }) }));
  vi.doMock("@/lib/supabase/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/lib/supabase/auth")>();
    return {
      ...actual,
      requireAuthenticatedUser: async () => {
        if (role !== "administrator") throw new actual.AuthenticationError();
        return { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", appMetadata: { administrator: true } };
      },
    };
  });
  const route = await import("../src/app/api/admin/site-content/publish/route");
  return { route, rpc };
}

describe("administrator site-content publication route", () => {
  it.each(["anonymous", "authenticated"] as const)("rejects the %s role before mutation", async (role) => {
    const { route, rpc } = await loadRoute(role);
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ logicalId: "medication:alpha" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the single administrator-authenticated RPC without a spoofable authority flag", async () => {
    const { route, rpc } = await loadRoute("administrator");
    const record = { logicalId: "medication:alpha", candidateReleaseId: "release-1" };
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify(record),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("publish_site_content_record", { p_record: record });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("administrator_authorized");
  });

  it("begins a digest-bound candidate through the same administrator mutation authority", async () => {
    const { route, rpc } = await loadRoute("administrator");
    const plan = { candidateReleaseId: "release-1", planDigest: "sha256:synthetic" };
    const response = await route.POST(
      new Request("http://local/api/admin/site-content/publish", {
        method: "POST",
        body: JSON.stringify({ action: "begin", plan }),
      }),
    );
    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("begin_site_content_candidate_release", { p_plan: plan });
  });
});
