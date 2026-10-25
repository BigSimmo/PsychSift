import { describe, expect, it } from "vitest";

import {
  buildAnswerFollowUpQuery,
  buildAnswerFollowUpSuggestions,
  followUpTemplateKindsByMenuKey,
} from "@/lib/answer-follow-up";
import { buildRelatedInformationMenu } from "@/lib/rag/answer-composition";
import { ragEvalCases } from "@/lib/rag/rag-eval-cases";
import type { AnswerSection, ClinicalQueryIntent, RagAnswer, RagQueryClass, SearchResult } from "@/lib/types";

describe("buildAnswerFollowUpQuery", () => {
  it("P08C retains subject and constraints through elaboration and long anaphora without nested wrappers", () => {
    const first = buildAnswerFollowUpQuery("lithium dosing", "what about renal impairment?");
    const second = buildAnswerFollowUpQuery(
      first,
      "Please elaborate with an explanation and an example of how this changes the approach to monitoring over time.",
    );
    expect(second).toContain("lithium dosing");
    expect(second).toContain("renal impairment");
    expect(second).toContain("Please elaborate");
    expect((second.match(/Follow-up to/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it("returns the follow-up unchanged when there is no prior question", () => {
    expect(buildAnswerFollowUpQuery(undefined, "what about renal impairment?")).toBe("what about renal impairment?");
    expect(buildAnswerFollowUpQuery("", "what about renal impairment?")).toBe("what about renal impairment?");
  });

  it("wraps a short ambiguous follow-up with the prior question", () => {
    expect(buildAnswerFollowUpQuery("lithium dosing", "what about renal impairment?")).toBe(
      'Follow-up to "lithium dosing": what about renal impairment?',
    );
  });

  it("wraps pronoun-style continuations", () => {
    expect(buildAnswerFollowUpQuery("clozapine monitoring", "is it safe in pregnancy?")).toBe(
      'Follow-up to "clozapine monitoring": is it safe in pregnancy?',
    );
  });

  it("pins the programme follow-up case to one bounded prior question", () => {
    const programmeCase = ragEvalCases.find((testCase) => testCase.id === "anaphoric-follow-up");

    expect(buildAnswerFollowUpQuery("lithium dosing", "what about renal impairment?")).toBe(programmeCase?.question);
    expect(programmeCase?.programmeExpectation?.requiredFacts).toEqual(
      expect.arrayContaining(["one_prior_question_retained", "continuation_cue_required"]),
    );
    expect(programmeCase?.programmeExpectation?.forbiddenPatterns).toContain("unbounded_history_payload");
  });

  it("does not wrap a follow-up that restates the prior topic", () => {
    expect(buildAnswerFollowUpQuery("lithium dosing", "lithium levels in the elderly")).toBe(
      "lithium levels in the elderly",
    );
  });

  it("does not wrap a long self-contained follow-up", () => {
    const longQuestion =
      "What baseline investigations are required before starting sodium valproate in a woman of childbearing age?";
    expect(buildAnswerFollowUpQuery("lithium dosing", longQuestion)).toBe(longQuestion);
  });

  it("does not wrap a short question on a clearly new topic without continuation cues", () => {
    expect(buildAnswerFollowUpQuery("lithium dosing", "clozapine baseline bloods")).toBe("clozapine baseline bloods");
  });

  it("T8-R2 rejects oversized prior context instead of truncating it to fit the API", () => {
    const longPrior = "a".repeat(2100) + " material tail restriction";
    expect(() => buildAnswerFollowUpQuery(longPrior, "what about them?")).toThrow(RangeError);
  });

  it("trims whitespace before deciding", () => {
    expect(buildAnswerFollowUpQuery("  lithium dosing  ", "  what about the elderly?  ")).toBe(
      'Follow-up to "lithium dosing": what about the elderly?',
    );
  });
});

// ---------------------------------------------------------------------------
// Follow-up chips (packet S3 / README §A4). The three contracts under test are:
// candidates come from the S2 composition menu, every candidate must be supported
// by retrieved evidence, and anything the answer already covered is suppressed.
// ---------------------------------------------------------------------------

const allQueryClasses: RagQueryClass[] = [
  "document_lookup",
  "table_threshold",
  "medication_dose_risk",
  "comparison",
  "broad_summary",
  "unsupported_or_general",
];

const allIntents: ClinicalQueryIntent[] = [
  "definition",
  "protocol",
  "drug_dosing",
  "escalation_risk",
  "document_lookup",
  "comparison",
  "broad_summary",
  "general",
];

function evidenceSource(content: string, index = 0): SearchResult {
  return {
    id: `chunk-${index}`,
    document_id: "doc-1",
    title: "WA Lithium Prescribing Guideline",
    file_name: "lithium.pdf",
    page_number: 4,
    chunk_index: index,
    section_heading: "Prescribing",
    content,
    image_ids: [],
    images: [],
    similarity: 0.7,
  };
}

/** Mentions every menu kind's subject matter, so a chip that is dropped was dropped for another reason. */
const broadEvidence = evidenceSource(
  "Monitor serum lithium levels and renal function. Reduce the dose in renal or hepatic impairment. " +
    "Cautions and contraindications are listed below; avoid in severe impairment. Withhold or stop lithium and " +
    "escalate if toxicity is suspected: seek urgent review, refer to the emergency department and contact the " +
    "on-call consultant. Thresholds above 1.2 mmol/L require immediate action. Document the decision in the record " +
    "and use the shared-care form. Offer first-line management and consider switching or a washout where the " +
    "sources differ on the preferred option.",
);

function analysisFor(
  query: string,
  queryClass: RagQueryClass,
  intent: ClinicalQueryIntent,
  overrides: Partial<NonNullable<RagAnswer["queryAnalysis"]>> = {},
): NonNullable<RagAnswer["queryAnalysis"]> {
  return {
    originalQuery: query,
    normalizedQuery: query,
    queryClass,
    intent,
    confidence: 0.9,
    reasons: [],
    canonicalTerms: ["lithium"],
    expandedTerms: [],
    typoCorrections: [],
    medications: ["lithium"],
    acronyms: [],
    thresholdTerms: [],
    documentTitleTerms: [],
    queryRewrite: { normalizedQuery: query, searchQuery: query, expansions: [], reasons: [] },
    documentTitleIntent: false,
    comparisonIntent: false,
    freshnessNeed: false,
    needsVisualEvidence: false,
    needsSynthesis: false,
    needsClassifierFallback: false,
    ...overrides,
  };
}

function answerFor(
  options: {
    query?: string;
    queryClass?: RagQueryClass;
    intent?: ClinicalQueryIntent;
    answer?: string;
    sources?: SearchResult[];
    sections?: AnswerSection[];
    analysisOverrides?: Partial<NonNullable<RagAnswer["queryAnalysis"]>>;
  } = {},
): RagAnswer {
  const query = options.query ?? "lithium dosing";
  const queryClass = options.queryClass ?? "medication_dose_risk";
  return {
    answer: options.answer ?? "Start low and titrate against response.",
    grounded: true,
    confidence: "high",
    citations: [],
    sources: options.sources ?? [broadEvidence],
    queryClass,
    queryAnalysis: analysisFor(query, queryClass, options.intent ?? "drug_dosing", options.analysisOverrides),
    ...(options.sections ? { answerSections: options.sections } : {}),
  };
}

describe("buildAnswerFollowUpSuggestions · composition menu", () => {
  it("derives dosing chips from the medication_dose_risk / drug_dosing menu, in menu order", () => {
    const suggestions = buildAnswerFollowUpSuggestions("lithium dosing", answerFor(), ["lithium dosing"]);

    expect(suggestions).toEqual([
      "What monitoring is required for lithium?",
      "What cautions or contraindications apply to lithium?",
      "What should trigger stopping or escalating lithium?",
      "How is lithium dosed in renal or hepatic impairment?",
    ]);
  });

  it("follows the intent refinement: escalation_risk swaps the dosing menu for the escalation menu", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium toxicity action",
      answerFor({ query: "lithium toxicity action", intent: "escalation_risk" }),
      ["lithium toxicity action"],
    );

    expect(suggestions).toEqual([
      "What immediate actions are required for lithium?",
      "What thresholds trigger those actions for lithium?",
      "Who should be contacted or referred for lithium?",
      "What should I document for lithium?",
    ]);
    expect(suggestions.some((item) => /renal or hepatic/i.test(item))).toBe(false);
  });

  it("keeps document_lookup narrow — the class whose S2 menu is deliberately none", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "Summarise the discharge policy",
      answerFor({
        query: "Summarise the discharge policy",
        queryClass: "document_lookup",
        intent: "document_lookup",
        answer: "The policy sets out planning and follow-up requirements.",
        sources: [
          evidenceSource(
            "Discharge planning starts at admission. Staff must reconcile medicines and follow the steps below; " +
              "contraindications to early discharge are noted.",
          ),
        ],
        analysisOverrides: { canonicalTerms: ["discharge"], medications: [], documentTitleIntent: true },
      }),
      ["Summarise the discharge policy"],
    );

    expect(suggestions).toEqual([
      "What are the key action points?",
      "Are there any contraindications noted?",
      "Summarise the practical steps for discharge.",
    ]);
  });

  it("answers every menu kind the S2 menu offers, index-aligned, across all 48 class×intent cells", () => {
    for (const queryClass of allQueryClasses) {
      for (const intent of allIntents) {
        const menu = buildRelatedInformationMenu(queryClass, intent);
        if (menu.key === "none") {
          expect(menu.items).toHaveLength(0);
          continue;
        }
        const kinds = followUpTemplateKindsByMenuKey[menu.key];
        expect(kinds, `no follow-up templates for menu key ${menu.key}`).toBeDefined();
        expect(kinds).toEqual(menu.items.map((item) => item.kind));
      }
    }
  });

  it("derives an evidence-backed subject when the client payload carries no query analysis", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        answer: "Start low and titrate against response.",
        grounded: true,
        confidence: "high",
        citations: [],
        sources: [broadEvidence],
      },
      ["lithium dosing"],
    );

    expect(suggestions).toContain("What monitoring is required for lithium?");
  });
});

describe("buildAnswerFollowUpSuggestions · evidence gate", () => {
  it("drops a candidate whose subject the retrieved evidence never mentions", () => {
    const withoutRenalOrEscalation = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      answerFor({
        sources: [
          evidenceSource(
            "Lithium is usually given once daily at night. Monitor serum lithium levels after each change. " +
              "Cautions are listed in the appendix.",
          ),
        ],
      }),
      ["lithium dosing"],
    );

    // Same class, same menu — only the evidence changed.
    expect(withoutRenalOrEscalation).toEqual([
      "What monitoring is required for lithium?",
      "What cautions or contraindications apply to lithium?",
    ]);
    expect(withoutRenalOrEscalation.some((item) => /renal or hepatic/i.test(item))).toBe(false);
  });

  it("returns no chips at all when the answer carries no retrieved evidence", () => {
    expect(buildAnswerFollowUpSuggestions("lithium dosing", answerFor({ sources: [] }), ["lithium dosing"])).toEqual(
      [],
    );
  });

  it("does not let query-derived canonical terms vouch for corpus coverage", () => {
    // "monitoring" is in the query analysis but in no source; the monitoring chip
    // must not appear on that basis alone.
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium monitoring",
      answerFor({
        query: "lithium monitoring",
        sources: [evidenceSource("Lithium is a mood stabiliser used in bipolar disorder.")],
        analysisOverrides: { canonicalTerms: ["lithium", "monitoring"] },
      }),
      ["lithium monitoring"],
    );

    expect(suggestions).toEqual([]);
  });

  it("accepts server-derived safety findings and quote cards as evidence", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor({ sources: [evidenceSource("Lithium is a mood stabiliser used in bipolar disorder.")] }),
        safetyWarnings: [
          {
            id: "warn-1",
            kind: "monitoring",
            label: "Monitoring required",
            text: "Monitor serum lithium levels every six months.",
            citation: {
              chunk_id: "chunk-0",
              document_id: "doc-1",
              title: "WA Lithium Prescribing Guideline",
              file_name: "lithium.pdf",
              page_number: 4,
              chunk_index: 0,
            },
            href: "/documents/doc-1",
          },
        ],
      },
      ["lithium dosing"],
    );

    expect(suggestions).toEqual(["What monitoring is required for lithium?"]);
  });

  it("returns nothing when the subject itself is unsupported by evidence or analysis", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "quetiapine dosing",
      {
        answer: "No indexed guidance was found.",
        grounded: false,
        confidence: "low",
        citations: [],
        sources: [evidenceSource("Monitor renal function and document the review.")],
      },
      ["quetiapine dosing"],
    );

    expect(suggestions).toEqual([]);
  });

  it("does not treat renal as supported by the unrelated word adrenaline", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "renal dosing",
      answerFor({
        query: "renal dosing",
        sources: [evidenceSource("Adrenaline administration requires monitoring and documentation.")],
        analysisOverrides: { canonicalTerms: [], medications: [] },
      }),
      ["renal dosing"],
    );

    expect(suggestions).toEqual([]);
  });

  it("keeps token-bounded multiword subjects and configured inflected evidence", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "renal impairment dosing",
      answerFor({
        query: "renal impairment dosing",
        sources: [evidenceSource("Renal impairment requires ongoing monitoring of serum levels.")],
        analysisOverrides: { canonicalTerms: [], medications: [] },
      }),
      ["renal impairment dosing"],
    );

    expect(suggestions).toContain("What monitoring is required for renal impairment?");
  });
});

describe("buildAnswerFollowUpSuggestions · already-answered suppression", () => {
  it("skips the follow-up for a kind the answer already emitted as a section", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      answerFor({
        sections: [
          {
            heading: "Monitoring and timing",
            body: "Check levels five days after each change.",
            citation_chunk_ids: ["chunk-0"],
            kind: "monitoring_timing",
          },
        ],
      }),
      ["lithium dosing"],
    );

    expect(suggestions.some((item) => /monitoring is required/i.test(item))).toBe(false);
    // The rest of the menu still comes through — suppression is per kind.
    expect(suggestions).toContain("What cautions or contraindications apply to lithium?");
  });

  it("skips a follow-up the answer body already covers", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      answerFor({ answer: "Monitor serum lithium levels five to seven days after every dose change." }),
      ["lithium dosing"],
    );

    expect(suggestions.some((item) => /monitoring is required/i.test(item))).toBe(false);
    expect(suggestions[0]).toBe("What cautions or contraindications apply to lithium?");
  });

  it("keeps a kind whose words appear only in the sources, not in the answer", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      answerFor({ answer: "Start low and titrate against response." }),
      ["lithium dosing"],
    );

    expect(suggestions).toContain("What monitoring is required for lithium?");
  });
});

describe("buildAnswerFollowUpSuggestions · thread and shape rules", () => {
  it.each([
    ["ART dosing", "Arterial monitoring is required.", false],
    ["renal dosing", "Adrenaline monitoring is required.", false],
    ["sodium valproate dosing", "Sodium monitoring and valproate are discussed separately.", false],
    ["sodium valproate dosing", "Sodium monitoring is required.", false],
    ["sodium valproate dosing", "SODIUM-VALPROATE monitoring is required.", true],
    ["ART dosing", "ART: monitoring is required.", true],
  ])("R3 bounds whole subject support for %s / %s", (query, content, supported) => {
    const suggestions = buildAnswerFollowUpSuggestions(
      query,
      answerFor({ query, sources: [{ ...evidenceSource(content), title: "Guidance", section_heading: null }] }),
    );
    expect(suggestions.some((item) => /monitoring is required/i.test(item))).toBe(supported);
  });
  it("never turns a reported gap's prose into a question", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor(),
        conflictsOrGaps: [
          // The real messages `detectConflictsOrGaps` writes: full advisory
          // sentences, one of them two sentences long. Wrapping either in
          // "What does the source say about ...?" cannot produce English, and
          // for a while the live answer page showed exactly that.
          {
            type: "gap",
            message:
              "Current evidence comes from one document; broaden document scope if you need cross-document comparison.",
          },
          {
            type: "conflict",
            message:
              "Sources disagree on the ANC withholding threshold (1.5 vs 2.0). Confirm the correct cut-off against the primary guideline before acting on any single source.",
          },
        ],
      },
      ["lithium dosing"],
    );

    for (const suggestion of suggestions) {
      expect(suggestion).not.toContain("What does the source say about");
      // Every suggestion is one question, so the only sentence-ending
      // punctuation it may carry is its own trailing "?".
      expect(suggestion.slice(0, -1)).not.toMatch(/[.;]/);
      expect(suggestion.endsWith("?")).toBe(true);
    }
    // The gap is not silently dropped: the reader still sees its exact words as
    // a caveat on the answer itself (`answer-render-policy`), and the authored
    // question is offered whenever a slot is free — see the spare-slot test
    // below. Here the four dosing chips fill every slot, and a concrete dosing
    // question outranks a meta-question about coverage.
    expect(suggestions).toHaveLength(4);
    expect(suggestions).not.toContain("What does the indexed guidance not cover for lithium?");
  });

  it("offers a gap's own words when the gap is already a question", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor(),
        conflictsOrGaps: [{ type: "gap", message: "Which guideline governs paediatric dosing?" }],
      },
      ["lithium dosing"],
    );

    expect(suggestions[0]).toBe("Which guideline governs paediatric dosing?");
    // A gap that asked for itself suppresses the generic source-gap template.
    expect(suggestions).not.toContain("What does the indexed guidance not cover for lithium?");
  });

  it("never displaces a concrete menu chip with the gap question", () => {
    // The gap question is offered last and only into a spare slot. Put it first
    // and a gapped medication_dose_risk answer trades the renal/hepatic dosing
    // chip — a concrete, evidence-backed question — for a meta-question about
    // coverage. The gap's own words are already on screen as a caveat, so the
    // chip is the cheaper of the two things to lose.
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor(),
        conflictsOrGaps: [{ type: "gap", message: "Paediatric dosing is not covered." }],
      },
      ["lithium dosing"],
    );

    expect(suggestions).toEqual([
      "What monitoring is required for lithium?",
      "What cautions or contraindications apply to lithium?",
      "What should trigger stopping or escalating lithium?",
      "How is lithium dosed in renal or hepatic impairment?",
    ]);
  });

  it("offers the gap question in a spare slot on a menu that has no gap item", () => {
    // `source_gap` lives only in the `management` menu, so before this a reported
    // gap on any other query class went unmentioned entirely.
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor({ answer: "Monitoring, cautions and escalation are all covered above." }),
        conflictsOrGaps: [{ type: "gap", message: "Paediatric dosing is not covered." }],
      },
      ["lithium dosing"],
    );

    expect(suggestions.length).toBeLessThanOrEqual(4);
    if (suggestions.length < 4) {
      expect(suggestions.at(-1)).toBe("What does the indexed guidance not cover for lithium?");
    }
  });

  it("does not call a conflict a coverage gap", () => {
    // `detectConflictsOrGaps` writes `type: "conflict"` when sources disagree on
    // a withholding threshold. That answer HAS coverage, from several sources —
    // the problem is that they contradict each other — so "What does the indexed
    // guidance not cover?" misstates the evidence and points the clinician at
    // the wrong follow-up.
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor({ answer: "Monitoring, cautions and escalation are all covered above." }),
        conflictsOrGaps: [
          {
            type: "conflict",
            message:
              "Sources disagree on the ANC withholding threshold (1.5 vs 2.0). Confirm the correct cut-off against the primary guideline before acting on any single source.",
          },
        ],
      },
      ["lithium dosing"],
    );

    expect(suggestions).not.toContain("What does the indexed guidance not cover for lithium?");
  });

  it("still offers the gap question when a gap accompanies a conflict", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium dosing",
      {
        ...answerFor({ answer: "Monitoring, cautions and escalation are all covered above." }),
        conflictsOrGaps: [
          { type: "conflict", message: "Sources disagree on the ANC withholding threshold (1.5 vs 2.0)." },
          { type: "gap", message: "Paediatric dosing is not covered." },
        ],
      },
      ["lithium dosing"],
    );

    if (suggestions.length < 4) {
      expect(suggestions).toContain("What does the indexed guidance not cover for lithium?");
    }
  });

  it("stays silent about a gap the answer already has a Source gap section for", () => {
    // The menu loop drops its own `source_gap` template when a section of that
    // kind was emitted; the direct offer has to apply the same rule, or the chip
    // asks what the guidance does not cover directly beneath a section that
    // just said. `source_gap` is a real emitted kind — `rag.ts` maps
    // gap/unsupported/missing/unclear headings onto it.
    const suggestions = buildAnswerFollowUpSuggestions(
      "lithium management",
      {
        ...answerFor({
          query: "lithium management",
          intent: "general",
          answer: "Review the plan at each visit.",
          sections: [
            {
              heading: "Caveat",
              kind: "source_gap",
              body: "The guidance does not cover paediatric use.",
              citation_chunk_ids: [],
            },
          ],
        }),
        conflictsOrGaps: [{ type: "gap", message: "Paediatric dosing is not covered." }],
      },
      ["lithium management"],
    );

    expect(suggestions).not.toContain("What does the indexed guidance not cover for lithium?");
  });

  it("does not call a conflict a coverage gap on the management menu either (#181)", () => {
    // The management menu carries its own `source_gap` template, gated on the
    // `reported_gap` evidence term; a conflict alone must not satisfy it.
    const conflictOnly = buildAnswerFollowUpSuggestions(
      "lithium management",
      {
        ...answerFor({ query: "lithium management", queryClass: "broad_summary", intent: "general" }),
        conflictsOrGaps: [{ type: "conflict", message: "Sources disagree on the ANC withholding threshold." }],
      },
      ["lithium management"],
    );
    const withGap = buildAnswerFollowUpSuggestions(
      "lithium management",
      {
        ...answerFor({ query: "lithium management", queryClass: "broad_summary", intent: "general" }),
        conflictsOrGaps: [{ type: "gap", message: "Paediatric dosing is not covered." }],
      },
      ["lithium management"],
    );

    expect(conflictOnly).not.toContain("What does the indexed guidance not cover for lithium?");
    expect(withGap).toContain("What does the indexed guidance not cover for lithium?");
  });

  it("offers no gap question when the topic is not supported by the evidence", () => {
    // `reportedGapQuestion` interpolates the topic, so offering it past this gate
    // would name a subject the corpus never mentioned.
    const suggestions = buildAnswerFollowUpSuggestions(
      "quetiapine dosing",
      {
        ...answerFor({ query: "quetiapine dosing" }),
        conflictsOrGaps: [{ type: "gap", message: "Paediatric dosing is not covered." }],
      },
      ["quetiapine dosing"],
    );

    expect(suggestions).not.toContain("What does the indexed guidance not cover for quetiapine?");
  });

  it("avoids repeating questions already asked in the thread", () => {
    const suggestions = buildAnswerFollowUpSuggestions("lithium dosing", answerFor(), [
      "lithium dosing",
      "What monitoring is required for lithium?",
    ]);

    expect(suggestions.some((item) => /monitoring is required/i.test(item))).toBe(false);
    expect(suggestions).toContain("What cautions or contraindications apply to lithium?");
  });

  it("anchors the subject on the opening question after a short follow-up turn", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "what about renal impairment?",
      answerFor({ analysisOverrides: { medications: [] } }),
      ["lithium dosing", "what about renal impairment?"],
    );

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => !/for what about renal impairment/i.test(item))).toBe(true);
    expect(suggestions).toContain("What monitoring is required for lithium?");
  });

  it("reads the subject back out of the question so acronyms keep their casing", () => {
    const suggestions = buildAnswerFollowUpSuggestions(
      "ADHD medication monitoring",
      answerFor({
        query: "ADHD medication monitoring",
        queryClass: "broad_summary",
        intent: "protocol",
        answer: "The guideline sets out baseline and ongoing checks.",
        sources: [
          evidenceSource("Offer first-line treatment and document the review on the shared-care form for ADHD."),
        ],
        analysisOverrides: { canonicalTerms: ["adhd"], medications: [] },
      }),
      ["ADHD medication monitoring"],
    );

    expect(suggestions).toEqual(["What is the first-line management for ADHD?", "What should I document for ADHD?"]);
  });

  it("is deterministic — the same answer always yields the same chips", () => {
    const answer = answerFor();
    expect(buildAnswerFollowUpSuggestions("lithium dosing", answer, ["lithium dosing"])).toEqual(
      buildAnswerFollowUpSuggestions("lithium dosing", answer, ["lithium dosing"]),
    );
  });

  it("returns nothing without a prior question", () => {
    expect(buildAnswerFollowUpSuggestions("   ", answerFor())).toEqual([]);
  });
});
