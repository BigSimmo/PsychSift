import { readFileSync } from "node:fs";
import { answerRequestSchema } from "../src/lib/validation/answer-request";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAnswerStream } from "../src/components/clinical-dashboard/answer-request";
import { buildAnswerFollowUpQuery } from "../src/lib/answer-follow-up";
import { parseAnswerRequestContext } from "../src/lib/answer-request-context";
import {
  savePersistedAnswerThread,
  loadPersistedAnswerThread,
  answerThreadTtlMs,
} from "../src/lib/answer-thread-storage";
import type { VerifiedEvidencePreviewUnit } from "../src/lib/answer-stream-contract";

const previewSource = {
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
};

const evidencePreview: VerifiedEvidencePreviewUnit = {
  schemaVersion: 1,
  kind: "evidence_preview",
  sequence: 0,
  sources: [previewSource],
  selectedContextCount: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestAnswerStream", () => {
  it.each(["renal impairment", "monitoring"])(
    "T8-R1 sends successive %s follow-ups through actual transport and reload",
    async (topic) => {
      const storage = new Map<string, string>();
      vi.stubGlobal("window", {
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
      });
      const requests: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init: RequestInit) => {
          const body = JSON.parse(String(init.body));
          expect(Object.keys(body).sort()).toEqual(["filters", "query", "queryMode"]);
          expect(answerRequestSchema.safeParse(body).success).toBe(true);
          requests.push(body.query);
          return new Response(
            `event: final\ndata: ${JSON.stringify({ answer: "PRIOR_MODEL_PROSE_CANARY", grounded: true, confidence: "medium", citations: [], sources: [], strongSupportLabelCapped: false })}\n\n`,
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }),
      );
      const send = (queryText: string) =>
        requestAnswerStream({
          queryText,
          filters: {},
          queryMode: "auto",
          selectedDocumentIds: [],
          clientDemoMode: false,
          authorizationHeader: {},
          onProgress: () => undefined,
          onEvidencePreview: () => undefined,
          timedOut: () => false,
          onSessionExpired: () => undefined,
          networkFailure: () => new Error("network failure"),
        });
      const first = await send("lithium dosing");
      const second = await send(buildAnswerFollowUpQuery(first.query, `what about ${topic}?`));
      savePersistedAnswerThread("fixture-owner", {
        version: 3,
        priorTurns: [],
        latestTurn: {
          query: `what about ${topic}?`,
          resolvedQuery: second.query,
          answer: second.payload,
          sources: [],
        },
        collapsedTurnIds: [],
        showEarlierTurns: false,
        latestSubmissionSignature: "fixture-signature",
        expiresAt: Date.now() + answerThreadTtlMs,
      });
      const restored = loadPersistedAnswerThread("fixture-owner");
      expect(restored?.latestTurn?.query).toBe(`what about ${topic}?`);
      const third = await send(
        buildAnswerFollowUpQuery(
          restored?.latestTurn?.resolvedQuery,
          "Please elaborate with an explanation and an example of how this affects monitoring over the next several appointments.",
        ),
      );
      expect(third.query).toContain("lithium dosing");
      expect(third.query).toContain(topic);
      expect(third.query).toContain("Please elaborate");
      expect(requests).toHaveLength(3);
      const example = await send(buildAnswerFollowUpQuery(first.query, "Give an example."));
      expect(example.query).toContain("lithium dosing");
      const elaborated = await send(
        buildAnswerFollowUpQuery(restored?.latestTurn?.resolvedQuery, "Please elaborate on monitoring."),
      );
      expect(elaborated.query).toContain("lithium dosing");
      expect(elaborated.query).toContain("monitoring");
      for (const prior of [first.query, restored?.latestTurn?.resolvedQuery]) {
        const newSubject = await send(buildAnswerFollowUpQuery(prior, "Please elaborate on clozapine monitoring."));
        expect(newSubject.query).toBe("Please elaborate on clozapine monitoring.");
        expect(newSubject.query).not.toContain("lithium");
        for (const [latest, fresh] of [
          ["Please elaborate on dosing and monitoring.", "Please elaborate on clozapine dosing and monitoring."],
          ["Please elaborate on this in detail.", "Please elaborate on this and clozapine monitoring in detail."],
        ]) {
          const continued = await send(buildAnswerFollowUpQuery(prior, latest));
          expect.soft(parseAnswerRequestContext(continued.query), latest).toEqual({
            version: "answer-request-context-v1",
            subject: "lithium dosing",
            constraints: prior === first.query ? [] : [`what about ${topic}?`],
            latestRequest: latest,
            depth: "detailed",
          });
          const unrelated = await send(buildAnswerFollowUpQuery(prior, fresh));
          expect.soft(unrelated.query).toBe(fresh);
          expect.soft(unrelated.query).not.toContain("lithium");
        }
      }
      const normal = await send(
        buildAnswerFollowUpQuery("lithium dosing with renal impairment", "instead with normal renal function"),
      );
      expect(normal.query).not.toContain("renal impairment");
      const fresh = await send(buildAnswerFollowUpQuery(third.query, "Explain clozapine monitoring"));
      expect(fresh.query).toBe("Explain clozapine monitoring");
      expect(() =>
        buildAnswerFollowUpQuery("lithium " + "context ".repeat(260) + "TAIL_RESTRICTION", "what about this?"),
      ).toThrow("prior");
      const caller = readFileSync("src/components/ClinicalDashboard.tsx", "utf8");
      expect(caller).toContain("resolvedQuery: payload.query");
      expect(caller).toContain("latestAnswerTurnRef.current?.resolvedQuery ?? latestAnswerTurnRef.current?.query");
      expect(requests.join(" ")).not.toContain("PRIOR_MODEL_PROSE_CANARY");
    },
  );

  it("preserves the authenticated request body and forwards only verified preview events", async () => {
    const streamBody = [
      `event: progress\ndata: ${JSON.stringify({ stage: "ranking", message: "private", verifiedUnit: evidencePreview })}`,
      `event: final\ndata: ${JSON.stringify({
        answer: "Grounded answer.",
        grounded: true,
        confidence: "medium",
        citations: [],
        sources: [previewSource],
      })}`,
      "",
    ].join("\n\n");
    const fetchMock = vi.fn(async () => new Response(streamBody, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const previews: Array<VerifiedEvidencePreviewUnit | null> = [];

    const result = await requestAnswerStream({
      queryText: "clozapine monitoring",
      filters: { medications: ["clozapine"] },
      queryMode: "auto",
      selectedDocumentIds: ["doc-1"],
      clientDemoMode: false,
      authorizationHeader: { authorization: "Bearer test-token" },
      onProgress: () => undefined,
      onEvidencePreview: (preview) => previews.push(preview),
      timedOut: () => false,
      onSessionExpired: vi.fn(),
      networkFailure: () => new Error("network failure"),
    });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(input).toBe("/api/answer/stream");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      query: "clozapine monitoring",
      documentIds: ["doc-1"],
      filters: { medications: ["clozapine"] },
      queryMode: "auto",
    });
    expect(previews).toEqual([evidencePreview, null]);
    expect(result).toMatchObject({ kind: "answer", query: "clozapine monitoring" });
    expect(result.payload.answer).toBe("Grounded answer.");
  });

  it("expires the client session before surfacing a 401 answer response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    const onSessionExpired = vi.fn();

    await expect(
      requestAnswerStream({
        queryText: "clozapine monitoring",
        filters: {},
        queryMode: "auto",
        selectedDocumentIds: [],
        clientDemoMode: true,
        authorizationHeader: {},
        onProgress: () => undefined,
        onEvidencePreview: () => undefined,
        timedOut: () => false,
        onSessionExpired,
        networkFailure: () => new Error("network failure"),
      }),
    ).rejects.toMatchObject({ status: 401, retryable: false });
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });
});
