import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const answerQuestionWithScope = vi.fn();
const publicAccessContext = vi.fn();
const consumeSubjectApiRateLimit = vi.fn();
const resolveSearchScope = vi.fn();
const logAnswerDiagnostics = vi.fn();

vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/lib/rag/rag", () => ({ answerQuestionWithScope, summarizeDocument: vi.fn() }));
vi.mock("@/lib/public-api-access", () => ({ publicAccessContext }));
vi.mock("@/lib/api-rate-limit", () => ({
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
  consumeSummaryRateLimits: vi.fn(),
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/answer-response", () => ({
  answerDegradedModeSignal: () => ({ active: false }),
  buildGovernedAnswerClientResponse: (answer: unknown) => ({ payload: answer, telemetryAnswer: answer }),
  buildGovernedDemoAnswerClientResponse: vi.fn(),
}));
vi.mock("@/lib/search-scope", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveSearchScope,
}));
vi.mock("@/lib/owner-scope", () => ({
  resolveRetrievalAccessScope: (ownerId?: string) => ({ ownerId }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/answer-telemetry", () => ({ logAnswerDiagnostics }));
vi.mock("@/lib/observability/agent-monitoring", () => ({ setAgentConversationId: vi.fn() }));
vi.mock("@/lib/sse-heartbeat", () => ({ startSseHeartbeat: () => () => undefined }));
vi.mock("@/lib/server-timing", () => ({
  answerServerTimingEntries: () => [],
  buildServerTimingHeader: () => null,
  preambleServerTimingEntries: () => [],
}));
vi.mock("@/lib/answer-feedback-token", () => ({
  answerFeedbackMetadata: (interactionId: string) => ({ interactionId }),
}));

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type ParsedSseFrame = { event: string; data: Record<string, unknown> };

function parseSseFrames(body: string): ParsedSseFrame[] {
  return body
    .split(/\n\n+/)
    .map((frame) => frame.trim())
    .filter(Boolean)
    .flatMap((frame) => {
      const lines = frame.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
      const data = lines.find((line) => line.startsWith("data: "))?.slice("data: ".length);
      if (!event || !data) return [];
      return [{ event, data: JSON.parse(data) as Record<string, unknown> }];
    });
}

beforeEach(() => {
  publicAccessContext.mockResolvedValue({
    ownerId,
    authenticated: true,
    rateLimitSubject: { kind: "owner", id: ownerId },
  });
  consumeSubjectApiRateLimit.mockResolvedValue({
    limited: false,
    limit: 100,
    remaining: 99,
    retryAfterSeconds: 0,
    resetAt: new Date(Date.now() + 60_000).toISOString(),
  });
  resolveSearchScope.mockResolvedValue({ documentIds: undefined, filters: {}, activeFilterCount: 0, warnings: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("answer stream verified preview ordering", () => {
  it("delivers the ranking preview before generation and final frames", async () => {
    answerQuestionWithScope.mockImplementation(async ({ onProgress }: { onProgress?: (event: unknown) => void }) => {
      onProgress?.({
        stage: "ranking",
        verifiedUnit: {
          schemaVersion: 1,
          kind: "evidence_preview",
          sequence: 0,
          sources: [
            {
              id: "chunk-1",
              document_id: "doc-1",
              title: "Clozapine Monitoring",
              file_name: "clozapine.pdf",
              page_number: 3,
              chunk_index: 1,
              section_heading: "Monitoring",
              content: "ANC thresholds and FBC monitoring schedule for clozapine.",
              image_ids: [],
              similarity: 0.82,
              images: [],
            },
          ],
          selectedContextCount: 1,
        },
      });
      onProgress?.({ stage: "generating" });
      return { answer: "Source-backed answer.", grounded: true, confidence: "high", citations: [], sources: [] };
    });

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring" }),
      }),
    );
    const frames = parseSseFrames(await response.text());

    const rankingIndex = frames.findIndex((frame) => frame.event === "progress" && frame.data.stage === "ranking");
    const generationIndex = frames.findIndex(
      (frame) => frame.event === "progress" && frame.data.stage === "generating",
    );
    const finalIndex = frames.findIndex((frame) => frame.event === "final");
    const rankingFrame = frames[rankingIndex];
    expect(rankingIndex).toBeGreaterThan(-1);
    expect((rankingFrame.data.verifiedUnit as { kind?: string } | undefined)?.kind).toBe("evidence_preview");
    expect(rankingIndex).toBeLessThan(generationIndex);
    expect(generationIndex).toBeLessThan(finalIndex);

    const observationContext = answerQuestionWithScope.mock.calls[0]?.[0]?.observationContext;
    expect(observationContext).toEqual({
      interactionId: frames[finalIndex]?.data.interactionId,
      rolloutMode: "legacy",
    });
    expect(logAnswerDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ observationContext }));
  });

  it("uses each route-created UUID for both answer telemetry stores", async () => {
    answerQuestionWithScope.mockResolvedValue({
      answer: "Source-backed answer.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    });

    const { POST: postAnswer } = await import("../src/app/api/answer/route");
    const answerResponse = await postAnswer(
      new Request("http://localhost/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring" }),
      }),
    );
    const answerPayload = (await answerResponse.json()) as { interactionId: string };
    expect({ status: answerResponse.status, answerPayload }).toEqual({
      status: 200,
      answerPayload: expect.objectContaining({ interactionId: expect.any(String) }),
    });
    const normalContext = answerQuestionWithScope.mock.calls.at(-1)?.[0]?.observationContext;
    expect(normalContext).toEqual({ interactionId: answerPayload.interactionId, rolloutMode: "legacy" });
    expect(logAnswerDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({ observationContext: normalContext }),
    );

    const { POST: postStream } = await import("../src/app/api/answer/stream/route");
    const streamResponse = await postStream(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring" }),
      }),
    );
    const finalFrame = parseSseFrames(await streamResponse.text()).find((frame) => frame.event === "final");
    const streamContext = answerQuestionWithScope.mock.calls.at(-1)?.[0]?.observationContext;
    expect(streamContext).toEqual({ interactionId: finalFrame?.data.interactionId, rolloutMode: "legacy" });
    expect(logAnswerDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({ observationContext: streamContext }),
    );
  });
});
