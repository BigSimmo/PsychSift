import { afterEach, describe, expect, it, vi } from "vitest";

const setAgentConversationId = vi.fn();
const summarizeDocument = vi.fn(async () => ({
  answer: "Summary body.",
  grounded: true,
  confidence: "high" as const,
  citations: [],
  sources: [],
  smartPanel: { query: "summary" },
  smartApiPlan: { displayMode: "direct" as const },
}));

vi.mock("@/lib/observability/agent-monitoring", () => ({
  setAgentConversationId,
}));

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isDemoMode: () => false,
}));

vi.mock("@/lib/rag/rag", () => ({
  summarizeDocument,
}));

vi.mock("@/lib/answer-telemetry", () => ({
  persistAnswerDiagnostics: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-rate-limit")>()),
  consumeApiRateLimit: vi.fn(async () => ({
    limited: false,
    limit: 12,
    remaining: 11,
    retryAfterSeconds: 60,
    resetAt: new Date().toISOString(),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

vi.mock("@/lib/supabase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth")>()),
  requireAuthenticatedUser: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
}));

describe("document summarize Sentry conversation id", () => {
  afterEach(() => {
    setAgentConversationId.mockClear();
    summarizeDocument.mockClear();
    vi.resetModules();
  });

  it("sets the agent conversation id before any LLM summarize work and returns a governed payload", async () => {
    const { POST } = await import("../src/app/api/documents/[id]/summarize/route");
    const documentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const response = await POST(
      new Request(`http://localhost/api/documents/${documentId}/summarize`, { method: "POST" }),
      {
        params: Promise.resolve({ id: documentId }),
      },
    );

    expect(response.status).toBe(200);
    expect(setAgentConversationId).toHaveBeenCalledTimes(1);
    expect(setAgentConversationId.mock.invocationCallOrder[0]).toBeLessThan(
      summarizeDocument.mock.invocationCallOrder[0]!,
    );
    const body = (await response.json()) as {
      answer?: string;
      grounded?: boolean;
      interactionId?: string;
      degradedMode?: { active: boolean; reason: string | null };
      sourceGovernanceWarnings?: unknown[];
      safetyWarnings?: unknown[];
    };
    expect(body.answer).toBe("Summary body.");
    expect(body.grounded).toBe(true);
    expect(body.degradedMode).toEqual({ active: false, reason: null });
    expect(body.sourceGovernanceWarnings).toEqual([]);
    expect(body.safetyWarnings).toEqual([]);
    expect(body.interactionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(setAgentConversationId).toHaveBeenCalledWith(body.interactionId);
  });
});
