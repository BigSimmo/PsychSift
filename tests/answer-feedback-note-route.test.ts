import { afterEach, describe, expect, it, vi } from "vitest";

import { rejectPatientDetailFeedbackNote } from "@/lib/clinical-question-patient-check-server";
import { PublicApiError } from "@/lib/http";

const interactionId = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

async function loadRoute(authenticated = false) {
  const insert = vi.fn(async () => ({ error: null }));
  const consumeSubjectApiRateLimit = vi.fn(async () => ({ limited: false }));
  vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({ from: vi.fn(() => ({ insert })) }),
  }));
  vi.doMock("@/lib/public-api-access", () => ({
    publicAccessContext: vi.fn(async () => ({
      authenticated,
      ownerId: authenticated ? "33333333-3333-4333-8333-333333333333" : undefined,
      rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
    })),
  }));
  vi.doMock("@/lib/api-rate-limit", () => ({
    allowRateLimitInMemoryFallbackOnUnavailable: () => true,
    consumeSubjectApiRateLimit,
    rateLimitJsonResponse: vi.fn(),
  }));
  vi.doMock("@/lib/answer-feedback-token", () => ({ verifyAnswerFeedbackToken: vi.fn(() => true) }));
  const { POST } = await import("../src/app/api/answer-feedback/route");
  const post = (body: Record<string, unknown>) =>
    POST(
      new Request("http://localhost/api/answer-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { post, insert, consumeSubjectApiRateLimit };
}

const answerBody = {
  interactionId,
  feedbackCategory: "numeric_error",
  answerHash: "d".repeat(64),
  feedbackToken: "signed-feedback-token",
};

describe("feedback note check", () => {
  it.each([
    "Wrong for Mr Smith, see MRN 1234567",
    "Call me on 0412 345 678 about this",
    "Sent from jane.citizen@example.com",
  ])("refuses an identifying note without echoing it: %s", (note) => {
    let caught: unknown;
    try {
      rejectPatientDetailFeedbackNote(note);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PublicApiError);
    const error = caught as PublicApiError;
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/^This note looks like it holds a patient detail/);
    expect(error.message).not.toContain("Smith");
    expect(error.message).not.toContain("1234567");
    expect(error.message).not.toContain("example.com");
  });

  it.each([null, undefined, "", "The lithium starting dose is wrong; the cited table says 250 mg."])(
    "lets an ordinary or absent note through: %s",
    (note) => {
      expect(() => rejectPatientDetailFeedbackNote(note)).not.toThrow();
    },
  );
});

describe("answer feedback route: optional note", () => {
  it("saves a trimmed ordinary note with the answer report", async () => {
    const { post, insert } = await loadRoute();
    const response = await post({ ...answerBody, note: "  The renal dose line is wrong.  " });
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ note: "The renal dose line is wrong.", record_type: "answer" }),
    );
  });

  it("stores null when no note or only whitespace is sent", async () => {
    const { post, insert } = await loadRoute();
    expect((await post({ ...answerBody, note: "   " })).status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
  });

  it("rate limits, then refuses an identifying note before saving, without echoing it", async () => {
    const { post, insert, consumeSubjectApiRateLimit } = await loadRoute();
    const response = await post({ ...answerBody, note: "Mr Smith MRN 1234567 got the wrong dose" });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; code: string };
    expect(payload.code).toBe("patient_detail_in_feedback_note");
    expect(JSON.stringify(payload)).not.toContain("Smith");
    expect(JSON.stringify(payload)).not.toContain("1234567");
    expect(insert).not.toHaveBeenCalled();
    expect(consumeSubjectApiRateLimit).toHaveBeenCalledTimes(1);
  });

  it("refuses a note over 500 characters", async () => {
    const { post, insert } = await loadRoute();
    const response = await post({ ...answerBody, note: "a".repeat(501) });
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("never logs the note", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { post } = await loadRoute();
    await post({ ...answerBody, note: "Synthetic marker note 7Q" });
    await post({ ...answerBody, note: "Mr Smith synthetic marker 7Q" });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("7Q");
    }
  });
});

describe("answer feedback route: medication and therapy record reports", () => {
  it.each(["medication", "therapy"] as const)("saves a %s record report with its slug", async (recordType) => {
    const { post, insert } = await loadRoute(true);
    const response = await post({
      recordType,
      recordId: "lithium-carbonate",
      feedbackCategory: "outdated_guidance",
      note: "Monitoring interval differs from the cited guideline.",
    });
    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        record_type: recordType,
        record_id: "lithium-carbonate",
        feedback_category: "outdated_guidance",
        note: "Monitoring interval differs from the cited guideline.",
        answer_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        interaction_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
  });

  it.each([
    { recordType: "medication", recordId: "Not A Slug", feedbackCategory: "numeric_error" },
    { recordType: "medication", recordId: "", feedbackCategory: "numeric_error" },
    { recordType: "pharmacy", recordId: "lithium", feedbackCategory: "numeric_error" },
    { recordType: "therapy", recordId: "cbt", feedbackCategory: "made_up" },
    { recordType: "therapy", recordId: "cbt", feedbackCategory: "numeric_error", interactionId },
    { recordType: "answer", recordId: "cbt", feedbackCategory: "numeric_error" },
  ])("rejects a malformed record report %j", async (body) => {
    const { post, insert } = await loadRoute(true);
    expect((await post(body)).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("asks an anonymous reader to sign in before saving a record report", async () => {
    const { post, insert } = await loadRoute(false);
    const response = await post({ recordType: "medication", recordId: "lithium", feedbackCategory: "numeric_error" });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "sign_in_required" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an identifying note on a record report", async () => {
    const { post, insert } = await loadRoute(true);
    const response = await post({
      recordType: "therapy",
      recordId: "cbt",
      feedbackCategory: "needs_correction",
      note: "Patient DOB 01/02/1960 had this",
    });
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
