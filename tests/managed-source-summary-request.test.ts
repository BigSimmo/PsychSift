import { afterEach, describe, expect, it, vi } from "vitest";

async function syntheticIngestionEgress(overrides = {}) {
  return (await import("./helpers/synthetic-ingestion-egress")).syntheticIngestionEgress(overrides);
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const generationId = uuid(2);
function source() {
  return {
    document: {
      id: uuid(1),
      title: "Synthetic workflow",
      file_name: "synthetic.pdf",
      source_path: "synthetic.pdf",
      metadata: { index_generation_id: uuid(3), public_corpus: true },
    },
    indexGenerationId: generationId,
    chunks: [
      {
        id: uuid(4),
        index_generation_id: generationId,
        page_number: 1,
        chunk_index: 0,
        section_heading: null,
        content: "Use the synthetic workflow checklist.",
      },
    ],
    images: [],
  };
}

function publicMetadata() {
  const hash = `sha256:${"a".repeat(64)}`;
  return {
    corpus_scope: "australian_public",
    source_catalogue_key: "synthetic-guideline",
    source_policy_version: "australian-source-policy-v1",
    source_policy_digest: "sha256:02dcc095258338d0c355af79dfa1889c024f25f385b553e5b6c802207546855d",
    content_mode: "indexed_content",
    licence_policy: "public_index_permitted",
    public_source_lifecycle: "shadow",
    source_policy_checked: true,
    content_identity_verdict: "clear",
    content_identity_verdict_version: "public-source-content-identity-v1",
    content_identity_hash: hash,
    content_hash: hash,
    source_content_hash: hash,
    source_exact_url: "https://example.test/synthetic.pdf",
    source_exact_version: "synthetic-v1",
    licence_evidence_digest: hash,
  };
}

function modelOutput(chunkId = uuid(4)) {
  return {
    summary: "Synthetic workflow overview.",
    clinical_specifics: {
      profile: {
        overview: "Synthetic workflow overview.",
        applies_to: [],
        key_clinical_actions: [
          {
            text: "Use the synthetic workflow checklist.",
            source_chunk_ids: [chunkId],
            source_image_ids: [],
            evidence_type: "text",
            support: "direct",
          },
        ],
        medication_dose_monitoring: [],
        thresholds_timing: [],
        escalation_risk_warnings: [],
        required_forms_documentation: [],
        not_covered: [],
        important_tables_images: [],
        best_questions: [],
        source_quality_notes: [],
      },
      actions: [],
      thresholds_timing: [],
      medication_monitoring: [],
      risk_escalation: [],
      documentation_forms: [],
      exceptions_gaps: [],
    },
    labels: [{ label: "synthetic workflow", label_type: "workflow", confidence: 0.9 }],
  };
}

function mockTransport(output: unknown = modelOutput()) {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "resp_synthetic",
          object: "response",
          status: "completed",
          model: "gpt-5.6-sol-synthetic-snapshot",
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: JSON.stringify(output), annotations: [] }],
            },
          ],
        }),
        { headers: { "content-type": "application/json", "x-request-id": "synthetic-request-id" } },
      );
    }),
  );
  vi.stubEnv("OPENAI_API_KEY", "synthetic-test-key");
  return bodies;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("managed candidate source summary request", () => {
  it("prepares a candidate without active promotion, then dispatches its exact body and returns source-anchored output without persistence", async () => {
    const bodies = mockTransport();
    const { prepareCandidateSourceAnchoredSummary, generateCandidateSourceAnchoredSummary } =
      await import("../src/lib/document-enrichment");
    const input = source();
    const plan = prepareCandidateSourceAnchoredSummary(input);
    expect(plan.documentId).toBe(uuid(1));
    expect(plan.indexGenerationId).toBe(generationId);
    expect(JSON.parse(plan.requestBody)).toMatchObject({
      metadata: { operation: "summary" },
      prompt_cache_key: "clinical-document-enrichment-v1",
      text: { format: { name: "clinical_document_enrichment", strict: true } },
    });
    const payload = await generateCandidateSourceAnchoredSummary(plan, {
      ingestionEgress: await syntheticIngestionEgress({ documentId: uuid(1), generationId }),
    });
    expect(bodies).toEqual([plan.requestBody]);
    expect(payload).toMatchObject({
      summary_kind: "structured",
      document_id: uuid(1),
      index_generation_id: generationId,
      heuristic_fallback: false,
      source_chunk_ids: [uuid(4)],
      source_image_ids: [],
    });
    expect(payload.clinical_specifics.profile.key_clinical_actions[0]).toMatchObject({
      source_chunk_ids: [uuid(4)],
      pages: [1],
    });
  });

  it("rejects protected public-source image evidence before a body can be authorized", async () => {
    const bodies = mockTransport();
    const { prepareCandidateSourceAnchoredSummary } = await import("../src/lib/document-enrichment");
    const input = source();
    expect(() =>
      prepareCandidateSourceAnchoredSummary({
        ...input,
        document: { ...input.document, metadata: publicMetadata() },
        images: [
          {
            id: uuid(5),
            index_generation_id: generationId,
            page_number: 1,
            caption: "Healthdirect protected synthetic evidence",
          },
        ],
      }),
    ).toThrow("protected_source_identity");
    expect(bodies).toEqual([]);
  });

  it("rejects a source row bound to another document", async () => {
    const { prepareCandidateSourceAnchoredSummary } = await import("../src/lib/document-enrichment");
    const input = source();
    expect(() =>
      prepareCandidateSourceAnchoredSummary({ ...input, chunks: [{ ...input.chunks[0], document_id: uuid(99) }] }),
    ).toThrow("source_anchored_summary_source_document_mismatch");
  });

  it.each(["missing", "mixed"])("rejects %s source generation before preparing any request", async (kind) => {
    const { prepareCandidateSourceAnchoredSummary } = await import("../src/lib/document-enrichment");
    const input = source();
    expect(() =>
      prepareCandidateSourceAnchoredSummary({
        ...input,
        chunks: [{ ...input.chunks[0], index_generation_id: kind === "missing" ? undefined : uuid(99) }],
      }),
    ).toThrow("source_anchored_summary_source_generation_mismatch");
  });

  it("rejects an image from another generation", async () => {
    const { prepareCandidateSourceAnchoredSummary } = await import("../src/lib/document-enrichment");
    expect(() =>
      prepareCandidateSourceAnchoredSummary({
        ...source(),
        images: [{ id: uuid(5), index_generation_id: uuid(99), page_number: 1, caption: "Synthetic table" }],
      }),
    ).toThrow("source_anchored_summary_source_generation_mismatch");
  });

  it("keeps late evidence in the coverage-selected prompt and its anchor authority", async () => {
    const { prepareCandidateSourceAnchoredSummary } = await import("../src/lib/document-enrichment");
    const input = source();
    const chunks = Array.from({ length: 90 }, (_, index) => ({
      ...input.chunks[0],
      id: uuid(100 + index),
      chunk_index: index,
      page_number: index + 1,
      content:
        index === 89
          ? "Urgent review of synthetic late threshold below 3.5 is required."
          : "Synthetic background material.",
    }));
    const plan = prepareCandidateSourceAnchoredSummary({ ...input, chunks });
    expect(plan.authority.selectedChunks).toContainEqual(expect.objectContaining({ id: uuid(189), page_number: 90 }));
    expect(JSON.parse(plan.requestBody).input).toContain(
      "Urgent review of synthetic late threshold below 3.5 is required.",
    );
    expect(plan.authority.selectedChunks.length).toBeLessThanOrEqual(36);
  });

  it("captures immutable evidence and refuses copied plans", async () => {
    const bodies = mockTransport();
    const { prepareCandidateSourceAnchoredSummary, generateCandidateSourceAnchoredSummary } =
      await import("../src/lib/document-enrichment");
    const input = source();
    const plan = prepareCandidateSourceAnchoredSummary(input);
    input.chunks[0].content = "Changed after preparation.";
    input.document.title = "Changed title.";
    expect(Object.isFrozen(plan.authority.selectedChunks[0])).toBe(true);
    expect(Reflect.set(plan, "requestBody", "{}")).toBe(false);
    const ingestionEgress = await syntheticIngestionEgress();
    await expect(generateCandidateSourceAnchoredSummary({ ...plan }, { ingestionEgress })).rejects.toThrow(
      "source_anchored_summary_plan_invalid",
    );
    await generateCandidateSourceAnchoredSummary(plan, { ingestionEgress });
    expect(bodies).toEqual([plan.requestBody]);
    expect(bodies[0]).not.toContain("Changed after preparation.");
  });

  it("returns observed provider evidence separately from requested identity", async () => {
    mockTransport();
    const { prepareCandidateSourceAnchoredSummary, generateCandidateSourceAnchoredSummaryResult } =
      await import("../src/lib/document-enrichment");
    const result = await generateCandidateSourceAnchoredSummaryResult(prepareCandidateSourceAnchoredSummary(source()), {
      ingestionEgress: await syntheticIngestionEgress(),
    });
    expect(result.payload.heuristic_fallback).toBe(false);
    expect(result.providerEvidence).toMatchObject({
      requestedModel: result.payload.model,
      providerModel: "gpt-5.6-sol-synthetic-snapshot",
      requestId: "synthetic-request-id",
    });
    expect(result.providerEvidence.usage).toBeUndefined();
  });

  it("refuses unselected model anchors without returning a heuristic replacement", async () => {
    const bodies = mockTransport(modelOutput(uuid(99)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { prepareCandidateSourceAnchoredSummary, generateCandidateSourceAnchoredSummary } =
        await import("../src/lib/document-enrichment");
      await expect(
        generateCandidateSourceAnchoredSummary(prepareCandidateSourceAnchoredSummary(source()), {
          ingestionEgress: await syntheticIngestionEgress(),
        }),
      ).rejects.toThrow("source_anchored_summary_generation_failed");
      expect(bodies).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
