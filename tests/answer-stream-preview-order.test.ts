import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const answerQuestionWithScope = vi.fn();
const publicAccessContext = vi.fn();
const consumeSubjectApiRateLimit = vi.fn();
const resolveSearchScope = vi.fn();
const persistAnswerDiagnostics = vi.fn();

vi.mock("@/lib/env", () => ({
  isDemoMode: () => false,
  env: { RAG_INCREMENTAL_EVIDENCE_PREVIEW: true },
}));
vi.mock("@/lib/rag/rag", () => ({ answerQuestionWithScope, summarizeDocument: vi.fn() }));
vi.mock("@/lib/public-api-access", () => ({ publicAccessContext }));
vi.mock("@/lib/api-rate-limit", () => ({
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
  consumeSummaryRateLimits: vi.fn(),
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/answer-response", async (importOriginal) => importOriginal());
vi.mock("@/lib/search-scope", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveSearchScope,
}));
vi.mock("@/lib/owner-scope", () => ({
  resolveRetrievalAccessScope: (ownerId?: string) => ({ ownerId }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/answer-telemetry", () => ({ persistAnswerDiagnostics }));
vi.mock("@/lib/observability/agent-monitoring", () => ({ setAgentConversationId: vi.fn() }));
vi.mock("@/lib/sse-heartbeat", () => ({ startSseHeartbeat: () => () => undefined }));
vi.mock("@/lib/server-timing", () => ({
  buildServerTimingHeader: () => null,
  preambleServerTimingEntries: () => [],
}));
vi.mock("@/lib/answer-feedback-token", () => ({ answerFeedbackMetadata: () => ({}) }));

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const normalScope = {
  documentIds: ["private-scope-document-id"],
  filters: { collections: ["private-filter"] },
  activeFilterCount: 1,
  matchedDocumentCount: 1,
  warnings: ["Scoped to one current source."],
  summary: "One active filter",
  futureInternalField: "private",
};

const coverageGapAnswer = {
  answer: "The active sources support only part of this question.",
  grounded: false,
  confidence: "unsupported",
  citations: [],
  sources: [
    {
      id: "coverage-chunk-1",
      document_id: "public-source-document-1",
      title: "Current clinical guidance",
      file_name: "current-guidance.pdf",
      page_number: 2,
      chunk_index: 1,
      section_heading: "Monitoring",
      content: "The source confirms monitoring is required but does not cover the requested threshold.",
      image_ids: [],
      similarity: 0.81,
      adjacent_before: [{ id: "private-adjacent-chunk" }],
    },
  ],
  fallbackReasonCode: "coverage_gap",
  fallbackReason: "private_raw_coverage_reason",
  routingReason: "private_internal_route_reason",
  degradedMode: { active: true, reason: "private_raw_coverage_reason" },
};

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
  persistAnswerDiagnostics.mockResolvedValue(undefined);
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
    const observationContext = answerQuestionWithScope.mock.calls[0]?.[0]?.observationContext as
      { interactionId: string; rolloutMode: string } | undefined;
    expect(observationContext).toEqual({ interactionId: expect.any(String), rolloutMode: "legacy" });
    expect(persistAnswerDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: observationContext?.interactionId }),
    );
  });

  it("logs an empty-scope final outcome with the stream's one interaction id", async () => {
    resolveSearchScope.mockResolvedValueOnce({
      documentIds: [],
      filters: { collections: ["private-filter"] },
      activeFilterCount: 1,
      matchedDocumentCount: 0,
      warnings: ["No indexed documents matched."],
      summary: "One active filter",
      futureInternalField: "private",
    });

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "missing scoped evidence" }),
      }),
    );
    const frames = parseSseFrames(await response.text());
    const final = frames.find((frame) => frame.event === "final")?.data;

    expect(answerQuestionWithScope).not.toHaveBeenCalled();
    const logged = persistAnswerDiagnostics.mock.calls[0]?.[0] as
      { interactionId: string; answer: { fallbackReasonCode?: string; fallbackReason?: string } } | undefined;
    expect(logged).toMatchObject({
      interactionId: expect.any(String),
      answer: { fallbackReasonCode: "no_candidates", fallbackReason: "retrieval_miss" },
    });
    const { ragProgrammeTelemetryForAnswer } = await import("../src/lib/rag/rag-programme-telemetry");
    expect(ragProgrammeTelemetryForAnswer(logged!.answer as never)?.interaction_id).toBe(logged?.interactionId);
    expect(Object.keys(final?.scope as Record<string, unknown>)).toEqual([
      "summary",
      "activeFilterCount",
      "matchedDocumentCount",
      "warnings",
      "queryMode",
    ]);
    expect(final?.scope).toEqual({
      summary: "One active filter",
      activeFilterCount: 1,
      matchedDocumentCount: 0,
      warnings: ["No indexed documents matched."],
      queryMode: "auto",
    });
    expect(JSON.stringify(final?.scope)).not.toMatch(/private-filter|futureInternalField|documentIds|filters/);
  });

  it("projects a non-empty coverage gap and normal scope through the governed SSE boundary", async () => {
    resolveSearchScope.mockResolvedValueOnce(normalScope);
    answerQuestionWithScope.mockResolvedValueOnce(coverageGapAnswer);

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "partially covered monitoring threshold" }),
      }),
    );
    const frames = parseSseFrames(await response.text());
    const final = frames.find((frame) => frame.event === "final")?.data;

    expect(final).toMatchObject({
      fallbackReasonCode: "coverage_gap",
      degradedMode: {
        active: true,
        reason: "The active sources support only part of this question.",
      },
      sources: [{ id: "coverage-chunk-1", document_id: "public-source-document-1" }],
    });
    expect(Object.keys(final?.scope as Record<string, unknown>)).toEqual([
      "summary",
      "activeFilterCount",
      "matchedDocumentCount",
      "warnings",
      "queryMode",
    ]);
    expect(final?.scope).toEqual({
      summary: "One active filter",
      activeFilterCount: 1,
      matchedDocumentCount: 1,
      warnings: ["Scoped to one current source."],
      queryMode: "auto",
    });
    expect(JSON.stringify(final)).not.toMatch(
      /private-scope-document-id|private-filter|futureInternalField|private-adjacent-chunk|private_raw_coverage_reason|private_internal_route_reason/,
    );
  });

  it("does not complete the SSE response before configured joined persistence settles", async () => {
    let release!: () => void;
    const persistence = new Promise<void>((resolve) => {
      release = resolve;
    });
    persistAnswerDiagnostics.mockReturnValueOnce(persistence);
    answerQuestionWithScope.mockResolvedValueOnce({
      answer: "Source-backed answer.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    });

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring" }),
      }),
    );
    let bodySettled = false;
    const body = response.text().then((value) => {
      bodySettled = true;
      return value;
    });
    await vi.waitFor(() => expect(persistAnswerDiagnostics).toHaveBeenCalledOnce());

    expect(bodySettled).toBe(false);
    release();
    expect(await body).toContain("event: final");
  });

  it("emits zero evidence_preview units over SSE when all candidate sources have danger-level governance status", async () => {
    const { buildEvidencePreviewProgress, readLastEvidencePreviewReason } = await import("../src/lib/answer-preview");
    const dangerSource = {
      id: "danger-chunk-1",
      document_id: "danger-doc-1",
      title: "Superseded Clozapine Protocol",
      file_name: "superseded-clozapine.pdf",
      page_number: 1,
      chunk_index: 0,
      section_heading: "Monitoring",
      content: "Outdated ANC monitoring interval from a retired guideline.",
      image_ids: [],
      images: [],
      similarity: 0.89,
      source_metadata: {
        document_status: "outdated",
        clinical_validation_status: "unverified",
        extraction_quality: "poor",
      } as unknown as import("../src/lib/types").SearchResult["source_metadata"],
    };

    answerQuestionWithScope.mockImplementationOnce(
      async ({ onProgress }: { onProgress?: (event: unknown) => void }) => {
        onProgress?.({
          stage: "ranking",
          ...buildEvidencePreviewProgress({
            normalResults: [dangerSource],
            fallbackResults: [dangerSource],
          }),
        });
        onProgress?.({ stage: "generating" });
        return { answer: "Refusal response.", grounded: false, confidence: "unsupported", citations: [], sources: [] };
      },
    );

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring interval" }),
      }),
    );
    const frames = parseSseFrames(await response.text());

    expect(frames.filter((frame) => frame.data.verifiedUnit !== undefined)).toEqual([]);
    expect(
      frames.filter((frame) => (frame.data.verifiedUnit as { kind?: string } | undefined)?.kind === "evidence_preview"),
    ).toEqual([]);
    const rankingFrame = frames.find((frame) => frame.event === "progress" && frame.data.stage === "ranking");
    expect(rankingFrame).toBeDefined();
    expect(rankingFrame?.data.previewReason).toBe("all_sources_danger");
    expect(rankingFrame?.data.verifiedUnit).toBeUndefined();
    expect(readLastEvidencePreviewReason()?.reason).toBe("all_sources_danger");
  });

  it("emits zero evidence_preview units over SSE when answer-level relevance has danger status", async () => {
    const { buildEvidencePreviewProgress, readLastEvidencePreviewReason } = await import("../src/lib/answer-preview");
    const cleanSource = {
      id: "clean-chunk-1",
      document_id: "clean-doc-1",
      title: "Approved Clozapine Guideline",
      file_name: "approved-clozapine.pdf",
      page_number: 2,
      chunk_index: 1,
      section_heading: "Monitoring",
      content: "Standard weekly ANC monitoring requirements for clozapine initiation.",
      image_ids: [],
      images: [],
      similarity: 0.85,
    };

    answerQuestionWithScope.mockImplementationOnce(
      async ({ onProgress }: { onProgress?: (event: unknown) => void }) => {
        onProgress?.({
          stage: "ranking",
          ...buildEvidencePreviewProgress({
            normalResults: [cleanSource],
            fallbackResults: [cleanSource],
            relevance: {
              isSourceBacked: false,
              verdict: "none",
              label: "Not covered",
              score: 0,
              directSourceCount: 0,
              weakSourceCount: 0,
              matchedTerms: [],
              missingTerms: ["lithium"],
              supportReason: "Retrieved passages do not back the query.",
            },
          }),
        });
        onProgress?.({ stage: "generating" });
        return {
          answer: "Unsupported response.",
          grounded: false,
          confidence: "unsupported",
          citations: [],
          sources: [],
        };
      },
    );

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "lithium toxicity dialysis threshold" }),
      }),
    );
    const frames = parseSseFrames(await response.text());

    expect(frames.filter((frame) => frame.data.verifiedUnit !== undefined)).toEqual([]);
    expect(
      frames.filter((frame) => (frame.data.verifiedUnit as { kind?: string } | undefined)?.kind === "evidence_preview"),
    ).toEqual([]);
    const rankingFrame = frames.find((frame) => frame.event === "progress" && frame.data.stage === "ranking");
    expect(rankingFrame).toBeDefined();
    expect(rankingFrame?.data.previewReason).toBe("answer_level_danger");
    expect(rankingFrame?.data.verifiedUnit).toBeUndefined();
    expect(readLastEvidencePreviewReason()?.reason).toBe("answer_level_danger");
  });

  it("drops an undeliverable verifiedUnit at the route boundary and records contract_rejected", async () => {
    const { readLastEvidencePreviewReason } = await import("../src/lib/answer-preview");

    answerQuestionWithScope.mockImplementationOnce(
      async ({ onProgress }: { onProgress?: (event: unknown) => void }) => {
        onProgress?.({
          stage: "ranking",
          previewReason: "ok",
          verifiedUnit: {
            schemaVersion: 1,
            kind: "evidence_preview",
            sequence: 0,
            sources: [],
            selectedContextCount: 0,
          },
        });
        onProgress?.({ stage: "generating" });
        return { answer: "Source-backed answer.", grounded: true, confidence: "high", citations: [], sources: [] };
      },
    );

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring" }),
      }),
    );
    const frames = parseSseFrames(await response.text());

    expect(frames.filter((frame) => frame.data.verifiedUnit !== undefined)).toEqual([]);
    expect(
      frames.filter((frame) => (frame.data.verifiedUnit as { kind?: string } | undefined)?.kind === "evidence_preview"),
    ).toEqual([]);
    const rankingFrame = frames.find((frame) => frame.event === "progress" && frame.data.stage === "ranking");
    expect(rankingFrame).toBeDefined();
    expect(rankingFrame?.data.previewReason).toBe("contract_rejected");
    expect(rankingFrame?.data.verifiedUnit).toBeUndefined();
    expect(readLastEvidencePreviewReason()?.reason).toBe("contract_rejected");
  });

  it("filters out danger-level sources and emits only clean sources in the SSE evidence_preview unit", async () => {
    const { buildEvidencePreviewProgress, readLastEvidencePreviewReason } = await import("../src/lib/answer-preview");
    const dangerSource = {
      id: "danger-chunk-1",
      document_id: "danger-doc-1",
      title: "Superseded Clozapine Protocol",
      file_name: "superseded-clozapine.pdf",
      page_number: 1,
      chunk_index: 0,
      section_heading: "Monitoring",
      content: "Outdated ANC monitoring interval from a retired guideline.",
      image_ids: [],
      images: [],
      similarity: 0.91,
      source_metadata: {
        document_status: "outdated",
        clinical_validation_status: "unverified",
        extraction_quality: "poor",
      } as unknown as import("../src/lib/types").SearchResult["source_metadata"],
    };
    const cleanSource = {
      id: "clean-chunk-1",
      document_id: "clean-doc-1",
      title: "Approved Clozapine Guideline",
      file_name: "approved-clozapine.pdf",
      page_number: 2,
      chunk_index: 1,
      section_heading: "Monitoring",
      content: "Standard weekly ANC monitoring requirements for clozapine initiation.",
      image_ids: [],
      images: [],
      similarity: 0.85,
    };

    answerQuestionWithScope.mockImplementationOnce(
      async ({ onProgress }: { onProgress?: (event: unknown) => void }) => {
        onProgress?.({
          stage: "ranking",
          ...buildEvidencePreviewProgress({
            normalResults: [dangerSource, cleanSource],
            fallbackResults: [dangerSource, cleanSource],
          }),
        });
        onProgress?.({ stage: "generating" });
        return {
          answer: "Standard weekly ANC monitoring is required.",
          grounded: true,
          confidence: "high",
          citations: [],
          sources: [cleanSource],
        };
      },
    );

    const { POST } = await import("../src/app/api/answer/stream/route");
    const response = await POST(
      new Request("http://localhost/api/answer/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "clozapine monitoring interval" }),
      }),
    );
    const frames = parseSseFrames(await response.text());

    const rankingFrame = frames.find((frame) => frame.event === "progress" && frame.data.stage === "ranking");
    expect(rankingFrame).toBeDefined();
    expect(rankingFrame?.data.previewReason).toBe("ok");
    const verifiedUnit = rankingFrame?.data.verifiedUnit as
      { kind?: string; selectedContextCount?: number; sources?: Array<{ id: string }> } | undefined;
    expect(verifiedUnit?.kind).toBe("evidence_preview");
    expect(verifiedUnit?.selectedContextCount).toBe(1);
    expect(verifiedUnit?.sources?.map((source) => source.id)).toEqual(["clean-chunk-1"]);
    expect(readLastEvidencePreviewReason()?.reason).toBe("ok");
  });
});
