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
});
