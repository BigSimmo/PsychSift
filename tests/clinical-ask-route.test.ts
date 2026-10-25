import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  rate: vi.fn(),
  run: vi.fn(),
  resolveScope: vi.fn(),
  openAI: vi.fn(),
  authorityDomainsForProfile: vi.fn(),
  externalSearchEnabled: vi.fn(),
  retrieveExternal: vi.fn(),
  modeEnabled: vi.fn(),
  enabled: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocks.logWarn, error: mocks.logError },
}));
vi.mock("@/lib/public-api-access", () => ({ publicAccessContext: mocks.access }));
vi.mock("@/lib/api-rate-limit", () => ({
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => new Response("limited", { status: 429 }),
}));
vi.mock("@/lib/clinical-ask/orchestrator", () => ({ runClinicalAsk: mocks.run }));
vi.mock("@/lib/owner-scope", () => ({ resolveRetrievalAccessScope: mocks.resolveScope }));
vi.mock("@/lib/clinical-ask/authority-registry", () => ({
  authorityDomainsForProfile: mocks.authorityDomainsForProfile,
  clinicalAskExternalSearchEnabled: mocks.externalSearchEnabled,
  clinicalAskModeEnabled: mocks.modeEnabled,
  clinicalAskEnabled: mocks.enabled,
}));
vi.mock("@/lib/clinical-ask/external-evidence", () => ({ retrieveExternalEvidence: mocks.retrieveExternal }));
vi.mock("@/lib/openai", () => ({ createOpenAIClient: mocks.openAI }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: vi.fn() }) }));
vi.mock("@/lib/observability/agent-monitoring", () => ({ setAgentConversationId: vi.fn() }));
vi.mock("@/lib/answer-feedback-token", () => ({
  answerFeedbackMetadata: () => ({ interactionId: "x" }),
  hashAnswerForFeedback: () => "hash",
}));

import { POST } from "@/app/api/clinical-ask/stream/route";
import { identifierShapeWarning } from "@/lib/clinical-ask/context";
import { rejectPatientDetailQuestion } from "@/lib/clinical-question-patient-check-server";

const body = {
  mode: "services",
  question: "Which example service applies?",
  confirmedContext: {
    serviceLocation: "example",
    population: "adult",
    pathwayStage: "assessment",
    referralPurpose: "review",
  },
  clarificationAnswers: {},
  priorTurns: [],
  allowExternalFallback: false,
  inputTransport: "typed",
};
const post = (value: unknown = body) =>
  new Request("http://local.test/api/clinical-ask/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    authenticated: true,
    ownerId: "owner-a",
    rateLimitSubject: { kind: "owner", ownerId: "owner-a" },
  });
  mocks.rate.mockResolvedValue({ limited: false, limit: 20, remaining: 19, retryAfterSeconds: 1, resetAt: "x" });
  mocks.resolveScope.mockReturnValue({ ownerId: "owner-a", includePublic: true });
  mocks.authorityDomainsForProfile.mockReturnValue(["health.wa.gov.au"]);
  mocks.externalSearchEnabled.mockReturnValue(false);
  mocks.retrieveExternal.mockResolvedValue([]);
  mocks.modeEnabled.mockReturnValue(true);
  mocks.enabled.mockReturnValue(true);
  mocks.run.mockResolvedValue({
    state: "failed",
    mode: "services",
    code: "internal_error",
    retryable: false,
    message: "Clinical Ask failed safely.",
  });
});

describe("POST /api/clinical-ask/stream", () => {
  it("authenticates, rate limits, owner-scopes, and streams safe headers", async () => {
    const response = await POST(post());
    await response.text();
    expect(mocks.access).toHaveBeenCalled();
    expect(mocks.rate).toHaveBeenCalledWith(expect.objectContaining({ bucket: "clinical_ask" }));
    expect(mocks.resolveScope).toHaveBeenCalledWith("owner-a");
    expect(mocks.run).toHaveBeenCalledWith(
      expect.anything(),
      { ownerId: "owner-a", includePublic: true },
      expect.anything(),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("server-timing")).toMatch(/auth;dur=|ratelimit;dur=/);
  });

  it("preserves the mode profile authority boundary for external retrieval", async () => {
    mocks.externalSearchEnabled.mockReturnValue(true);
    mocks.run.mockImplementation(async (_request, _scope, dependencies, signal) => {
      await dependencies.retrieveExternal(body, ["official-service-directories"], signal);
      return {
        state: "failed",
        mode: "services",
        code: "internal_error",
        retryable: false,
        message: "Clinical Ask failed safely.",
      };
    });

    const response = await POST(post({ ...body, allowExternalFallback: true }));
    await response.text();

    expect(mocks.authorityDomainsForProfile).toHaveBeenCalledWith("services", ["official-service-directories"]);
    expect(mocks.retrieveExternal).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "services" }),
      ["health.wa.gov.au"],
      expect.any(AbortSignal),
    );
  });

  it("does not reject the stream when cancellation races the terminal frame", async () => {
    let resolveRun!: (response: {
      state: "failed";
      mode: "services";
      code: "aborted";
      retryable: false;
      message: string;
    }) => void;
    mocks.run.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRun = resolve;
      }),
    );
    const response = await POST(post());
    await expect(response.body?.cancel()).resolves.toBeUndefined();
    resolveRun({
      state: "failed",
      mode: "services",
      code: "aborted",
      retryable: false,
      message: "Clinical Ask was cancelled.",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it("logs an internal failure before sending the safe error frame", async () => {
    mocks.run.mockRejectedValueOnce(new Error("synthesis provider returned 503"));

    const response = await POST(post());
    const text = await response.text();

    expect(text).toContain('"code":"internal_error"');
    expect(mocks.logError).toHaveBeenCalledWith(
      "Clinical Ask stream failed",
      expect.objectContaining({ name: "Error", message: expect.any(String) }),
    );
  });

  it("does not log a client abort as a failure", async () => {
    mocks.run.mockRejectedValueOnce(new DOMException("Clinical Ask stream cancelled.", "AbortError"));

    const response = await POST(post());
    const text = await response.text();

    expect(text).not.toContain('"code":"internal_error"');
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request before rate limiting or orchestration", async () => {
    mocks.access.mockResolvedValue({
      authenticated: false,
      ownerId: undefined,
      rateLimitSubject: { kind: "anonymous", subjectKey: "anon:test" },
    });
    const response = await POST(post());
    expect(response.status).toBe(401);
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects unknown input before access", async () => {
    const response = await POST(post({ ...body, unknown: true }));
    expect(response.status).toBe(400);
    expect(mocks.access).not.toHaveBeenCalled();
  });

  it("returns 429 before orchestration", async () => {
    mocks.rate.mockResolvedValue({ limited: true, limit: 20, remaining: 0, retryAfterSeconds: 60, resetAt: "x" });
    expect((await POST(post())).status).toBe(429);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("blocks identifier-shaped text without leaking it or constructing providers", async () => {
    const secret = "patient@example.com";
    const response = await POST(post({ ...body, question: `Review ${secret}` }));
    const text = await response.text();
    expect(text).toContain("identifiable_input_blocked");
    expect(text).not.toContain(secret);
    expect(response.headers.get("server-timing")).not.toContain(secret);
    expect(mocks.resolveScope).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.openAI).not.toHaveBeenCalled();
  });

  it("answers 404 before authentication or the durable rate limiter when the master flag is off", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await POST(post());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(await response.text()).not.toContain("mode_unavailable");
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
    expect(mocks.modeEnabled).not.toHaveBeenCalled();
    expect(mocks.resolveScope).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    // A designed 404 is not a server fault: it must not write an error-level
    // log line (which the Sentry Logs allowlist would forward) per probe.
    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.logWarn).not.toHaveBeenCalled();
  });

  it("keeps the SSE mode_unavailable frame for a mode on the emergency denylist", async () => {
    mocks.modeEnabled.mockReturnValue(false);
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("mode_unavailable");
  });

  it("returns the explicit dormant-mode error without starting retrieval", async () => {
    mocks.modeEnabled.mockReturnValue(false);
    const response = await POST(post());
    const text = await response.text();
    expect(text).toContain("mode_unavailable");
    expect(mocks.resolveScope).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  // Audit ARCH-06 (2026-10-20): Clinical Ask used only the narrow identifier-shape test (email, Medicare,
  // labelled record numbers, labelled date of birth, phone), so a name with a title, a bed with a name, or a
  // bare UMRN reached OpenAI here although Answer refuses it. Every example is synthetic.
  describe("patient-detail parity with Answer", () => {
    const answerRefuses = [
      "Mr Smith lithium level 1.4",
      "Mrs Jones in bed 4, 82, on clozapine - next step?",
      "Ms Example started olanzapine, what monitoring?",
      "Ward 4 Ms Smith QTc question",
      "pt John on lithium, level 1.1",
      "D1234567 clozapine titration",
    ];
    const answerAllows = [
      "lithium dose for 70 year old with CKD",
      "QTc 480 ms ECG monitoring with ziprasidone",
      "MS on interferon with depression: antidepressant choice?",
      "pt with renal impairment on lithium",
    ];

    it.each(answerRefuses)("blocks %j, which Answer refuses and the old shape test let through", async (question) => {
      // Preconditions: Answer refuses it, and the old Clinical Ask test alone would have passed it.
      expect(() => rejectPatientDetailQuestion({ query: question })).toThrow();
      expect(identifierShapeWarning(question)).toBe(false);

      const response = await POST(post({ ...body, question }));
      const text = await response.text();
      expect(text).toContain("identifiable_input_blocked");
      expect(text).toContain("Remove identifying details before using Clinical Ask.");
      for (const word of ["Smith", "Jones", "Example", "John", "D1234567"]) expect(text).not.toContain(word);
      expect(mocks.resolveScope).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
      expect(mocks.retrieveExternal).not.toHaveBeenCalled();
      expect(mocks.openAI).not.toHaveBeenCalled();
    });

    it.each(answerAllows)("lets %j through, as Answer does", async (question) => {
      expect(() => rejectPatientDetailQuestion({ query: question })).not.toThrow();
      const response = await POST(post({ ...body, question }));
      expect(await response.text()).not.toContain("identifiable_input_blocked");
      expect(mocks.run).toHaveBeenCalledOnce();
    });

    it("blocks a patient detail in confirmed context before orchestration", async () => {
      const response = await POST(
        post({ ...body, confirmedContext: { ...body.confirmedContext, population: ["adult", "Mrs Jones"] } }),
      );
      const text = await response.text();
      expect(text).toContain("identifiable_input_blocked");
      expect(text).not.toContain("Jones");
      expect(mocks.run).not.toHaveBeenCalled();
    });

    it("blocks a patient detail in a clarification answer before orchestration", async () => {
      const response = await POST(
        post({ ...body, clarificationAnswers: { "services:serviceLocation": "Mr Smith in bed 12" } }),
      );
      const text = await response.text();
      expect(text).toContain("identifiable_input_blocked");
      expect(text).not.toContain("Smith");
      expect(mocks.run).not.toHaveBeenCalled();
    });
  });
});
