import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildGovernedAnswerClientResponse } from "@/lib/answer-response";
import { readAnswerStream } from "@/components/clinical-dashboard/search-utils";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import { buildAnswerClipboardText } from "@/components/clinical-dashboard/answer-copy-payload";
import {
  answerUsesAdaptiveMainSurface,
  projectAnswerForMainSurface,
} from "@/components/clinical-dashboard/answer-section-projector";
import type { RagAnswer } from "@/lib/types";
import {
  answerThreadStorageKey,
  answerThreadTtlMs,
  clearPersistedAnswerThread,
  loadPersistedAnswerThread,
  maxStoredAnswerTurns,
  normalizeLatestTurn,
  normalizePersistedAnswerThread,
  normalizeStoredAnswerTurn,
  resolveAnswerThreadOwnerId,
  savePersistedAnswerThread,
  type PersistedAnswerThread,
} from "@/lib/answer-thread-storage";

const sampleAnswer = {
  answer: "Monitor renal function every 3 months.",
  grounded: true,
  confidence: "high",
  citations: [],
  sources: [],
  strongSupportLabelCapped: false,
} satisfies RagAnswer;

function createSampleThread(overrides: Partial<PersistedAnswerThread> = {}): PersistedAnswerThread {
  return {
    version: 3,
    priorTurns: [
      {
        id: "answer-turn-1",
        query: "lithium dosing",
        answer: sampleAnswer,
        sources: [],
      },
    ],
    latestTurn: {
      query: "what about renal impairment?",
      answer: sampleAnswer,
      sources: [],
    },
    collapsedTurnIds: ["answer-turn-1"],
    showEarlierTurns: false,
    latestSubmissionSignature: "answer:what about renal impairment?:",
    expiresAt: Date.now() + answerThreadTtlMs,
    ...overrides,
  };
}

describe("answer thread storage", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
        removeItem(key: string) {
          storage.delete(key);
        },
      },
      sessionStorage: {
        get length() {
          return storage.size;
        },
        key(index: number) {
          return [...storage.keys()][index] ?? null;
        },
        getItem(key: string) {
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          storage.set(key, value);
        },
        removeItem(key: string) {
          storage.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("FR5 purges a seeded V3 invalid latest turn even with valid prior turns", () => {
    const thread = createSampleThread();
    const key = `${answerThreadStorageKey}:owner-1`;
    storage.set(
      key,
      JSON.stringify({
        ...thread,
        latestTurn: { ...thread.latestTurn, answer: { ...sampleAnswer, answerSections: {} } },
      }),
    );
    expect(
      loadPersistedAnswerThread("owner-1", { expectedSubmissionSignature: thread.latestSubmissionSignature }),
    ).toBeNull();
    expect(storage.has(key)).toBe(false);
  });

  it.each([
    ["retrievalGateBlocked", "low"],
    ["authorityTrustCapRequired", "medium"],
  ])("FR4 preserves true %s through final SSE and restoration with trust capped", async (field, trust) => {
    const payload = buildGovernedAnswerClientResponse({
      ...sampleAnswer,
      [field]: true,
      relevance: {
        verdict: "direct",
        label: "Direct",
        matchedTerms: [],
        missingTerms: [],
        directSourceCount: 1,
        weakSourceCount: 0,
        score: 1,
        supportReason: "Direct support",
        isSourceBacked: true,
      },
    }).payload;
    const streamed = await readAnswerStream(
      new Response(`event: final\ndata: ${JSON.stringify(payload)}\n\n`),
      () => {},
    );
    expect(streamed).toMatchObject({ [field]: true });
    expect(
      savePersistedAnswerThread(
        "owner-1",
        createSampleThread({ latestTurn: { query: "Question", answer: streamed, sources: [] } }),
      ),
    ).toBe(true);
    const restored = loadPersistedAnswerThread("owner-1")?.latestTurn?.answer;
    expect(restored).toMatchObject({ [field]: true });
    expect(buildAnswerRenderModel(restored!).trust).toBe(trust);
  });

  it("#WGMB4Z preserves the strong-support label cap through final SSE and restoration without touching trust", async () => {
    const payload = buildGovernedAnswerClientResponse({
      ...sampleAnswer,
      confidence: "high",
      supportedClaims: [],
      relevance: {
        verdict: "direct",
        label: "Direct",
        matchedTerms: [],
        missingTerms: [],
        directSourceCount: 1,
        weakSourceCount: 0,
        score: 1,
        supportReason: "Direct support",
        isSourceBacked: true,
      },
    }).payload;
    expect(payload).toMatchObject({ authorityTrustCapRequired: false, strongSupportLabelCapped: true });
    const streamed = await readAnswerStream(
      new Response(`event: final\ndata: ${JSON.stringify(payload)}\n\n`),
      () => {},
    );
    expect(streamed).toMatchObject({ strongSupportLabelCapped: true });
    expect(
      savePersistedAnswerThread(
        "owner-1",
        createSampleThread({ latestTurn: { query: "Question", answer: streamed, sources: [] } }),
      ),
    ).toBe(true);
    const restored = loadPersistedAnswerThread("owner-1")?.latestTurn?.answer;
    expect(restored).toMatchObject({ strongSupportLabelCapped: true });
    const model = buildAnswerRenderModel(restored!);
    expect(model.trust).toBe("high");
    expect(model.supportLabelTrust).toBe("medium");
  });

  it("R3 preserves a comparison and accessible visual table through final SSE and storage", async () => {
    const source = {
      id: "chunk-1",
      document_id: "doc-1",
      title: "Guideline",
      file_name: "guide.pdf",
      page_number: 1,
      chunk_index: 0,
      section_heading: null,
      content: "Monitor weekly.",
      image_ids: ["image-1"],
      images: [],
      similarity: 1,
    };
    const answer: RagAnswer = {
      ...sampleAnswer,
      sources: [source],
      comparisonMatrix: {
        documents: [{ documentId: "doc-1", title: "Guideline", fileName: "guide.pdf" }],
        rows: [
          {
            parameter: "Monitoring interval",
            status: "agreement",
            entries: [{ documentId: "doc-1", chunkIds: ["chunk-1"], value: "Weekly", qualifiers: [] }],
          },
        ],
      },
      visualEvidence: [
        {
          id: "visual-1",
          image_id: "image-1",
          signed_url_endpoint: "/api/images/image-1",
          caption: "Monitoring",
          document_id: "doc-1",
          title: "Guideline",
          file_name: "guide.pdf",
          page_number: 1,
          source_chunk_id: "chunk-1",
          chunk_index: 0,
          viewer_href: "/documents/doc-1?page=1&chunk=chunk-1",
          image_type: "clinical_table",
          tableRows: [["Timing", "Weekly"]],
          tableColumns: ["Parameter", "Guidance"],
        },
      ],
    };
    const stream = (value: unknown) =>
      readAnswerStream(new Response(`event: final\ndata: ${JSON.stringify(value)}\n\n`), () => {});
    const payload = await stream(JSON.parse(JSON.stringify(buildGovernedAnswerClientResponse(answer).payload)));
    const thread = createSampleThread({
      priorTurns: [],
      latestTurn: { query: "Question", answer: payload, sources: payload.sources },
    });
    expect(savePersistedAnswerThread("user-a", thread)).toBe(true);
    const restored = loadPersistedAnswerThread("user-a")!.latestTurn!.answer;
    expect(restored.comparisonMatrix).toEqual(answer.comparisonMatrix);
    expect(restored.visualEvidence).toEqual(answer.visualEvidence);
    const malformed = { ...payload, comparisonMatrix: { documents: [], rows: {} } };
    const oversized = {
      ...payload,
      visualEvidence: [
        { ...payload.visualEvidence![0], tableRows: Array.from({ length: 201 }, () => ["Timing", "Weekly"]) },
      ],
    };
    for (const invalid of [malformed, oversized]) {
      await expect(stream(invalid)).rejects.toThrow("invalid final payload");
      expect(
        savePersistedAnswerThread("user-a", {
          ...thread,
          latestTurn: { query: "Question", answer: invalid as unknown as RagAnswer, sources: [] },
        }),
      ).toBe(false);
    }
  });

  it("R3 strips nested private carriers on save and accepts only canonical final SSE", async () => {
    const metadata = {
      publisher: "Public publisher",
      owner_id: "private-owner",
      metrics: { nested: { reviewer_id: "private-reviewer" } },
    };
    const label = {
      label: "Monitoring",
      label_type: "topic",
      source: "manual",
      confidence: 1,
      owner_id: "private-label-owner",
      metadata,
    };
    const citation = {
      chunk_id: "chunk-1",
      document_id: "doc-1",
      title: "Guideline",
      file_name: "guide.pdf",
      page_number: 1,
      chunk_index: 0,
      source_metadata: metadata,
    };
    const answer = {
      ...sampleAnswer,
      citations: [citation],
      sources: [
        {
          id: "chunk-1",
          document_id: "doc-1",
          title: "Guideline",
          file_name: "guide.pdf",
          page_number: 1,
          chunk_index: 0,
          section_heading: null,
          content: "Review the source.",
          image_ids: [],
          similarity: 1,
          source_metadata: metadata,
          document_labels: [label],
        },
      ],
      quoteCards: [{ ...citation, quote: "Review the source.", section_heading: null }],
      bestSource: {
        ...citation,
        source_strength: "strong",
        score: 1,
        snippet: "Review the source.",
        section_heading: null,
        image_count: 0,
        viewer_href: "/documents/doc-1",
      },
      safetyWarnings: [
        {
          id: "warning-1",
          kind: "monitoring",
          label: "Monitoring",
          text: "Review the source.",
          href: "/documents/doc-1",
          citation,
        },
      ],
      relatedDocuments: [
        {
          document_id: "doc-1",
          title: "Guideline",
          file_name: "guide.pdf",
          labels: [label],
          summary: null,
          best_pages: [1],
          best_chunk_ids: ["chunk-1"],
          image_count: 0,
          match_reason: "Direct support",
          score: 1,
        },
      ],
    } as unknown as RagAnswer;
    const stream = (value: unknown) =>
      readAnswerStream(new Response(`event: final\ndata: ${JSON.stringify(value)}\n\n`), () => {});
    await expect(stream(answer)).rejects.toThrow("invalid final payload");
    const thread = createSampleThread({
      priorTurns: [],
      latestTurn: { query: "Question", answer, sources: answer.sources },
    });
    expect(savePersistedAnswerThread("user-a", thread)).toBe(true);
    expect(storage.get(`${answerThreadStorageKey}:user-a`)).not.toContain("private-");
    const restored = loadPersistedAnswerThread("user-a")!.latestTurn!.answer;
    expect(restored.relatedDocuments?.[0].labels[0]).toEqual({
      label: "Monitoring",
      label_type: "topic",
      source: "manual",
      confidence: 1,
    });
    expect(restored.safetyWarnings?.[0].citation.source_metadata).toEqual({ publisher: "Public publisher" });
    expect(restored.quoteCards?.[0].source_metadata).toEqual({ publisher: "Public publisher" });
    expect(restored.bestSource?.source_metadata).toEqual({ publisher: "Public publisher" });
    expect(await stream(restored)).toEqual(restored);
  });

  it.each([true, false])(
    "R3 retains best-source withdrawal through JSON SSE storage and render/copy with retained=%s",
    async (retained) => {
      const source = {
        id: "chunk-1",
        document_id: "doc-1",
        title: "Guideline",
        file_name: "guideline.pdf",
        page_number: 1,
        chunk_index: 0,
        section_heading: null,
        content: "Review the source.",
        image_ids: [],
        images: [],
        similarity: 1,
      };
      const server: RagAnswer = {
        ...sampleAnswer,
        sources: retained ? [source] : [],
        answerQualityTier: "source_only",
        routingMode: "extractive",
        bestSource: null,
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Review source.",
            riskClass: "routine",
            supportingChunkIds: ["chunk-1"],
            supportStatus: "direct",
          },
        ],
      };
      const json = JSON.parse(JSON.stringify(buildGovernedAnswerClientResponse(server).payload));
      const streamed = await readAnswerStream(
        new Response(`event: final\ndata: ${JSON.stringify(json)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
        () => {},
      );
      expect(streamed.bestSource).toBeNull();
      const thread = createSampleThread({
        priorTurns: [{ id: "turn-1", query: "Question", answer: streamed, sources: streamed.sources }],
        latestTurn: { query: "Question", answer: streamed, sources: streamed.sources },
      });
      expect(savePersistedAnswerThread("user-a", thread)).toBe(true);
      const restored = loadPersistedAnswerThread("user-a")!;
      for (const turn of [restored.latestTurn!, ...restored.priorTurns]) {
        expect(turn.answer.bestSource).toBeNull();
        const model = buildAnswerRenderModel(turn.answer);
        expect(model.bestSource).toBeNull();
        expect(buildAnswerClipboardText({ answer: turn.answer, renderCopyText: model.copyText })).not.toMatch(
          /Best source/i,
        );
      }
    },
  );

  it.each([true, false])(
    "P12B Task4 preserves complete canonical v20 current/prior/copy through final SSE and reload, render=%s",
    async (renderAdaptiveAnswer) => {
      const source = {
        id: "chunk-v20",
        document_id: "doc-v20",
        title: "Synthetic current guideline",
        file_name: "synthetic.pdf",
        page_number: 6,
        chunk_index: 0,
        section_heading: "Monitoring",
        content: "Review observations every three months.",
        image_ids: [],
        images: [],
        similarity: 1,
      };
      const server: RagAnswer = {
        ...sampleAnswer,
        answer: "Review the current plan.",
        sources: [source],
        citations: [
          {
            chunk_id: source.id,
            document_id: source.document_id,
            title: source.title,
            file_name: source.file_name,
            page_number: source.page_number,
            chunk_index: source.chunk_index,
          },
        ],
        answerContractVersion: "clinical-rag-answer-v20",
        renderAdaptiveAnswer,
        answerSections: [
          {
            heading: "Monitoring",
            body: "Review observations every three months.",
            kind: "monitoring_timing",
            supportLevel: "direct",
            citation_chunk_ids: [source.id],
          },
          {
            heading: "Source difference",
            body: "The uploaded protocol and WA guideline differ; review both before use.",
            kind: "source_conflict",
            supportLevel: "direct",
            citation_chunk_ids: [source.id],
          },
          {
            heading: "Source gap",
            body: "Route: not covered by the active sources.",
            kind: "source_gap",
            supportLevel: "unsupported",
            citation_chunk_ids: [],
          },
        ],
      };
      const payload = buildGovernedAnswerClientResponse(server).payload;
      const streamed = await readAnswerStream(
        new Response(`event: final\ndata: ${JSON.stringify(payload)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
        () => {},
      );
      const thread = createSampleThread({
        priorTurns: [{ id: "turn-v20", query: "Prior question", answer: streamed, sources: streamed.sources }],
        latestTurn: { query: "Current question", answer: streamed, sources: streamed.sources },
      });
      expect(savePersistedAnswerThread("user-v20", thread)).toBe(true);
      const restored = loadPersistedAnswerThread("user-v20")!;
      for (const turn of [restored.latestTurn!, ...restored.priorTurns]) {
        expect(turn.answer.answerContractVersion).toBe("clinical-rag-answer-v20");
        expect(turn.answer.renderAdaptiveAnswer).toBe(renderAdaptiveAnswer);
        expect(turn.answer.answerSections?.map((section) => section.kind)).toEqual([
          "monitoring_timing",
          "source_conflict",
          "source_gap",
        ]);
        expect(answerUsesAdaptiveMainSurface(turn.answer)).toBe(renderAdaptiveAnswer);
        expect(
          projectAnswerForMainSurface({ answer: turn.answer, sources: turn.sources, preformatted: false }).sections,
        ).toHaveLength(3);
        const copy = buildAnswerClipboardText({
          answer: turn.answer,
          sources: turn.sources,
          renderCopyText: buildAnswerRenderModel(turn.answer).copyText,
        });
        expect(copy).toContain("Monitoring\n\nReview observations every three months.");
        expect(copy).toContain("Source difference");
        expect(copy).toContain("Source gap\n\nRoute: not covered by the active sources.");
      }
    },
  );

  it.each([
    [
      { fallbackReasonCode: "provider_timeout", degradedMode: { active: true, reason: "private-reason" } },
      "Answer generation timed out; the verified source-backed portion is shown.",
    ],
    [
      { degradedMode: { active: true, reason: "private-reason" } },
      "The answer could not be completed from the currently verified sources.",
    ],
    [{ degradedMode: { active: false, reason: "private-reason" } }, null],
  ])("R3 canonicalizes saved degradation %j", (fields, reason) => {
    const answer = { ...sampleAnswer, ...fields } as RagAnswer;
    const thread = createSampleThread({ priorTurns: [], latestTurn: { query: "Question", answer, sources: [] } });
    expect(savePersistedAnswerThread("user-a", thread)).toBe(true);
    expect(storage.get(`${answerThreadStorageKey}:user-a`)).not.toContain("private-reason");
    expect(loadPersistedAnswerThread("user-a")?.latestTurn?.answer.degradedMode?.reason).toBe(reason);
  });

  it("R3 preserves demo disclosure without storing feedback credentials", () => {
    const answer = {
      ...sampleAnswer,
      demoMode: true,
      fallbackMode: "non_production_demo",
      interactionId: "private-interaction",
      feedbackToken: "private-token",
      bestSource: null,
    } as const;
    const thread = createSampleThread({ priorTurns: [], latestTurn: { query: "Question", answer, sources: [] } });
    expect(savePersistedAnswerThread("user-a", thread)).toBe(true);
    const restored = loadPersistedAnswerThread("user-a")?.latestTurn?.answer;
    expect(restored).toMatchObject({ demoMode: true, fallbackMode: "non_production_demo", bestSource: null });
    expect(storage.get(`${answerThreadStorageKey}:user-a`)).not.toMatch(/private-interaction|private-token/);
  });

  it.each([{ fallbackReasonCode: "private-reason" }, { answerSections: { owner_id: "private" } }])(
    "R3 refuses malformed saved answer %j",
    (fields) => {
      const thread = createSampleThread({
        priorTurns: [],
        latestTurn: { query: "Question", answer: { ...sampleAnswer, ...fields } as unknown as RagAnswer, sources: [] },
      });
      expect(savePersistedAnswerThread("user-a", thread)).toBe(false);
      storage.set(`${answerThreadStorageKey}:user-a`, JSON.stringify(thread));
      expect(loadPersistedAnswerThread("user-a")).toBeNull();
    },
  );

  it("round-trips an exact-match completed thread without extending its expiry", () => {
    const sampleThread = createSampleThread({ showEarlierTurns: true });
    expect(savePersistedAnswerThread("user-a", sampleThread)).toBe(true);
    expect(
      loadPersistedAnswerThread("user-a", {
        expectedSubmissionSignature: sampleThread.latestSubmissionSignature,
      }),
    ).toEqual(sampleThread);
    expect(loadPersistedAnswerThread("user-b")).toBeNull();

    const raw = JSON.parse(storage.get(`${answerThreadStorageKey}:user-a`) ?? "{}");
    expect(raw.expiresAt).toBe(sampleThread.expiresAt);
    expect(raw).not.toHaveProperty("savedAt");
  });

  it("scopes snapshots to accounts or the resolved current-tab guest", () => {
    expect(
      resolveAnswerThreadOwnerId({
        userId: "user-a",
        demoMode: false,
        demoOwnerId: "demo-owner",
        authStatus: "authenticated",
      }),
    ).toBe("user-a");
    expect(
      resolveAnswerThreadOwnerId({
        demoMode: true,
        demoOwnerId: "demo-owner",
        authStatus: "unconfigured",
      }),
    ).toBe("demo-owner");
    for (const authStatus of ["unconfigured", "signed_out", "expired", "error"] as const) {
      expect(resolveAnswerThreadOwnerId({ demoMode: false, demoOwnerId: "demo-owner", authStatus })).toBe(
        "guest-tab-session",
      );
    }
    expect(
      resolveAnswerThreadOwnerId({ demoMode: false, demoOwnerId: "demo-owner", authStatus: "loading" }),
    ).toBeNull();
  });

  it("leaves a valid thread in place when the returned URL signature does not match", () => {
    const sampleThread = createSampleThread();
    savePersistedAnswerThread("user-a", sampleThread);

    expect(
      loadPersistedAnswerThread("user-a", {
        expectedSubmissionSignature: "answer:what about renal impairment?:queryMode=compare_guidance",
      }),
    ).toBeNull();
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(true);
    expect(loadPersistedAnswerThread("user-a")).toEqual(sampleThread);
  });

  it("restores the latest thread on the unsubmitted answer home", () => {
    const sampleThread = createSampleThread();
    savePersistedAnswerThread("guest-tab-session", sampleThread);
    expect(loadPersistedAnswerThread("guest-tab-session")).toEqual(sampleThread);
  });

  it("clears stored thread state", () => {
    savePersistedAnswerThread("user-a", createSampleThread());
    clearPersistedAnswerThread();
    expect([...storage.keys()].some((key) => key.startsWith(answerThreadStorageKey))).toBe(false);
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
  });

  it("clears only the active owner's thread when an owner is provided", () => {
    const sampleThread = createSampleThread();
    savePersistedAnswerThread("user-a", sampleThread);
    savePersistedAnswerThread("user-b", sampleThread);
    storage.set(answerThreadStorageKey, JSON.stringify(sampleThread));

    clearPersistedAnswerThread("user-a");

    expect(storage.has(answerThreadStorageKey)).toBe(false);
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(loadPersistedAnswerThread("user-b")).toEqual(sampleThread);
  });

  it("purges invalid and corrupt persisted payloads", () => {
    storage.set(`${answerThreadStorageKey}:user-a`, JSON.stringify({ version: 3 }));
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(false);

    storage.set(`${answerThreadStorageKey}:user-a`, "{not-json");
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(false);
  });

  it("reprojects restored sources and canonicalizes persisted degradation reasons", () => {
    const unsafeSource = {
      id: "chunk-unsafe",
      document_id: "doc-unsafe",
      title: "Lithium guideline",
      file_name: "lithium.pdf",
      page_number: 2,
      chunk_index: 1,
      section_heading: "Renal monitoring",
      content: "Monitor renal function.",
      image_ids: [],
      similarity: 0.9,
      source_metadata: {
        publisher: "WA Health",
        jurisdiction: "Australia/WA",
        document_status: "current",
        clinical_validation_status: "approved",
        extraction_quality: "good",
        uploaded_by: "private-uploader-id",
        content_hash: "a".repeat(64),
        clinical_validation_evidence: { reviewer_id: "private-reviewer-id" },
      },
      document_labels: [
        {
          id: "private-label-id",
          document_id: "doc-unsafe",
          owner_id: "private-owner-id",
          label: "lithium",
          label_type: "medication",
          source: "manual",
          confidence: 1,
          metadata: { reviewer_id: "private-label-reviewer-id" },
        },
      ],
      score_explanation: { rankScore: 0.9, evidence: { owner_id: "private-score-owner" } },
      match_explanation: { reasons: ["private-match-reason"] },
      indexing_quality: { metrics: { reviewer_id: "private-index-reviewer" } },
    };
    const persisted = createSampleThread({
      latestTurn: {
        query: "what about renal impairment?",
        answer: {
          ...sampleAnswer,
          citations: [
            {
              chunk_id: unsafeSource.id,
              document_id: unsafeSource.document_id,
              title: unsafeSource.title,
              file_name: unsafeSource.file_name,
              page_number: unsafeSource.page_number,
              chunk_index: unsafeSource.chunk_index,
              source_metadata: unsafeSource.source_metadata,
            },
          ],
          sources: [unsafeSource],
          fallbackReasonCode: "provider_timeout",
          degradedMode: { active: true, reason: "private socket host token=secret" },
        } as never,
        sources: [unsafeSource] as never,
      },
    });
    storage.set(`${answerThreadStorageKey}:user-a`, JSON.stringify(persisted));

    const restored = loadPersistedAnswerThread("user-a");
    expect(restored?.latestTurn?.answer.degradedMode).toEqual({
      active: true,
      reason: "Answer generation timed out; the verified source-backed portion is shown.",
    });
    expect(restored?.latestTurn?.sources[0].document_labels).toEqual([
      { label: "lithium", label_type: "medication", source: "manual", confidence: 1 },
    ]);
    expect(restored?.latestTurn?.answer.citations[0].source_metadata).toEqual(
      restored?.latestTurn?.sources[0].source_metadata,
    );
    expect(JSON.stringify(restored)).not.toMatch(
      /private socket|token=secret|private-uploader|content_hash|private-reviewer|private-label-id|private-owner|private-score|private-match|private-index/,
    );
  });

  it("expires and purges threads once the completed-answer TTL has elapsed", () => {
    const expiredThread = createSampleThread({ expiresAt: Date.now() - 1 });
    storage.set(`${answerThreadStorageKey}:user-a`, JSON.stringify(expiredThread));
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(false);
    expect(savePersistedAnswerThread("user-a", expiredThread)).toBe(false);
  });

  it("rejects an expiry beyond the 12-hour privacy boundary", () => {
    const overlongThread = createSampleThread({ expiresAt: Date.now() + answerThreadTtlMs + 60_000 });
    storage.set(`${answerThreadStorageKey}:user-a`, JSON.stringify(overlongThread));
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(savePersistedAnswerThread("user-a", overlongThread)).toBe(false);
  });

  it("drops an oversized snapshot instead of leaving an older answer behind", () => {
    savePersistedAnswerThread("user-a", createSampleThread());
    const oversizedAnswer = { ...sampleAnswer, answer: "ü".repeat(2_300_000) };
    const oversizedThread = createSampleThread({
      latestTurn: { query: "large answer", answer: oversizedAnswer, sources: [] },
      latestSubmissionSignature: "answer:large answer:",
    });

    expect(savePersistedAnswerThread("user-a", oversizedThread)).toBe(false);
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(false);
  });

  it("R3 rejects a malformed latest answer without saving its valid prior under the new signature", () => {
    expect(savePersistedAnswerThread("user-a", createSampleThread())).toBe(true);
    const malformed = createSampleThread({
      latestTurn: { query: "new question", answer: { ...sampleAnswer, confidence: "invalid" } as never, sources: [] },
      latestSubmissionSignature: "answer:new question:",
    });
    expect(savePersistedAnswerThread("user-a", malformed)).toBe(false);
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(false);
  });

  it("R3 rejects a total-byte oversized snapshot made of valid bounded answers", () => {
    expect(savePersistedAnswerThread("user-a", createSampleThread())).toBe(true);
    const largeAnswer = { ...sampleAnswer, answer: "ü".repeat(195_000) };
    const oversized = createSampleThread({
      priorTurns: Array.from({ length: maxStoredAnswerTurns - 1 }, (_, index) => ({
        id: `turn-${index}`,
        query: `question ${index}`,
        answer: largeAnswer,
        sources: [],
      })),
      latestTurn: { query: "large answer", answer: largeAnswer, sources: [] },
    });
    expect(
      savePersistedAnswerThread("user-a", createSampleThread({ priorTurns: [], latestTurn: oversized.latestTurn })),
    ).toBe(true);
    expect(savePersistedAnswerThread("user-a", oversized)).toBe(false);
    expect(storage.has(`${answerThreadStorageKey}:user-a`)).toBe(false);
  });

  it("drops legacy version 1 threads but keeps version 2 threads, capping their support label", () => {
    const key = `${answerThreadStorageKey}:user-a`;
    const v1Thread = {
      version: 1,
      priorTurns: createSampleThread().priorTurns,
      latestTurn: createSampleThread().latestTurn,
      collapsedTurnIds: ["answer-turn-1"],
      savedAt: Date.now(),
    };
    storage.set(key, JSON.stringify(v1Thread));
    expect(
      loadPersistedAnswerThread("user-a", {
        expectedSubmissionSignature: "answer:what about renal impairment?:",
      }),
    ).toBeNull();
    expect(storage.has(key)).toBe(false);

    const v2Thread = {
      ...createSampleThread(),
      version: 2,
    };
    storage.set(key, JSON.stringify(v2Thread));
    const restoredV2 = loadPersistedAnswerThread("user-a", {
      expectedSubmissionSignature: "answer:what about renal impairment?:",
    });
    expect(restoredV2?.version).toBe(3);
    expect(restoredV2?.priorTurns).toHaveLength(v2Thread.priorTurns.length);
    expect(storage.has(key)).toBe(true);

    // A v2 answer written before the flag existed is kept with the conservative cap.
    const latest = createSampleThread().latestTurn!;
    const { strongSupportLabelCapped: _dropped, ...answerWithoutFlag } = latest.answer as unknown as Record<
      string,
      unknown
    >;
    void _dropped;
    storage.set(key, JSON.stringify({ ...v2Thread, latestTurn: { ...latest, answer: answerWithoutFlag } }));
    const restoredUncapped = loadPersistedAnswerThread("user-a", {
      expectedSubmissionSignature: "answer:what about renal impairment?:",
    });
    expect(restoredUncapped?.latestTurn?.answer.strongSupportLabelCapped).toBe(true);
  });

  it("discards version 3 turns lacking strongSupportLabelCapped and version 1 threads", () => {
    const key = `${answerThreadStorageKey}:user-a`;
    const uncappedAnswer = {
      answer: "Legacy cached answer text.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    };

    // Stored turn without strongSupportLabelCapped returns null
    expect(
      normalizeStoredAnswerTurn({
        id: "turn-legacy",
        query: "lithium",
        answer: uncappedAnswer,
        sources: [],
      }),
    ).toBeNull();

    // Latest turn without strongSupportLabelCapped returns null
    expect(
      normalizeLatestTurn({
        query: "lithium",
        answer: uncappedAnswer,
        sources: [],
      }),
    ).toBeNull();

    // Invalid non-boolean strongSupportLabelCapped also returns null
    expect(
      normalizeStoredAnswerTurn({
        id: "turn-legacy",
        query: "lithium",
        answer: { ...uncappedAnswer, strongSupportLabelCapped: "invalid" },
        sources: [],
      }),
    ).toBeNull();

    // normalizePersistedAnswerThread rejects version 1 (version 2 is upgraded, see above)
    expect(
      normalizePersistedAnswerThread({
        version: 1,
        priorTurns: [],
        latestTurn: createSampleThread().latestTurn,
      }),
    ).toBeNull();

    // A thread whose latestTurn lacks strongSupportLabelCapped is purged from storage
    const threadWithUncappedLatest = {
      ...createSampleThread(),
      latestTurn: {
        query: "what about renal impairment?",
        answer: uncappedAnswer,
        sources: [],
      },
    };
    storage.set(key, JSON.stringify(threadWithUncappedLatest));
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(storage.has(key)).toBe(false);

    // Prior turns lacking strongSupportLabelCapped are discarded while valid turns are retained
    const validTurn = {
      id: "turn-valid",
      query: "valid query",
      answer: sampleAnswer,
      sources: [],
    };
    const threadWithMixedPriors = {
      ...createSampleThread(),
      priorTurns: [
        {
          id: "turn-legacy",
          query: "legacy query",
          answer: uncappedAnswer,
          sources: [],
        },
        validTurn,
      ],
    };
    storage.set(key, JSON.stringify(threadWithMixedPriors));
    const restored = loadPersistedAnswerThread("user-a");
    expect(restored).not.toBeNull();
    expect(restored?.priorTurns).toHaveLength(1);
    expect(restored?.priorTurns[0].id).toBe("turn-valid");
  });

  it("keeps no more than 12 completed turns including the latest", () => {
    const priorTurns = Array.from({ length: 20 }, (_, index) => ({
      id: `answer-turn-${index + 1}`,
      query: `question ${index + 1}`,
      answer: sampleAnswer,
      sources: [],
    }));
    savePersistedAnswerThread("user-a", createSampleThread({ priorTurns }));
    const restored = loadPersistedAnswerThread("user-a");
    expect(restored?.priorTurns).toHaveLength(maxStoredAnswerTurns - 1);
    expect(restored?.priorTurns[0]?.id).toBe("answer-turn-10");
  });

  it("keeps blocked storage non-blocking", () => {
    vi.stubGlobal("window", {
      localStorage: {
        removeItem() {
          throw new Error("blocked");
        },
      },
      sessionStorage: {
        get length() {
          throw new Error("blocked");
        },
        getItem() {
          throw new Error("blocked");
        },
        setItem() {
          throw new Error("blocked");
        },
        removeItem() {
          throw new Error("blocked");
        },
      },
    });
    expect(loadPersistedAnswerThread("user-a")).toBeNull();
    expect(savePersistedAnswerThread("user-a", createSampleThread())).toBe(false);
    expect(() => clearPersistedAnswerThread()).not.toThrow();
  });
});
