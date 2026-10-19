import { afterEach, describe, expect, it, vi } from "vitest";

const interactionId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("answer feedback route", () => {
  async function loadRouteForValidation(insert = vi.fn(async () => ({ error: null }))) {
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => ({ insert })) }),
    }));
    vi.doMock("@/lib/public-api-access", () => ({
      publicAccessContext: vi.fn(async () => ({
        authenticated: false,
        ownerId: undefined,
        rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
      })),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      allowRateLimitInMemoryFallbackOnUnavailable: () => true,
      consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/answer-feedback-token", () => ({ verifyAnswerFeedbackToken: vi.fn(() => true) }));
    const { POST } = await import("../src/app/api/answer-feedback/route");
    return { POST, insert };
  }

  it.each([
    "wrong_mode",
    "missed_source",
    "unsupported_conclusion",
    "important_information_missing",
    "source_conflict",
    "outdated_source",
    "presentation_problem",
  ])("accepts structured Clinical Ask feedback reason %s", async (feedbackCategory) => {
    const { POST, insert } = await loadRouteForValidation();
    const response = await POST(
      new Request("http://localhost/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          feedbackCategory,
          answerHash: "d".repeat(64),
          feedbackToken: "signed-feedback-token",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ feedback_category: feedbackCategory }));
  });

  it.each(["question", "context", "answer", "extract", "comment"])(
    "rejects raw or free-text field %s before database access",
    async (field) => {
      const { POST, insert } = await loadRouteForValidation();
      const response = await POST(
        new Request("http://localhost/api/answer-feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            interactionId,
            feedbackCategory: "presentation_problem",
            answerHash: "e".repeat(64),
            feedbackToken: "signed-feedback-token",
            [field]: "synthetic raw content",
          }),
        }),
      );
      expect(response.status).toBe(400);
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("rejects unknown feedback reasons", async () => {
    const { POST, insert } = await loadRouteForValidation();
    const response = await POST(
      new Request("http://localhost/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          feedbackCategory: "other",
          answerHash: "f".repeat(64),
          feedbackToken: "signed-feedback-token",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("accepts privacy-minimised anonymous feedback", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => ({ insert })) }),
    }));
    vi.doMock("@/lib/public-api-access", () => ({
      publicAccessContext: vi.fn(async () => ({
        authenticated: false,
        ownerId: undefined,
        rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
      })),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      allowRateLimitInMemoryFallbackOnUnavailable: () => true,
      consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/answer-feedback-token", () => ({
      verifyAnswerFeedbackToken: vi.fn(() => true),
    }));

    const { POST } = await import("../src/app/api/answer-feedback/route");
    const response = await POST(
      new Request("http://localhost/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          feedbackCategory: "needs_correction",
          answerHash: "a".repeat(64),
          feedbackToken: "signed-feedback-token",
          sourceIds: [sourceId],
          citedSourceIds: [sourceId],
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        interaction_id: interactionId,
        owner_id: null,
        answer_hash: "a".repeat(64),
        feedback_category: "needs_correction",
      }),
    );
  });

  it("maps PostgreSQL unique violations to a duplicate-feedback response", async () => {
    const insert = vi.fn(async () => ({ error: { code: "23505", message: "localized constraint failure" } }));
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => ({ insert })) }),
    }));
    vi.doMock("@/lib/public-api-access", () => ({
      publicAccessContext: vi.fn(async () => ({
        authenticated: false,
        ownerId: undefined,
        rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
      })),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      allowRateLimitInMemoryFallbackOnUnavailable: () => true,
      consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/answer-feedback-token", () => ({
      verifyAnswerFeedbackToken: vi.fn(() => true),
    }));

    const { POST } = await import("../src/app/api/answer-feedback/route");
    const response = await POST(
      new Request("http://localhost/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          feedbackCategory: "verified",
          answerHash: "b".repeat(64),
          feedbackToken: "signed-feedback-token",
        }),
      }),
    );

    expect(response.status).toBe(409);
  });

  it("rejects fabricated interaction IDs before inserting feedback", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const verifyAnswerFeedbackToken = vi.fn(() => false);
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => ({ insert })) }),
    }));
    vi.doMock("@/lib/public-api-access", () => ({
      publicAccessContext: vi.fn(async () => ({
        authenticated: false,
        ownerId: undefined,
        rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
      })),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      allowRateLimitInMemoryFallbackOnUnavailable: () => true,
      consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/answer-feedback-token", () => ({ verifyAnswerFeedbackToken }));

    const { POST } = await import("../src/app/api/answer-feedback/route");
    const response = await POST(
      new Request("http://localhost/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          interactionId,
          feedbackCategory: "verified",
          answerHash: "c".repeat(64),
          feedbackToken: "fabricated-feedback-token",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_feedback_token" });
    expect(verifyAnswerFeedbackToken).toHaveBeenCalledWith({
      token: "fabricated-feedback-token",
      interactionId,
      answerHash: "c".repeat(64),
    });
    expect(insert).not.toHaveBeenCalled();
  });
});

// F-02: one row per interaction. A problem report may replace an earlier "supported"
// ('verified') verdict; a 'verified' tap never replaces a problem report.
describe("answer feedback route: a problem report supersedes a supported verdict", () => {
  type FeedbackRow = Record<string, unknown>;

  /** In-memory stand-in for rag_answer_feedback: a unique interaction_id and a filtered update. */
  function fakeFeedbackTable() {
    const rows: FeedbackRow[] = [];
    const insert = vi.fn(async (row: FeedbackRow) => {
      if (rows.some((existing) => existing.interaction_id === row.interaction_id)) {
        return { error: { code: "23505", message: "duplicate key" } };
      }
      rows.push({ ...row, id: `row-${rows.length + 1}` });
      return { error: null };
    });
    const update = vi.fn((patch: FeedbackRow) => {
      const filters: Array<(row: FeedbackRow) => boolean> = [];
      const chain = {
        match(values: FeedbackRow) {
          for (const [key, value] of Object.entries(values)) filters.push((row) => row[key] === value);
          return chain;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return chain;
        },
        is(column: string, value: null) {
          filters.push((row) => (row[column] ?? null) === value);
          return chain;
        },
        async select(columns: string) {
          expect(columns).toBe("id");
          const matched = rows.filter((row) => filters.every((filter) => filter(row)));
          for (const row of matched) Object.assign(row, patch);
          return { data: matched.map((row) => ({ id: row.id })), error: null };
        },
      };
      return chain;
    });
    return { rows, insert, update };
  }

  async function loadRoute(ownerId?: string) {
    const table = fakeFeedbackTable();
    vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({ from: vi.fn(() => ({ insert: table.insert, update: table.update })) }),
    }));
    vi.doMock("@/lib/public-api-access", () => ({
      publicAccessContext: vi.fn(async () => ({
        authenticated: Boolean(ownerId),
        ownerId,
        rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
      })),
    }));
    vi.doMock("@/lib/api-rate-limit", () => ({
      allowRateLimitInMemoryFallbackOnUnavailable: () => true,
      consumeSubjectApiRateLimit: vi.fn(async () => ({ limited: false })),
      rateLimitJsonResponse: vi.fn(),
    }));
    vi.doMock("@/lib/answer-feedback-token", () => ({ verifyAnswerFeedbackToken: vi.fn(() => true) }));
    const { POST } = await import("../src/app/api/answer-feedback/route");
    const post = (feedbackCategory: string, extra: Record<string, unknown> = {}) =>
      POST(
        new Request("http://localhost/api/answer-feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            interactionId,
            feedbackCategory,
            answerHash: "9".repeat(64),
            feedbackToken: "signed-feedback-token",
            ...extra,
          }),
        }),
      );
    return { post, ...table };
  }

  it("records a problem reported after a supported tap on the same answer", async () => {
    const { post, rows, update } = await loadRoute();
    expect((await post("verified")).status).toBe(201);

    const response = await post("numeric_error", {
      note: "The cited table gives a different starting dose.",
      sourceIds: [sourceId],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      interaction_id: interactionId,
      owner_id: null,
      feedback_category: "numeric_error",
      note: "The cited table gives a different starting dose.",
      source_ids: [sourceId],
      record_type: "answer",
    });
  });

  it("keeps an earlier problem report when a supported tap follows it", async () => {
    const { post, rows, update } = await loadRoute();
    expect((await post("unsupported_answer", { note: "No cited source says this." })).status).toBe(201);

    const response = await post("verified");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "feedback_already_recorded" });
    expect(update).not.toHaveBeenCalled();
    expect(rows).toEqual([
      expect.objectContaining({ feedback_category: "unsupported_answer", note: "No cited source says this." }),
    ]);
  });

  it("does not let a second problem report replace the first one", async () => {
    const { post, rows } = await loadRoute();
    expect((await post("verified")).status).toBe(201);
    expect((await post("numeric_error")).status).toBe(200);

    const response = await post("presentation_problem");

    expect(response.status).toBe(409);
    expect(rows).toEqual([expect.objectContaining({ feedback_category: "numeric_error" })]);
  });

  it("keeps duplicate supported taps idempotent with a 409", async () => {
    const { post, rows, update } = await loadRoute();
    expect((await post("verified")).status).toBe(201);
    expect((await post("verified")).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(rows).toEqual([expect.objectContaining({ feedback_category: "verified" })]);
  });

  it("only replaces the signed-in reader's own supported verdict", async () => {
    const ownerId = "33333333-3333-4333-8333-333333333333";
    const { post, rows } = await loadRoute(ownerId);
    // A supported verdict for the same interaction held under a different owner.
    rows.push({
      id: "row-other",
      interaction_id: interactionId,
      owner_id: "44444444-4444-4444-8444-444444444444",
      answer_hash: "9".repeat(64),
      record_type: "answer",
      feedback_category: "verified",
    });

    const response = await post("numeric_error");

    expect(response.status).toBe(409);
    expect(rows).toEqual([expect.objectContaining({ id: "row-other", feedback_category: "verified" })]);
  });

  it("does not replace a supported verdict recorded for a different answer text", async () => {
    const { post, rows } = await loadRoute();
    expect((await post("verified")).status).toBe(201);

    const response = await post("numeric_error", { answerHash: "8".repeat(64) });

    expect(response.status).toBe(409);
    expect(rows).toEqual([expect.objectContaining({ feedback_category: "verified", answer_hash: "9".repeat(64) })]);
  });
});
