import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Route-layer behaviour for the CPD export and routine routes: the auth wrapper, demo-mode
 * behaviour, the rate limit, the 404 mapping and the private, no-store headers. Their library
 * helpers are tested elsewhere; this pins the layer a refactor of the route itself could break.
 */
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const routineId = "11111111-1111-4111-8111-111111111111";

type RuntimeOptions = { demoMode?: boolean; signedIn?: boolean; limited?: boolean };

function mockRuntime({ demoMode = false, signedIn = true, limited = false }: RuntimeOptions = {}) {
  vi.resetModules();
  class AuthenticationError extends Error {}
  const repository = {
    fetchOwnerCmeYear: vi.fn(async () => null as unknown),
    fetchOwnerCmeEntries: vi.fn(async () => []),
    fetchOwnerCmeRoutines: vi.fn(async () => []),
    saveCmeRoutine: vi.fn(async () => ({ id: routineId })),
  };
  const consumeSubjectApiRateLimit = vi.fn(async () => ({ limited }));
  vi.doMock("@/lib/env", () => ({ env: {}, isDemoMode: () => demoMode }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError,
    requireAuthenticatedUser: vi.fn(async () => {
      if (!signedIn) throw new AuthenticationError("Authentication required.");
      return { id: ownerId };
    }),
    unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
  }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    allowRateLimitInMemoryFallbackOnUnavailable: () => false,
    consumeSubjectApiRateLimit,
    rateLimitJsonResponse: () => Response.json({ error: "limited" }, { status: 429 }),
  }));
  vi.doMock("@/lib/cme/repository", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    ...repository,
  }));
  return { repository, consumeSubjectApiRateLimit };
}

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("GET /api/cme/export", () => {
  const exportRequest = (year: number | string) => new Request(`http://local.test/api/cme/export?year=${year}`);

  it("serves the demo year as a private, no-store CSV attachment", async () => {
    mockRuntime({ demoMode: true });
    const { DEMO_CME_YEAR } = await import("@/lib/cme/demo-year");
    const { GET } = await import("../src/app/api/cme/export/route");

    const response = await GET(exportRequest(DEMO_CME_YEAR.year));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="cme-${DEMO_CME_YEAR.year}-demo.csv"`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 404 for any other year in demo mode", async () => {
    mockRuntime({ demoMode: true });
    const { DEMO_CME_YEAR } = await import("@/lib/cme/demo-year");
    const { GET } = await import("../src/app/api/cme/export/route");

    const response = await GET(exportRequest(DEMO_CME_YEAR.year - 1));

    expect(response.status).toBe(404);
  });

  it("refuses a signed-out request with 401 before the rate limit or any read", async () => {
    const { repository, consumeSubjectApiRateLimit } = mockRuntime({ signedIn: false });
    const { GET } = await import("../src/app/api/cme/export/route");

    const response = await GET(exportRequest(2026));

    expect(response.status).toBe(401);
    expect(consumeSubjectApiRateLimit).not.toHaveBeenCalled();
    expect(repository.fetchOwnerCmeYear).not.toHaveBeenCalled();
  });

  it("answers 429 when the owner's CPD bucket is exhausted", async () => {
    const { repository, consumeSubjectApiRateLimit } = mockRuntime({ limited: true });
    const { GET } = await import("../src/app/api/cme/export/route");

    const response = await GET(exportRequest(2026));

    expect(response.status).toBe(429);
    expect(consumeSubjectApiRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "cme", subject: { kind: "owner", ownerId } }),
    );
    expect(repository.fetchOwnerCmeYear).not.toHaveBeenCalled();
  });

  it("answers 404 for a year the owner has not set up", async () => {
    mockRuntime();
    const { GET } = await import("../src/app/api/cme/export/route");

    const response = await GET(exportRequest(2026));

    expect(response.status).toBe(404);
  });

  it("rejects a year outside the accepted range", async () => {
    mockRuntime();
    const { GET } = await import("../src/app/api/cme/export/route");

    const response = await GET(exportRequest(1999));

    expect(response.status).toBe(400);
  });
});

describe("/api/cme/routines", () => {
  it("serves the demo routines on GET in demo mode without touching auth", async () => {
    const { consumeSubjectApiRateLimit } = mockRuntime({ demoMode: true });
    const { GET } = await import("../src/app/api/cme/routines/route");

    const response = await GET(new Request("http://local.test/api/cme/routines"));

    expect(response.status).toBe(200);
    expect(((await response.json()) as { demoMode?: boolean }).demoMode).toBe(true);
    expect(consumeSubjectApiRateLimit).not.toHaveBeenCalled();
  });

  it("returns the owner's routines privately with no-store on GET", async () => {
    const { repository } = mockRuntime();
    const { GET } = await import("../src/app/api/cme/routines/route");

    const response = await GET(new Request("http://local.test/api/cme/routines"));

    expect(response.status).toBe(200);
    expectPrivateNoStore(response);
    expect(repository.fetchOwnerCmeRoutines).toHaveBeenCalledWith(expect.anything(), ownerId);
  });

  it("refuses a signed-out GET with 401 and a rate-limited GET with 429", async () => {
    mockRuntime({ signedIn: false });
    const signedOut = await (
      await import("../src/app/api/cme/routines/route")
    ).GET(new Request("http://local.test/api/cme/routines"));
    expect(signedOut.status).toBe(401);

    mockRuntime({ limited: true });
    const limited = await (
      await import("../src/app/api/cme/routines/route")
    ).GET(new Request("http://local.test/api/cme/routines"));
    expect(limited.status).toBe(429);
  });

  it("refuses POST and PATCH writes in demo mode rather than faking them", async () => {
    const { repository } = mockRuntime({ demoMode: true });
    const { POST } = await import("../src/app/api/cme/routines/route");
    const { PATCH } = await import("../src/app/api/cme/routines/[id]/route");

    const created = await POST(new Request("http://local.test/api/cme/routines", { method: "POST", body: "{}" }));
    const updated = await PATCH(
      new Request(`http://local.test/api/cme/routines/${routineId}`, { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ id: routineId }) },
    );

    for (const response of [created, updated]) {
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code?: string }).code).toBe("demo_mode_unavailable");
    }
    expect(repository.saveCmeRoutine).not.toHaveBeenCalled();
  });

  it("refuses a signed-out PATCH with 401 and a malformed routine id with 400", async () => {
    const { repository } = mockRuntime({ signedIn: false });
    const { PATCH } = await import("../src/app/api/cme/routines/[id]/route");
    const signedOut = await PATCH(
      new Request(`http://local.test/api/cme/routines/${routineId}`, { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ id: routineId }) },
    );
    expect(signedOut.status).toBe(401);

    mockRuntime();
    const { PATCH: patchSignedIn } = await import("../src/app/api/cme/routines/[id]/route");
    const malformed = await patchSignedIn(
      new Request("http://local.test/api/cme/routines/not-a-uuid", { method: "PATCH", body: "{}" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(malformed.status).toBe(400);
    expect(repository.saveCmeRoutine).not.toHaveBeenCalled();
  });
});
