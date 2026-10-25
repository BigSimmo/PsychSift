import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The CPD entry routes re-run the entry form's patient-detail check on the server, so a caller that
 * skips the form cannot store a patient detail the form would refuse. Every name here is synthetic.
 */
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entryId = "11111111-1111-4111-8111-111111111111";

const cleanEntry = {
  date: "2026-09-22",
  title: "Grand round on lithium monitoring",
  allocations: [{ category: "educational", hours: 1 }],
  reflection: "Revisited renal monitoring intervals.",
  costCents: null,
  routineId: null,
  documentId: null,
  sourceUrl: null,
  buckets: [],
  formalPeerReviewHours: 0,
};
const patientReflection = "Saw John Smith, 45, after an overdose on ward 3.";

function mockRuntime() {
  vi.resetModules();
  const fetchOwnerCmeYear = vi.fn(async () => null);
  const insertCmeEntry = vi.fn();
  const saveCmeEntry = vi.fn();
  const amendClosedCmeEntry = vi.fn();
  const from = vi.fn(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: { transcribed_at: null, source_url: null }, error: null }),
    };
    return builder;
  });
  vi.doMock("@/lib/env", () => ({ env: {}, isDemoMode: () => false }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError: class AuthenticationError extends Error {},
    requireAuthenticatedUser: vi.fn(async () => ({ id: ownerId })),
    unauthorizedResponse: () => new Response("unauthorized", { status: 401 }),
  }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    allowRateLimitInMemoryFallbackOnUnavailable: () => false,
    consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
    rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
  }));
  vi.doMock("@/lib/cme/repository", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    fetchOwnerCmeYear,
    insertCmeEntry,
    saveCmeEntry,
    amendClosedCmeEntry,
    assertValidCmeLinkedIds: vi.fn(async () => undefined),
  }));
  return { fetchOwnerCmeYear, insertCmeEntry, saveCmeEntry, amendClosedCmeEntry };
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://local.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CPD entry patient-detail backstop", () => {
  it("refuses a new entry whose reflection holds a patient detail, before any read or write", async () => {
    const mocks = mockRuntime();
    const { POST } = await import("../src/app/api/cme/entries/route");

    const response = await POST(
      jsonRequest("POST", "/api/cme/entries", { ...cleanEntry, reflection: patientReflection }),
    );

    expect(response.status).toBe(422);
    const payload = (await response.json()) as { code?: string; message?: string };
    expect(payload.code).toBe("patient_detail");
    expect(payload.message).not.toContain("John");
    expect(mocks.fetchOwnerCmeYear).not.toHaveBeenCalled();
    expect(mocks.insertCmeEntry).not.toHaveBeenCalled();
  });

  it("refuses a new entry whose title holds a patient detail", async () => {
    const mocks = mockRuntime();
    const { POST } = await import("../src/app/api/cme/entries/route");

    const response = await POST(
      jsonRequest("POST", "/api/cme/entries", { ...cleanEntry, title: "Case review: John Smith, 45" }),
    );

    expect(response.status).toBe(422);
    expect(mocks.insertCmeEntry).not.toHaveBeenCalled();
  });

  it("lets a clean entry through to the year check", async () => {
    const mocks = mockRuntime();
    const { POST } = await import("../src/app/api/cme/entries/route");

    const response = await POST(jsonRequest("POST", "/api/cme/entries", cleanEntry));

    // No confirmed year in this double, so the route stops at the year check, past the backstop.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code?: string }).code).toBe("cme_year_not_confirmed");
    expect(mocks.fetchOwnerCmeYear).toHaveBeenCalled();
  });

  it("refuses a full edit or a closed-year amendment that adds a patient detail", async () => {
    const mocks = mockRuntime();
    const { PATCH } = await import("../src/app/api/cme/entries/[id]/route");
    const context = { params: Promise.resolve({ id: entryId }) };

    const edit = await PATCH(
      jsonRequest("PATCH", `/api/cme/entries/${entryId}`, { ...cleanEntry, reflection: patientReflection }),
      context,
    );
    const amendment = await PATCH(
      jsonRequest("PATCH", `/api/cme/entries/${entryId}`, {
        ...cleanEntry,
        reflection: patientReflection,
        amendmentReason: "Corrected the hours",
      }),
      { params: Promise.resolve({ id: entryId }) },
    );

    expect(edit.status).toBe(422);
    expect(amendment.status).toBe(422);
    expect(mocks.saveCmeEntry).not.toHaveBeenCalled();
    expect(mocks.amendClosedCmeEntry).not.toHaveBeenCalled();
  });
});
