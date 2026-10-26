import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError } from "@/lib/supabase/auth";

const { mockRequireAuthenticatedUser, mockRpc, mockFrom, notLimitedRow } = vi.hoisted(() => {
  const notLimitedRow = () => ({
    data: [
      {
        limited: false,
        limit_value: 60,
        remaining: 59,
        retry_after_seconds: 60,
        reset_at: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
    error: null,
  });
  return {
    mockRequireAuthenticatedUser: vi.fn(),
    mockRpc: vi.fn(async () => notLimitedRow()),
    mockFrom: vi.fn(),
    notLimitedRow,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  // The shared database-backed rate limiter calls rpc(); the stored-links table is from().
  createAdminClient: vi.fn(() => ({ rpc: mockRpc, from: mockFrom })),
}));

vi.mock("@/lib/supabase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/auth")>();
  return {
    ...actual,
    requireAuthenticatedUser: mockRequireAuthenticatedUser,
  };
});

import { GET, POST, PUT } from "@/app/api/teaching/assessments/respond/[token]/route";
import {
  createEpaMagicLinkRequest,
  getEpaMagicLinkByToken,
  hashEpaMagicToken,
  submitEpaMagicLinkResponse,
} from "@/lib/teaching/assessments/magic-link";

describe("External supervisor EPA magic-link (#MAAXAX)", () => {
  beforeEach(() => {
    mockRequireAuthenticatedUser.mockReset();
    mockRequireAuthenticatedUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      email: "trainee@health.wa.gov.au",
    });
  });

  it("generates a high-entropy token, hashes it with SHA-256 at rest, and resolves valid lookups", async () => {
    // The GET route checks expiry against the real clock, so the link must be created on it too;
    // a fixed date here expires the link 14 days later and turns this case red from then on.
    const now = new Date();
    const created = createEpaMagicLinkRequest({
      epaCode: "EPA 1",
      traineeName: "Dr Alex Example",
      supervisorName: "Dr Jordan Consultant",
      supervisorRole: "specialist",
      clinicalSetting: "Emergency Psychiatry",
      now,
    });

    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(created.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(hashEpaMagicToken(created.token)).toBe(created.tokenHash);
    expect(created.urlPath).toBe(`/teaching/assessments/respond/${created.token}`);
    expect(JSON.stringify(created.request)).not.toContain(created.token);

    const lookup = getEpaMagicLinkByToken(created.token, now);
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.request.epaCode).toBe("EPA 1");
      expect(lookup.request.traineeName).toBe("Dr Alex Example");
      expect(lookup.request.supervisorRole).toBe("Specialist");
    }

    const getRes = await GET(new Request(`https://psychiatry.tools${created.urlPath}`), {
      params: Promise.resolve({ token: created.token }),
    });
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { request: { epaCode: string; traineeName: string } };
    expect(getBody.request).toMatchObject({
      epaCode: "EPA 1",
      traineeName: "Dr Alex Example",
    });
  });

  it("rejects unknown and expired magic-link tokens", async () => {
    const unknownRes = await GET(new Request("https://psychiatry.tools/api/teaching/assessments/respond/unknown"), {
      params: Promise.resolve({ token: "unknown-token-value-1234567890" }),
    });
    expect(unknownRes.status).toBe(404);
    expect(await unknownRes.json()).toMatchObject({ code: "magic_link_not_found" });

    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    const created = createEpaMagicLinkRequest({
      epaCode: 2,
      traineeName: "Dr Alex Example",
      supervisorName: "Dr Taylor Registrar",
      now: createdAt,
    });

    const afterExpiry = new Date("2026-10-20T00:00:00.000Z");
    const lookup = getEpaMagicLinkByToken(created.token, afterExpiry);
    expect(lookup).toMatchObject({
      ok: false,
      status: "expired",
      code: "magic_link_expired",
    });

    const postExpired = submitEpaMagicLinkResponse(
      created.token,
      { level: "minimal", observed: "direct", strengths: "Structured handover." },
      afterExpiry,
    );
    expect(postExpired).toMatchObject({
      ok: false,
      status: "expired",
      code: "magic_link_expired",
    });
  });

  it("rejects patient-identifiable details in request fields and feedback, and enforces single-use consumption", async () => {
    expect(() =>
      createEpaMagicLinkRequest({
        epaCode: 1,
        traineeName: "Dr Alex Example",
        supervisorName: "Dr Jordan Consultant",
        clinicalSetting: "Patient DOB 12/04/1985 UMRN D4678677",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "magic_link_patient_details",
      }),
    );

    const clientToken = "browser_generated_token_1234567890abcd";
    const putRes = await PUT(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.10" },
        body: JSON.stringify({
          epaCode: 3,
          traineeName: "Dr Alex Example",
          supervisorName: "Sam Pharmacist",
          supervisorRole: "pharmacist",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(putRes.status).toBe(200);

    const patientDetailResponse = await POST(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({
          level: "proximal",
          observed: "direct",
          strengths: "Reviewed patient DOB 12/04/1985 UMNs 12345678 on Ward 4.",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(patientDetailResponse.status).toBe(400);
    expect(await patientDetailResponse.json()).toMatchObject({
      code: "patient_detail_detected",
    });

    // Valid single-use submission succeeds
    const validResponse = await POST(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({
          level: "minimal",
          complexity: "medium",
          observed: "team",
          strengths: "Clear chart check and safe lithium monitoring plan.",
          improvements: "Document baseline renal function target timing.",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(validResponse.status).toBe(200);
    const validBody = (await validResponse.json()) as {
      ok: boolean;
      request: { status: string; submission: { level: string; complexity: string } };
    };
    expect(validBody.ok).toBe(true);
    expect(validBody.request.status).toBe("completed");
    expect(validBody.request.submission).toMatchObject({
      level: "minimal",
      complexity: "medium",
    });

    // Second submission with the same token is rejected (single-use consumption)
    const replayResponse = await POST(
      new Request(`https://psychiatry.tools/api/teaching/assessments/respond/${clientToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.11" },
        body: JSON.stringify({
          level: "direct",
          observed: "direct",
          strengths: "Replay attempt.",
        }),
      }),
      { params: Promise.resolve({ token: clientToken }) },
    );
    expect(replayResponse.status).toBe(409);
    expect(await replayResponse.json()).toMatchObject({
      code: "magic_link_already_used",
    });
  });

  it("allows supervisor and assessor names with titles such as 'Dr J. Smith' and 'Ms Taylor'", async () => {
    const createdDr = createEpaMagicLinkRequest({
      epaCode: 1,
      traineeName: "Dr Alex Example",
      supervisorName: "Dr J. Smith",
      supervisorRole: "specialist",
    });
    const submitDr = submitEpaMagicLinkResponse(createdDr.token, {
      level: "minimal",
      observed: "direct",
      assessorName: "Dr J. Smith",
      strengths: "Safe handover and clear plan.",
    });
    expect(submitDr.ok).toBe(true);
    if (submitDr.ok) {
      expect(submitDr.request.submission?.assessorName).toBe("Dr J. Smith");
    }

    const createdMs = createEpaMagicLinkRequest({
      epaCode: 2,
      traineeName: "Dr Alex Example",
      supervisorName: "Ms Taylor",
      supervisorRole: "nurse",
    });
    const submitMs = submitEpaMagicLinkResponse(createdMs.token, {
      level: "proximal",
      observed: "direct",
      assessorName: "Ms Taylor",
      strengths: "Calm de-escalation.",
    });
    expect(submitMs.ok).toBe(true);
    if (submitMs.ok) {
      expect(submitMs.request.submission?.assessorName).toBe("Ms Taylor");
    }
  });

  it("requires authentication on PUT and, in production, answers 503 while the durable table is unavailable", async () => {
    mockRequireAuthenticatedUser.mockRejectedValueOnce(new AuthenticationError());
    const unauthPut = await PUT(
      new Request("https://psychiatry.tools/api/teaching/assessments/respond/unauth_token_1234567890abcd", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          epaCode: 1,
          traineeName: "Dr Alex Example",
          supervisorName: "Dr J. Smith",
        }),
      }),
      { params: Promise.resolve({ token: "unauth_token_1234567890abcd" }) },
    );
    expect(unauthPut.status).toBe(401);

    vi.stubEnv("NODE_ENV", "production");
    // Production reads public.teaching_epa_magic_links (#MAAXAX); before that migration is live the
    // lookup fails, and the supervisor sees "unavailable" rather than a server fault.
    const missingTable = { data: null, error: { code: "42P01" } };
    const failing: Record<string, unknown> = {};
    for (const step of ["select", "eq", "gt", "order", "limit"]) failing[step] = () => failing;
    failing.maybeSingle = () => Promise.resolve(missingTable);
    vi.mocked(createAdminClient).mockReturnValueOnce({ rpc: mockRpc, from: () => failing } as never);
    try {
      const prodGet = await GET(new Request("https://psychiatry.tools/api/teaching/assessments/respond/some_token"), {
        params: Promise.resolve({ token: "some_token_1234567890abcdef" }),
      });
      expect(prodGet.status).toBe(503);
      expect(await prodGet.json()).toMatchObject({ code: "assessment_store_unavailable" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the demo-mode supervisor link", () => {
  it("opens a made-up request and accepts an answer without storing it", async () => {
    const { EPA_MAGIC_LINK_DEMO_TOKEN } = await import("@/lib/teaching/assessments/magic-link");
    const url = `https://psychiatry.tools/api/teaching/assessments/respond/${EPA_MAGIC_LINK_DEMO_TOKEN}`;
    const params = { params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) };
    const opened = await GET(new Request(url), params);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ request: { traineeName: "Dr Trainee Example", status: "pending" } });
    const sent = await POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: "proximal", observed: "direct", strengths: "Clear formulation." }),
      }),
      { params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) },
    );
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ ok: true, request: { status: "completed" } });
    const again = await GET(new Request(url), { params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) });
    expect(await again.json()).toMatchObject({ request: { status: "pending" } });
  });

  it("refuses an answer that does not say how the supervisor knows, instead of assuming they saw it", async () => {
    const { EPA_MAGIC_LINK_DEMO_TOKEN } = await import("@/lib/teaching/assessments/magic-link");
    const url = `https://psychiatry.tools/api/teaching/assessments/respond/${EPA_MAGIC_LINK_DEMO_TOKEN}`;
    const post = (body: unknown) =>
      POST(
        new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) },
      );

    const undeclared = await post({ level: "proximal", strengths: "Clear formulation." });
    expect(undeclared.status).toBe(400);
    expect(await undeclared.json()).toMatchObject({ code: "invalid_submission" });

    const teamWithoutRole = await post({ level: "proximal", observed: "team" });
    expect(teamWithoutRole.status).toBe(400);
    expect(await teamWithoutRole.json()).toMatchObject({ code: "invalid_submission" });

    const team = await post({ level: "proximal", observed: "team", strengths: "Ward nurse reported calm handover." });
    expect(team.status).toBe(200);
    expect(await team.json()).toMatchObject({ request: { submission: { observed: "team" } } });
  });

  it("works in production too, without touching the stored links", async () => {
    const { EPA_MAGIC_LINK_DEMO_TOKEN } = await import("@/lib/teaching/assessments/magic-link");
    vi.stubEnv("NODE_ENV", "production");
    mockFrom.mockClear();
    try {
      const url = `https://psychiatry.tools/api/teaching/assessments/respond/${EPA_MAGIC_LINK_DEMO_TOKEN}`;
      const opened = await GET(new Request(url), { params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) });
      expect(opened.status).toBe(200);
      const sent = await POST(
        new Request(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: "proximal", observed: "direct" }),
        }),
        { params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) },
      );
      expect(sent.status).toBe(200);
      // Only the shared rate limiter runs; the stored-links table is never read or written.
      expect(mockFrom).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("magic-link public rate limit uses the shared database-backed limiter", () => {
  // Outside demo mode (production never runs demo mode) the routes use the shared limiter.
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockImplementation(async () => notLimitedRow());
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("consumes the durable limiter with 60 reads and 20 writes per minute per caller", async () => {
    const { EPA_MAGIC_LINK_DEMO_TOKEN } = await import("@/lib/teaching/assessments/magic-link");
    const url = `https://psychiatry.tools/api/teaching/assessments/respond/${EPA_MAGIC_LINK_DEMO_TOKEN}`;
    const params = () => ({ params: Promise.resolve({ token: EPA_MAGIC_LINK_DEMO_TOKEN }) });
    await GET(new Request(url, { headers: { "x-forwarded-for": "203.0.113.7" } }), params());
    await POST(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ level: "proximal", observed: "direct" }),
      }),
      params(),
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      "consume_api_subject_rate_limit",
      expect.objectContaining({ p_bucket: "teaching_magic_link_read", p_limit: 60, p_window_seconds: 60 }),
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      "consume_api_subject_rate_limit",
      expect.objectContaining({ p_bucket: "teaching_magic_link_write", p_limit: 20, p_window_seconds: 60 }),
    );
    const subjectKey = (mockRpc.mock.calls[0] as unknown[])[1] as { p_subject_key: string };
    expect(subjectKey.p_subject_key).toMatch(/^anon:[0-9a-f]{32}$/);
    expect(subjectKey.p_subject_key).not.toContain("203.0.113.7");
  });

  it("answers 429 with the same shape when the shared limiter says the caller is over the limit", async () => {
    mockRpc.mockImplementation(async () => ({
      data: [
        {
          limited: true,
          limit_value: 60,
          remaining: 0,
          retry_after_seconds: 42,
          reset_at: new Date(Date.now() + 42_000).toISOString(),
        },
      ],
      error: null,
    }));
    const response = await GET(
      new Request("https://psychiatry.tools/api/teaching/assessments/respond/rl_token_1234567890abcdef", {
        headers: { "x-forwarded-for": "198.51.100.9" },
      }),
      { params: Promise.resolve({ token: "rl_token_1234567890abcdef" }) },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toMatchObject({ code: "rate_limited" });
  });
});

it("gives a magic link a random ID that is not derived from its token hash", async () => {
  const { createEpaMagicLinkRequest } = await import("@/lib/teaching/assessments/magic-link");
  const created = createEpaMagicLinkRequest({
    epaCode: "EPA 1",
    traineeName: "Dr Alex Example",
    supervisorName: "Dr Jordan Consultant",
    now: new Date(),
  });
  expect(created.request.id).toMatch(/^epa-link-[0-9a-f-]{36}$/);
  expect(created.request.id).not.toContain(created.tokenHash.slice(0, 12));
});
