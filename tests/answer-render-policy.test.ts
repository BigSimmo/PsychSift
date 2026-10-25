import { describe, expect, it, vi } from "vitest";
import {
  buildAnswerRenderModel,
  currencyReviewWarnings,
  describeSourceStrengthForCopy,
  formatAnswerRenderCopyText,
  isCurrencyReviewWarning,
} from "../src/lib/answer-render-policy";
import { toClientAnswerPayload } from "../src/lib/answer-client-payload";
import { answerStateForAnswer, buildAnswerClipboardText } from "@/components/clinical-dashboard/answer-copy-payload";
import type {
  BestSourceRecommendation,
  Citation,
  QuoteCard,
  RagAnswer,
  RelatedDocument,
  SearchResult,
  VisualEvidenceCard,
} from "../src/lib/types";

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Clozapine Monitoring Guideline",
    file_name: "clozapine-monitoring.pdf",
    page_number: 4,
    chunk_index: 0,
    section_heading: "Monitoring",
    content: "If blood results are red range, withhold clozapine and contact the monitoring service.",
    image_ids: [],
    similarity: 0.95,
    hybrid_score: 0.95,
    images: [],
    source_strength: "strong",
    ...overrides,
  };
}

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    title: "Clozapine Monitoring Guideline",
    file_name: "clozapine-monitoring.pdf",
    page_number: 4,
    chunk_index: 0,
    similarity: 0.95,
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteCard> = {}): QuoteCard {
  return {
    ...citation(overrides),
    quote: "withhold clozapine and contact the monitoring service",
    section_heading: "Monitoring",
    source_strength: "strong",
    ...overrides,
  };
}

function visual(overrides: Partial<VisualEvidenceCard> = {}): VisualEvidenceCard {
  return {
    id: "image-1",
    image_id: "img-1",
    signed_url_endpoint: "/api/images/img-1",
    caption: "Monitoring table",
    document_id: "doc-1",
    title: "Clozapine Monitoring Guideline",
    file_name: "clozapine-monitoring.pdf",
    page_number: 4,
    source_chunk_id: "chunk-1",
    chunk_index: 0,
    viewer_href: "/documents/doc-1?page=4&chunk=chunk-1",
    tableRows: [["Red", "Withhold"]],
    tableColumns: ["Range", "Action"],
    ...overrides,
  };
}

function related(overrides: Partial<RelatedDocument> = {}): RelatedDocument {
  return {
    document_id: "related-doc",
    title: "Related Guideline",
    file_name: "related.pdf",
    labels: [],
    summary: "Related monitoring material.",
    best_pages: [1],
    best_chunk_ids: ["related-chunk"],
    image_count: 0,
    match_reason: "Similar topic",
    score: 0.7,
    ...overrides,
  };
}

function answer(overrides: Partial<RagAnswer> = {}): RagAnswer {
  const baseSource = source();
  return {
    answer: "For red-range blood results, withhold clozapine and contact the monitoring service.",
    grounded: true,
    confidence: "high",
    citations: [citation()],
    sources: [baseSource],
    answerSections: [
      {
        heading: "Action",
        body: "Withhold clozapine and contact the monitoring service.",
        citation_chunk_ids: ["chunk-1"],
        kind: "required_actions",
        supportLevel: "direct",
      },
    ],
    quoteCards: [quote()],
    visualEvidence: [visual()],
    relatedDocuments: [related()],
    bestSource: {
      ...citation(),
      source_strength: "strong",
      score: 0.95,
      snippet: "If blood results are red range, withhold clozapine.",
      section_heading: "Monitoring",
      image_count: 1,
      viewer_href: "/documents/doc-1?page=4&chunk=chunk-1",
    } satisfies BestSourceRecommendation,
    relevance: {
      verdict: "direct",
      label: "Direct source support",
      matchedTerms: ["clozapine", "withhold"],
      missingTerms: [],
      directSourceCount: 1,
      weakSourceCount: 0,
      score: 1,
      supportReason: "Direct source support.",
      isSourceBacked: true,
    },
    ...overrides,
  };
}

function clientAnswer(overrides: Partial<RagAnswer> = {}) {
  return toClientAnswerPayload(answer(overrides));
}

it.each(["model_synthesis", "source_only"] as const)(
  "R3 keeps explicit %s provenance with extractive routing",
  (answerQualityTier) => {
    const payload = clientAnswer({ answerQualityTier, routingMode: "extractive", fallbackReasonCode: "coverage_gap" });
    const model = buildAnswerRenderModel(payload);
    const copied = buildAnswerClipboardText({ answer: payload, weakEvidence: false, renderCopyText: model.copyText });
    if (answerQualityTier === "model_synthesis") {
      expect(answerStateForAnswer({ answer: payload, weakEvidence: false }).kind).not.toBe("source_only");
      expect(copied).toMatch(/^AI-generated from the cited sources\./);
      expect(copied).not.toMatch(/without (?:AI|model) synthesis/i);
    } else {
      expect(copied).toMatch(/^Assembled directly from the cited sources without model synthesis\./);
    }
  },
);

describe("answer render policy", () => {
  it("caps trust and adds a warning from the bounded retrieval gate signal", () => {
    const model = buildAnswerRenderModel(answer({ retrievalGateBlocked: true }));

    expect(model.trust).toBe("low");
    expect(model.warnings).toContain("Retrieval confidence gate was blocked for low signal.");
  });

  it("labels review-only citations accurately instead of calling them generated-answer citations", () => {
    const model = buildAnswerRenderModel(
      answer({
        citations: [citation({ provenance: "review_only" })],
        bestSource: null,
        answerSections: [],
        quoteCards: [],
      }),
    );
    expect(model.primarySources[0]?.reason).toBe("Added for source review; not accepted as claim support.");
  });

  it("makes review-due status visible", () => {
    const reviewDue = source({
      source_metadata: {
        source_title: "Clozapine guideline",
        publisher: "Local service",
        jurisdiction: "WA",
        version: "1",
        publication_date: "2024-01-01",
        review_date: "2026-01-01",
        uploaded_at: "2024-01-01",
        indexed_at: "2024-01-01",
        uploaded_by: null,
        document_status: "review_due",
        clinical_validation_status: "approved",
        extraction_quality: "good",
      },
    });
    const model = buildAnswerRenderModel(
      answer({
        sources: [reviewDue],
        bestSource: null,
        quoteCards: [],
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Withhold clozapine.",
            riskClass: "high_risk",
            supportingChunkIds: ["chunk-1"],
            supportStatus: "direct",
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
      }),
    );
    expect(model.warnings).toContain("A supporting source is due for review.");
  });

  it("does not describe an incidental review-due retrieval as a supporting source", () => {
    const incidental = source({
      id: "incidental",
      document_id: "incidental-doc",
      source_metadata: {
        source_title: "Old directory",
        publisher: "Local service",
        jurisdiction: "WA",
        version: "1",
        publication_date: "2024-01-01",
        review_date: "2026-01-01",
        uploaded_at: "2024-01-01",
        indexed_at: "2024-01-01",
        uploaded_by: null,
        document_status: "review_due",
        clinical_validation_status: "unverified",
        extraction_quality: "good",
      },
    });
    const model = buildAnswerRenderModel(
      answer({
        sources: [source(), incidental],
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Withhold clozapine.",
            riskClass: "high_risk",
            supportingChunkIds: ["chunk-1"],
            supportStatus: "direct",
          },
        ],
        evidenceAssessments: {
          "chunk-1": {
            relevance: "direct",
            claimSupport: "direct",
            authority: "approved",
            currency: "current",
            extractionQuality: "good",
          },
          incidental: {
            relevance: "none",
            claimSupport: "unsupported",
            authority: "unverified",
            currency: "review_due",
            extractionQuality: "good",
          },
        },
      }),
    );
    expect(model.warnings).not.toContain("A supporting source is due for review.");
  });

  it("uses retrieved-source wording for review-due evidence when there is no material support", () => {
    const reviewDue = source({
      source_metadata: {
        source_title: "Review source",
        publisher: "Local service",
        jurisdiction: "WA",
        version: "1",
        publication_date: "2024-01-01",
        review_date: "2026-01-01",
        uploaded_at: "2024-01-01",
        indexed_at: "2024-01-01",
        uploaded_by: null,
        document_status: "review_due",
        clinical_validation_status: "unverified",
        extraction_quality: "good",
      },
    });
    const model = buildAnswerRenderModel(
      answer({
        sources: [reviewDue],
        citations: [],
        answerSections: [],
        quoteCards: [],
        bestSource: null,
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "The retrieved material mentions a clinic.",
            riskClass: "routine",
            supportingChunkIds: [],
            supportStatus: "unsupported",
          },
        ],
        evidenceAssessments: {
          "chunk-1": {
            relevance: "nearby",
            claimSupport: "unsupported",
            authority: "unverified",
            currency: "review_due",
            extractionQuality: "good",
          },
        },
      }),
    );
    expect(model.warnings).toContain("A retrieved source is due for review.");
    expect(model.warnings).not.toContain("A supporting source is due for review.");
  });

  it("fails closed when answer relevance metadata is absent", () => {
    const model = buildAnswerRenderModel(
      answer({
        relevance: undefined,
        smartPanel: undefined,
      }),
    );

    expect(model.trust).toBe("low");
    expect(model.allowedBlocks).not.toContain("quoteCards");
    expect(model.allowedBlocks).not.toContain("visualEvidence");
    expect(model.allowedBlocks).not.toContain("relatedDocuments");
    expect(model.visualEvidence).toEqual([]);
    expect(model.tables).toEqual([]);
    expect(model.copyText).not.toContain("Displayed table evidence");
  });

  it("does not render high trust for high-risk claims supported only by unverified evidence", () => {
    const model = buildAnswerRenderModel(
      clientAnswer({
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Withhold clozapine.",
            riskClass: "high_risk",
            supportingChunkIds: ["chunk-1"],
            supportStatus: "direct",
          },
        ],
        evidenceAssessments: {
          "chunk-1": {
            relevance: "direct",
            claimSupport: "direct",
            authority: "unverified",
            currency: "current",
            extractionQuality: "good",
          },
        },
      }),
    );
    expect(model.trust).not.toBe("high");
  });

  it("keeps high trust for routine claims on unverified evidence while the D5 flag is off", () => {
    // Locks the zero-change default: only high-risk claims are authority-gated.
    const model = buildAnswerRenderModel(
      clientAnswer({
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Document the review date.",
            riskClass: "routine",
            supportingChunkIds: ["chunk-1"],
            supportStatus: "direct",
          },
        ],
        evidenceAssessments: {
          "chunk-1": {
            relevance: "direct",
            claimSupport: "direct",
            authority: "unverified",
            currency: "current",
            extractionQuality: "good",
          },
        },
      }),
    );
    expect(model.trust).toBe("high");
  });

  // #WGMB4Z (owner decisions 3, 10 and 17, Josh, 2026-09-25): the all-claims rule is LABEL
  // ONLY. "Strong support" shows only when every claim is direct with approved or locally
  // reviewed authority, and never when there are no assessed claims; everything else the
  // render model decides (trust, quote cards, related documents, tables, source and row caps,
  // warnings, copy text) stays exactly as main derives it. An explicit "false" opts the label
  // back to following trust. The flag is computed when the payload is projected, so build it
  // inside the env stub.
  describe("strong-support label cap (#WGMB4Z decision 17)", () => {
    type Claims = NonNullable<RagAnswer["supportedClaims"]>;
    type Authority = "unverified" | "locally_reviewed" | "approved";
    const claimsAnswer = (
      claims: Claims | undefined,
      authority: Authority = "unverified",
      overrides: Partial<RagAnswer> = {},
    ) =>
      clientAnswer({
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
        ...overrides,
      });
    const routine = (supportStatus: "direct" | "partial" = "direct"): Claims => [
      {
        claimId: "claim-1",
        text: "Document the review date.",
        riskClass: "routine",
        supportingChunkIds: ["chunk-1"],
        supportStatus,
      },
    ];
    const withEnv = <T>(value: string | undefined, run: () => T): T => {
      vi.stubEnv("NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS", value);
      try {
        return run();
      } finally {
        vi.unstubAllEnvs();
      }
    };
    const withoutLabel = (model: ReturnType<typeof buildAnswerRenderModel>) => ({
      ...model,
      supportLabelTrust: "ignored",
      // The copied text carries the label too, so pasted notes never read stronger than the screen.
      copyText: model.copyText.replace(/\nSupport label: [^\n]*/, ""),
    });

    it.each([
      ["no supportedClaims", undefined, "unverified"],
      ["empty supportedClaims", [] as Claims, "unverified"],
      ["a routine claim on unverified evidence", routine(), "unverified"],
      ["a partial routine claim on approved evidence", routine("partial"), "approved"],
    ] as const)(
      "keeps trust high and every render cap as main for %s, but lowers only the label",
      (_label, claims, authority) => {
        const capped = withEnv(undefined, () => claimsAnswer(claims as Claims | undefined, authority));
        const optedOut = withEnv("false", () => claimsAnswer(claims as Claims | undefined, authority));
        expect(capped.authorityTrustCapRequired).toBe(false);
        expect(capped.strongSupportLabelCapped).toBe(true);
        expect(optedOut.strongSupportLabelCapped).toBe(false);

        const model = buildAnswerRenderModel(capped, { includeDebugReasons: true });
        expect(model.trust).toBe("high");
        expect(model.supportLabelTrust).toBe("medium");
        // Same quote cards, related documents and visual evidence main gives a high-trust answer.
        expect(model.quoteCards).toHaveLength(1);
        expect(model.relatedDocuments).toHaveLength(1);
        expect(model.visualEvidence).toHaveLength(1);
        expect(model.allowedBlocks).toEqual(expect.arrayContaining(["quoteCards", "relatedDocuments"]));
        expect(model.copyText).toContain("Render trust: high");
        expect(model.copyText).toContain(
          "Support label: Supported (not every claim is checked against a reviewed source)",
        );
        // Nothing but the label differs from the opted-out (main) model.
        const mainModel = buildAnswerRenderModel(optedOut, { includeDebugReasons: true });
        expect(mainModel.supportLabelTrust).toBe("high");
        expect(mainModel.copyText).not.toContain("Support label:");
        expect(withoutLabel(model)).toEqual(withoutLabel(mainModel));
      },
    );

    it.each(["locally_reviewed", "approved"] as const)(
      "keeps Strong support when every claim is direct on %s evidence",
      (authority) => {
        const payload = withEnv(undefined, () => claimsAnswer(routine(), authority));
        expect(payload.strongSupportLabelCapped).toBe(false);
        const model = buildAnswerRenderModel(payload);
        expect(model.trust).toBe("high");
        expect(model.supportLabelTrust).toBe("high");
      },
    );

    it.each(["", "0", "off", "False", "true"])(
      'keeps the label cap on for a D5 value that is not exactly "false" (%j)',
      (value) => {
        const payload = withEnv(value, () => claimsAnswer(routine(), "unverified"));
        expect(payload.strongSupportLabelCapped).toBe(true);
        expect(buildAnswerRenderModel(payload).supportLabelTrust).not.toBe("high");
      },
    );

    it('lets the label follow trust when the D5 flag is explicitly "false"', () => {
      for (const claims of [undefined, [] as Claims, routine()]) {
        const payload = withEnv("false", () => claimsAnswer(claims, "unverified"));
        expect(payload.strongSupportLabelCapped).toBe(false);
        const model = buildAnswerRenderModel(payload);
        expect(model.trust).toBe("high");
        expect(model.supportLabelTrust).toBe("high");
      }
    });

    it("never raises the label above trust, and leaves medium, low and unsupported answers alone", () => {
      withEnv(undefined, () => {
        for (const [overrides, trust] of [
          [{ confidence: "medium" }, "medium"],
          [{ confidence: "low" }, "low"],
          [{ grounded: false }, "unsupported"],
        ] as const) {
          const model = buildAnswerRenderModel(claimsAnswer([], "unverified", overrides));
          expect(model.trust).toBe(trust);
          expect(model.supportLabelTrust).toBe(trust);
        }
        const reviewedMedium = buildAnswerRenderModel(
          claimsAnswer(routine(), "locally_reviewed", { confidence: "medium" }),
        );
        expect(reviewedMedium.supportLabelTrust).toBe("medium");
      });
    });

    it("treats a stored payload without the label field as main did (label follows trust)", () => {
      // Saved or restored answers produced before this field existed carry no flag. They keep
      // main's behaviour rather than guessing; the stored-thread label is queued separately.
      const legacy = withEnv(undefined, () => claimsAnswer(routine(), "unverified"));
      delete (legacy as { strongSupportLabelCapped?: boolean }).strongSupportLabelCapped;
      const model = buildAnswerRenderModel(legacy);
      expect(model.trust).toBe("high");
      expect(model.supportLabelTrust).toBe("high");
    });
  });

  it("caps trust for ANY claim on unverified evidence when NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS is on (D5)", () => {
    vi.stubEnv("NEXT_PUBLIC_RAG_TRUST_CAP_ALL_CLAIMS", "true");
    try {
      const model = buildAnswerRenderModel(
        clientAnswer({
          supportedClaims: [
            {
              claimId: "claim-1",
              text: "Document the review date.",
              riskClass: "routine",
              supportingChunkIds: ["chunk-1"],
              supportStatus: "direct",
            },
          ],
          evidenceAssessments: {
            "chunk-1": {
              relevance: "direct",
              claimSupport: "direct",
              authority: "unverified",
              currency: "current",
              extractionQuality: "good",
            },
          },
        }),
      );
      expect(model.trust).toBe("medium");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["missing assessment", undefined],
    [
      "missing authority",
      {
        relevance: "direct",
        claimSupport: "direct",
        currency: "current",
        extractionQuality: "good",
      },
    ],
  ])("caps high-risk trust for %s", (_label, assessment) => {
    const model = buildAnswerRenderModel(
      clientAnswer({
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Withhold clozapine.",
            riskClass: "high_risk",
            supportingChunkIds: ["chunk-1"],
            supportStatus: "direct",
          },
        ],
        evidenceAssessments: assessment
          ? ({ "chunk-1": assessment } as unknown as RagAnswer["evidenceAssessments"])
          : {},
      }),
    );
    expect(model.trust).not.toBe("high");
  });

  it("prefers a direct supporting chunk as best source", () => {
    const direct = source({ id: "chunk-2", document_id: "doc-2", title: "Direct threshold", file_name: "direct.pdf" });
    const model = buildAnswerRenderModel(
      clientAnswer({
        answerQualityTier: "model_synthesis",
        bestSource: undefined,
        sources: [source(), direct],
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Withhold clozapine.",
            riskClass: "high_risk",
            supportingChunkIds: ["chunk-2"],
            supportStatus: "direct",
          },
        ],
      }),
    );
    expect(model.bestSource?.chunk_id).toBe("chunk-2");
  });

  it("R3 retains an explicit best-source recommendation despite another direct supporting chunk", () => {
    const model = buildAnswerRenderModel(
      clientAnswer({
        answerQualityTier: "model_synthesis",
        sources: [source(), source({ id: "chunk-2", document_id: "doc-2" })],
        supportedClaims: [
          {
            claimId: "claim-1",
            text: "Withhold clozapine.",
            riskClass: "high_risk",
            supportingChunkIds: ["chunk-2"],
            supportStatus: "direct",
          },
        ],
      }),
    );
    expect(model.bestSource?.chunk_id).toBe("chunk-1");
  });

  it("copies the displayed table values, units, and canonical provenance", () => {
    const model = buildAnswerRenderModel(
      answer({
        visualEvidence: [
          visual({
            tableTitle: "ANC action thresholds",
            tableColumns: ["ANC", "Action"],
            tableRows: [["0.49 ×10^9/L", "Stop and escalate"]],
          }),
        ],
      }),
    );
    expect(model.copyText).toContain("ANC action thresholds");
    expect(model.copyText).toContain("0.49 ×10^9/L");
    expect(model.copyText).toContain("Stop and escalate");
    expect(model.copyText).toContain("/documents/doc-1?page=4&chunk=chunk-1");
  });

  it("omits the table-evidence heading when displayed evidence has no table rows", () => {
    const text = formatAnswerRenderCopyText({
      answerText: "Review the image source.",
      trust: "high",
      primarySources: [],
      warnings: [],
      visualEvidence: [visual({ tableRows: undefined, tableColumns: undefined })],
    });

    expect(text).not.toContain("Displayed table evidence");
  });

  it("strips high-yield bold markers from the copy/paste clinical draft", () => {
    const model = buildAnswerRenderModel(
      answer({
        answer: "For red-range results, **withhold clozapine** and recheck ANC **within 24 hours**.",
      }),
    );
    // The pasted draft is plain text for clinical notes — no literal "**".
    expect(model.copyText).not.toContain("**");
    expect(model.copyText).toContain("withhold clozapine");
    expect(model.copyText).toContain("within 24 hours");
  });

  it("caps missing relevance metadata below source-backed trust", () => {
    const model = buildAnswerRenderModel(
      answer({
        relevance: undefined,
        smartPanel: undefined,
      }),
    );

    expect(model.trust).toBe("low");
    expect(model.allowedBlocks).toEqual(expect.arrayContaining(["sourceStatus", "reviewSources"]));
    expect(model.allowedBlocks).not.toContain("evidenceMap");
    expect(model.allowedBlocks).not.toContain("quoteCards");
    expect(model.allowedBlocks).not.toContain("relatedDocuments");
  });

  it("limits unsupported answers to source review and warnings even when raw extras are present", () => {
    const model = buildAnswerRenderModel(
      answer({
        answer: "No current source with threshold-specific action guidance was found.",
        grounded: false,
        confidence: "unsupported",
        responseMode: "evidence_gap",
        routingMode: "unsupported",
      }),
      { includeDebugReasons: true },
    );

    expect(model.trust).toBe("unsupported");
    expect(model.allowedBlocks).toEqual(expect.arrayContaining(["sourceStatus", "reviewSources", "warnings"]));
    expect(model.allowedBlocks).not.toContain("quoteCards");
    expect(model.allowedBlocks).not.toContain("visualEvidence");
    expect(model.allowedBlocks).not.toContain("relatedDocuments");
    expect(model.quoteCards).toHaveLength(0);
    expect(model.visualEvidence).toHaveLength(0);
    expect(model.relatedDocuments).toHaveLength(0);
    expect(model.bestSource).toBeNull();
    expect(model.debugReasons?.quoteCards.shown).toBe(false);
    expect(model.copyText).toContain("Render trust: unsupported");
    expect(model.copyText).toContain("Sources for review");
  });

  it("keeps medium-confidence rendering focused on source status, sources, evidence map and capped quotes", () => {
    const model = buildAnswerRenderModel(
      answer({
        confidence: "medium",
        quoteCards: [quote(), quote({ quote: "another exact quote" })],
        visualEvidence: [visual(), visual({ id: "image-2", image_id: "img-2" })],
        relatedDocuments: [related(), related({ document_id: "related-doc-2", title: "Second related" })],
      }),
    );

    expect(model.trust).toBe("medium");
    expect(model.allowedBlocks).toEqual(expect.arrayContaining(["sourceStatus", "reviewSources", "evidenceMap"]));
    // TGA exemption limb (e): medium trust shows the exact sentences relied on, capped at 2.
    expect(model.allowedBlocks).toContain("quoteCards");
    expect(model.allowedBlocks).not.toContain("relatedDocuments");
    expect(model.quoteCards).toHaveLength(2);
    expect(model.relatedDocuments).toHaveLength(0);
    expect(model.evidenceRows).toHaveLength(1);
    expect(model.copyText).toContain("Verify against linked source documents");
  });

  it("deduplicates high-confidence evidence channels and caps optional blocks", () => {
    const manyQuotes = Array.from({ length: 6 }, (_, index) =>
      quote({ quote: `quoted evidence ${index}`, chunk_id: "chunk-1" }),
    );
    const manyVisuals = Array.from({ length: 5 }, (_, index) =>
      visual({ id: `image-${index}`, image_id: `img-${index}`, source_chunk_id: "chunk-1" }),
    );
    const manyRelated = Array.from({ length: 6 }, (_, index) =>
      related({ document_id: `related-${index}`, title: `Related ${index}` }),
    );

    const model = buildAnswerRenderModel(
      answer({
        quoteCards: manyQuotes,
        visualEvidence: manyVisuals,
        relatedDocuments: manyRelated,
      }),
    );

    expect(model.trust).toBe("high");
    expect(model.primarySources).toHaveLength(1);
    expect(model.quoteCards).toHaveLength(3);
    expect(model.visualEvidence).toHaveLength(3);
    expect(model.relatedDocuments).toHaveLength(4);
    expect(model.allowedBlocks).toEqual(expect.arrayContaining(["quoteCards", "visualEvidence", "relatedDocuments"]));
  });

  it("does not widen the client renderer to server-only smartApiPlan links", () => {
    const payload = toClientAnswerPayload(
      answer({
        smartApiPlan: {
          coreSourceLinks: [
            {
              id: "core-chunk",
              label: "Core source, page 8",
              href: "/documents/doc-core?page=8&chunk=core-chunk",
              document_id: "doc-core",
              chunk_id: "core-chunk",
              title: "Canonical Source Packet",
              file_name: "canonical-source.pdf",
              page_number: 8,
              source_strength: "strong",
              reason: "Selected by the answer plan.",
              snippet: "Canonical answer-plan source text.",
            },
          ],
        } as RagAnswer["smartApiPlan"],
      }),
    );
    const model = buildAnswerRenderModel(payload);

    expect(payload).not.toHaveProperty("smartApiPlan");
    expect(model.primarySources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ chunk_id: "core-chunk" })]),
    );
    expect(model.copyText).not.toContain("/documents/doc-core?page=8&chunk=core-chunk");
  });

  it("does not let bestSource re-promote a review-only citation for the same passage", () => {
    // Ledger #ZK460W / Copilot review on PR #2721. collectSourceCandidates gathers bestSource
    // before citations and dedupes first-wins; without the override a strong bestSource would
    // keep "Direct" / "strong match" labelling on a passage the answer marked review_only.
    // smartApiPlan.coreSourceLinks are server-only (stripped by toClientAnswerPayload) and are
    // covered separately by "does not widen the client renderer to server-only smartApiPlan links".
    const model = buildAnswerRenderModel(
      toClientAnswerPayload(
        answer({
          grounded: false,
          confidence: "unsupported",
          citations: [citation({ provenance: "review_only" })],
          quoteCards: [],
          answerSections: [],
          bestSource: {
            ...citation(),
            source_strength: "strong",
            quote: "Pinned best-source excerpt.",
            snippet: "Pinned best-source excerpt.",
            score: 0.99,
            section_heading: "Monitoring",
            image_count: 0,
            viewer_href: "/documents/doc-1?page=4&chunk=chunk-1",
          },
        }),
      ),
    );

    expect(model.trust).toBe("unsupported");
    expect(model.primarySources).toHaveLength(1);
    expect(model.primarySources[0]).toMatchObject({
      chunk_id: "chunk-1",
      provenance: "review_only",
      reason: "Added for source review; not accepted as claim support.",
      sourceStrength: "none",
    });
  });

  it("leaves an unrelated bestSource strength intact when no review-only citation covers that passage", () => {
    // bestSource is only collected when its chunk is already in supportingChunkIds (citations /
    // quotes / sections). Give the unrelated passage a normal citation so it remains eligible,
    // while the review-only override stays scoped to chunk-1.
    const model = buildAnswerRenderModel(
      toClientAnswerPayload(
        answer({
          grounded: false,
          confidence: "unsupported",
          citations: [
            citation({ provenance: "review_only" }),
            citation({
              chunk_id: "other-chunk",
              document_id: "doc-other",
              title: "Other Source",
              file_name: "other-source.pdf",
              page_number: 2,
            }),
          ],
          quoteCards: [],
          answerSections: [],
          sources: [
            source(),
            source({
              id: "other-chunk",
              document_id: "doc-other",
              title: "Other Source",
              file_name: "other-source.pdf",
              page_number: 2,
            }),
          ],
          bestSource: {
            ...citation({
              chunk_id: "other-chunk",
              document_id: "doc-other",
              title: "Other Source",
              file_name: "other-source.pdf",
              page_number: 2,
            }),
            source_strength: "strong",
            quote: "Unrelated best-source excerpt.",
            snippet: "Unrelated best-source excerpt.",
            score: 0.99,
            section_heading: "Other",
            image_count: 0,
            viewer_href: "/documents/doc-other?page=2&chunk=other-chunk",
          },
        }),
      ),
    );

    const reviewOnly = model.primarySources.find((row) => row.chunk_id === "chunk-1");
    const unrelated = model.primarySources.find((row) => row.chunk_id === "other-chunk");
    expect(reviewOnly).toMatchObject({
      provenance: "review_only",
      reason: "Added for source review; not accepted as claim support.",
      sourceStrength: "none",
    });
    expect(unrelated).toMatchObject({
      chunk_id: "other-chunk",
      reason: "Pinned by backend as the best source.",
      sourceStrength: "strong",
    });
  });

  it("deduplicates conflicting section evidence by source rather than rendering duplicate rows", () => {
    const model = buildAnswerRenderModel(
      answer({
        answerSections: [
          {
            heading: "Backend section",
            body: "Withhold clozapine.",
            citation_chunk_ids: ["chunk-1"],
            supportLevel: "direct",
          },
          {
            heading: "Parser section",
            body: "Contact the monitoring service.",
            citation_chunk_ids: ["chunk-1"],
            supportLevel: "direct",
          },
        ],
      }),
    );

    expect(model.evidenceRows).toHaveLength(1);
    expect(model.evidenceRows[0]?.channels).toContain("evidenceMap");
  });

  it("drops empty placeholder supplemental content before render decisions", () => {
    const model = buildAnswerRenderModel(
      answer({
        quoteCards: [quote({ quote: "" }), quote({ quote: "N/A" })],
        visualEvidence: [],
        relatedDocuments: [],
      }),
    );

    expect(model.quoteCards).toHaveLength(0);
    expect(model.allowedBlocks).not.toContain("quoteCards");
  });

  describe("canonical clinical tables", () => {
    it("keeps ordinary prose unchanged when no accepted table is visible", () => {
      const model = buildAnswerRenderModel(answer({ visualEvidence: [] }));

      expect(model.tables).toEqual([]);
      expect(model.copyText).toContain(model.answerText);
      expect(model.copyText).not.toContain("Clinical tables");
    });

    it("uses the same canonical headers and rows for rendering and clipboard text", () => {
      const model = buildAnswerRenderModel(
        answer({
          visualEvidence: [
            visual({
              tableTitle: "ANC actions",
              tableColumns: ["ANC range", "Action"],
              tableRows: [
                ["1.0–1.5 × 10⁹/L", "Increase monitoring"],
                ["<1.0 × 10⁹/L", "Withhold and seek specialist advice"],
              ],
            }),
          ],
        }),
      );

      expect(model.tables).toHaveLength(1);
      expect(model.tables[0]).toMatchObject({
        title: "ANC actions",
        headers: ["ANC range", "Action"],
        rows: [
          ["1.0–1.5 × 10⁹/L", "Increase monitoring"],
          ["<1.0 × 10⁹/L", "Withhold and seek specialist advice"],
        ],
        lowConfidence: false,
        source: {
          chunkId: "chunk-1",
          href: "/documents/doc-1?page=4&chunk=chunk-1",
        },
      });
      expect(model.copyText).toContain("ANC range | Action");
      expect(model.copyText).toContain("1.0–1.5 × 10⁹/L | Increase monitoring");
      expect(model.copyText).toContain("<1.0 × 10⁹/L | Withhold and seek specialist advice");
      expect(model.copyText).toContain(
        "Source: Clozapine Monitoring Guideline, page 4 | /documents/doc-1?page=4&chunk=chunk-1",
      );
    });

    it("preserves low-confidence reconstruction and incomplete-header caveats without inventing cells", () => {
      const model = buildAnswerRenderModel(
        answer({
          visualEvidence: [
            visual({
              tableTitle: "Dose and action",
              tableColumns: ["Dose", "", "Action"],
              tableRows: [["25 mg", "", "Review"]],
            }),
          ],
        }),
      );

      expect(model.tables[0]).toMatchObject({
        headers: ["Dose", null, "Action"],
        rows: [["25 mg", null, "Review"]],
        lowConfidence: true,
      });
      expect(model.tables[0]?.caveat).toContain("headers are incomplete");
      expect(model.tables[0]?.caveat).toContain("could not be confidently reconstructed");
      expect(model.copyText).toContain("Dose | [header missing] | Action");
      expect(model.copyText).toContain("25 mg | [blank] | Review");
      expect(model.copyText).not.toContain("Column 2");
      expect(model.copyText).not.toContain("Details 2");
    });

    it("preserves a low-confidence reconstructed table when all headers are complete", () => {
      const model = buildAnswerRenderModel(
        answer({
          visualEvidence: [
            visual({
              tableTitle: "Dose schedule",
              tableColumns: ["Medicine", "Dose"],
              tableRows: [
                ["Drug A", "25 mg"],
                ["", "daily"],
              ],
            }),
          ],
        }),
      );

      expect(model.tables[0]).toMatchObject({
        headers: ["Medicine", "Dose"],
        rows: [["Drug A", "25 mg daily"]],
        lowConfidence: true,
      });
      expect(model.tables[0]?.caveat).toContain("could not be confidently reconstructed");
      expect(model.tables[0]?.caveat).not.toContain("headers are incomplete");
      expect(model.copyText).toContain("Medicine | Dose");
      expect(model.copyText).toContain("Drug A | 25 mg daily");
    });

    it("copies numeric, source-status, and review-due warnings alongside tables", () => {
      const model = buildAnswerRenderModel(
        answer({
          faithfulnessWarning: "Numeric claims require source verification.",
          unverifiedNumericTokens: ["25 mg"],
          sourceGovernanceWarnings: [
            {
              code: "unverified_source",
              severity: "warning",
              message: "One or more supporting sources are not locally validated.",
            },
            {
              code: "review_due_source",
              severity: "warning",
              message: "A supporting source is due for review.",
            },
          ],
        }),
      );

      expect(model.copyText).toContain("Numeric claims require source verification.");
      expect(model.copyText).toContain("Unverified numeric tokens: 25 mg.");
      expect(model.copyText).toContain("One or more supporting sources are not locally validated.");
      expect(model.copyText).toContain("A supporting source is due for review.");
    });

    it("does not copy clinical content hidden by render policy", () => {
      const model = buildAnswerRenderModel(
        answer({
          grounded: false,
          confidence: "unsupported",
          routingMode: "unsupported",
          responseMode: "evidence_gap",
          visualEvidence: [visual({ tableRows: [["HIDDEN 900 mg", "Give now"]] })],
        }),
      );

      expect(model.tables).toEqual([]);
      expect(model.copyText).not.toContain("HIDDEN 900 mg");
      expect(model.copyText).not.toContain("Give now");
    });
  });

  describe("copy-text source-strength gloss (P4b)", () => {
    it("glosses each strength into a clinician-readable phrase and avoids the odd 'none support'", () => {
      expect(describeSourceStrengthForCopy("strong")).toBe("strong match");
      expect(describeSourceStrengthForCopy("moderate")).toBe("moderate match");
      expect(describeSourceStrengthForCopy("limited")).toBe("limited match");
      expect(describeSourceStrengthForCopy("none")).toBe("match strength not rated");
    });

    it("renders the glossed strength in the copy block, not the bare enum", () => {
      const link = (
        overrides: Partial<Parameters<typeof formatAnswerRenderCopyText>[0]["primarySources"][number]>,
      ) => ({
        id: "s1",
        chunk_id: "c1",
        document_id: "d1",
        title: "T",
        file_name: "f.pdf",
        page_number: 4,
        href: "/documents/doc-1?page=4",
        label: "Clozapine Monitoring (AKG)",
        sourceStrength: "strong" as const,
        reason: "selected",
        ...overrides,
      });
      const text = formatAnswerRenderCopyText({
        answerText: "Withhold clozapine for a red-range result.",
        trust: "high",
        primarySources: [link({}), link({ label: "Legacy Note", href: "/documents/doc-2", sourceStrength: "none" })],
        warnings: [],
      });
      expect(text).toContain("Clozapine Monitoring (AKG) | strong match | /documents/doc-1?page=4");
      expect(text).toContain("Legacy Note | match strength not rated | /documents/doc-2");
      expect(text).not.toContain("none support");
    });
  });
});

/**
 * The answer surface summarises `warnings` in one chip. A source being due for
 * review is a statement about that source's CURRENCY, not a missing piece of
 * evidence, and the same overdue assessment separately drives the answer's
 * stale-evidence state — so counting it as a gap both overstates the gaps and
 * reports one fact twice under the wrong name. The surface needs to tell the two
 * apart without matching prose it does not own, which is what these exports are
 * for.
 */
describe("currency warnings are distinguishable from evidence gaps", () => {
  it("recognises exactly the two currency sentences buildWarnings emits", () => {
    expect(isCurrencyReviewWarning(currencyReviewWarnings.supporting)).toBe(true);
    expect(isCurrencyReviewWarning(currencyReviewWarnings.retrieved)).toBe(true);
    expect(
      isCurrencyReviewWarning("Evidence support is low; verify linked sources before relying on the answer."),
    ).toBe(false);
    expect(isCurrencyReviewWarning("A supporting source is due for review")).toBe(false);
  });

  it("keeps the exported constants equal to the wording the model still emits", () => {
    // The two are the same string in one place today. Pinning it here means a
    // reworded warning cannot silently stop being recognised as a currency
    // warning and start being counted as an evidence gap.
    expect(currencyReviewWarnings.supporting).toBe("A supporting source is due for review.");
    expect(currencyReviewWarnings.retrieved).toBe("A retrieved source is due for review.");
  });
});

describe("answer warnings keep every conflict and gap", () => {
  it("does not let five earlier warnings crowd out a second conflict or gap (#182)", () => {
    const model = buildAnswerRenderModel(
      answer({
        retrievalGateBlocked: true,
        faithfulnessWarning: "Numeric claims require source verification.",
        unverifiedNumericTokens: ["25 mg"],
        sourceGovernanceWarnings: [
          {
            code: "unverified_source",
            severity: "warning",
            message: "One or more supporting sources are not locally validated.",
          },
        ],
        conflictsOrGaps: [
          { type: "gap", message: "Paediatric dosing is not covered." },
          { type: "conflict", message: "Sources disagree on the withholding threshold." },
        ],
      }),
    );

    expect(model.warnings).toContain("Paediatric dosing is not covered.");
    expect(model.warnings).toContain("Sources disagree on the withholding threshold.");
  });
});
