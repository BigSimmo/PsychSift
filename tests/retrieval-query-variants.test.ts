import { describe, expect, it } from "vitest";
import {
  analyzeClinicalQuery,
  buildClinicalTextSearchQuery,
  isMedicationDoseEvidenceQuery,
  medicationDoseEvidenceQueryIntent,
  rankClinicalResults,
} from "../src/lib/clinical-search";
import { expandClinicalVocabularyText } from "../src/lib/clinical-vocabulary";
import { selectRetrievalEvidence } from "../src/lib/retrieval-selection";
import {
  buildRetrievalQueryVariants,
  decideTextFastPath,
  evaluateEvidenceCoverageGate,
  retrievalPlanCacheQuery,
  selectRagAliasExpansions,
  shouldApplyUnsupportedSearchShortCircuit,
  textCandidateBudgetForQueryClass,
  relaxVariantToOrQuery,
  shouldRelaxWeakTextMatches,
} from "../src/lib/rag/rag";
import { firstVariantPoolIsStrong, maxTextRpcQueryVariants } from "../src/lib/rag/rag-retrieval-variants";
import { buildRagQueryPlan } from "../src/lib/rag/rag-query-plan";
import type { SearchResult } from "../src/lib/types";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    title: "Patient Safety Plan",
    file_name: "patient-safety-plan.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: "Safety plan content.",
    image_ids: [],
    similarity: 0,
    images: [],
    ...overrides,
  };
}

function tableFact(overrides: Partial<NonNullable<SearchResult["table_facts"]>[number]> = {}) {
  return {
    id: "fact-1",
    document_id: "doc-1",
    source_chunk_id: "chunk-1",
    source_image_id: null,
    page_number: 1,
    table_title: "Medication dose table",
    row_label: "Lorazepam",
    clinical_parameter: "Dose",
    threshold_value: "1 mg IM",
    action: "Review before repeat PRN dose.",
    ...overrides,
  };
}

describe("retrieval query variants", () => {
  it("keeps simple query variants byte-identical when a single plan is supplied", () => {
    const query = "What ANC threshold should stop clozapine?";
    const analysis = analyzeClinicalQuery(query);
    const legacy = buildRetrievalQueryVariants(query, analysis);
    const planned = buildRetrievalQueryVariants(query, analysis, [], buildRagQueryPlan(query, analysis));

    expect(planned).toEqual(legacy);
  });

  it.each(["What is the duress procedure during an acute ward incident?", "When is IM medication used for agitation?"])(
    "does not convert a clinical pathway into candidate source-inventory variants: %s",
    (query) => {
      const analysis = analyzeClinicalQuery(query);
      const plan = buildRagQueryPlan(query, analysis);

      expect(plan.kind).toBe("single");
      expect(buildRetrievalQueryVariants(query, analysis, [], plan)).toEqual(
        buildRetrievalQueryVariants(query, analysis),
      );
    },
  );

  it.each([
    "Give an overview of agitation management including treatment, monitoring and escalation.",
    "Compare clozapine and olanzapine monitoring requirements.",
    "Compare medication guidance and therapy guidance for agitation.",
  ])("keeps the original query first and caps decomposed candidates: %s", (query) => {
    const analysis = analyzeClinicalQuery(query);
    const plan = buildRagQueryPlan(query, analysis);
    const variants = buildRetrievalQueryVariants(query, analysis, [], plan);

    expect(plan.kind).toBe("decomposed");
    expect(variants[0]).toBe(buildClinicalTextSearchQuery(query));
    expect(variants.length).toBeLessThanOrEqual(4);
    expect(new Set(variants.map((variant) => variant.toLowerCase())).size).toBe(variants.length);
  });

  it("keeps typo-corrected acronym terms in a capped variant list", () => {
    const analysis = analyzeClinicalQuery("clozapin FBC ANC threshold");
    const variants = buildRetrievalQueryVariants("clozapin FBC ANC threshold", analysis);

    expect(variants[0]).toContain("clozapine");
    expect(variants.join(" ")).toContain("fbc");
    expect(variants.join(" ")).toContain("anc");
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("prioritizes amber/red blood-result variants for clozapine FBC withhold questions", () => {
    const query = "What FBC threshold should withhold clozapine?";
    const variants = buildRetrievalQueryVariants(query, analyzeClinicalQuery(query));

    expect(variants).toContain("clozapine blood results amber red range");
    expect(variants.indexOf("clozapine blood results amber red range")).toBeLessThan(maxTextRpcQueryVariants);
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("adds document-title-focused variants for document lookup intent", () => {
    const query = "Where is the active community patients in ED document?";
    const analysis = analyzeClinicalQuery(query);
    const variants = buildRetrievalQueryVariants(query, analysis);

    expect(analysis.documentTitleIntent).toBe(true);
    expect(variants.some((variant) => variant.includes("active community"))).toBe(true);
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("adds exact title variants for community admission lookups", () => {
    const query = "What is the process for admission of community patients?";
    const variants = buildRetrievalQueryVariants(query, analyzeClinicalQuery(query));

    expect(variants).toEqual(
      expect.arrayContaining(["admission of community patients", "admission community patients"]),
    );
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("adds shortened core variants for long natural-language threshold questions", () => {
    const query =
      "Please can you tell me exactly when I should withhold clozapine based on ANC and FBC threshold values in the monitoring table?";
    const analysis = analyzeClinicalQuery(query);
    const variants = buildRetrievalQueryVariants(query, analysis);

    expect(variants.length).toBeGreaterThan(1);
    expect(variants.some((variant) => variant.includes("clozapine") && variant.includes("anc"))).toBe(true);
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("adds DB-backed canonical aliases without exceeding the variant cap", () => {
    const query = "What is the depot workflow for missed doses?";
    const analysis = analyzeClinicalQuery(query);
    const aliases = [
      {
        alias: "depot",
        canonical: "long acting injectable antipsychotic",
        alias_type: "clinical_term",
        weight: 2,
        owner_id: null,
      },
    ];
    const variants = buildRetrievalQueryVariants(query, analysis, aliases);

    expect(variants.join(" ")).toContain("long acting injectable antipsychotic");
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("only expands aliases supplied for the current owner scope", () => {
    const query = "clozapin anc threshold";
    const expansions = selectRagAliasExpansions(query, [
      { alias: "clozapin", canonical: "clozapine", alias_type: "typo", owner_id: "owner-a", weight: 1 },
    ]);

    expect(expansions).toEqual(["clozapine"]);
    expect(expansions).not.toContain("private owner b neutrophil threshold");
  });

  it("does not short-circuit unsupported-looking queries when a DB alias matches", () => {
    const query = "coffee machine wobblefix";
    const analysis = analyzeClinicalQuery(query);
    const expansions = selectRagAliasExpansions(query, [
      { alias: "wobblefix", canonical: "clozapine monitoring ANC threshold", alias_type: "custom", weight: 1 },
    ]);

    expect(shouldApplyUnsupportedSearchShortCircuit(query, analysis, [])).toBe(true);
    expect(expansions).toEqual(["clozapine monitoring ANC threshold"]);
    expect(shouldApplyUnsupportedSearchShortCircuit(query, analysis, expansions)).toBe(false);
  });

  it("uses smaller lexical candidate budgets for fast-path-friendly query classes", () => {
    expect(textCandidateBudgetForQueryClass("document_lookup", 12)).toBe(36);
    expect(textCandidateBudgetForQueryClass("table_threshold", 12)).toBe(48);
    expect(textCandidateBudgetForQueryClass("medication_dose_risk", 12)).toBe(48);
    expect(textCandidateBudgetForQueryClass("comparison", 12)).toBe(84);
    expect(textCandidateBudgetForQueryClass("unsupported_or_general", 12)).toBe(24);
  });

  it("keeps forced-embedding retrieval out of the ordinary search cache key", () => {
    const baseArgs = {
      query: "How is panic disorder managed?",
      topK: 8,
      minSimilarity: 0.12,
    };

    expect(retrievalPlanCacheQuery(baseArgs, "broad_summary")).not.toBe(
      retrievalPlanCacheQuery({ ...baseArgs, forceEmbedding: true }, "broad_summary"),
    );
  });

  it("allows direct document title hits to skip embedding retrieval", () => {
    expect(
      decideTextFastPath(
        "Where is the patient safety plan document?",
        [
          result({
            title: "Patient Safety Plan",
            similarity: 0.4,
            match_explanation: { titleHit: true, reasons: ["title"] },
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: true, reason: "direct_title_text_match" });
  });

  it("does not fast-path red-zone flowchart matches unless action evidence is present", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";

    expect(
      decideTextFastPath(
        query,
        [
          result({
            title: "CJD Risk Assessment Flow Chart",
            file_name: "cjd-risk-flowchart.pdf",
            section_heading: "Risk assessment flow chart",
            content: "The risk assessment flow chart identifies red-zone procedural exposure risk.",
            similarity: 0.82,
            index_unit: {
              id: "unit-1",
              unit_type: "flowchart_step",
              title: "Risk assessment flow chart",
              content: "Red-zone procedural exposure risk.",
              source_chunk_id: "chunk-1",
              source_image_id: "image-1",
              page_start: 1,
              page_end: 1,
              heading_path: ["Risk assessment"],
              normalized_terms: ["risk", "red zone", "flowchart"],
              quality_score: 0.9,
              extraction_mode: "model_heavy",
            },
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: false, reason: "risk_flowchart_requires_action_evidence" });

    expect(
      decideTextFastPath(
        query,
        [
          result({
            title: "Risk Matrix Flowchart",
            file_name: "risk-flowchart.pdf",
            content: "Risk flowchart red-zone risk: next step is urgent senior review and escalation.",
            similarity: 0.72,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: true, reason: "direct_title_text_match" });
  });

  it("keeps table-threshold fast paths gated on structured evidence", () => {
    expect(
      decideTextFastPath(
        "When should clozapine be withheld based on ANC threshold?",
        [result({ content: "Clozapine monitoring overview.", similarity: 0.8 })],
        "table_threshold",
      ),
    ).toEqual({ returnFastPath: false, reason: "missing_structured_threshold_evidence" });

    expect(
      decideTextFastPath(
        "When should clozapine be withheld based on ANC threshold?",
        [
          result({
            content: "Structured threshold table.",
            similarity: 0.66,
            table_facts: [tableFact({ clinical_parameter: "ANC", threshold_value: "< 1.5", action: "Withhold." })],
          }),
        ],
        "table_threshold",
      ),
    ).toEqual({ returnFastPath: false, reason: "threshold_action_requires_structured_retrieval" });

    expect(
      decideTextFastPath(
        "What clozapine ANC monitoring threshold is shown?",
        [
          result({
            content: "Structured threshold table.",
            similarity: 0.66,
            table_facts: [tableFact({ clinical_parameter: "ANC", threshold_value: "< 1.5", action: "Withhold." })],
          }),
        ],
        "table_threshold",
      ),
    ).toEqual({ returnFastPath: true, reason: "structured_threshold_text_match" });
  });

  it("keeps medication-dose fast paths gated on dose evidence", () => {
    expect(
      decideTextFastPath(
        "What dose of lorazepam is recommended?",
        [result({ content: "General agitation pathway.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: false, reason: "missing_dose_evidence" });

    expect(
      decideTextFastPath(
        "What dose of lorazepam is recommended?",
        [
          result({
            content: "Lorazepam 1 mg IM may be used with monitoring.",
            similarity: 0.67,
          }),
        ],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: true, reason: "dose_evidence_text_match" });

    expect(
      decideTextFastPath(
        "How should agitation be managed when oral medication is refused?",
        [
          result({
            content: "For agitation, use IM medication when oral medication is refused, with review and monitoring.",
            similarity: 0.67,
          }),
        ],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: true, reason: "dose_evidence_text_match" });

    expect(
      decideTextFastPath(
        "What medication doses are used for opioid withdrawal?",
        [
          result({ content: "Opioid withdrawal management guidance.", similarity: 0.9 }),
          result({ content: "For agitation, lorazepam 1 mg IM may be used.", similarity: 0.88 }),
        ],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: false, reason: "missing_dose_query_context" });
  });

  it.each([
    ["How much lorazepam should be given?", { asksAmount: true, asksRoute: false, asksFrequency: false }],
    ["How many micrograms of clonidine are used?", { asksAmount: true, asksRoute: false, asksFrequency: false }],
    ["Is clonidine 100 µg listed?", { asksAmount: true, asksRoute: false, asksFrequency: false }],
    ["How often should lorazepam be administered?", { asksAmount: false, asksRoute: false, asksFrequency: true }],
    ["Is olanzapine administered intramuscularly?", { asksAmount: false, asksRoute: true, asksFrequency: false }],
  ])("detects explicit medication evidence intent in %s", (query, expected) => {
    expect(isMedicationDoseEvidenceQuery(query)).toBe(true);
    expect(medicationDoseEvidenceQueryIntent(query)).toEqual(expected);
  });

  it("routes natural amount and frequency questions through the contextual gate", () => {
    expect(
      decideTextFastPath(
        "How much lorazepam should be given?",
        [result({ content: "Lorazepam may be used with clinical review.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: false, reason: "missing_dose_amount_evidence" });

    expect(
      decideTextFastPath(
        "How often should lorazepam be administered?",
        [result({ content: "Lorazepam 1 mg may be used with clinical review.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: false, reason: "missing_frequency_evidence" });

    expect(
      decideTextFastPath(
        "How often should lorazepam be administered?",
        [result({ content: "Lorazepam 1 mg may be administered every 6 hours.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toEqual({ returnFastPath: true, reason: "dose_evidence_text_match" });
  });

  it("accepts microgram-symbol dose evidence when it is co-located with the subject", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "How many micrograms of clonidine are used?",
        [result({ content: "Clonidine 100 µg may be used with monitoring.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: true, reason: "dose_route_amount_evidence_gate" });
  });

  it("keeps flowchart zone-action fast paths gated on action evidence", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";

    // A lexically strong but action-free flowchart page must not short-circuit
    // retrieval before the structured/vector layers can surface the zone actions.
    expect(
      decideTextFastPath(
        query,
        [
          result({
            content: "Appendix IV: Risk assessment flow chart to identify infection control procedures.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: false, reason: "risk_flowchart_requires_action_evidence" });

    // An action word alone (review/urgent) without any coloured-zone context on
    // the same result must not satisfy the guard either.
    expect(
      decideTextFastPath(
        query,
        [
          result({
            content: "Flowchart: review infection-control procedures before the patient proceeds.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: false, reason: "risk_flowchart_requires_action_evidence" });

    // Document "review" boilerplate (review date / reviewed by) on a zone chunk
    // is not an action instruction and must not satisfy the guard.
    expect(
      decideTextFastPath(
        query,
        [
          result({
            content: "Red Zone criteria table. Review date: March 2026. Reviewed by the policy committee.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: false, reason: "risk_flowchart_requires_action_evidence" });

    expect(
      decideTextFastPath(
        query,
        [
          result({
            content:
              "If deteriorating (has any Purple or Red Zone criteria on observation chart), escalate for Senior Clinician Review or call a MET.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: true, reason: "strong_document_text_score" });
  });

  it("applies the zone-action guard to hyphenated risk-matrix queries", () => {
    // "risk-matrix" phrasing must trigger the same guard as "risk matrix".
    expect(
      decideTextFastPath(
        "In the risk-matrix, what is the next step after the red zone?",
        [
          result({
            content: "Risk-matrix overview of procedural exposure categories.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: false, reason: "risk_flowchart_requires_action_evidence" });
  });

  it("matches the queried zone colour before fast-pathing", () => {
    // A red-zone question must not fast-path on an amber-zone action chunk.
    expect(
      decideTextFastPath(
        "In the clinical flowchart, what is the next step after red-zone risk?",
        [
          result({
            content: "If the patient reaches the Amber Zone, escalate for urgent senior review.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: false, reason: "risk_flowchart_requires_action_evidence" });

    // ...and an amber-zone question (no literal "risk"/"red") still triggers the
    // guard and is satisfied by amber-zone action evidence.
    expect(
      decideTextFastPath(
        "In the clinical flowchart, what is the next step after the amber zone?",
        [
          result({
            content: "If the patient reaches the Amber Zone, escalate for urgent senior review.",
            similarity: 0.82,
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: true, reason: "strong_document_text_score" });
  });

  it("accepts risk-matrix cell colour tokens as zone context", () => {
    // risk_matrix_cell units store the cell colour as a bare token
    // ("... | Red | escalate ..."), not as the phrase "red zone".
    expect(
      decideTextFastPath(
        "In the risk matrix flowchart, what action is shown after red-zone risk?",
        [
          result({
            content:
              "Aggression risk matrix | Physical aggression | Recent incident | Red | Escalate to senior clinician urgently",
            similarity: 0.82,
            index_unit: {
              id: "unit-rm",
              unit_type: "risk_matrix_cell",
              title: "Physical aggression / Recent incident: Red",
              content:
                "Aggression risk matrix | Physical aggression | Recent incident | Red | Escalate to senior clinician urgently",
              source_chunk_id: "chunk-1",
              source_image_id: "image-1",
              page_start: 1,
              page_end: 1,
              heading_path: ["Risk matrix"],
              normalized_terms: ["red", "risk matrix"],
              quality_score: 0.9,
              extraction_mode: "model_heavy",
            },
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: true, reason: "strong_document_text_score" });
  });

  it("treats hyphenated risk-matrix queries as flowchart next-step lookups", () => {
    expect(
      decideTextFastPath(
        "In the risk-matrix flowchart, what action is shown after red-zone risk?",
        [
          result({
            content:
              "Aggression risk matrix | Physical aggression | Recent incident | Red | Escalate to senior clinician urgently",
            similarity: 0.82,
            index_unit: {
              id: "unit-rm-hyphen",
              unit_type: "risk_matrix_cell",
              title: "Physical aggression / Recent incident: Red",
              content:
                "Aggression risk matrix | Physical aggression | Recent incident | Red | Escalate to senior clinician urgently",
              source_chunk_id: "chunk-1",
              source_image_id: "image-1",
              page_start: 1,
              page_end: 1,
              heading_path: ["Risk matrix"],
              normalized_terms: ["red", "risk matrix"],
              quality_score: 0.9,
              extraction_mode: "model_heavy",
            },
          }),
        ],
        "document_lookup",
      ),
    ).toEqual({ returnFastPath: true, reason: "strong_document_text_score" });
  });

  it("requires zone and action evidence on a single result for the flowchart risk gate", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";

    // Zone words on one result and action words on another (or a flowchart image
    // caption) must not satisfy the gate - the answer needs both on one result.
    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({ content: "Risk assessment flow chart for infection control procedures.", similarity: 0.9 }),
          result({
            id: "chunk-2",
            content: "Compliance is monitored by review of clinical incidents.",
            similarity: 0.8,
          }),
        ],
        "document_lookup",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_visual_flowchart_risk_evidence" });

    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            content:
              "If deteriorating (has any Purple or Red Zone criteria on observation chart), escalate for Senior Clinician Review.",
            similarity: 0.9,
          }),
        ],
        "document_lookup",
      ),
    ).toMatchObject({ accepted: true, reason: "visual_flowchart_risk_gate" });
  });

  it("routes plain flowchart document lookups through the ordinary title gate", () => {
    // A flowchart mention without zone / next-step intent must not be forced
    // through the zone-action gate; a direct title hit uses the title gate.
    expect(
      evaluateEvidenceCoverageGate(
        "Which procedure flowchart covers ECT team coordination?",
        [
          result({
            title: "ECT Team Coordination Procedure Flowchart",
            file_name: "ect-team-coordination-flowchart.pdf",
            content: "Procedure flowchart covering ECT team coordination responsibilities.",
            similarity: 0.72,
            match_explanation: { titleHit: true, reasons: ["title"] },
          }),
        ],
        "document_lookup",
      ),
    ).toMatchObject({ strategy: "document_lookup_fast_path", reason: "document_title_evidence_gate" });
  });

  it("does not fast-path comparison queries before synthesis retrieval", () => {
    expect(
      decideTextFastPath(
        "Compare clozapine and lithium monitoring requirements.",
        [result({ content: "Clozapine and lithium monitoring.", similarity: 0.95 })],
        "comparison",
      ),
    ).toEqual({ returnFastPath: false, reason: "comparison_requires_synthesis" });
  });

  it("accepts active community ED title evidence before vector retrieval", () => {
    const gate = evaluateEvidenceCoverageGate(
      "How are active community patients in ED managed?",
      [
        result({
          title: "Active Community Patients in the Emergency Department",
          file_name: "active-community-pt-ed.pdf",
          content: "Active community patients in ED require liaison with the community team.",
          similarity: 0.72,
          match_explanation: {
            titleHit: true,
            labelHit: false,
            sectionHit: false,
            contentHit: true,
            tableHit: false,
            reasons: ["title"],
          },
        }),
      ],
      "document_lookup",
    );

    expect(gate).toMatchObject({
      accepted: true,
      reason: "active_community_ed_title_gate",
      strategy: "document_lookup_fast_path",
    });
  });

  it("requires action-bearing risk flowchart evidence before accepting document lookup coverage", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";

    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            title: "CJD Risk Assessment Flow Chart",
            file_name: "cjd-risk-flowchart.pdf",
            section_heading: "Risk assessment flow chart",
            content: "The flowchart identifies red-zone procedural risk categories.",
            similarity: 0.85,
            index_unit: {
              id: "unit-1",
              unit_type: "flowchart_step",
              title: "Risk assessment flow chart",
              content: "Red-zone procedural exposure risk.",
              source_chunk_id: "chunk-1",
              source_image_id: "image-1",
              page_start: 1,
              page_end: 1,
              heading_path: ["Risk assessment"],
              normalized_terms: ["risk", "red zone", "flowchart"],
              quality_score: 0.9,
              extraction_mode: "model_heavy",
            },
          }),
        ],
        "document_lookup",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_visual_flowchart_risk_evidence" });

    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            title: "Risk Matrix Flowchart",
            file_name: "risk-flowchart.pdf",
            content: "Risk flowchart red-zone risk: next step is urgent senior review and escalation.",
            similarity: 0.72,
          }),
        ],
        "document_lookup",
      ),
    ).toMatchObject({ accepted: true, reason: "visual_flowchart_risk_gate" });
  });

  it("requires clozapine blood action structured evidence for withhold threshold fast gates", () => {
    const query = "When should clozapine be withheld based on ANC and FBC threshold values?";
    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            title: "Clozapine Prescribing Administration Monitoring",
            content: "Clozapine monitoring overview.",
            similarity: 0.9,
          }),
        ],
        "table_threshold",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_clozapine_blood_action_structured_threshold" });

    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            title: "Clozapine Prescribing Administration Monitoring",
            content: "ANC and FBC monitoring table.",
            similarity: 0.8,
            table_facts: [
              tableFact({
                table_title: "Clozapine ANC/FBC table",
                clinical_parameter: "ANC",
                threshold_value: "< 1.5",
                action: "Withhold clozapine and review.",
              }),
            ],
          }),
        ],
        "table_threshold",
      ),
    ).toMatchObject({ accepted: true, reason: "clozapine_blood_action_structured_threshold" });
  });

  it("requires both route and numeric dose evidence for dose-route fast gates", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "What dose and route are shown in the agitation medication chart?",
        [result({ title: "Agitation and Arousal", content: "Lorazepam may be used for agitation.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_dose_amount_evidence" });

    expect(
      evaluateEvidenceCoverageGate(
        "What dose and route are shown in the agitation medication chart?",
        [
          result({
            title: "Agitation and Arousal Pharmacological Management",
            content: "Agitation medication chart: lorazepam 1 mg IM or PO with monitoring.",
            similarity: 0.8,
          }),
        ],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: true, reason: "dose_route_amount_evidence_gate" });
  });

  it("requires requested dose and route evidence to be co-located", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "How much lorazepam is administered intramuscularly?",
        [
          result({ id: "amount", content: "Lorazepam 1 mg may be used with monitoring.", similarity: 0.9 }),
          result({ id: "route", content: "Lorazepam may be administered intramuscularly.", similarity: 0.88 }),
        ],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_co_located_medication_evidence" });
  });

  it("reports missing route evidence for route-only questions", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "Which route is listed for lorazepam?",
        [result({ content: "Lorazepam is recommended with clinical monitoring.", similarity: 0.9 })],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_route_evidence" });
  });

  it("accepts SC and SL route evidence for dose-route fast gates", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "What SC route dose is listed?",
        [
          result({
            content: "Medication chart: 2 mg subcutaneous administration is listed for the route option.",
            similarity: 0.8,
          }),
        ],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: true, reason: "dose_route_amount_evidence_gate" });

    expect(
      evaluateEvidenceCoverageGate(
        "What SL route dose is listed?",
        [
          result({
            content: "Medication chart: 2 mg sublingual administration is listed for the route option.",
            similarity: 0.8,
          }),
        ],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: true, reason: "dose_route_amount_evidence_gate" });
  });

  it("does not require route for a dose-only question when dose and subject are co-located", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "What medication doses are used for opioid withdrawal?",
        [
          result({
            title: "Opioid use disorder",
            content: "For opioid withdrawal, methadone 10 mg may be used initially.",
            similarity: 0.8,
          }),
        ],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: true, reason: "dose_route_amount_evidence_gate" });
  });

  it("rejects entity-crossing dose evidence from an unrelated medication result", () => {
    expect(
      evaluateEvidenceCoverageGate(
        "What medication doses are used for opioid withdrawal?",
        [
          result({ content: "Opioid withdrawal management guidance.", similarity: 0.9 }),
          result({ content: "For agitation, lorazepam 1 mg IM may be used.", similarity: 0.88 }),
        ],
        "medication_dose_risk",
      ),
    ).toMatchObject({ accepted: false, reason: "missing_dose_query_context" });
  });

  it("ranks subject-matched dose evidence above stronger unrelated numeric dose results", () => {
    const query = "What medication doses are used for opioid withdrawal?";
    const ranked = rankClinicalResults(query, [
      result({
        id: "unrelated-dose",
        title: "Nicotine Replacement Therapy",
        content: "Nicotine patch 21 mg/24 hours and gum 4 mg are available.",
        similarity: 0.9,
      }),
      result({
        id: "opioid-dose",
        title: "Opioid use disorder",
        content: "For opioid withdrawal, methadone 10 mg may be used initially.",
        similarity: 0.55,
      }),
    ]);

    expect(ranked[0]?.id).toBe("opioid-dose");
    expect(ranked[0]?.score_explanation?.clinicalSignalBoost).toBeGreaterThan(
      ranked[1]?.score_explanation?.clinicalSignalBoost ?? 0,
    );
    expect(ranked[1]?.score_explanation?.rawPenalty).toBeLessThan(0);

    const selected = selectRetrievalEvidence({
      query,
      queryClass: "medication_dose_risk",
      results: ranked,
      topK: 1,
      maxResultsPerDocument: 2,
    });
    expect(selected.intent.requiredTermSignals).toContain("clinical_subject");
    expect(selected.results[0]?.id).toBe("opioid-dose");
  });

  it("requires direct source image evidence for source image/table requests", () => {
    const query = "Show the source table image for the patient property restricted items table.";
    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            title: "Patient Property",
            content: "Patient property restricted items table.",
            similarity: 0.8,
            table_facts: [
              tableFact({ source_image_id: null, table_title: "Patient Property", row_label: "Restricted items" }),
            ],
          }),
        ],
        "table_threshold",
      ),
    ).toMatchObject({ accepted: false, reason: "source_image_required_missing" });

    expect(
      evaluateEvidenceCoverageGate(
        query,
        [
          result({
            title: "Patient Property",
            content: "Patient property restricted items table.",
            similarity: 0.8,
            table_facts: [
              tableFact({ source_image_id: "image-1", table_title: "Patient Property", row_label: "Restricted items" }),
            ],
          }),
        ],
        "table_threshold",
      ),
    ).toMatchObject({ accepted: true, sourceImageSatisfied: true });
  });

  it("keeps source-image table and ANC terms in the text retrieval query", () => {
    const textQuery = buildClinicalTextSearchQuery(
      "Show the source table image for the clozapine ANC monitoring table.",
    );

    expect(textQuery).toContain("source");
    expect(textQuery).toContain("image");
    expect(textQuery).toContain("table");
    expect(textQuery).toContain("clozapine");
    expect(textQuery).toContain("anc");
  });

  it("keeps risk and red-zone flowchart terms in the text retrieval query", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";
    const textQuery = buildClinicalTextSearchQuery(query);
    const variants = buildRetrievalQueryVariants(query, analyzeClinicalQuery(query));

    expect(textQuery).toContain("risk");
    expect(textQuery).toContain("red");
    expect(textQuery).toContain("flowchart");
    expect(textQuery).toContain("next");
    expect(textQuery).toContain("step");
    // "red zone" replaces the old fully-conjunctive variants ("red zone risk flow",
    // "risk flow review urgent escalation") which matched 0/2 live chunks under
    // websearch_to_tsquery AND semantics and never contributed candidates.
    expect(variants).toEqual(expect.arrayContaining(["risk flow", "red zone"]));
    expect(variants).not.toContain("red zone risk flow");
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it("matches the zone variant to the colour the query names", () => {
    const query = "In the clinical flowchart, what is the next step after amber-zone risk?";
    const variants = buildRetrievalQueryVariants(query, analyzeClinicalQuery(query));

    // An amber-zone question must not pull red-zone chunks into its candidate
    // pool; the injected variant follows the colour the query names.
    expect(variants).toContain("amber zone");
    expect(variants).not.toContain("red zone");
  });

  it("injects the zone variant for risk-matrix wording too", () => {
    const query = "What action is shown for the risk matrix red zone?";
    const variants = buildRetrievalQueryVariants(query, analyzeClinicalQuery(query));

    // Risk-matrix questions hit the same zone-action evidence (risk_matrix_cell
    // units store the colour as a bare token), so they need the precise
    // "<colour> zone" variant just like flowchart wording does.
    expect(variants).toContain("red zone");
  });

  it("injects zone-colour variant for risk-matrix queries without a flowchart token", () => {
    // A query phrased as "risk matrix" (no "flowchart"/"algorithm"/"pathway") must
    // still receive the zone-colour variant so recall is not regressed for this
    // class of next-step question.
    const query = "In the risk matrix, what is the next step after the red zone?";
    const variants = buildRetrievalQueryVariants(query, analyzeClinicalQuery(query));

    expect(variants).toEqual(expect.arrayContaining(["risk flow", "red zone"]));
  });

  it("keeps agitation route queries focused on the canonical agitation and arousal source", () => {
    const query = "What IM or PO options are listed for agitation?";
    const textQuery = buildClinicalTextSearchQuery(query);
    const ranked = rankClinicalResults(query, [
      result({
        id: "generic-icu",
        document_id: "generic-doc",
        title: "Ventilated ICU Patients Bundle",
        file_name: "Ventilated ICU Patients Bundle.pdf",
        content: "Fentanyl bolus 50 microg/hr and oral medication options are listed.",
        similarity: 0.88,
      }),
      result({
        id: "agitation-source",
        document_id: "agitation-doc",
        title: "Agitation and Arousal Pharmacological Management",
        file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
        content: "Agitation medication chart: lorazepam 1 mg IM or PO with monitoring.",
        similarity: 0.54,
      }),
    ]);
    const selected = selectRetrievalEvidence({
      query,
      queryClass: "medication_dose_risk",
      results: ranked,
      topK: 1,
      maxResultsPerDocument: 2,
    });

    expect(textQuery).toBe("agitation arousal im po");
    expect(ranked[0].file_name).toBe("MHSP.AgitationArousalPharmaMgt.pdf");
    expect(selected.results[0]?.file_name).toBe("MHSP.AgitationArousalPharmaMgt.pdf");
  });

  it("keeps typo-heavy agitation dosing queries above generic infusion dosing sources", () => {
    const query = "What agitaton and arousl dosing guidance applies to psychiatric inpatients?";
    const textQuery = buildClinicalTextSearchQuery(query);
    const ranked = rankClinicalResults(query, [
      result({
        id: "smart-pump",
        document_id: "smart-pump-doc",
        title: "Smart Infusion Pumps and Dose Error Reduction Software Policy",
        file_name: "Smart Infusion Pumps and Dose Error Reduction Software (DERS) Policy (RPBG).pdf",
        content: "Infusion pump dose limits, infusion medication safety, and inpatient medication guidance.",
        similarity: 0.91,
      }),
      result({
        id: "dopamine",
        document_id: "dopamine-doc",
        title: "Dopamine Intravenous Infusion Management",
        file_name: "Dopamine Intravenous Infusion Management (RPBG).pdf",
        content: "Dopamine intravenous infusion dosing and monitoring guidance for clinical deterioration.",
        similarity: 0.87,
      }),
      result({
        id: "agitation-source",
        document_id: "agitation-doc",
        title: "Agitation and Arousal Pharmacological Management",
        file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
        content:
          "Medication chart for agitation and arousal pharmacological management in psychiatric inpatients, including IM and PO dose options.",
        similarity: 0.55,
        table_facts: [
          tableFact({
            table_title: "Agitation and arousal medication chart",
            row_label: "Lorazepam",
            threshold_value: "1 mg IM or PO",
            action: "Monitor response before repeat dosing.",
          }),
        ],
      }),
    ]);
    const selected = selectRetrievalEvidence({
      query,
      queryClass: "medication_dose_risk",
      results: ranked,
      topK: 1,
      maxResultsPerDocument: 2,
    });

    expect(textQuery).toBe("agitation arousal dose");
    expect(ranked[0].file_name).toBe("MHSP.AgitationArousalPharmaMgt.pdf");
    expect(selected.results[0]?.file_name).toBe("MHSP.AgitationArousalPharmaMgt.pdf");
  });

  it("promotes active-community ED source identity over generic ED management documents", () => {
    const query = "How are active community patients in ED managed?";
    const ranked = rankClinicalResults(query, [
      result({
        id: "generic-ed",
        document_id: "generic-ed-doc",
        title: "Patient Management in ED",
        file_name: "Patient Management in ED (FSH).pdf",
        content: "Management plan in ED and consultation liaison review.",
        similarity: 0.88,
      }),
      result({
        id: "active-community",
        document_id: "active-community-doc",
        title: "Active Community Pt ED",
        file_name: "MHSP.ActiveCommunityPtED.pdf",
        content: "Active community patients in ED are managed with community team liaison.",
        similarity: 0.52,
      }),
    ]);
    const selected = selectRetrievalEvidence({
      query,
      queryClass: "document_lookup",
      results: ranked,
      topK: 1,
      maxResultsPerDocument: 2,
    });

    expect(ranked[0].file_name).toBe("MHSP.ActiveCommunityPtED.pdf");
    expect(selected.results[0]?.file_name).toBe("MHSP.ActiveCommunityPtED.pdf");
  });

  it("promotes red-zone risk flowchart evidence over generic red-flag deterioration documents", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";
    const ranked = rankClinicalResults(query, [
      result({
        id: "generic-red-flags",
        document_id: "generic-red-flags-doc",
        title: "Secondary Assessment of Undiagnosed Patient in ED",
        file_name: "Secondary Assessment of Undiagnosed Patient in ED.pdf",
        content: "Identify red flags and escalate deterioration concerns.",
        similarity: 0.82,
      }),
      result({
        id: "risk-flowchart",
        document_id: "risk-flowchart-doc",
        title: "Risk Flowchart Red Zone",
        file_name: "Clinical Risk Flowchart.pdf",
        content: "Risk flowchart: after red-zone risk, urgent senior review is the next step.",
        similarity: 0.51,
      }),
    ]);
    const selected = selectRetrievalEvidence({
      query,
      queryClass: "document_lookup",
      results: ranked,
      topK: 1,
      maxResultsPerDocument: 2,
    });

    expect(ranked[0].file_name).toBe("Clinical Risk Flowchart.pdf");
    expect(selected.results[0]?.file_name).toBe("Clinical Risk Flowchart.pdf");
  });

  it("does not boost another colour's zone action for a colour-specific query", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";
    const ranked = rankClinicalResults(query, [
      result({
        id: "amber-zone-action",
        document_id: "amber-zone-doc",
        title: "Deterioration Response Guideline",
        file_name: "Deterioration Response Guideline.pdf",
        content: "If the patient reaches the Amber Zone, escalate for urgent senior review.",
        similarity: 0.62,
      }),
    ]);

    // Amber-zone action evidence must not take the risk-flowchart boost (or
    // dodge the generic penalty) for a red-zone question.
    expect(ranked[0]?.score_explanation?.rawPenalty).toBeLessThanOrEqual(-0.18);
  });

  it("penalizes action-free risk flowcharts for next-step queries", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";
    const ranked = rankClinicalResults(query, [
      result({
        id: "action-free-flowchart",
        document_id: "action-free-doc",
        title: "Infection Control Policy",
        file_name: "Infection Control Policy.pdf",
        content: "Risk assessment flow chart covering red-zone procedural risk categories.",
        similarity: 0.62,
      }),
    ]);

    // Naming the risk without any action instruction must not earn the
    // risk-flowchart boost (or dodge the generic penalty) for a next-step query.
    expect(ranked[0]?.score_explanation?.rawPenalty).toBeLessThanOrEqual(-0.18);
  });

  it("treats zone-action escalation text as risk-flowchart evidence even without the word flowchart", () => {
    const query = "In the clinical flowchart, what is the next step after red-zone risk?";
    const ranked = rankClinicalResults(query, [
      result({
        id: "zone-action",
        document_id: "zone-action-doc",
        title: "Recognising and Responding to Acute Deterioration",
        file_name: "Recognising and Responding to Acute Deterioration.pdf",
        content:
          "If deteriorating (has any Purple or Red Zone criteria on observation chart), escalate for Senior Clinician Review or call a MET.",
        similarity: 0.62,
      }),
    ]);

    // Escalation protocols express the flowchart's decision steps as text; they
    // must not take the generic risk-flowchart penalty for lacking the literal
    // word "flowchart".
    expect(ranked[0]?.score_explanation?.rawPenalty).toBe(0);
  });

  it("redacts retrieval cache keys while preserving query class and variant uniqueness", () => {
    const baseArgs = {
      query: "What ANC threshold should stop clozapine?",
      ownerId: "owner-1",
      topK: 8,
      minSimilarity: 0.12,
      queryMode: "auto" as const,
    };
    const key = retrievalPlanCacheQuery(baseArgs, "table_threshold", ["clozapine anc", "clozapine fbc"]);

    expect(key).toMatch(/^redacted-cache:[a-f0-9]{64}$/);
    expect(key).not.toContain("clozapine");
    expect(key).not.toContain("class:table_threshold");
    expect(key).not.toEqual(retrievalPlanCacheQuery(baseArgs, "document_lookup", ["clozapine anc", "clozapine fbc"]));
    expect(key).not.toEqual(retrievalPlanCacheQuery(baseArgs, "table_threshold", ["different variant"]));
    expect(key).not.toEqual(retrievalPlanCacheQuery({ ...baseArgs, topK: 12 }, "table_threshold", ["clozapine anc"]));
    expect(key).not.toEqual(
      retrievalPlanCacheQuery({ ...baseArgs, ragQueryPlanVersion: "rag-query-plan-v2" }, "table_threshold", [
        "clozapine anc",
        "clozapine fbc",
      ]),
    );
    expect(
      retrievalPlanCacheQuery({ ...baseArgs, ragQueryPlanVersion: "rag-query-plan-v2" }, "table_threshold", [
        "private raw subquestion text",
      ]),
    ).not.toContain("private raw subquestion text");
  });
});

describe("clinical abbreviation synonym expansion (CI-14)", () => {
  it("expands the FBC/CBC lab family bidirectionally", () => {
    // A clinician searching the US term "CBC" must reach FBC-only documents, and vice versa.
    expect(expandClinicalVocabularyText("cbc")).toEqual(expect.arrayContaining(["full blood count", "fbc"]));
    expect(expandClinicalVocabularyText("fbc")).toEqual(expect.arrayContaining(["full blood count", "cbc"]));
    expect(expandClinicalVocabularyText("complete blood count")).toEqual(expect.arrayContaining(["fbc"]));
  });

  it("surfaces the FBC form into the retrieval analysis for a CBC query", () => {
    // The expansion must reach analysis.expandedTerms, which feeds the query variants that
    // are run against the lexical RPCs and unioned — recovering FBC-only chunks.
    const analysis = analyzeClinicalQuery("clozapine CBC monitoring threshold");
    expect(analysis.expandedTerms).toEqual(expect.arrayContaining(["fbc"]));
  });

  it("expands the subcutaneous and sublingual administration routes", () => {
    expect(expandClinicalVocabularyText("give sc injection")).toEqual(expect.arrayContaining(["subcutaneous"]));
    expect(expandClinicalVocabularyText("administer sublingual")).toEqual(expect.arrayContaining(["sublingual", "sl"]));
  });
});

describe("relaxVariantToOrQuery (8b over-conjunction fallback)", () => {
  it("relaxes a multi-term AND variant to a deduped term-OR query", () => {
    expect(relaxVariantToOrQuery("ciwa score threshold drug treatment alcohol withdrawal")).toBe(
      "ciwa OR score OR threshold OR drug OR treatment OR alcohol OR withdrawal",
    );
  });

  it("strips punctuation, single-char tokens, and duplicate terms", () => {
    expect(relaxVariantToOrQuery("CIWA-Ar a alcohol, alcohol")).toBe("ciwa OR ar OR alcohol");
  });

  it("returns null when there is nothing to relax", () => {
    expect(relaxVariantToOrQuery("")).toBeNull();
    expect(relaxVariantToOrQuery("clozapine")).toBeNull();
  });
});

describe("shouldRelaxWeakTextMatches (P8b weak-augment)", () => {
  it("never fires on an empty strict result set (that is the empty_fallback path)", () => {
    expect(shouldRelaxWeakTextMatches([])).toBe(false);
  });

  it("fires when strict-AND returned a sparse set of middling matches", () => {
    expect(shouldRelaxWeakTextMatches([result({ text_rank: 0.1 })])).toBe(true);
    expect(
      shouldRelaxWeakTextMatches([result({ id: "a", text_rank: 0.12 }), result({ id: "b", text_rank: 0.08 })]),
    ).toBe(true);
  });

  it("does not fire when a sparse set is anchored by a strong lexical hit", () => {
    // A single precise match (e.g. an exact table lookup) must stay a one-RPC retrieval.
    expect(shouldRelaxWeakTextMatches([result({ text_rank: 1.1 })])).toBe(false);
    expect(
      shouldRelaxWeakTextMatches([result({ id: "a", text_rank: 0.4 }), result({ id: "b", text_rank: 0.05 })]),
    ).toBe(false);
  });

  it("fires when the best strict text rank is below the meaningful-signal floor", () => {
    const weak = [
      result({ id: "a", text_rank: 0.01 }),
      result({ id: "b", text_rank: 0.02 }),
      result({ id: "c", text_rank: 0.04 }),
    ];
    expect(shouldRelaxWeakTextMatches(weak)).toBe(true);
  });

  it("does not fire when strict-AND already carries meaningful lexical evidence", () => {
    const strong = [
      result({ id: "a", text_rank: 0.4 }),
      result({ id: "b", text_rank: 0.2 }),
      result({ id: "c", text_rank: 0.1 }),
    ];
    expect(shouldRelaxWeakTextMatches(strong)).toBe(false);
  });

  it("treats a missing text_rank as no lexical evidence", () => {
    const missing = [result({ id: "a" }), result({ id: "b" }), result({ id: "c" })];
    expect(shouldRelaxWeakTextMatches(missing)).toBe(true);
  });
});

describe("firstVariantPoolIsStrong (PT-02 sibling-variant early-exit)", () => {
  const pool = (count: number, topRank: number) =>
    Array.from({ length: count }, (_, index) =>
      result({ id: `chunk-${index}`, text_rank: index === 0 ? topRank : 0.1 }),
    );

  it("skips siblings only for a deep pool anchored by a precise hit", () => {
    expect(firstVariantPoolIsStrong(pool(24, 0.9), 48)).toBe(true);
    expect(firstVariantPoolIsStrong(pool(6, 0.35), 12)).toBe(true);
  });

  it("keeps the fan-out when the pool is shallow, even with a strong top hit", () => {
    expect(firstVariantPoolIsStrong(pool(3, 1.2), 48)).toBe(false);
    expect(firstVariantPoolIsStrong([], 12)).toBe(false);
  });

  it("keeps the fan-out when the pool is deep but imprecise", () => {
    expect(firstVariantPoolIsStrong(pool(48, 0.2), 48)).toBe(false);
  });

  it("agrees with the weak-OR bar so both paths share one notion of a precise hit", () => {
    // A pool that early-exits must never be one the weak-OR path considers weak.
    const strong = pool(24, 0.35);
    expect(firstVariantPoolIsStrong(strong, 48)).toBe(true);
    expect(shouldRelaxWeakTextMatches(strong)).toBe(false);
  });

  it("treats missing text_rank as no lexical evidence", () => {
    const unranked = Array.from({ length: 24 }, (_, index) => result({ id: `chunk-${index}` }));
    expect(firstVariantPoolIsStrong(unranked, 48)).toBe(false);
  });
});
