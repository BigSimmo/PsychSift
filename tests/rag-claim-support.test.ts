import { describe, expect, it } from "vitest";

import {
  claimRestatesSourceVerbatim,
  assessAndEnforceClaimSupport,
  assessClaimSupport,
  enforceLabelledNumericBandCoherence,
  sourceDirectlySupportsAnswerText,
  sourceHasLabelledNumericBandConflict,
} from "@/lib/rag/rag-claim-support";
import { reflowBoundedSourceLines } from "@/lib/rag/rag-source-segmentation";
import type { Citation, RagAnswer, SearchResult } from "@/lib/types";

function source(id: string, content: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id,
    document_id: `doc-${id}`,
    title: `Source ${id}`,
    file_name: `${id}.pdf`,
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content,
    image_ids: [],
    images: [],
    similarity: 0.9,
    source_metadata: {
      source_title: `Source ${id}`,
      publisher: "Local service",
      jurisdiction: "WA",
      version: "1",
      publication_date: "2026-01-01",
      review_date: "2027-01-01",
      uploaded_at: "2026-01-01",
      indexed_at: "2026-01-01",
      uploaded_by: null,
      document_status: "current",
      clinical_validation_status: "approved",
      extraction_quality: "good",
    },
    ...overrides,
  };
}

function citation(result: SearchResult, provenance: Citation["provenance"] = "model_selected"): Citation {
  return {
    chunk_id: result.id,
    document_id: result.document_id,
    title: result.title,
    file_name: result.file_name,
    page_number: result.page_number,
    chunk_index: result.chunk_index,
    provenance,
  };
}

function answer(text: string, sources: SearchResult[], citations = sources.map((item) => citation(item))): RagAnswer {
  return {
    answer: text,
    grounded: true,
    confidence: "high",
    citations,
    sources,
    routingMode: "strong",
    responseMode: "clinical_pathway",
  };
}

describe("deterministic claim support", () => {
  it("supports a complete numbered clinical action across a PDF wrap", () => {
    const evidence = source(
      "wrapped-numbered-assessment",
      "2. MO to check the serum lithium level (note time of last dose) and renal function as\nsoon as possible from the time of escalation.\n3. Notify the treating team.",
      { title: "Lithium clinical guideline" },
    );
    expect(
      sourceDirectlySupportsAnswerText(
        "MO to check the serum lithium level (note time of last dose) and renal function as soon as possible from the time of escalation.",
        evidence,
      ),
    ).toBe(true);
    expect(reflowBoundedSourceLines(evidence.content, { requireContinuationStart: true })).toEqual([
      "2. MO to check the serum lithium level (note time of last dose) and renal function as soon as possible from the time of escalation.",
      "3. Notify the treating team.",
    ]);
  });

  it.each(["\n\n", "\n3. ", "\n• "])(
    "does not join a numbered clinical action across a semantic boundary: %j",
    (boundary) => {
      const blocks = reflowBoundedSourceLines(`2. Check the lithium level${boundary}repeat after 12 hours.`, {
        requireContinuationStart: true,
      });
      expect(blocks.some((block) => /Check the lithium level.*repeat after 12 hours/.test(block))).toBe(false);
    },
  );

  it("keeps numbered topic headings separate even when they name an action", () => {
    expect(
      reflowBoundedSourceLines("2. Safety check\nrepeat after 12 hours.", {
        requireContinuationStart: true,
      }),
    ).toEqual(["2. Safety check", "repeat after 12 hours."]);
  });

  describe("A2 R4 preservation boundaries", () => {
    it.each([
      ["INR 2.0", "The INR is 2.0.", true],
      ["The INR is 2.0.", "INR 2.0", true],
      ["INR 2.0", "An INR is 2.0.", true],
      ["INR 2.0", "A pH is 2.0.", false],
      ["pH 2.0", "A pH is 2.0.", true],
      ["INR 2.0", "The INR is not 2.0.", false],
      ["INR not 2.0", "The INR is not 2.0.", true],
      ["INR not 2.0", "The INR is 2.0.", false],
      ["INR 2.0", "The INR may be 2.0.", false],
      ["INR may be 2.0", "The INR may be 2.0.", true],
      ["INR 2.0", "The INR is only 2.0.", false],
      ["INR 2.0", "The INR 2.0 is not the result.", false],
      ["INR 2.0", "Only the INR is 2.0.", false],
    ] as const)("normalizes only harmless leading articles: %s / %s", (claim, passage, supported) => {
      expect(sourceDirectlySupportsAnswerText(claim, source("short-article", passage))).toBe(supported);
    });

    it.each(["title", "section_heading"] as const)("does not borrow an article fact from %s", (field) => {
      const cited = source("article-metadata", "The pH is 2.0.", { [field]: "The INR is 2.0." });
      expect(sourceDirectlySupportsAnswerText("INR 2.0", cited)).toBe(false);
    });

    it.each(
      ["if", "unless", "when"].flatMap((condition) =>
        [false, true].flatMap((supported) => [false, true].map((reverse) => ({ condition, supported, reverse }))),
      ),
    )(
      "retains monitoring beside an independent $condition instruction, supported=$supported reverse=$reverse",
      ({ condition, supported, reverse }) => {
        const monitoring = "Monitor clozapine with regular blood counts";
        const instruction = `${condition} fever occurs, stop Drug B`;
        const candidate = `${(reverse ? [instruction, monitoring] : [monitoring, instruction]).join("; ")}.`;
        const cited = source("independent-condition", `${monitoring}.${supported ? ` ${instruction}.` : ""}`);
        const result = assessAndEnforceClaimSupport(answer(candidate, [cited]));
        expect(result.grounded).toBe(true);
        expect(result.answer).toContain(monitoring);
        expect(result.answer.includes(instruction)).toBe(supported);
        expect(result.citations.map((item) => item.chunk_id)).toEqual([cited.id]);
        expect(result.supportedClaims?.every((claim) => claim.supportStatus === "direct")).toBe(true);
        if (supported) expect(result.answer).toBe(candidate);
        else {
          expect(result.answer.replace(/\.$/, "")).toBe(monitoring);
          expect(result.routingReason).toContain("claim_support_unsupported_claims_withheld");
          expect(result.conflictsOrGaps).toContainEqual({
            type: "gap",
            message: "Answer claims were withheld because their cited evidence did not directly support them.",
          });
        }
      },
    );

    it.each([
      "if Drug B is stopped",
      "unless Drug B is stopped",
      "when Drug B is stopped",
      "if Drug B is stopped, escalate urgently",
      "if fever occurs, stop clozapine",
    ])("keeps a dependent or same-subject safety continuation atomic: %s", (continuation) => {
      const ordinary = "The clinic offers appointments.";
      const monitoring = "Monitor clozapine with regular blood counts";
      const cited = source("dependent-condition", `${ordinary} ${monitoring}.`);
      const result = assessAndEnforceClaimSupport(answer(`${ordinary}\n${monitoring}; ${continuation}.`, [cited]));
      expect(result.grounded).toBe(true);
      expect(result.answer).toBe(ordinary);
      expect(result.conflictsOrGaps?.some((gap) => gap.type === "gap")).toBe(true);
    });
  });
  describe("A2 R3 clause boundaries", () => {
    it.each([
      ["INR 2.0", "INR is 2.0", true],
      ["INR 2.0", "INR is not 2.0", false],
      ["INR 2.0", "Not INR 2.0", false],
      ["INR 2.0", "INR 2.0 is not the result", false],
      ["INR not 2.0", "INR is not 2.0", true],
      ["INR not 2.0", "INR is 2.0", false],
      ["Not INR 2.0", "Not INR 2.0", true],
      ["INR 2.0", "INR may be 2.0", false],
      ["INR may be 2.0", "INR may be 2.0", true],
    ] as const)("binds short fact polarity: %s / %s", (claim, passage, supported) => {
      expect(sourceDirectlySupportsAnswerText(claim, source("short-polarity", passage))).toBe(supported);
    });
    it.each([
      ["title", false],
      ["section_heading", false],
      ["title", true],
      ["section_heading", true],
    ] as const)("binds short fact to passage with %s metadata, actual passage=%s", (field, supported) => {
      const evidence = source("short-metadata", supported ? "INR is 2.0" : "pH 2.0", { [field]: "INR 2.0" });
      expect(sourceDirectlySupportsAnswerText("INR 2.0", evidence)).toBe(supported);
    });
    it.each(
      ["only if", "if", "unless", "when"].flatMap((condition) =>
        [false, true].map((supported) => ({ condition, supported })),
      ),
    )("keeps $condition dependent on the instruction, supported=$supported", ({ condition, supported }) => {
      const ordinary = "The clinic offers appointments.";
      const claim = `Stop Drug A; ${condition} fever occurs.`;
      const evidence = source(
        "conditional",
        `${ordinary} ${supported ? claim : "Stop Drug A when myocarditis develops."}`,
      );
      const result = assessAndEnforceClaimSupport(answer(`${ordinary}\n${claim}`, [evidence]));
      expect(result.grounded).toBe(true);
      expect(result.answer).toContain(ordinary);
      expect(result.answer.includes("Stop Drug A")).toBe(supported);
      expect(result.answer.includes(`${condition} fever occurs`)).toBe(supported);
    });
  });
  describe("A2 R2 review regressions", () => {
    it.each(["lead", "section"].flatMap((scope) => [true, false].map((supported) => ({ scope, supported }))))(
      "preserves short numeric labels in $scope supported=$supported",
      ({ scope, supported }) => {
        const ordinary = "The clinic offers appointments.";
        const primary = source("short-value", `${ordinary} ${supported ? "INR" : "pH"} 2.0`);
        const other = source("uncited-inr", "INR 2.0");
        const input = answer(
          scope === "lead" ? `${ordinary}\nINR 2.0` : ordinary,
          [primary, other],
          [citation(primary)],
        );
        if (scope === "section")
          input.answerSections = [{ heading: "Result", body: "INR 2.0", citation_chunk_ids: [primary.id] }];
        expect(assessClaimSupport(input).claims.find((claim) => claim.text === "INR 2.0")).toMatchObject({
          supportStatus: supported ? "direct" : "unsupported",
          supportingChunkIds: supported ? [primary.id] : [],
        });
        const result = assessAndEnforceClaimSupport(input);
        expect(result.grounded).toBe(true);
        expect(result.answer).toContain(ordinary);
        expect(
          [result.answer, ...(result.answerSections ?? []).map((section) => section.body)]
            .join(" ")
            .includes("INR 2.0"),
        ).toBe(supported);
      },
    );
    it("does not let a title bind another labelled numeric result", () => {
      expect(
        sourceDirectlySupportsAnswerText("INR 2.0", source("labelled", "INR 1.0; pH 2.0", { title: "INR guide" })),
      ).toBe(false);
    });
    it.each([
      "Monitor clozapine with regular blood counts; the clinic opens on Tuesdays.",
      "The clinic opens on Tuesdays; monitor clozapine with regular blood counts.",
    ])("retains the independent supported semicolon clause in %s", (claim) => {
      const result = assessAndEnforceClaimSupport(
        answer(claim, [source("independent-monitor", "Monitor clozapine with regular blood counts.")]),
      );
      expect(result.grounded).toBe(true);
      expect(result.answer).toMatch(/monitor clozapine with regular blood counts/i);
      expect(result.answer).not.toMatch(/Tuesday|clinic/i);
      expect(result.conflictsOrGaps?.some((gap) => gap.type === "gap")).toBe(true);
    });
  });

  describe("A2 R1 review regressions", () => {
    it.each(
      [24, 25].flatMap((position) =>
        ["lead", "section"].flatMap((scope) => [true, false].map((supported) => ({ position, scope, supported }))),
      ),
    )("assesses short directive $position in $scope supported=$supported", ({ position, scope, supported }) => {
      const ordinary = "The clinic offers appointments.";
      const primary = source("short-primary", `${ordinary} ${supported ? "No CPR." : ""}`);
      const uncited = source("short-other", "No CPR.");
      const prose = [...Array.from({ length: position - 1 }, () => ordinary), "No CPR."].join("\n");
      const input = answer(scope === "lead" ? prose : ordinary, [primary, uncited], [citation(primary)]);
      if (scope === "section")
        input.answerSections = [{ heading: "Directive", body: prose, citation_chunk_ids: [primary.id] }];
      const assessed = assessClaimSupport(input);
      expect(assessed.claims.find((claim) => claim.text === "No CPR.")).toMatchObject({
        supportStatus: supported ? "direct" : "unsupported",
        supportingChunkIds: supported ? [primary.id] : [],
      });
      const result = assessAndEnforceClaimSupport(input);
      const displayed = [result.answer, ...(result.answerSections ?? []).map((section) => section.body)].join("\n");
      expect(result.grounded).toBe(true);
      expect(displayed).toContain(ordinary);
      expect(displayed.includes("No CPR.")).toBe(supported);
    });

    it.each([
      [
        "Sleep loss causes fatigue and stress causes anxiety.",
        "Sleep loss causes fatigue and stress causes anxiety.",
        true,
      ],
      [
        "Sleep loss causes fatigue and stress causes anxiety.",
        "Sleep loss causes anxiety and stress causes fatigue.",
        false,
      ],
      [
        "Sleep loss causes anxiety and stress causes fatigue.",
        "Sleep loss causes anxiety and stress causes fatigue.",
        true,
      ],
      [
        "Sleep loss causes anxiety and stress causes fatigue.",
        "Sleep loss causes fatigue and stress causes anxiety.",
        false,
      ],
    ] as const)("binds each compound relation: %s / %s", (evidence, claim, supported) => {
      const cited = source("compound", evidence);
      expect(sourceDirectlySupportsAnswerText(claim, cited)).toBe(supported);
      expect(assessAndEnforceClaimSupport(answer(claim, [cited])).grounded).toBe(supported);
    });

    it.each([
      ["Sleep loss can cause fatigue.", "Sleep loss can result in fatigue.", true],
      ["Sleep loss can result in fatigue.", "Sleep loss can cause fatigue.", true],
      ["In adults, sleep loss can cause fatigue.", "In adults, sleep loss can result in fatigue.", true],
      ["In adults, sleep loss can cause fatigue.", "In children, sleep loss can result in fatigue.", false],
    ] as const)("keeps predicate complements out of population scope: %s / %s", (claim, evidence, supported) => {
      expect(sourceDirectlySupportsAnswerText(claim, source("complement", evidence))).toBe(supported);
    });

    it.each([true, false])("keeps semicolon-then safety coordination atomic supported=%s", (supported) => {
      const cited = source(
        "coordination",
        supported ? "Stop Drug A; then escalate urgently." : "Stop Drug A; urgent escalation is not required.",
      );
      const result = assessAndEnforceClaimSupport(answer("Stop Drug A; then escalate urgently.", [cited]));
      expect(result.grounded).toBe(supported);
      if (supported) expect(result.answer).toContain("then escalate urgently");
      else expect(result.answer).not.toContain("Stop Drug A");
    });
    it("retains an independent supported sentence beside failed semicolon coordination", () => {
      const cited = source(
        "independent",
        "The clinic offers appointments. Stop Drug A; urgent escalation is not required.",
      );
      const result = assessAndEnforceClaimSupport(
        answer("The clinic offers appointments. Stop Drug A; then escalate urgently.", [cited]),
      );
      expect(result.grounded).toBe(true);
      expect(result.answer).toBe("The clinic offers appointments.");
    });
  });

  describe("A2 every displayed claim", () => {
    it.each(
      [24, 25].flatMap((position) =>
        ["lead", "section"].flatMap((scope) =>
          ["numeric", "nonnumeric"].flatMap((kind) =>
            [true, false].map((supported) => ({ position, scope, kind, supported })),
          ),
        ),
      ),
    )("assesses position $position in $scope: $kind supported=$supported", ({ position, scope, kind, supported }) => {
      const ordinary = "The clinic offers appointments.";
      const tail = kind === "numeric" ? "Give Drug A 300 mg." : "Counselling improves wellbeing.";
      const primary = source("primary", `${ordinary} ${supported ? tail : ""}`);
      const other = source("other", tail);
      const prose = [...Array.from({ length: position - 1 }, () => ordinary), tail].join("\n");
      const input = answer(scope === "lead" ? prose : ordinary, [primary, other], [citation(primary)]);
      input.answerSections =
        scope === "section"
          ? [{ heading: "Details", body: prose, citation_chunk_ids: [primary.id] }]
          : [{ heading: "Independent", body: ordinary, citation_chunk_ids: [primary.id] }];
      const assessed = assessClaimSupport(input);
      expect(assessed.claims).toHaveLength(position + 1);
      const assessedTail = assessed.claims.find((claim) => claim.text === tail);
      expect(assessedTail?.supportStatus).toBe(supported ? "direct" : "unsupported");
      expect(assessedTail?.supportingChunkIds).toEqual(supported ? [primary.id] : []);
      const result = assessAndEnforceClaimSupport(input);
      const displayed = [result.answer, ...(result.answerSections ?? []).map((section) => section.body)].join("\n");
      expect(result.grounded).toBe(true);
      expect(displayed).toContain(ordinary);
      if (supported) expect(displayed).toContain(tail);
      else expect(displayed).not.toContain(tail);
      expect(result.supportedClaims?.every((claim) => claim.supportStatus === "direct")).toBe(true);
    });
  });

  describe("A2 relationship support", () => {
    const claim = "In adults, sleep loss can cause fatigue.";
    it.each([
      ["direct paraphrase", "In adults, sleep loss may lead to fatigue.", true],
      ["passive paraphrase", "In adults, fatigue may be caused by sleep loss.", true],
      ["explanatory paraphrase", "Fatigue can result from sleep loss in adults.", true],
      ["co-occurrence", "In adults, sleep loss and fatigue were recorded.", false],
      ["reversal", "In adults, fatigue can cause sleep loss.", false],
      ["negation", "In adults, sleep loss does not cause fatigue.", false],
      ["negated object", "In adults, sleep loss causes no fatigue.", false],
      ["population shift", "In children, sleep loss can cause fatigue.", false],
      ["qualified association", "In adults, sleep loss is associated with fatigue.", false],
      ["dropped qualification", "In adults, severe sleep loss can cause fatigue.", false],
      ["dropped condition", "In adults, sleep loss can cause fatigue if ill.", false],
    ] as const)("distinguishes %s from causal support", (_label, evidence, supported) => {
      const cited = source("relation", evidence);
      expect(sourceDirectlySupportsAnswerText(claim, cited)).toBe(supported);
      const result = assessAndEnforceClaimSupport(answer(claim, [cited]));
      expect(result.grounded).toBe(supported);
    });
    it.each([
      ["Fatigue is higher than alertness in adults.", true],
      ["Alertness is higher than fatigue in adults.", false],
      ["Fatigue is lower than alertness in adults.", false],
      ["Fatigue and alertness were assessed in adults.", false],
    ] as const)("binds comparison direction in %s", (evidence, supported) => {
      expect(
        sourceDirectlySupportsAnswerText(
          "In adults, fatigue is higher than alertness.",
          source("comparison", evidence),
        ),
      ).toBe(supported);
    });
    it("rejects overgeneralization while retaining the independently supported lead", () => {
      const cited = source("relation", "The clinic offers appointments. In adults, sleep loss may lead to fatigue.");
      const input = answer("The clinic offers appointments.", [cited]);
      input.answerSections = [
        {
          heading: "Explanation",
          body: "Sleep loss always causes fatigue in everyone.",
          citation_chunk_ids: [cited.id],
        },
      ];
      const result = assessAndEnforceClaimSupport(input);
      expect(result.grounded).toBe(true);
      expect(result.answer).toBe(input.answer);
      expect(result.answerSections).toEqual([]);
      expect(result.conflictsOrGaps?.some((gap) => gap.type === "gap")).toBe(true);
    });
    it.each([
      ["Counselling improves wellbeing.", true],
      ["Counselling and wellbeing were recorded.", false],
      ["Counselling does not improve wellbeing.", false],
    ] as const)("requires the asserted improvement in %s", (evidence, supported) => {
      expect(sourceDirectlySupportsAnswerText("Counselling improves wellbeing.", source("improvement", evidence))).toBe(
        supported,
      );
    });
  });

  it("uses the exact packed verification corpus instead of a wider unpacked source corpus", () => {
    const unpacked = source("packed-corpus", "See the selected management passage.");
    const packed = { ...unpacked, content: "Stop clozapine when ANC is below 1.0 x10^9/L." };
    const input = answer("Stop clozapine when ANC is below 1.0 x10^9/L.", [unpacked]);

    expect(assessAndEnforceClaimSupport(input).responseMode).toBe("evidence_gap");
    const verified = assessAndEnforceClaimSupport(input, [packed]);
    expect(verified.responseMode).not.toBe("evidence_gap");
    expect(verified.supportedClaims?.[0]?.supportingChunkIds).toEqual(["packed-corpus"]);
  });

  it("keeps an ordinal repeat-dose interval atomic when matching the observed wrapped source", () => {
    const claim =
      "Olanzapine IM may be repeated after 2 hours and a third dose 6 hours after the first dose if required — Total of 3 doses or 30mg maximum in 24 hours (10mg maximum in 24 hours for older adults over 65 years) whichever occurs first.";
    const evidence = source(
      "olanzapine-repeat-dose",
      [
        "Olanzapine IM may be repeated after 2 hours and a third dose 6 hours after the",
        "first dose if required. Total of 3 doses or 30mg maximum in 24 hours (10mg",
        "maximum in 24 hours for older adults over 65 years) whichever occurs first.",
      ].join("\n"),
    );

    expect(sourceDirectlySupportsAnswerText(claim, evidence)).toBe(true);
  });

  it("reflows visual wraps while preserving bullets and numbered headings", () => {
    expect(
      reflowBoundedSourceLines(
        [
          "Where the ANC is below",
          "1.0 x10^9/L.",
          "",
          "- First requirement",
          "continued line",
          "- Second requirement",
          "2.2 Admissions Accompanied by Police",
          "Section label:",
          "Final line",
        ].join("\n"),
      ),
    ).toEqual([
      "Where the ANC is below 1.0 x10^9/L.",
      "- First requirement continued line",
      "- Second requirement",
      "2.2 Admissions Accompanied by Police",
      "Section label:",
      "Final line",
    ]);
  });

  it("supports a claim restating a source sentence split by a PDF visual line wrap (#231)", () => {
    // Measured live 2026-08-17: the EMHS lithium guideline's starting-dose bullet wraps
    // mid-sentence, so segment-splitting on raw newlines separated 500 mg/over-65 from
    // 250 mg and a verbatim-faithful high-risk claim read as unsupported.
    const wrappedDoseBullet = source(
      "wrapped-dose-bullet",
      [
        "Dosage and administration",
        "",
        "• The usual oral starting dose for adults is 500 mg nocte and for patients over 65 years it",
        "is 250 mg nocte.",
        "• Dose should be titrated against target serum levels.",
      ].join("\n"),
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );
    const input = answer(
      "The usual oral starting dose for adults is 500 mg nocte and for patients over 65 years it is 250 mg nocte.",
      [wrappedDoseBullet],
    );

    const { claims } = assessClaimSupport(input);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.supportStatus).toBe("direct");
    expect(claims[0]?.supportingChunkIds).toEqual(["wrapped-dose-bullet"]);
  });

  it("supports an imperative dosing claim against descriptive guideline norm phrasing (S1c R2)", () => {
    // R2: "The usual … starting dose … is 500 mg" is a descriptive norm. The imperative
    // claim expects a normative "start" signal, which no prior pattern produced.
    const emhs = source(
      "emhs-lithium-dosing",
      [
        "Dosage and administration",
        "",
        "• The usual oral starting dose for adults is 500 mg nocte and for patients over 65 years it",
        "is 250 mg nocte.",
        "• Dose should be titrated against target serum levels.",
      ].join("\n"),
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );

    expect(sourceDirectlySupportsAnswerText("Start lithium at 500 mg nocte.", emhs)).toBe(true);
  });

  it("keeps rejecting imperative claims whose only echo is descriptive care-record prose (S1c R2 negative)", () => {
    const chartRecord = source(
      "chart-record",
      "Progress notes: the patient was started on lithium 500 mg nocte at this visit.",
    );

    expect(sourceDirectlySupportsAnswerText("Start lithium at 500 mg nocte.", chartRecord)).toBe(false);
  });

  it("does not let a norm phrase for one action lend normativity to an unrelated imperative (S1c R2 negatives)", () => {
    const sameSentence = source(
      "stop-same-sentence",
      "The usual practice after abrupt stopping of lithium is that the dose is reduced.",
    );
    const crossSentence = source(
      "stop-cross-sentence",
      "The usual oral starting dose for adults is 500 mg nocte. Abrupt stopping is associated with relapse.",
      { title: "Lithium Clinical Guideline(EMHS)" },
    );

    expect(sourceDirectlySupportsAnswerText("Stop lithium.", sameSentence)).toBe(false);
    expect(sourceDirectlySupportsAnswerText("Stop lithium.", crossSentence)).toBe(false);
  });

  it("does not read incidental norm-adjacent action words as normative directives (S1c R2 negatives)", () => {
    const repeatedDoseWarning = source(
      "repeated-dose-warning",
      "A typical error is a repeated dose when the schedule is unclear.",
    );
    const monitoredPatientDescription = source(
      "monitored-patient",
      "The typical patient monitored on this dose is reviewed weekly.",
    );
    const startingWeightRecord = source("starting-weight", "The usual practice is to record the starting weight.");

    expect(sourceDirectlySupportsAnswerText("Repeat the dose.", repeatedDoseWarning)).toBe(false);
    expect(sourceDirectlySupportsAnswerText("Monitor the dose weekly.", monitoredPatientDescription)).toBe(false);
    expect(sourceDirectlySupportsAnswerText("Start lithium at 500 mg nocte.", startingWeightRecord)).toBe(false);
  });

  it("still requires the claimed medication itself in the dosing evidence (S1c R2 negative)", () => {
    const emhs = source(
      "emhs-lithium-entity",
      "• The usual oral starting dose for adults is 500 mg nocte and for patients over 65 years it\nis 250 mg nocte.",
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );

    expect(sourceDirectlySupportsAnswerText("Start sertraline at 500 mg nocte.", emhs)).toBe(false);
  });

  it("requires normative evidence for a descriptive-norm claim rather than incidental care history (S1c R2 pin)", () => {
    // R2 also grows the CLAIM side: a descriptive-norm claim now expects normative
    // evidence, so an incidental care-history sentence stops counting as support.
    const careHistory = source("care-history", "Patients were started on an average dose of 500 mg nocte.");

    expect(sourceDirectlySupportsAnswerText("The usual starting dose is 500 mg nocte.", careHistory)).toBe(false);
  });

  it("supports a claim synthesising two adjacent source bullets when one segment carries every atom (S1c R3)", () => {
    const emhs = source(
      "emhs-lithium-synthesis",
      [
        "Dosage and administration",
        "",
        "• The usual oral starting dose for adults is 500 mg nocte and for patients over 65 years it",
        "is 250 mg nocte.",
        "• Dose should be titrated against target serum levels.",
      ].join("\n"),
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Start lithium at 500 mg nocte and titrate the dose against target serum levels.",
        emhs,
      ),
    ).toBe(true);
  });

  it("does not borrow topics from an adjacent bullet that carries its own competing dose atoms (S1c R3 negative)", () => {
    // Cross-bullet value mis-binding: the over-65 population must not be bound to the
    // adult dose merely because the two bullets are adjacent.
    const perPopulationBullets = source(
      "per-population-bullets",
      [
        "• Adults: the usual starting dose is 500 mg nocte.",
        "• Patients over 65 years: the usual starting dose is 250 mg nocte.",
      ].join("\n"),
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "For patients over 65 years, start lithium at 500 mg nocte.",
        perPopulationBullets,
      ),
    ).toBe(false);
  });

  it("does not synthesise support across non-adjacent segments (S1c R3 negative)", () => {
    const spacedBullets = source(
      "spaced-bullets",
      [
        "• The usual oral starting dose for adults is 500 mg nocte.",
        "• Dose should be titrated against target serum levels.",
        "• Take samples 12 hours after the last evening dose.",
        "• Annual thyroid function testing is recommended.",
      ].join("\n"),
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Start lithium at 500 mg nocte and arrange annual thyroid function testing.",
        spacedBullets,
      ),
    ).toBe(false);
  });

  it("keeps rejecting an alien-topic claim whose atoms coincidentally match the dosing bullet (S1c R3 negative)", () => {
    const emhs = source(
      "emhs-lithium-alien-topic",
      [
        "• The usual oral starting dose for adults is 500 mg nocte and for patients over 65 years it",
        "is 250 mg nocte.",
        "• Dose should be titrated against target serum levels.",
      ].join("\n"),
      { title: "Lithium Clinical Guideline(EMHS)", file_name: "Lithium Clinical Guideline(EMHS).pdf" },
    );

    expect(
      sourceDirectlySupportsAnswerText("Start lithium at 500 mg nocte to prevent migraine recurrence.", emhs),
    ).toBe(false);
  });

  it("keeps a wrapped escalation recipient in the directly supporting source segment", () => {
    const wrappedRule = source(
      "wrapped-escalation-rule",
      [
        "• Side effects are noted as causing distress to the patient, the LUNSERS should be repeated",
        "3-monthly. Any side effect which is causing distress irrespective of score should be escalated",
        "to the treating doctor and reviewed.",
      ].join("\n"),
      {
        title: "Neuroleptic Side Effects (AKG)",
        file_name: "Neuroleptic Side Effects (AKG).pdf",
      },
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Any side effect which is causing distress irrespective of score should be escalated to the treating doctor and reviewed.",
        wrappedRule,
      ),
    ).toBe(true);
  });

  it("preserves inline comparison operators while removing true blockquote markup", () => {
    const exact = source(
      "exact",
      "Escalate when the score is very high (>101). Review a level below <2.0 with the treating doctor.",
    );
    const missingComparator = source(
      "missing-comparator",
      "Escalate when the score is very high (101). Review a level of 2.0 with the treating doctor.",
    );

    expect(sourceDirectlySupportsAnswerText("> Escalate when the score is very high (>101).", exact)).toBe(true);
    expect(assessClaimSupport(answer("> Escalate when the score is very high (>101).", [exact])).claims[0]?.text).toBe(
      "Escalate when the score is very high (>101).",
    );
    expect(
      sourceDirectlySupportsAnswerText(">101 requires escalation.", source("line-start", ">101 requires escalation.")),
    ).toBe(true);
    expect(
      sourceDirectlySupportsAnswerText(
        "> 101 requires escalation.",
        source("line-start-spaced", "> 101 requires escalation."),
      ),
    ).toBe(true);
    expect(sourceDirectlySupportsAnswerText("Review a level below <2.0 with the treating doctor.", exact)).toBe(true);
    expect(sourceDirectlySupportsAnswerText("Escalate when the score is very high (>101).", missingComparator)).toBe(
      false,
    );
    expect(
      sourceDirectlySupportsAnswerText("Review a level below <2.0 with the treating doctor.", missingComparator),
    ).toBe(false);
  });

  it("does not recover conflicting bands from review-only evidence", () => {
    const evidence = source(
      "review",
      "Scores are medium (41-89) or high (81-100). Any side effect causing distress should be escalated.",
    );
    const input = answer(
      "Escalate when the score is medium (41-89) or high (81-100), or whenever a side effect causes distress.",
      [evidence],
      [citation(evidence, "review_only")],
    );

    expect(enforceLabelledNumericBandCoherence(input)).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      responseMode: "evidence_gap",
      citations: [],
    });
  });

  it("fails closed when overlapping bands have no explicit nonnumeric alternative", () => {
    const evidence = source("conflict", "Escalate when the score is medium (41-89) or high (81-100).");
    const input = answer(evidence.content, [evidence], [citation(evidence)]);

    expect(enforceLabelledNumericBandCoherence(input)).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      responseMode: "evidence_gap",
      citations: [],
    });
  });

  it("does not treat positive escalation evidence as support for a negative instruction", () => {
    const positive = source(
      "positive-escalation",
      "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Do not escalate a neuroleptic side effect causing distress to the treating doctor.",
        positive,
      ),
    ).toBe(false);
  });

  it.each([
    "Escalation is not indicated for a neuroleptic side effect causing distress.",
    "No escalation is required for a neuroleptic side effect causing distress.",
    "Escalation should not be undertaken for a neuroleptic side effect causing distress.",
    "Escalation is unnecessary for a neuroleptic side effect causing distress.",
    "Need not escalate a neuroleptic side effect causing distress.",
    "Neuroleptic side effects should not be escalated when they cause distress.",
    "Neuroleptic side effects are not to be escalated when they cause distress.",
    "Do not urgently escalate neuroleptic side effects causing distress.",
    "Neuroleptic side effects should never be escalated when they cause distress.",
  ])("recognizes negative escalation wording: %s", (claim) => {
    const positive = source(
      "positive-escalation-variant",
      "Escalation is indicated for any neuroleptic side effect causing distress.",
    );

    expect(sourceDirectlySupportsAnswerText(claim, positive)).toBe(false);
  });

  it.each([
    [
      "Clozapine should not be stopped when myocarditis is suspected.",
      "Clozapine should be stopped when myocarditis is suspected.",
    ],
    [
      "Clozapine should definitely not be stopped when myocarditis is suspected.",
      "Clozapine should be stopped when myocarditis is suspected.",
    ],
    [
      "Clozapine should under no circumstances be stopped when myocarditis is suspected.",
      "Clozapine should be stopped when myocarditis is suspected.",
    ],
    [
      "Valproate should not be used during pregnancy.",
      "Valproate may be used during pregnancy after specialist review.",
    ],
    [
      "Valproate is not to be used during pregnancy.",
      "Valproate may be used during pregnancy after specialist review.",
    ],
    ["Do not continue clozapine when myocarditis is suspected.", "Continue clozapine when myocarditis is suspected."],
    [
      "Clozapine should not be continued when myocarditis is suspected.",
      "Clozapine should be continued when myocarditis is suspected.",
    ],
    ["Do not administer clozapine for agitation.", "Administer clozapine for agitation."],
    ["Clozapine should not be administered for agitation.", "Clozapine should be administered for agitation."],
    [
      "Stopping clozapine is not recommended when myocarditis is suspected.",
      "Stopping clozapine is recommended when myocarditis is suspected.",
    ],
    ["Refrain from stopping clozapine when myocarditis is suspected.", "Stop clozapine when myocarditis is suspected."],
    [
      "Clozapine discontinuation is not indicated for myocarditis.",
      "Clozapine discontinuation is indicated for myocarditis.",
    ],
    [
      "Administration of clozapine is not recommended for agitation.",
      "Administration of clozapine is recommended for agitation.",
    ],
    [
      "Continuing clozapine is not recommended for myocarditis.",
      "Continuing clozapine is recommended for myocarditis.",
    ],
    [
      "Stopping clozapine is generally not recommended when myocarditis is suspected.",
      "Stopping clozapine is recommended when myocarditis is suspected.",
    ],
    [
      "Stopping clozapine is not usually recommended when myocarditis is suspected.",
      "Stopping clozapine is recommended when myocarditis is suspected.",
    ],
    [
      "Stopping clozapine is certainly not indicated when myocarditis is suspected.",
      "Stopping clozapine is indicated when myocarditis is suspected.",
    ],
    ["Sedation is unnecessary for an agitated patient.", "Sedation is necessary for an agitated patient."],
    ["No restraint is needed for an agitated patient.", "Restraint is needed for an agitated patient."],
    ["Transfer is unwarranted after assessment.", "Transfer is warranted after assessment."],
    ["Sedation is not needed for an agitated patient.", "Sedation is needed for an agitated patient."],
    ["No need to sedate an agitated patient.", "Sedate an agitated patient."],
    [
      "It is not indicated to administer clozapine after myocarditis.",
      "Administration of clozapine is indicated after myocarditis.",
    ],
    [
      "There is no indication to administer clozapine after myocarditis.",
      "Administration of clozapine is indicated after myocarditis.",
    ],
    [
      "There is no indication for administration of clozapine after myocarditis.",
      "Administration of clozapine is indicated after myocarditis.",
    ],
    ["Do not need to administer clozapine after myocarditis.", "Administer clozapine after myocarditis."],
    [
      "Clozapine should not ever be stopped when myocarditis is suspected.",
      "Clozapine should be stopped when myocarditis is suspected.",
    ],
  ])("does not invert a negated clinical directive: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("opposite-directive", evidenceText))).toBe(false);
  });

  it("requires normative escalation evidence rather than a descriptive noun mention", () => {
    const descriptive = source(
      "escalation-record",
      "The neuroleptic side effect escalation record includes patient distress and treating doctor contact.",
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Escalate any neuroleptic side effect causing distress to the treating doctor.",
        descriptive,
      ),
    ).toBe(false);
  });

  it.each([
    [
      "Escalate any neuroleptic side effect causing distress to the treating doctor.",
      "In one audit case, a neuroleptic side effect causing distress was escalated to the treating doctor.",
    ],
    [
      "Escalate any neuroleptic side effect causing distress to the treating doctor.",
      "The record states that a neuroleptic side effect causing distress is escalated to the treating doctor.",
    ],
    ["Sedate the agitated patient.", "The agitated patient sedation record was completed."],
    ["Admit the agitated patient.", "The agitated patient admission record was completed."],
    ["Restraint is required for agitation.", "Document restraint used for agitation."],
    ["Sedation is required for agitation.", "Document sedation used for agitation."],
    ["Admission is required after assessment.", "Document admission decisions after assessment."],
    ["Referral is required after review.", "Document referral outcomes after review."],
  ])("does not treat a descriptive action record as prescriptive support: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("descriptive-action", evidenceText))).toBe(false);
  });

  it.each([
    ["Sedate the agitated patient.", "Sedate the agitated patient."],
    ["Admission is required after assessment.", "Admission is required after assessment."],
    ["Referral is required after review.", "Referral is required after review."],
    [
      "Escalate any neuroleptic side effect causing distress to the treating doctor.",
      "Whenever a neuroleptic side effect causes distress, escalate it to the treating doctor.",
    ],
    [
      "Escalate any neuroleptic side effect causing distress to the treating doctor.",
      "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
    ],
  ])("retains direct support for a genuinely prescriptive action: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("prescriptive-action", evidenceText))).toBe(true);
  });

  it.each([
    ["Admit patients with severe agitation.", "Patients with severe agitation are admitted."],
    ["Refer patients after specialist review.", "Patients are referred after specialist review."],
    ["Transfer the patient after assessment.", "The patient is transferred after assessment."],
    ["Escalate side effects causing distress.", "Side effects causing distress are escalated."],
  ])("accepts generic present-passive policy guidance: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("present-passive-policy", evidenceText))).toBe(true);
  });

  it.each([
    ["Restrain the agitated patient.", "A historical audit found restraint was required for agitation."],
    ["Sedate the agitated patient.", "The case record stated sedation was necessary for agitation."],
    ["Transfer the patient after assessment.", "A historical audit found transfer was warranted after assessment."],
    ["Admit the patient after assessment.", "The case report said admission was indicated after assessment."],
  ])("rejects historical noun-predicate action evidence: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("historical-action", evidenceText))).toBe(false);
  });

  it.each([
    [
      "Escalate any neuroleptic side effect causing distress to the treating doctor.",
      "The patient chart shows that a neuroleptic side effect causing distress is escalated to the treating doctor.",
    ],
    ["Sedate the agitated patient.", "The progress note says the agitated patient is sedated."],
    ["Restrain the agitated patient.", "The EHR shows that the agitated patient is restrained."],
    ["Refer the patient after review.", "At this visit the patient is referred after review."],
  ])("rejects patient-record present-passive action evidence: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("patient-record-action", evidenceText))).toBe(false);
  });

  it.each([
    "When neuroleptic side effects cause distress, assessment and escalation are recommended.",
    "When neuroleptic side effects cause distress, review is required and escalation is recommended.",
  ])("retains a shared condition for coordinated prescriptive actions: %s", (evidenceText) => {
    expect(
      sourceDirectlySupportsAnswerText(
        "Escalate neuroleptic side effects whenever distress occurs.",
        source("coordinated-action", evidenceText),
      ),
    ).toBe(true);
  });

  it("does not treat topical-only evidence as direct support for escalation", () => {
    const topical = source(
      "topical-only",
      "Neuroleptic side effects causing distress are recorded during routine monitoring.",
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Escalate any neuroleptic side effect causing distress to the treating doctor.",
        topical,
      ),
    ).toBe(false);
  });

  it.each([
    "Any neuroleptic side effect causing a rash should be escalated to the treating doctor.",
    "Any mild neuroleptic side effect should be escalated to the treating doctor.",
    "Any neuroleptic side effect that is recorded should be escalated to the treating doctor.",
  ])("does not substitute a different trigger for whenever-distress escalation: %s", (content) => {
    expect(
      sourceDirectlySupportsAnswerText(
        "Escalate neuroleptic side effects whenever any side effect is causing the patient distress.",
        source("different-trigger", content),
      ),
    ).toBe(false);
  });

  it.each([
    "A neuroleptic side effect causing distress is recorded during monitoring. Escalate neuroleptic side effects whenever a rash occurs.",
    "A neuroleptic side effect causing distress is recorded, but a rash should be escalated.",
    "Escalate chest pain to the treating doctor, while a neuroleptic side effect causing distress should be recorded.",
    "Distress occurs during neuroleptic side-effect monitoring and escalation is recommended only for rash.",
    "Any neuroleptic side effect causes distress during monitoring and escalation is recommended only for rash.",
  ])("does not combine action and trigger support across evidence clauses: %s", (content) => {
    expect(
      sourceDirectlySupportsAnswerText(
        "Escalate neuroleptic side effects whenever any side effect is causing distress.",
        source("split-support", content),
      ),
    ).toBe(false);
  });

  it("requires every action in a compound generated answer", () => {
    expect(
      sourceDirectlySupportsAnswerText(
        "Escalate neuroleptic side effects causing distress; stop the medicine.",
        source("stop-only", "Stop the medicine when clinically indicated."),
      ),
    ).toBe(false);
  });

  it("does not treat descriptive restraint evidence as support for sedation", () => {
    expect(
      sourceDirectlySupportsAnswerText(
        "Sedate the agitated patient using physical restraint.",
        source("restraint-record", "Assess the agitated patient and document any physical restraint."),
      ),
    ).toBe(false);
  });

  it.each([
    ["Give diazepam 10 mg orally.", "Give lorazepam 10 mg orally."],
    ["Give acamprosate 333 mg three times daily.", "Give naltrexone 333 mg three times daily."],
    ["Administer promethazine 25 mg intramuscularly.", "Administer droperidol 25 mg intramuscularly."],
    ["Start mirtazapine 15 mg nightly.", "Start trazodone 15 mg nightly."],
  ])("does not bind a medication value to a different medicine: %s", (claim, evidenceText) => {
    expect(sourceDirectlySupportsAnswerText(claim, source("foreign-medication", evidenceText))).toBe(false);
  });

  it("does not borrow the requested medication from a mixed-document title", () => {
    const mixed = source("mixed-title-medication", "Give lorazepam 10 mg orally.", {
      title: "Diazepam and lorazepam guidance",
    });
    expect(sourceDirectlySupportsAnswerText("Give diazepam 10 mg orally.", mixed)).toBe(false);
  });

  it("does not manufacture support by reflowing unrelated high-risk source lines", () => {
    const stopAndStart = source("separate-stop-start", "Stop clozapine\nStarting dose 12.5 mg");
    expect(sourceDirectlySupportsAnswerText("Stop clozapine at 12.5 mg.", stopAndStart)).toBe(false);

    const crossRoute = source(
      "separate-route-lines",
      "Oral olanzapine 10 mg\nRestraint protocol\nIntramuscular administration is required.",
      {
        title: "Olanzapine clinical guidance",
        section_heading: "Dosing and restraint",
      },
    );
    expect(sourceDirectlySupportsAnswerText("Give olanzapine 10 mg intramuscularly.", crossRoute)).toBe(false);
  });

  it("reflows the bounded admission-policy requirement used by the comparison fallback", () => {
    const admissionPolicy = source(
      "admission-policy-wrap",
      [
        "When emergency admission is required, the referring clinician will",
        "provide a medical clearance before transfer.",
        "2.2 Admissions Accompanied by Police",
      ].join("\n"),
      {
        title: "Admission Of Community Patients",
        file_name: "MHSP.AdmissionCommunityPts.pdf",
      },
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "When emergency admission is required, the referring clinician will provide a medical clearance before transfer.",
        admissionPolicy,
      ),
    ).toBe(true);
  });

  it("reflows the actual hosted AKG admission filename without weakening unrelated line boundaries", () => {
    const admissionPolicy = source(
      "hosted-admission-policy-wrap",
      [
        "Where there are indications of intoxication or physical health issues, the referring clinician will",
        "provide a medical clearance or if the consumer is a being referred from AKG Community Mental",
        "health team member then they are to be referred to the Armadale Health Service Emergency",
        "Department (AHS-ED) to obtain medical clearance.",
        "The Bed flow coordinator will arrange the prioritisation of beds.",
      ].join("\n"),
      {
        title: "Admission Of Community Patients(AKG)",
        file_name: "Admission of Community Patients (AKG).pdf",
      },
    );

    expect(
      sourceDirectlySupportsAnswerText(
        "Where there are indications of intoxication or physical health issues, the referring clinician will provide a medical clearance or if the consumer is a being referred from AKG Community Mental health team member then they are to be referred to the Armadale Health Service Emergency Department (AHS-ED) to obtain medical clearance.",
        admissionPolicy,
      ),
    ).toBe(true);
    expect(sourceDirectlySupportsAnswerText("The clinician must sedate the patient.", admissionPolicy)).toBe(false);
  });

  it.each([
    "Do not use routine restraint. Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
    "Stop the questionnaire if incomplete. Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
  ])("finds directly supporting escalation in a mixed-directive chunk: %s", (content) => {
    expect(
      sourceDirectlySupportsAnswerText(
        "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
        source("mixed-directives", content),
      ),
    ).toBe(true);
  });

  it("fails closed when a generated single band comes from a source with contradictory bands", () => {
    const evidence = source(
      "contradictory-source",
      "LUNSERS score bands are medium (41-89), high (81-100), and very high (>101). Escalate neuroleptic side effects when the score is high (81-100).",
    );
    const input = answer(
      "Escalate neuroleptic side effects when the score is high (81-100).",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      responseMode: "evidence_gap",
      citations: [],
    });
  });

  it("checks contradictory review-due sources rather than treating weak governance as safe", () => {
    const evidence = source(
      "review-due-source",
      "LUNSERS score bands are medium (41-89), high (81-100), and very high (>101). Escalate neuroleptic side effects when the score is high (81-100).",
      {
        source_metadata: {
          ...source("metadata", "metadata").source_metadata!,
          document_status: "review_due",
        },
      },
    );
    const input = answer(
      "Escalate neuroleptic side effects when the score is high (81-100).",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
    });
  });

  it("checks an unlabelled score range against the cited source's full bands", () => {
    const evidence = source(
      "unlabelled-range-source",
      "LUNSERS score bands are medium (41-89), high (81-100), and very high (>101). Escalate neuroleptic side effects when the LUNSERS score is 81-100.",
    );
    const input = answer(
      "Escalate neuroleptic side effects when the LUNSERS score is 81-100.",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
    });
  });

  it("detects contradictory bands split across rows of one structured table", () => {
    const evidence = source(
      "table-bands",
      "Escalate neuroleptic side effects when the LUNSERS score is high (81-100).",
      {
        table_facts: [
          ["medium", "41-89"],
          ["high", "81-100"],
          ["very high", ">101"],
        ].map(([label, threshold], index) => ({
          id: `fact-${index}`,
          document_id: "doc-table-bands",
          source_chunk_id: "table-bands",
          source_image_id: null,
          page_number: 1,
          table_title: "LUNSERS score bands",
          row_label: label,
          clinical_parameter: "LUNSERS score",
          threshold_value: threshold,
          action: "Escalate to the treating doctor",
        })),
      },
    );
    const input = answer(
      "Escalate neuroleptic side effects when the LUNSERS score is high (81-100).",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
    });
  });

  it("detects same-scale conflicts split across content and structured table facts", () => {
    const evidence = source("cross-representation-bands", "LUNSERS score bands list medium (41-89).", {
      table_facts: [
        {
          id: "fact-high",
          document_id: "doc-cross-representation-bands",
          source_chunk_id: "cross-representation-bands",
          source_image_id: null,
          page_number: 1,
          table_title: "LUNSERS score bands",
          row_label: "high",
          clinical_parameter: "LUNSERS score",
          threshold_value: "81-100",
          action: "Escalate neuroleptic side effects when the score is high (81-100).",
        },
      ],
    });
    const input = answer(
      "Escalate neuroleptic side effects when the score is high (81-100).",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
    });
  });

  it("does not merge a different prose scale with a table merely because its name appears elsewhere", () => {
    const evidence = source(
      "distinct-cross-representation-scales",
      "The LUNSERS score was recorded. Depression score bands are medium (41-89).",
      {
        table_facts: [
          {
            id: "fact-lunsers-high",
            document_id: "doc-distinct-cross-representation-scales",
            source_chunk_id: "distinct-cross-representation-scales",
            source_image_id: null,
            page_number: 1,
            table_title: "LUNSERS score bands",
            row_label: "high",
            clinical_parameter: "LUNSERS score",
            threshold_value: "81-100",
            action: "Escalate neuroleptic side effects when the score is high (81-100).",
          },
        ],
      },
    );

    expect(sourceHasLabelledNumericBandConflict(evidence)).toBe(false);
  });

  it("withholds a single-band quote when its full cited source has contradictory bands", () => {
    const evidence = source(
      "quote-source",
      "LUNSERS score bands are medium (41-89), high (81-100), and very high (>101). A high score of 81-100 requires escalation. Any neuroleptic side effect causing distress should be escalated.",
    );
    const input = {
      ...answer("Any neuroleptic side effect causing distress should be escalated.", [evidence], [citation(evidence)]),
      quoteCards: [
        {
          ...citation(evidence, "exact_quote"),
          quote: "A high score of 81-100 requires escalation.",
          section_heading: "LUNSERS",
        },
      ],
    };

    expect(enforceLabelledNumericBandCoherence(input)).toMatchObject({
      grounded: true,
      confidence: "medium",
      quoteCards: [],
    });
  });

  it("withholds an actionable bare-range quote when its full cited source has contradictory bands", () => {
    const evidence = source(
      "bare-quote-source",
      "LUNSERS score bands are medium (41-89), high (81-100), and very high (>101). Escalate at 81-100.",
    );
    const input = {
      ...answer("Monitor for distress.", [evidence], [citation(evidence)]),
      quoteCards: [
        {
          ...citation(evidence, "exact_quote"),
          quote: "Escalate at 81-100.",
          section_heading: "LUNSERS",
        },
      ],
    };

    expect(enforceLabelledNumericBandCoherence(input)).toMatchObject({
      grounded: true,
      confidence: "medium",
      quoteCards: [],
    });
  });

  it("rejects a recovered alternative with a second directive", () => {
    const evidence = source(
      "distress-only",
      "Whenever a neuroleptic side effect occurs and causes distress, escalate it to the treating doctor.",
    );
    const input = answer(
      "Escalate neuroleptic side effects when the score is medium (41-89) or high (81-100), or whenever distress occurs, and sedate the patient.",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      citations: [],
    });
  });

  it("rejects a recovered alternative with a noun-form second directive", () => {
    const evidence = source(
      "distress-and-restraint",
      "Whenever distress occurs, escalate to the treating doctor and document any restraint used.",
    );
    const input = answer(
      "Escalate neuroleptic side effects when the score is medium (41-89) or high (81-100), or whenever distress occurs: restraint is required.",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      citations: [],
    });
  });

  it("recovers the safe nonnumeric alternative when provider emphasis surrounds the conflicting bands", () => {
    const evidence = source(
      "bold-distress-only",
      "Whenever a neuroleptic side effect occurs and causes distress, escalate it to the treating doctor, irrespective of score.",
    );
    const input = answer(
      "Escalate neuroleptic side effects when the score is **medium** (**41-89**) or **high** (**81-100**), or whenever distress occurs, irrespective of score.",
      [evidence],
      [citation(evidence)],
    );

    expect(enforceLabelledNumericBandCoherence(input, { answerText: input.answer })).toMatchObject({
      grounded: true,
      confidence: "medium",
      answer: expect.stringMatching(/whenever distress occurs, irrespective of score/i),
    });
  });

  it("sanitizes and revalidates a recovered nonnumeric alternative before output", () => {
    const evidence = source(
      "recovery",
      "Any neuroleptic side effect causing distress should be escalated to the treating doctor.",
    );
    const input = answer(
      "CLINICAL GUIDELINE. Escalate neuroleptic side effects when the LUNSERS score is medium (41-89) or high (81-100), or whenever distress occurs.",
      [evidence],
      [citation(evidence)],
    );

    const recovered = enforceLabelledNumericBandCoherence(input, { answerText: input.answer });

    expect(recovered).toMatchObject({ grounded: true, confidence: "medium" });
    expect(recovered.answer).toBe("Escalate neuroleptic side effects whenever distress occurs.");
    expect(recovered.answer).not.toContain("CLINICAL GUIDELINE");
  });

  it("rejects a valid citation id whose chunk does not support a high-risk claim", () => {
    const cited = source("c1", "Clozapine monitoring includes regular blood counts.");
    const result = assessClaimSupport(answer("Stop clozapine when ANC is below 1.0 x10^9/L.", [cited]));
    expect(result.claims[0]).toMatchObject({ riskClass: "high_risk", supportStatus: "partial" });
  });

  it.each([
    ["Do not stop clozapine.", "Stop clozapine immediately."],
    ["Give lithium 300 mg orally twice daily.", "Give lithium 300 mg intramuscularly once daily."],
    ["Clozapine is contraindicated in pregnancy.", "Clozapine may be used during pregnancy after specialist review."],
    ["Do not use lithium in severe renal impairment.", "Lithium requires monitoring in mild renal impairment."],
    ["Avoid valproate in hepatic impairment.", "Valproate monitoring includes liver function tests."],
    ["Escalate urgently for myocarditis symptoms.", "Review myocarditis symptoms at the next appointment."],
    ["Stop clozapine below ANC 1.0 x10^9/L.", "Stop lithium below a level of 1.0 x10^9/L."],
    ["Stop clozapine when fever develops.", "Stop clozapine when myocarditis develops."],
    ["Give lithium 300 mg for bipolar disorder.", "Give lithium 300 mg for major depression."],
    ["Cease clozapine for neutropenia.", "Cease clozapine for myocarditis."],
    ["Discontinue clozapine for neutropenia.", "Discontinue clozapine for myocarditis."],
    ["Escalate urgently for neutropenia.", "Escalate urgently for myocarditis."],
  ])("does not directly support %s from mismatched evidence", (claim, evidence) => {
    const cited = source("c1", evidence);
    expect(assessClaimSupport(answer(claim, [cited])).claims[0]?.supportStatus).not.toBe("direct");
  });

  it("fails closed when a high-risk action cites a different trigger condition", () => {
    const cited = source("c1", "Stop clozapine when myocarditis develops.");
    const result = assessAndEnforceClaimSupport(answer("Stop clozapine when fever develops.", [cited]));

    expect(result).toMatchObject({ grounded: false, confidence: "unsupported", responseMode: "evidence_gap" });
    expect(result.supportedClaims?.[0]).toMatchObject({ riskClass: "high_risk", supportStatus: "partial" });
    expect(result.citations).toEqual([]);
  });

  it("supports equivalent condition-first wording without treating the action clause as the trigger", () => {
    const cited = source("c1", "Stop clozapine when fever develops.");

    expect(assessClaimSupport(answer("If fever develops, discontinue clozapine.", [cited])).claims[0]).toMatchObject({
      riskClass: "high_risk",
      supportStatus: "direct",
    });
  });

  it("uses the first indication span instead of a later duration clause", () => {
    const cited = source("c1", "Give lithium 300 mg for bipolar disorder as ongoing therapy.");

    expect(
      assessClaimSupport(answer("Give lithium 300 mg for bipolar disorder for ongoing care.", [cited])).claims[0],
    ).toMatchObject({ riskClass: "high_risk", supportStatus: "direct" });
  });

  it("evaluates section prose only against that section's citations", () => {
    const wrongSection = source("wrong", "Stop clozapine below ANC 1.0 x10^9/L.");
    const citedSection = source("cited", "Clozapine monitoring includes regular blood counts.");
    const input = answer("The sources describe clozapine monitoring.", [wrongSection, citedSection]);
    input.answerSections = [
      {
        heading: "Threshold",
        body: "Stop clozapine below ANC 1.0 x10^9/L.",
        citation_chunk_ids: [citedSection.id],
      },
    ];
    expect(assessClaimSupport(input).claims.find((claim) => claim.text.includes("Stop"))?.supportStatus).toBe(
      "partial",
    );
  });

  it("withholds an unsupported high-risk section without discarding a directly supported main answer", () => {
    const cited = source("section-withhold", "Monitor clozapine with regular blood counts.");
    const input = answer("Monitor clozapine with regular blood counts.", [cited]);
    input.answerSections = [
      {
        heading: "Threshold",
        body: "Stop clozapine below ANC 1.0 x10^9/L.",
        citation_chunk_ids: [cited.id],
      },
    ];

    const result = assessAndEnforceClaimSupport(input);
    expect(result).toMatchObject({ grounded: true, confidence: "medium" });
    expect(result.answer).toBe(input.answer);
    expect(result.answerSections).toEqual([]);
    expect(result.routingReason).toContain("claim_support_unsupported_sections_withheld");
  });

  it("accepts exact quote and deterministic support but never review-only enrichment", () => {
    const exact = source("exact", "Stop clozapine below ANC 1.0 x10^9/L.");
    const review = source("review", "Stop lithium below a level of 1.0 x10^9/L.");
    const direct = assessClaimSupport(
      answer("Stop clozapine below ANC 1.0 x10^9/L.", [exact], [citation(exact, "exact_quote")]),
    );
    expect(direct.claims[0]?.supportStatus).toBe("direct");

    const deterministic = assessClaimSupport(
      answer("Stop clozapine below ANC 1.0 x10^9/L.", [exact], [citation(exact, "deterministic_support")]),
    );
    expect(deterministic.claims[0]?.supportStatus).toBe("direct");

    const reviewOnly = assessClaimSupport(
      answer("Stop lithium below a level of 1.0 x10^9/L.", [review], [citation(review, "review_only")]),
    );
    expect(reviewOnly.claims[0]?.supportStatus).toBe("unsupported");
  });

  it("fails closed for partial high-risk claims while retaining review sources", () => {
    const cited = source("c1", "Clozapine monitoring includes regular blood counts.");
    const result = assessAndEnforceClaimSupport(answer("Stop clozapine below ANC 1.0 x10^9/L.", [cited]));
    expect(result).toMatchObject({ grounded: false, confidence: "unsupported", responseMode: "evidence_gap" });
    expect(result.citations).toEqual([]);
    expect(result.answerSections).toEqual([]);
    expect(result.sources).toEqual([cited]);
    expect(result.routingReason).toContain("claim_support_high_risk_gap");
  });

  it("withholds routine partial factual prose instead of grounding it at medium confidence", () => {
    const cited = source("c1", "The service operates a clozapine clinic.");
    const result = assessAndEnforceClaimSupport(answer("The clinic offers appointments on Tuesdays.", [cited]));
    expect(result.responseMode).toBe("evidence_gap");
    expect(result.confidence).toBe("unsupported");
  });

  it("assesses newline-delimited claims independently instead of merging their evidence scopes", () => {
    const admission = source("admission", "Admission requires referral and bed allocation.");
    const followUp = source("follow-up", "Follow-up review should occur within 72 hours.");
    const input = answer(
      "Admission requires referral and bed allocation.\nFollow-up review should occur within 72 hours.",
      [admission, followUp],
    );

    const assessment = assessClaimSupport(input);
    expect(assessment.claims).toHaveLength(2);
    expect(assessment.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Admission requires referral and bed allocation.", supportStatus: "direct" }),
        expect.objectContaining({
          text: "Follow-up review should occur within 72 hours.",
          riskClass: "high_risk",
          supportStatus: "direct",
        }),
      ]),
    );
    expect(assessAndEnforceClaimSupport(input).responseMode).not.toBe("evidence_gap");
  });

  it("assesses numeric claim 25 and withholds it while retaining independently supported claims", () => {
    const routineClaims =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey"
        .split(" ")
        .map((label) => `Routine ${label} appointments are available.`);
    const assessedClaims = ["Give Drug A 300 mg.", ...routineClaims];
    const cited = source("c1", assessedClaims.join(" "));
    const input = answer([...assessedClaims, "Give Drug B 300 mg."].join("\n"), [cited]);

    const result = assessAndEnforceClaimSupport(input);
    expect(assessClaimSupport(input).claims).toHaveLength(25);
    expect(assessClaimSupport(input).claims[24]?.supportStatus).not.toBe("direct");
    expect(result.supportedClaims).toHaveLength(24);
    expect(result).toMatchObject({
      grounded: true,
      confidence: "medium",
    });
    expect(result.answer).toContain("Give Drug A 300 mg.");
    expect(result.answer).not.toContain("Drug B");
    expect(result.routingReason).toContain("claim_support_unsupported_claims_withheld");
  });

  it("ignores incidental outdated or poor retrieval-only sources but fails closed when direct support is dangerous", () => {
    const direct = source("direct", "Stop clozapine below ANC 1.0 x10^9/L.");
    const incidental = source("incidental", "An old unrelated administrative note.", {
      source_metadata: {
        ...direct.source_metadata!,
        document_status: "outdated",
        extraction_quality: "poor",
      },
    });
    const safe = assessAndEnforceClaimSupport(
      answer("Stop clozapine below ANC 1.0 x10^9/L.", [direct, incidental], [citation(direct)]),
    );
    expect(safe.responseMode).not.toBe("evidence_gap");

    const dangerousDirect = { ...direct, source_metadata: incidental.source_metadata };
    const refused = assessAndEnforceClaimSupport(
      answer("Stop clozapine below ANC 1.0 x10^9/L.", [dangerousDirect], [citation(dangerousDirect)]),
    );
    expect(refused.responseMode).toBe("evidence_gap");
    expect(refused.routingReason).toContain("material_source_governance_gap");
  });

  it("does not let matrix-wide attribution turn lithium evidence into direct clozapine support", () => {
    const lithium = source("lithium", "Stop lithium below a level of 1.0 x10^9/L.");
    const input = answer(
      "Conflict — ANC threshold: Lithium guide: stop clozapine below ANC 1.0 x10^9/L.",
      [lithium],
      [citation(lithium, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [{ documentId: lithium.document_id, title: lithium.title, fileName: lithium.file_name }],
      rows: [
        {
          parameter: "ANC threshold",
          status: "agreement",
          entries: [
            {
              documentId: lithium.document_id,
              chunkIds: [lithium.id],
              value: "stop clozapine below ANC 1.0 x10^9/L",
              qualifiers: [],
            },
          ],
        },
      ],
    };

    const result = assessAndEnforceClaimSupport(input);
    expect(result.responseMode).toBe("evidence_gap");
    expect(result.supportedClaims?.[0]).toMatchObject({ riskClass: "high_risk", supportStatus: "partial" });
  });

  it("keeps per-source claim support isolated from another source's partial claim", () => {
    const related = source("related", "Clozapine monitoring includes regular blood counts.", {
      relevance: {
        verdict: "direct",
        label: "Direct retrieval match",
        matchedTerms: ["clozapine"],
        missingTerms: [],
        directSourceCount: 1,
        weakSourceCount: 0,
        score: 1,
        supportReason: "Direct retrieval match",
        isSourceBacked: true,
        coverageScore: 1,
        rankScore: 1,
        titleMatchedTerms: [],
        contentMatchedTerms: ["clozapine"],
        metadataMatchedTerms: [],
        chips: [],
      },
    });
    const unrelated = source("unrelated", "The service directory lists community phone numbers.");
    const result = assessClaimSupport(
      answer("Stop clozapine below ANC 1.0 x10^9/L.", [related, unrelated], [citation(related)]),
    );
    expect(result.evidenceAssessments.related).toMatchObject({ relevance: "direct", claimSupport: "partial" });
    expect(result.evidenceAssessments.unrelated).toMatchObject({ relevance: "none", claimSupport: "unsupported" });
  });

  it("fails closed when comparison prose swaps values between attributed documents", () => {
    const protocolA = source("a", "Protocol A sets the clozapine ANC threshold below 1.5 x 10^9/L.");
    const protocolB = source("b", "Protocol B sets the clozapine ANC threshold below 1.0 x 10^9/L.");
    const input = answer(
      "Conflict — ANC: Protocol A: below 1.0 x 10^9/L; Protocol B: below 1.5 x 10^9/L.",
      [protocolA, protocolB],
      [citation(protocolA, "deterministic_support"), citation(protocolB, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [
        { documentId: protocolA.document_id, title: "Protocol A", fileName: protocolA.file_name },
        { documentId: protocolB.document_id, title: "Protocol B", fileName: protocolB.file_name },
      ],
      rows: [
        {
          parameter: "ANC",
          status: "conflict",
          entries: [
            {
              documentId: protocolA.document_id,
              chunkIds: [protocolA.id],
              value: "below 1.5 x 10^9/L",
              qualifiers: [],
            },
            {
              documentId: protocolB.document_id,
              chunkIds: [protocolB.id],
              value: "below 1.0 x 10^9/L",
              qualifiers: [],
            },
          ],
        },
      ],
    };
    expect(assessAndEnforceClaimSupport(input).responseMode).toBe("evidence_gap");
  });

  it("accepts an accurately attributed comparison with a bounded non-clinical missing cell", () => {
    const protocolA = source("a", "Protocol A sets the clozapine ANC threshold below 1.5 x 10^9/L.");
    const protocolB = source("b", "Protocol B sets the clozapine ANC threshold below 1.0 x 10^9/L.");
    const protocolC = source("c", "Protocol C discusses clozapine governance without an ANC threshold.");
    const input = answer(
      "Evidence gap — ANC: Protocol A: below 1.5 x 10^9/L; Protocol B: below 1.0 x 10^9/L; Protocol C: not reported.",
      [protocolA, protocolB, protocolC],
      [citation(protocolA, "deterministic_support"), citation(protocolB, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [
        { documentId: protocolA.document_id, title: "Protocol A", fileName: protocolA.file_name },
        { documentId: protocolB.document_id, title: "Protocol B", fileName: protocolB.file_name },
        { documentId: protocolC.document_id, title: "Protocol C", fileName: protocolC.file_name },
      ],
      rows: [
        {
          parameter: "ANC",
          status: "missing",
          entries: [
            {
              documentId: protocolA.document_id,
              chunkIds: [protocolA.id],
              value: "below 1.5 x 10^9/L",
              qualifiers: [],
            },
            {
              documentId: protocolB.document_id,
              chunkIds: [protocolB.id],
              value: "below 1.0 x 10^9/L",
              qualifiers: [],
            },
            { documentId: protocolC.document_id, chunkIds: [], value: null, qualifiers: ["No evidence found for ANC"] },
          ],
        },
      ],
    };
    const result = assessAndEnforceClaimSupport(input);
    expect(result.responseMode).toBe("comparison_matrix");
    expect(result.supportedClaims?.[0]?.supportStatus).toBe("direct");
    expect(result.supportedClaims?.[0]?.supportingChunkIds).toEqual([protocolA.id, protocolB.id]);
  });

  it("fails closed when one attributed matrix entry comes from an internally contradictory source", () => {
    const protocolC = source(
      "matrix-band-conflict",
      "LUNSERS score bands are medium (41-89) and high (81-100). Protocol C reports high (81-100).",
    );
    const input = answer(
      "Conflict — LUNSERS band: Protocol C: high (81-100).",
      [protocolC],
      [citation(protocolC, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [{ documentId: protocolC.document_id, title: "Protocol C", fileName: protocolC.file_name }],
      rows: [
        {
          parameter: "LUNSERS band",
          status: "conflict",
          entries: [
            {
              documentId: protocolC.document_id,
              chunkIds: [protocolC.id],
              value: "high (81-100)",
              qualifiers: [],
            },
          ],
        },
      ],
    };

    expect(enforceLabelledNumericBandCoherence(input)).toMatchObject({
      grounded: false,
      confidence: "unsupported",
      citations: [],
    });
  });

  it("uses ordinary section citations for non-preformatted comparison answers", () => {
    const cited = source("cited", "Stop clozapine below ANC 1.0 x10^9/L.");
    const input = answer("The comparison requires source review.", [cited], [citation(cited)]);
    input.responseMode = "comparison_matrix";
    input.answerSections = [
      {
        heading: "Threshold",
        body: "Stop clozapine below ANC 1.0 x10^9/L.",
        citation_chunk_ids: [cited.id],
      },
    ];
    input.comparisonMatrix = { documents: [], rows: [] };
    const claim = assessClaimSupport(input).claims.find((item) => item.text.startsWith("Stop clozapine"));
    expect(claim?.supportStatus).toBe("direct");
  });

  it("rejects an appended route and frequency absent from the attributed deterministic entry", () => {
    const protocolA = source("a", "Protocol A gives Drug A at 300 mg.");
    const input = answer(
      "Conflict — Dose: Protocol A: 300 mg intramuscularly daily.",
      [protocolA],
      [citation(protocolA, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [{ documentId: protocolA.document_id, title: "Protocol A", fileName: protocolA.file_name }],
      rows: [
        {
          parameter: "Dose",
          status: "agreement",
          entries: [{ documentId: protocolA.document_id, chunkIds: [protocolA.id], value: "300 mg", qualifiers: [] }],
        },
      ],
    };
    expect(assessAndEnforceClaimSupport(input).responseMode).toBe("evidence_gap");
  });

  it("fails closed when generated comparison clauses cross-bind Drug A and Drug B values", () => {
    const drugA = source("drug-a", "Drug A is given at 300 mg.");
    const drugB = source("drug-b", "Drug B is given at 600 mg.");
    const input = answer(
      "Drug A is given at 600 mg whereas Drug B is given at 300 mg.",
      [drugA, drugB],
      [citation(drugA), citation(drugB)],
    );
    input.responseMode = "comparison_matrix";
    input.preformatted = false;
    input.answerSections = [
      {
        heading: "Comparison",
        body: "Drug A is given at 600 mg; Drug B is given at 300 mg.",
        citation_chunk_ids: [drugA.id, drugB.id],
      },
    ];
    expect(assessAndEnforceClaimSupport(input).responseMode).toBe("evidence_gap");
  });

  it.each([
    ["Drug A is contraindicated in renal impairment.", "Drug A is contraindicated in hepatic impairment."],
    ["Stop Drug A and escalate urgently.", "Stop Drug A at the next routine appointment."],
  ])("requires every conjunctive safety dimension in %s", (claim, evidence) => {
    const cited = source("safety", evidence);
    expect(assessAndEnforceClaimSupport(answer(claim, [cited])).responseMode).toBe("evidence_gap");
  });

  it("rejects clinical recommendations appended to a deterministic missing-cell marker", () => {
    const protocolA = source("a", "Protocol A gives Drug A at 300 mg.");
    const protocolB = source("b", "Protocol B contains no attributed dose evidence for Drug A.");
    const input = answer(
      "Evidence gap — Dose: Protocol A: 300 mg; Protocol B: no evidence found, but give Drug A 600 mg daily.",
      [protocolA, protocolB],
      [citation(protocolA, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [
        { documentId: protocolA.document_id, title: "Protocol A", fileName: protocolA.file_name },
        { documentId: protocolB.document_id, title: "Protocol B", fileName: protocolB.file_name },
      ],
      rows: [
        {
          parameter: "Dose",
          status: "missing",
          entries: [
            { documentId: protocolA.document_id, chunkIds: [protocolA.id], value: "300 mg", qualifiers: [] },
            {
              documentId: protocolB.document_id,
              chunkIds: [],
              value: null,
              qualifiers: ["No evidence found for Dose"],
            },
          ],
        },
      ],
    };
    expect(assessAndEnforceClaimSupport(input).responseMode).toBe("evidence_gap");
  });

  it.each([
    ["Drug A is contraindicated.", "Drug A is not contraindicated."],
    ["Stop Drug A and escalate urgently.", "Stop Drug A; urgent escalation is not required."],
  ])("does not let a negated state verify the positive claim %s", (claim, evidence) => {
    const cited = source("negated", evidence);
    expect(assessAndEnforceClaimSupport(answer(claim, [cited])).responseMode).toBe("evidence_gap");
  });

  it("rejects an arbitrary clinical suffix after a parameter-scoped missing marker", () => {
    const protocolA = source("a", "Protocol A gives Drug A at 300 mg.");
    const protocolB = source("b", "Protocol B contains no attributed dose evidence for Drug A.");
    const input = answer(
      "Evidence gap — Dose: Protocol A: 300 mg; Protocol B: no evidence found for dose give Drug A 600 mg daily.",
      [protocolA, protocolB],
      [citation(protocolA, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [
        { documentId: protocolA.document_id, title: "Protocol A", fileName: protocolA.file_name },
        { documentId: protocolB.document_id, title: "Protocol B", fileName: protocolB.file_name },
      ],
      rows: [
        {
          parameter: "Dose",
          status: "missing",
          entries: [
            { documentId: protocolA.document_id, chunkIds: [protocolA.id], value: "300 mg", qualifiers: [] },
            {
              documentId: protocolB.document_id,
              chunkIds: [],
              value: null,
              qualifiers: ["No evidence found for Dose"],
            },
          ],
        },
      ],
    };
    expect(assessAndEnforceClaimSupport(input).responseMode).toBe("evidence_gap");
  });

  it.each(["must not stop", "should not cease", "never discontinue"])(
    "does not verify %s against positive stop evidence",
    (negativeAction) => {
      const cited = source("stop", "Stop Drug A immediately.");
      expect(assessAndEnforceClaimSupport(answer(`${negativeAction} Drug A.`, [cited])).responseMode).toBe(
        "evidence_gap",
      );
    },
  );

  it("accepts the exact parameter-scoped missing-cell form", () => {
    const protocolA = source("a", "Protocol A gives Drug A at 300 mg.");
    const protocolB = source("b", "Protocol B contains no attributed dose evidence for Drug A.");
    const input = answer(
      "Evidence gap — Dose: Protocol A: 300 mg; Protocol B: no evidence found for Dose.",
      [protocolA, protocolB],
      [citation(protocolA, "deterministic_support")],
    );
    input.preformatted = true;
    input.responseMode = "comparison_matrix";
    input.comparisonEvaluationState = "evaluated";
    input.comparisonMatrix = {
      documents: [
        { documentId: protocolA.document_id, title: "Protocol A", fileName: protocolA.file_name },
        { documentId: protocolB.document_id, title: "Protocol B", fileName: protocolB.file_name },
      ],
      rows: [
        {
          parameter: "Dose",
          status: "missing",
          entries: [
            { documentId: protocolA.document_id, chunkIds: [protocolA.id], value: "300 mg", qualifiers: [] },
            {
              documentId: protocolB.document_id,
              chunkIds: [],
              value: null,
              qualifiers: ["No evidence found for Dose"],
            },
          ],
        },
      ],
    };
    const result = assessAndEnforceClaimSupport(input);
    expect(result.responseMode).toBe("comparison_matrix");
    expect(result.supportedClaims?.[0]?.supportStatus).toBe("direct");
  });
});

describe("high-risk answer support (#ZZ4RAP)", () => {
  // Captured live from Lithium Therapy - Initiation And Continuation Guideline (FSH), PDF wrapping kept.
  const nsaid = source(
    "lithium-nsaid",
    [
      "• NSAIDs: (e.g. ibuprofen) can reduce lithium clearance and therefore",
      "increase lithium levels and the risk of toxicity. Avoid the combination where",
      "possible. Low dose aspirin is safe to use.",
      "",
      "• Serotonergic drugs: Lithium can contribute to serotonin toxicity, therefore",
      "patients who are prescribed combinations of serotonergic drugs should be",
      "closely monitored",
    ].join("\n"),
  );

  it.each([
    [
      "the source sentence restated word for word",
      "NSAIDs such as ibuprofen can reduce lithium clearance and therefore increase lithium levels and the risk of toxicity.",
      true,
    ],
    [
      "a combination warning naming the medicines from the sentence before it",
      "Avoid ibuprofen where possible in someone taking lithium.",
      true,
    ],
    ["a medicine named only after the warning", "Avoid aspirin where possible in someone taking lithium.", false],
    [
      "a restatement that drops the end of the sentence",
      "NSAIDs such as ibuprofen can reduce lithium clearance and therefore increase lithium levels.",
      false,
    ],
    ["a restatement that starts mid-sentence", "Increase lithium levels and the risk of toxicity.", false],
  ] as const)("%s", (_label, claim, supported) => {
    expect(sourceDirectlySupportsAnswerText(claim, nsaid)).toBe(supported);
  });

  it("lends 'the combination' only the medicines of the sentence before it", () => {
    const safeFirst = source(
      "safe-first",
      "Low dose aspirin is safe to use. NSAIDs (e.g. ibuprofen) can reduce lithium clearance and therefore increase lithium levels. Avoid the combination where possible.",
    );
    expect(sourceDirectlySupportsAnswerText("Avoid aspirin where possible in someone taking lithium.", safeFirst)).toBe(
      false,
    );
    expect(
      sourceDirectlySupportsAnswerText("Avoid ibuprofen where possible in someone taking lithium.", safeFirst),
    ).toBe(true);
  });

  it("keeps a verbatim match inside one source sentence", () => {
    const twoSentences = source(
      "two-sentences",
      "Stop lithium therapy straight away. When toxicity is suspected, obtain an urgent medical review.",
    );
    expect(
      sourceDirectlySupportsAnswerText(
        "Stop lithium therapy straight away when toxicity is suspected, obtain an urgent medical review.",
        twoSentences,
      ),
    ).toBe(false);
  });

  it("does not let a verbatim match change a unit or exponent", () => {
    const units = source(
      "units",
      "Stop clozapine therapy immediately if the white cell count falls below 3.0 × 10⁹/L on repeat testing.",
    );
    expect(
      sourceDirectlySupportsAnswerText(
        "Stop clozapine therapy immediately if the white cell count falls below 3.0 × 10³/L on repeat testing.",
        units,
      ),
    ).toBe(false);
  });

  it("does not start a verbatim match at a block that continues a colon-led condition", () => {
    const conditional = source(
      "conditional",
      [
        "If the eGFR falls below 30 mL/min:",
        "",
        "Stop lithium and contact the treating psychiatrist urgently today.",
      ].join("\n"),
    );
    expect(
      claimRestatesSourceVerbatim("Stop lithium and contact the treating psychiatrist urgently today.", conditional),
    ).toBe(false);
  });

  it("keeps the direction check on 'a risk of increased/decreased'", () => {
    const direction = source("direction", "NSAIDs carry a risk of increased lithium levels in older patients.");
    expect(
      sourceDirectlySupportsAnswerText("NSAIDs carry a risk of decreased lithium levels in older patients.", direction),
    ).toBe(false);
  });

  it("keeps the direction of a listed finding", () => {
    const finding = source(
      "finding",
      "Signs of toxicity: increased lithium levels in older patients after dehydration.",
    );
    expect(
      sourceDirectlySupportsAnswerText(
        "Signs of toxicity: reduced lithium levels in older patients after dehydration.",
        finding,
      ),
    ).toBe(false);
  });

  it("binds a finding's direction to the finding it modifies", () => {
    const mixed = source("mixed", "Signs of toxicity: increased muscle tone, reduced consciousness and coarse tremor.");
    expect(
      sourceDirectlySupportsAnswerText(
        "Signs of toxicity: reduced muscle tone, increased consciousness and coarse tremor.",
        mixed,
      ),
    ).toBe(false);
    expect(
      sourceDirectlySupportsAnswerText(
        "Signs of toxicity: increased muscle tone, reduced consciousness and coarse tremor.",
        mixed,
      ),
    ).toBe(true);
  });

  it("does not let a verbatim match drop a leading negation", () => {
    const negated = source("negated", "Do not stop clozapine therapy until the haematologist has reviewed the result.");
    expect(
      sourceDirectlySupportsAnswerText(
        "Stop clozapine therapy until the haematologist has reviewed the result.",
        negated,
      ),
    ).toBe(false);
  });

  it("reads a listed finding such as 'increased muscle tone' as a finding, not a change relation", () => {
    const toxicity = source(
      "lithium-toxicity",
      [
        "• Signs and symptoms of severe toxicity:",
        "o Increased muscle tone, hyperreflexia, myoclonic jerks, coarse tremor, dysarthria,",
        "disorientation, psychosis, seizures, coma, QT-interval prolongation and death.",
      ].join("\n"),
    );
    expect(
      sourceDirectlySupportsAnswerText(
        "Signs and symptoms of severe toxicity include increased muscle tone, hyperreflexia, myoclonic jerks, coarse tremor, dysarthria, disorientation, psychosis, seizures, coma, QT-interval prolongation and death.",
        toxicity,
      ),
    ).toBe(true);
    // A real change relation is still checked for direction.
    const relation = source("relation", "Dehydration increased lithium levels.");
    expect(sourceDirectlySupportsAnswerText("Lithium levels increased dehydration.", relation)).toBe(false);
  });
});
