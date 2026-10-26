import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  authorityTrustCapRequired,
  toClientAnswerPayload,
  projectClientAnswerPayload,
  type ClientRagAnswerPayload,
  type ClientSearchResult,
} from "@/lib/answer-client-payload";
import { buildGovernedAnswerClientResponse, buildGovernedDemoAnswerClientResponse } from "@/lib/answer-response";
import { isAnswerPayload } from "@/components/clinical-dashboard/search-utils";
import { buildAnswerRenderModel } from "@/lib/answer-render-policy";
import { extractSafetyFindings } from "@/lib/clinical-safety";
import { issueContextPackAdmissionReceipt } from "@/lib/rag/rag-context-admission";
import type { RagAnswer, SearchResult } from "@/lib/types";

function fullSource(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Clozapine monitoring guideline",
    file_name: "clozapine.pdf",
    page_number: 4,
    chunk_index: 7,
    section_heading: "Monitoring",
    content: "Full blood count weekly for 18 weeks. ".repeat(60),
    retrieval_synopsis: "FBC weekly for 18 weeks, then monthly.",
    image_ids: [],
    similarity: 0.82,
    corpus_scope: "clinical_kb_site",
    site_content_domain: "medications",
    context_pack_admission: issueContextPackAdmissionReceipt({
      ownerId: null,
      sourcePolicyVersion: "source-policy-v1",
      indexGeneration: null,
      document: null,
      siteContent: {
        releaseId: "12345678-1234-5678-9234-123456789abc",
        releaseDigest: "a".repeat(64),
        changeEpoch: "7",
      },
    }),
    source_metadata: { document_status: "current" } as SearchResult["source_metadata"],
    adjacent_context: "Preceding paragraph context. ".repeat(20),
    document_summary: "A long document summary. ".repeat(30),
    memory_cards: [{ id: "m1" } as never],
    table_facts: [{ id: "t1" } as never],
    index_unit: { unit_type: "table" } as never,
    ...overrides,
  } as SearchResult;
}

function answerWith(sources: SearchResult[]): RagAnswer {
  return {
    answer: "Use the cited source.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources,
  };
}

// #WGMB4Z decision 17 (owner, 2026-09-25): the all-claims rule governs the displayed
// support word only. authorityTrustCapRequired - which lowers render trust and so hides
// quote cards, related documents and tables - keeps main's semantics exactly: high-risk
// claims only unless NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS is exactly "true", and no gated
// claims means no cap.
describe("authorityTrustCapRequired truth table (main semantics)", () => {
  type Claims = NonNullable<RagAnswer["supportedClaims"]>;
  type Authority = "unverified" | "locally_reviewed" | "approved";
  const claim = (riskClass: "routine" | "high_risk", supportStatus: "direct" | "partial" = "direct") => ({
    claimId: `claim-${riskClass}`,
    text: "Document the review date.",
    riskClass,
    supportingChunkIds: ["chunk-1"],
    supportStatus,
  });
  const answerWithClaims = (claims: Claims | undefined, authority: Authority): RagAnswer => ({
    ...answerWith([]),
    supportedClaims: claims,
    evidenceAssessments: {
      "chunk-1": {
        relevance: "direct",
        claimSupport: "direct",
        authority,
        currency: "current",
        extractionQuality: "good",
      },
    },
  });
  // [label, claims, authority, capped when env is unset or anything but "true", capped when env is "true"]
  const cases: Array<[string, Claims | undefined, Authority, boolean, boolean]> = [
    ["no claims (undefined)", undefined, "unverified", false, false],
    ["no claims (empty)", [], "unverified", false, false],
    ["routine claim on unverified evidence", [claim("routine")] as Claims, "unverified", false, true],
    ["routine claim on locally reviewed evidence", [claim("routine")] as Claims, "locally_reviewed", false, false],
    ["partial routine claim on approved evidence", [claim("routine", "partial")] as Claims, "approved", false, true],
    ["high-risk claim on unverified evidence", [claim("high_risk")] as Claims, "unverified", true, true],
    ["high-risk claim on approved evidence", [claim("high_risk")] as Claims, "approved", false, false],
  ];
  it.each(cases)("%s", (_label, claims, authority, cappedByDefault, cappedWhenTrue) => {
    for (const [env, expected] of [
      [undefined, cappedByDefault],
      ["false", cappedByDefault],
      ["", cappedByDefault],
      ["True", cappedByDefault],
      ["true", cappedWhenTrue],
    ] as const) {
      vi.stubEnv("NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS", env);
      try {
        expect({ env, capped: authorityTrustCapRequired(answerWithClaims(claims, authority)) }).toEqual({
          env,
          capped: expected,
        });
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });
});

describe("toClientAnswerPayload", () => {
  it.each([
    {
      answer: "Clinical guidance. Synthetic demo only: Hidden review metadata",
      hidden: "Hidden review metadata",
      grounded: true,
      preformatted: undefined,
    },
    { answer: "Source excerpt: Clinical guidance.", hidden: "Source excerpt", grounded: true, preformatted: undefined },
    { answer: "Source excerpt: Clinical guidance.", hidden: "Source excerpt", grounded: false, preformatted: true },
  ])(
    "excludes hidden claim metadata with grounded=$grounded, preformatted=$preformatted: $hidden",
    ({ answer, hidden, grounded, preformatted }) => {
      const mark = {
        claimId: "hidden",
        text: hidden,
        supportStatus: "direct" as const,
        supportingChunkIds: ["chunk-1"],
      };
      const payload = toClientAnswerPayload({
        ...answerWith([fullSource()]),
        answer,
        grounded,
        preformatted,
        supportedClaims: [
          { ...mark, riskClass: "routine" },
          { ...mark, claimId: "visible", text: "Clinical guidance.", riskClass: "routine" },
        ],
      });
      expect(payload.claimMarks).toEqual([{ ...mark, claimId: "visible", text: "Clinical guidance." }]);
      expect(projectClientAnswerPayload(payload, true)).toEqual(payload);
      const poisoned = { ...payload, claimMarks: [...payload.claimMarks!, mark] };
      expect(projectClientAnswerPayload(poisoned)?.claimMarks).toEqual(payload.claimMarks);
      expect(projectClientAnswerPayload(poisoned, true)).toBeNull();
    },
  );

  it("retains claim text displayed by a grounded preformatted answer", () => {
    const mark = {
      claimId: "visible",
      text: "Source excerpt",
      supportStatus: "direct" as const,
      supportingChunkIds: ["chunk-1"],
    };
    const payload = toClientAnswerPayload({
      ...answerWith([fullSource()]),
      answer: "Source excerpt: Clinical guidance.",
      grounded: true,
      preformatted: true,
      supportedClaims: [{ ...mark, riskClass: "routine" }],
    });
    expect(payload.claimMarks).toEqual([mark]);
    expect(projectClientAnswerPayload(payload, true)).toEqual(payload);
  });

  it("projects only displayed, retained-source claim marks and a content-free currency warning", () => {
    const input: RagAnswer = {
      ...answerWith([fullSource()]),
      answer: "Use the cited source.",
      supportedClaims: [
        {
          claimId: "visible",
          text: "Use the cited source.",
          riskClass: "routine",
          supportStatus: "direct",
          supportingChunkIds: ["chunk-1"],
        },
        {
          claimId: "private",
          text: "PRIVATE_UNDISPLAYED_CLAIM",
          riskClass: "routine",
          supportStatus: "direct",
          supportingChunkIds: ["chunk-1"],
        },
        {
          claimId: "foreign",
          text: "Use the cited source.",
          riskClass: "routine",
          supportStatus: "direct",
          supportingChunkIds: ["private-chunk"],
        },
      ],
      evidenceAssessments: {
        "chunk-1": {
          relevance: "direct",
          claimSupport: "direct",
          authority: "approved",
          currency: "review_due",
          extractionQuality: "good",
        },
      },
    };
    const payload = toClientAnswerPayload(input);
    expect(payload.claimMarks).toEqual([
      { claimId: "visible", text: "Use the cited source.", supportStatus: "direct", supportingChunkIds: ["chunk-1"] },
    ]);
    expect(payload.sourceCurrencyWarning).toBe("supporting");
    expect(payload).not.toHaveProperty("supportedClaims");
    expect(payload).not.toHaveProperty("evidenceAssessments");
    expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_UNDISPLAYED_CLAIM|private-chunk|riskClass/);
    expect(projectClientAnswerPayload(JSON.parse(JSON.stringify(payload)), true)).toEqual(payload);
    const poisoned = { ...payload, claimMarks: [{ ...payload.claimMarks![0], supportingChunkIds: ["private-chunk"] }] };
    expect(projectClientAnswerPayload(poisoned, true)).toBeNull();
    expect(projectClientAnswerPayload(poisoned)?.claimMarks).toEqual([]);
    expect(
      projectClientAnswerPayload(
        { ...payload, claimMarks: [{ ...payload.claimMarks![0], privateOwner: "secret" }] },
        true,
      ),
    ).toBeNull();
  });
  it("P12A R1 accepts exact source_conflict vocabulary while rejecting unknown section kinds", () => {
    const section = {
      heading: "Source conflict",
      body: "Synthetic reviewed difference.",
      citation_chunk_ids: ["chunk-1"],
      kind: "source_conflict" as const,
    };
    const input = { ...answerWith([]), answerSections: [section] };
    const payload = toClientAnswerPayload(input);
    expect(payload.answerSections).toEqual([section]);
    for (const strict of [false, true]) {
      expect(projectClientAnswerPayload(payload, strict)?.answerSections).toEqual([section]);
      expect(
        projectClientAnswerPayload(
          { ...payload, answerSections: [{ ...section, kind: "unreviewed_conflict" }] },
          strict,
        ),
      ).toBeNull();
    }
  });
  it("P08C omits server diagnostics from both strict and reconstructed public payloads", () => {
    const input = {
      ...answerWith([]),
      ragDiagnostics: { query: "PRIVATE_CONTEXT_CANARY", required_part_count: 2, represented_part_count: 1 },
      openAIUsageAttempts: [{ model: "SERVER_MODEL_CANARY", usage: { input_tokens: 100 } }],
    };
    for (const strict of [true, false]) {
      const projected = projectClientAnswerPayload(
        JSON.parse(JSON.stringify(strict ? toClientAnswerPayload(input as unknown as RagAnswer) : input)),
        strict,
      );
      expect(projected).not.toBeNull();
      expect(projected).not.toHaveProperty("ragDiagnostics");
      expect(projected).not.toHaveProperty("openAIUsageAttempts");
      expect(JSON.stringify(projected)).not.toContain("SERVER_MODEL_CANARY");
      expect(JSON.stringify(projected)).not.toContain("PRIVATE_CONTEXT_CANARY");
      expect(projectClientAnswerPayload(input, true)).toBeNull();
    }
  });
  it.each(["retrievalGateBlocked", "authorityTrustCapRequired", "strongSupportLabelCapped"])(
    "FR4 rejects malformed optional safety boolean %s in both modes",
    (field) => {
      for (const strict of [false, true]) {
        for (const invalid of ["true", {}, null]) {
          expect(projectClientAnswerPayload({ ...answerWith([]), [field]: invalid }, strict)).toBeNull();
        }
        for (const valid of [true, false]) {
          expect(projectClientAnswerPayload({ ...answerWith([]), [field]: valid }, strict)).toMatchObject({
            [field]: valid,
          });
        }
      }
    },
  );

  it("R3 projects every nested citation carrier and rejects malformed public enums", () => {
    const src = fullSource();
    const citation = {
      chunk_id: src.id,
      document_id: src.document_id,
      title: src.title,
      file_name: src.file_name,
      page_number: src.page_number,
      chunk_index: src.chunk_index,
      provenance: null,
      source_metadata: {
        document_status: null,
        clinical_validation_status: null,
        extraction_quality: null,
        publisher: null,
        owner_id: "private-owner",
        evidence: { secret: true },
      },
    };
    const answer = {
      ...answerWith([{ ...src, source_strength: null, similarity_origin: null } as unknown as SearchResult]),
      citations: [citation],
      quoteCards: [{ ...citation, quote: "Review the source.", section_heading: null, source_strength: null }],
      bestSource: {
        ...citation,
        source_strength: "strong",
        score: 1,
        snippet: "Review the source.",
        quote: null,
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
    } as unknown as RagAnswer;
    const projected = toClientAnswerPayload(answer);
    expect(projected.citations[0].source_metadata).toEqual({ publisher: null });
    expect(projected.citations[0]).not.toHaveProperty("provenance");
    expect(projected.sources[0]).not.toHaveProperty("source_strength");
    expect(projected.bestSource).not.toHaveProperty("quote");
    expect(JSON.stringify(projected)).not.toContain("private-owner");
    expect(isAnswerPayload(JSON.parse(JSON.stringify(projected)))).toBe(true);
    expect(isAnswerPayload({ ...projected, answerSections: { owner_id: "private" } })).toBe(false);
    expect(isAnswerPayload({ ...projected, citations: [citation] })).toBe(false);
  });

  it("R3 derives server safety from source relevance before public projection", () => {
    const relevance = {
      verdict: "direct",
      label: "Direct",
      matchedTerms: ["unrelated"],
      missingTerms: [],
      directSourceCount: 1,
      weakSourceCount: 0,
      score: 1,
      supportReason: "Direct",
      isSourceBacked: true,
    } as const;
    const answer = {
      ...answerWith([
        fullSource({
          content: "Contraindicated in severe disease.",
          relevance: {
            ...relevance,
            matchedTerms: ["unrelated"],
            missingTerms: [],
            coverageScore: 1,
            rankScore: 1,
            titleMatchedTerms: [],
            contentMatchedTerms: [],
            metadataMatchedTerms: [],
            chips: [],
          },
        }),
      ]),
      relevance: { ...relevance, matchedTerms: ["unrelated"], missingTerms: [] },
    };
    const payload = buildGovernedAnswerClientResponse(answer).payload;
    expect(payload.safetyWarnings).toHaveLength(1);
    expect(payload.sources[0]).not.toHaveProperty("relevance");
    expect(extractSafetyFindings(payload)).toEqual(payload.safetyWarnings);
  });

  it("R3 projects related labels and structured fields without internal metadata", () => {
    const answer = {
      ...answerWith([fullSource()]),
      relatedDocuments: [
        {
          document_id: "doc-1",
          title: "Guideline",
          file_name: "guide.pdf",
          labels: [
            {
              label: "monitoring",
              label_type: "topic",
              source: "manual",
              confidence: 1,
              owner_id: "private-owner",
              metadata: { secret: true },
            },
          ],
          summary: null,
          best_pages: [4],
          best_chunk_ids: ["chunk-1"],
          image_count: 0,
          match_reason: "Direct support",
          score: 1,
        },
      ],
      answerSections: [
        {
          heading: "Monitoring",
          body: "Review the source.",
          citation_chunk_ids: ["chunk-1"],
          owner_id: "private-owner",
        },
      ],
    } as unknown as RagAnswer;
    const projected = toClientAnswerPayload(answer);
    expect(JSON.stringify(projected)).not.toContain("private-owner");
    expect(projected.relatedDocuments?.[0].document_id).toBe("doc-1");
    expect(projected.relatedDocuments?.[0].labels).toEqual([
      { label: "monitoring", label_type: "topic", source: "manual", confidence: 1 },
    ]);
    expect(projectClientAnswerPayload(projected, true)).toEqual(projected);
  });

  it.each([
    { answerSections: { owner_id: "private" } },
    { answerSections: [{ heading: "Heading", body: "Body", citation_chunk_ids: [], kind: "invented" }] },
    { routingMode: null },
    { relatedDocuments: [{ labels: { owner_id: "private" } }] },
    { sourceCoverage: { documents_used: -1, pages: [], strongest_similarity: 1, has_images: false } },
  ])("R3 rejects malformed structured payload %j", (fields) => {
    expect(projectClientAnswerPayload({ ...answerWith([]), ...fields }, true)).toBeNull();
    expect(projectClientAnswerPayload({ ...answerWith([]), ...fields })).toBeNull();
  });

  it.each([true, false])("R3 preserves explicit best-source withdrawal with retained source=%s", (retained) => {
    const answer: RagAnswer = {
      ...answerWith(retained ? [fullSource()] : []),
      bestSource: null,
      answerQualityTier: "source_only",
      routingMode: "extractive",
      supportedClaims: [
        {
          claimId: "claim-1",
          text: "Review source",
          riskClass: "routine",
          supportingChunkIds: ["chunk-1"],
          supportStatus: "direct",
        },
      ],
    };
    expect(toClientAnswerPayload(answer).bestSource).toBeNull();
  });

  it("R3 derives a best source only for eligible generated answers with absence", () => {
    const base: RagAnswer = {
      ...answerWith([fullSource()]),
      supportedClaims: [
        {
          claimId: "claim-1",
          text: "Review source",
          riskClass: "routine",
          supportingChunkIds: ["chunk-1"],
          supportStatus: "direct",
        },
      ],
    };
    expect(
      toClientAnswerPayload({ ...base, answerQualityTier: "source_only", routingMode: "extractive" }).bestSource,
    ).toBeUndefined();
    expect(
      toClientAnswerPayload({ ...base, answerQualityTier: "model_synthesis", routingMode: "strong" }).bestSource
        ?.chunk_id,
    ).toBe("chunk-1");
    expect(
      toClientAnswerPayload({ ...base, answerQualityTier: "model_synthesis", bestSource: null }).bestSource,
    ).toBeNull();
  });
  it("governs empty-source real and demo answers without requiring source fields", () => {
    const answer = {
      answer: "No source details.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
    } as RagAnswer;

    expect(buildGovernedAnswerClientResponse(answer).payload).toMatchObject({ sources: [], safetyWarnings: [] });
    expect(buildGovernedDemoAnswerClientResponse(answer)).toMatchObject({
      sources: [],
      safetyWarnings: [],
      demoMode: true,
    });
  });

  it("drops server-only per-source fields the client never renders", () => {
    const trimmed = toClientAnswerPayload(answerWith([fullSource()])).sources![0];
    expect(trimmed).not.toHaveProperty("adjacent_context");
    expect(trimmed).not.toHaveProperty("memory_cards");
    expect(trimmed).not.toHaveProperty("table_facts");
    expect(trimmed).not.toHaveProperty("index_unit");
    expect(trimmed).not.toHaveProperty("document_summary");
    expect(trimmed).not.toHaveProperty("corpus_scope");
    expect(trimmed).not.toHaveProperty("site_content_domain");
    expect(trimmed).not.toHaveProperty("context_pack_admission");
    expect(trimmed).not.toHaveProperty("images");
  });

  it("does not serialize bulky source image objects", () => {
    const image = {
      id: "image-1",
      storage_path: "private/source/page-4.png",
      metadata: { raw: "x".repeat(8_000) },
      table_markdown: `| heading |\n| --- |\n| ${"cell ".repeat(1_000)} |`,
    } as never;
    const source = fullSource({ image_ids: ["image-1"], images: [image] });
    const trimmed = toClientAnswerPayload(answerWith([source])).sources![0];

    expect(trimmed.image_ids).toEqual(["image-1"]);
    expect(trimmed).not.toHaveProperty("images");
    expect(JSON.stringify(trimmed)).not.toContain("private/source/page-4.png");
  });

  it("does not pass unclassified runtime fields through the route boundary", () => {
    const source = { ...fullSource(), future_server_secret: "private" } as SearchResult;
    const trimmed = toClientAnswerPayload(answerWith([source])).sources![0] as SearchResult & {
      future_server_secret?: string;
    };
    expect(trimmed.future_server_secret).toBeUndefined();
  });

  it("rejects restored private fields and preserves only projected transport exceptions", () => {
    const payload = toClientAnswerPayload(answerWith([fullSource()]));
    for (const key of ["ragDiagnostics", "supportedClaims", "routingReason", "futureServerSecret"]) {
      expect(projectClientAnswerPayload({ ...payload, [key]: "private" }, true)).toBeNull();
    }
    for (const key of ["context_pack_admission", "adjacent_context", "corpus_scope", "future_server_secret"]) {
      expect(
        projectClientAnswerPayload({ ...payload, sources: [{ ...payload.sources[0], [key]: "private" }] }, true),
      ).toBeNull();
    }

    const restored = projectClientAnswerPayload(
      {
        ...payload,
        interactionId: "transport-interaction",
        feedbackToken: "transport-feedback",
        degradedMode: { active: false, reason: null },
      },
      true,
    );
    expect(restored).toEqual({ ...payload, degradedMode: { active: false, reason: null } });
    expect(restored).not.toHaveProperty("interactionId");
    expect(restored).not.toHaveProperty("feedbackToken");
  });

  it("keeps identity, snippet, scoring, and governance fields intact", () => {
    const trimmed = toClientAnswerPayload(answerWith([fullSource()])).sources![0];
    expect(trimmed.id).toBe("chunk-1");
    expect(trimmed.title).toBe("Clozapine monitoring guideline");
    expect(trimmed.retrieval_synopsis).toBe("FBC weekly for 18 weeks, then monthly.");
    expect(trimmed.content).toBe("FBC weekly for 18 weeks, then monthly.");
    expect(trimmed.similarity).toBe(0.82);
    expect(trimmed.source_metadata).toEqual({ document_status: "current" });
    expect(trimmed.page_number).toBe(4);
  });

  it("recursively allowlists source, citation, label, and safety metadata", () => {
    // Deliberately malformed runtime metadata tests the server-boundary sanitizer.
    // It is not a valid private/server metadata fixture.
    const unsafeMetadata = {
      source_kind: "registry_record",
      registry_record_kind: "medication",
      registry_record_subkind: "monograph",
      registry_record_slug: "clozapine",
      registry_record_id: "private-record-id",
      source_title: "Clozapine monograph",
      publisher: "Clinical KB",
      jurisdiction: "Australia/WA",
      review_date: "2026-08-01",
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
      uploaded_by: "private-uploader-id",
      content_hash: "a".repeat(64),
      clinical_validation_evidence: { reviewer_id: "private-reviewer-id" },
      future_private_metadata: { owner_id: "private-owner-id" },
    } as unknown as SearchResult["source_metadata"];
    const result = buildGovernedAnswerClientResponse({
      ...answerWith([
        fullSource({
          source_metadata: unsafeMetadata,
          document_labels: [
            {
              id: "private-label-id",
              document_id: "private-label-document-id",
              owner_id: "private-label-owner-id",
              label: "clozapine",
              label_type: "medication",
              source: "manual",
              confidence: 0.9,
              metadata: { reviewer_id: "private-label-reviewer-id" },
            },
          ],
          score_explanation: { rankScore: 0.9, evidence: { owner_id: "private-score-owner" } } as never,
          match_explanation: { reasons: ["private-match-reason"], evidence: "private-match-evidence" } as never,
          indexing_quality: {
            document_id: "private-index-document-id",
            owner_id: "private-index-owner-id",
            quality_score: 0.9,
            extraction_quality: "good",
            metrics: { reviewer_id: "private-index-reviewer-id" },
            issues: [],
          },
        }),
      ]),
      citations: [
        {
          chunk_id: "chunk-1",
          document_id: "doc-1",
          title: "Clozapine monitoring guideline",
          file_name: "clozapine.pdf",
          page_number: 4,
          chunk_index: 7,
          source_metadata: unsafeMetadata,
        },
      ],
    });

    expect(result.payload.sources[0]).toMatchObject({
      source_metadata: {
        source_kind: "registry_record",
        registry_record_kind: "medication",
        registry_record_subkind: "monograph",
        registry_record_slug: "clozapine",
        publisher: "Clinical KB",
        jurisdiction: "Australia/WA",
        document_status: "current",
        clinical_validation_status: "approved",
        extraction_quality: "good",
      },
      document_labels: [{ label: "clozapine", label_type: "medication", source: "manual", confidence: 0.9 }],
    });
    expect(result.payload.citations[0].source_metadata).toEqual(result.payload.sources[0].source_metadata);
    expect(result.payload.sources[0]).not.toHaveProperty("score_explanation");
    expect(result.payload.sources[0]).not.toHaveProperty("match_explanation");
    expect(result.payload.sources[0]).not.toHaveProperty("indexing_quality");
    expect(JSON.stringify(result.payload)).not.toMatch(
      /private-record-id|private-uploader-id|content_hash|private-reviewer-id|private-owner-id|private-label-id|private-label-owner-id|private-score-owner|private-match-evidence|private-index-owner/,
    );
  });

  it("derives safety warnings before replacing full source content with the rendered snippet", () => {
    const source = fullSource({ content: `${"Routine context. ".repeat(60)}Contraindicated in severe disease.` });
    const response = buildGovernedAnswerClientResponse({
      answer: "Review the source.",
      grounded: true,
      confidence: "medium",
      citations: [],
      sources: [source],
    } as RagAnswer);
    const payload = response.payload;

    expect(payload.sources![0].content).toBe(source.retrieval_synopsis);
    expect(payload.sources![0].content.length).toBeLessThan(source.content.length);
    expect(payload.safetyWarnings).toHaveLength(1);
    // Issue 9: governance provenance is retained on safety-finding citations so the
    // safety panel can badge outdated / review-due / unverified sources, consistent
    // with regular source citations (which already keep source_metadata).
    expect(payload.safetyWarnings![0].citation).toHaveProperty("source_metadata", { document_status: "current" });
    expect(extractSafetyFindings(payload)).toHaveLength(1);
  });

  it("leaves short content untouched", () => {
    const short = fullSource({ content: "Short snippet.", retrieval_synopsis: undefined });
    expect(toClientAnswerPayload(answerWith([short])).sources![0].content).toBe("Short snippet.");
  });

  it("does not mutate the original answer (caches keep the full sources)", () => {
    const source = fullSource();
    const answer = answerWith([source]);
    toClientAnswerPayload(answer);
    expect(answer.sources![0].adjacent_context).toBeTruthy();
    expect(answer.sources![0].content.length).toBeGreaterThan(700);
  });

  it("projects answers without sources instead of returning the server object", () => {
    const empty = {
      ...answerWith([]),
      routingReason: "server-only-routing",
      futureServerSecret: "must-not-cross-boundary",
    } as RagAnswer & { futureServerSecret: string };
    expect(toClientAnswerPayload(empty)).toEqual({
      answer: "Use the cited source.",
      grounded: true,
      confidence: "high",
      citations: [],
      sources: [],
      retrievalGateBlocked: false,
      authorityTrustCapRequired: false,
      // #WGMB4Z decision 17: no assessed claims never earns the "Strong support" label.
      strongSupportLabelCapped: true,
    });
    expect(toClientAnswerPayload(empty)).not.toBe(empty);
  });

  it("returns an explicit allowlisted client type without private answer fields", () => {
    const payload = toClientAnswerPayload(answerWith([]));

    expectTypeOf(payload).toEqualTypeOf<ClientRagAnswerPayload>();
    expectTypeOf(payload).not.toHaveProperty("routingReason");
    expectTypeOf(payload).not.toHaveProperty("fallbackReason");
    expectTypeOf(payload).not.toHaveProperty("retrievalDiagnostics");
    expectTypeOf(payload).not.toHaveProperty("supportedClaims");
    expectTypeOf(payload).not.toHaveProperty("evidenceAssessments");
    expectTypeOf(payload).not.toHaveProperty("smartPanel");
    expectTypeOf(payload).not.toHaveProperty("smartApiPlan");

    type ClientSource = ClientRagAnswerPayload["sources"][number];
    type ClientMetadata = NonNullable<ClientSource["source_metadata"]>;
    type ClientLabel = NonNullable<ClientSource["document_labels"]>[number];
    type ClientScope = NonNullable<ClientRagAnswerPayload["scope"]>;
    expectTypeOf<ClientSource>().not.toHaveProperty("adjacent_context");
    expectTypeOf<ClientSource>().not.toHaveProperty("context_pack_admission");
    expectTypeOf<ClientSource>().not.toHaveProperty("document_summary");
    expectTypeOf<ClientSource>().not.toHaveProperty("memory_cards");
    expectTypeOf<ClientSource>().not.toHaveProperty("table_facts");
    expectTypeOf<ClientSource>().not.toHaveProperty("index_unit");
    expectTypeOf<ClientSource>().not.toHaveProperty("corpus_scope");
    expectTypeOf<ClientSource>().not.toHaveProperty("site_content_domain");
    expectTypeOf<ClientSource>().not.toHaveProperty("images");
    expectTypeOf<ClientSource>().not.toHaveProperty("score_explanation");
    expectTypeOf<ClientSource>().not.toHaveProperty("match_explanation");
    expectTypeOf<ClientSource>().not.toHaveProperty("indexing_quality");
    expectTypeOf<ClientSource>().not.toHaveProperty("memory_score");
    expectTypeOf<ClientSource>().not.toHaveProperty("relevance");
    expectTypeOf<ClientMetadata>().not.toHaveProperty("registry_record_id");
    expectTypeOf<ClientMetadata>().not.toHaveProperty("uploaded_by");
    expectTypeOf<ClientMetadata>().not.toHaveProperty("content_hash");
    expectTypeOf<ClientMetadata>().not.toHaveProperty("clinical_validation_evidence");
    expectTypeOf<ClientLabel>().not.toHaveProperty("id");
    expectTypeOf<ClientLabel>().not.toHaveProperty("document_id");
    expectTypeOf<ClientLabel>().not.toHaveProperty("owner_id");
    expectTypeOf<ClientLabel>().not.toHaveProperty("metadata");
    expectTypeOf<ClientSearchResult>().toEqualTypeOf<ClientSource>();
    expectTypeOf<ClientScope>().not.toHaveProperty("retrieval");
    expectTypeOf(payload.degradedMode).toEqualTypeOf<{ active: boolean; reason?: string | null } | undefined>();
  });

  it("preserves the server-derived high-risk authority cap through projection and rendering", () => {
    const source = fullSource({
      relevance: {
        verdict: "direct",
        label: "Direct",
        matchedTerms: ["monitoring"],
        missingTerms: [],
        directSourceCount: 1,
        weakSourceCount: 0,
        score: 1,
        supportReason: "Direct support",
        isSourceBacked: true,
        coverageScore: 1,
        rankScore: 1,
        titleMatchedTerms: ["monitoring"],
        contentMatchedTerms: ["monitoring"],
        metadataMatchedTerms: [],
        chips: [],
      },
    });
    const response = buildGovernedAnswerClientResponse({
      ...answerWith([source]),
      relevance: source.relevance,
      supportedClaims: [
        {
          claimId: "claim-1",
          text: "High-risk monitoring claim",
          riskClass: "high_risk",
          supportingChunkIds: [source.id],
          supportStatus: "direct",
        },
      ],
      evidenceAssessments: {
        [source.id]: {
          relevance: "direct",
          claimSupport: "direct",
          authority: "unverified",
          currency: "current",
          extractionQuality: "good",
        },
      },
      quoteCards: [
        {
          chunk_id: source.id,
          document_id: source.document_id,
          title: source.title,
          file_name: source.file_name,
          page_number: source.page_number,
          chunk_index: source.chunk_index,
          quote: "High-risk monitoring claim",
          section_heading: source.section_heading,
        },
      ],
    });

    expect(response.payload.authorityTrustCapRequired).toBe(true);
    expect(response.payload).not.toHaveProperty("supportedClaims");
    expect(response.payload).not.toHaveProperty("evidenceAssessments");

    const renderModel = buildAnswerRenderModel(response.payload);
    expect(renderModel.trust).toBe("medium");
    expect(renderModel.quoteCards).toEqual([]);
  });

  it("materially shrinks a representative payload", () => {
    const answer = answerWith(Array.from({ length: 8 }, (_, index) => fullSource({ id: `chunk-${index}` })));
    const fullBytes = JSON.stringify(answer).length;
    const trimmedBytes = JSON.stringify(toClientAnswerPayload(answer)).length;
    expect(trimmedBytes).toBeLessThan(fullBytes * 0.8);
  });
});

describe("P12A final adaptive discriminator and bounds", () => {
  it.each([false, true])("preserves complete canonical prose with render permission %s", (renderAdaptiveAnswer) => {
    const answer: RagAnswer = {
      ...answerWith([]),
      answerContractVersion: "clinical-rag-answer-v20",
      renderAdaptiveAnswer,
      answerSections: Array.from({ length: 8 }, (_, i) => ({
        heading: `Part ${i}`,
        body: `Required part ${i} retains its complete independently supported explanation.`,
        kind: "required_actions",
        supportLevel: "direct",
        citation_chunk_ids: [],
      })),
    };
    const client = toClientAnswerPayload(answer);
    expect(client.answerSections).toEqual(answer.answerSections);
    expect(client.answerContractVersion).toBe("clinical-rag-answer-v20");
    expect(client.renderAdaptiveAnswer).toBe(renderAdaptiveAnswer);
    expect(projectClientAnswerPayload(client, true)).toEqual(client);
  });
  it("rejects unknown/mismatched permissions and aggregate overflow", async () => {
    const { adaptiveAnswerLimits: limits } = await import("@/lib/rag/rag-answer-contract-limits");
    const base = toClientAnswerPayload(answerWith([]));
    for (const extra of [
      { renderAdaptiveAnswer: true },
      { answerContractVersion: "clinical-rag-answer-v19", renderAdaptiveAnswer: true },
      { answerContractVersion: "clinical-rag-answer-v20" },
      { answerContractVersion: "clinical-rag-answer-v20", renderAdaptiveAnswer: "true" },
    ])
      expect(projectClientAnswerPayload({ ...base, ...extra })).toBeNull();
    const section = { heading: "H", body: "b".repeat(limits.body), citation_chunk_ids: [] };
    const legal = {
      ...base,
      answerContractVersion: "clinical-rag-answer-v20",
      renderAdaptiveAnswer: false,
      answer: "a".repeat(limits.lead),
      answerSections: [section, { ...section, body: "c".repeat(limits.total - limits.lead - limits.body - 2) }],
    };
    expect(projectClientAnswerPayload(legal)).not.toBeNull();
    expect(
      projectClientAnswerPayload({
        ...legal,
        answerSections: [section, { ...legal.answerSections[1], body: legal.answerSections[1].body + "x" }],
      }),
    ).toBeNull();
  });
});

// Audit NEW-G-03 (24 Oct 2026): no check reads the text of an AI-written gap note, so a refused
// answer must not keep showing one ("avoid sertraline in the first trimester" survived a refusal).
describe("AI-written gap notes on refused answers", () => {
  const modelNote = {
    type: "gap" as const,
    message: "Sources do not cover use in pregnancy; avoid sertraline in the first trimester.",
    origin: "model" as const,
  };
  const systemNote = { type: "gap" as const, message: "Check the source for the current dose range." };

  it("tags notes parsed from the model as model-written", async () => {
    const { sanitizeConflictsOrGaps } = await import("@/lib/rag/rag-quote-verification");
    const [note] = sanitizeConflictsOrGaps([{ type: "gap", message: modelNote.message }], [fullSource()]);
    expect(note.origin).toBe("model");
  });

  it("drops model notes and keeps system notes once the answer is refused", () => {
    const refused: RagAnswer = {
      ...answerWith([fullSource()]),
      answer: "No current source with pregnancy guidance was found.",
      grounded: false,
      confidence: "unsupported",
      responseMode: "evidence_gap",
      conflictsOrGaps: [modelNote, systemNote],
    };
    const payload = toClientAnswerPayload(refused);
    expect(payload.conflictsOrGaps).toEqual([systemNote]);
    expect(buildAnswerRenderModel(payload).warnings.join(" ")).not.toContain("sertraline");
  });

  it("keeps model notes on an answer that was not refused, without sending the origin tag", () => {
    const payload = toClientAnswerPayload({ ...answerWith([fullSource()]), conflictsOrGaps: [modelNote, systemNote] });
    expect(payload.conflictsOrGaps).toEqual([{ type: "gap", message: modelNote.message }, systemNote]);
  });
});
