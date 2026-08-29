import { describe, expect, it } from "vitest";
import {
  analyzeClinicalQuery,
  buildClinicalTextSearchQuery,
  classifyQueryIntent,
  classifyRagQuery,
  clinicalRankExplanation,
  expandClinicalQuery,
  hasDoseEvidenceSupport,
  hasForeignThresholdLabel,
  hasMedicationMonitoringSubjectEvidence,
  hasNumericOrTableEvidence,
  hasStructuredThresholdEvidence,
  medicationMonitoringQuerySubjectTokens,
  normalizedClinicalSearchTokens,
  rankClinicalResults,
} from "../src/lib/clinical-search";
import { queryForClinicalMode } from "../src/lib/clinical-query-mode";
import { buildRagQueryPlan } from "../src/lib/rag/rag-query-plan";
import type { SearchResult } from "../src/lib/types";

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "doc-1",
    title: overrides.title ?? "Guideline",
    file_name: overrides.file_name ?? "guideline.pdf",
    page_number: 1,
    chunk_index: 0,
    section_heading: null,
    content: overrides.content ?? "Treatment process text.",
    image_ids: [],
    similarity: overrides.similarity ?? 0.6,
    hybrid_score: overrides.hybrid_score ?? 0.6,
    images: [],
    ...overrides,
  };
}

describe("deterministic RAG query-plan routing", () => {
  it.each([
    ["Which specifier applies to panic disorder?", "specifiers"],
    ["What differential diagnosis should be considered?", "differentials"],
    ["Which medication is listed for acute agitation?", "medications"],
  ] as const)("maps explicit site vocabulary without provider work: %s", (query, expectedDomain) => {
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(plan.targetSiteDomains).toContain(expectedDomain);
    expect(plan.siteDomainDecision).toBe("explicit");
  });

  it.each([
    ["What is the duress procedure during an acute ward incident?", []],
    ["When is IM medication used for agitation?", ["medications"]],
  ] as const)("keeps clinical pathway planning on an open or clinical site domain: %s", (query, domains) => {
    const analysis = analyzeClinicalQuery(query);
    const plan = buildRagQueryPlan(query, analysis);

    expect(plan.kind).not.toBe("clarification_required");
    expect(plan.targetSiteDomains).toEqual(domains);
  });

  it("keeps ambiguous clinical wording open to all site domains", () => {
    const query = "What should be considered next?";
    const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));

    expect(plan.targetSiteDomains).toEqual([]);
    expect(plan.siteDomainDecision).toBe("none");
  });
});

describe("clinical search query normalization", () => {
  it("does not mistake a determiner before a categorical range for a foreign subject", () => {
    expect(
      hasForeignThresholdLabel(
        "what clozapine monitoring action is needed for red range blood results",
        "If blood results return in the red range, clozapine therapy must be discontinued immediately.",
      ),
    ).toBe(false);
  });

  it("recognizes plural foreign threshold labels", () => {
    expect(
      hasForeignThresholdLabel(
        "What lithium level range is used for maintenance monitoring?",
        "Blood glucose target levels: Maintenance range is 3.0-15.0 mmol/L.",
      ),
    ).toBe(true);
    expect(
      hasForeignThresholdLabel(
        "What lithium level range is used for maintenance monitoring?",
        "TSH reference ranges: Maintenance range is 0.4-4.0 mIU/L.",
      ),
    ).toBe(true);
  });

  it.each([
    ["Lithicarb", "TSH is 0.4 to 4.0 mmol/L."],
    ["Quilonum SR", "Serum sodium is 130 to 145 mmol/L."],
    ["Lithicarb", "Blood glucose is 3.0 to 15.0 mmol/L."],
  ])("recognizes an assigned foreign analyte for a %s level query", (brand, evidence) => {
    expect(hasForeignThresholdLabel(`What ${brand} level range is used for maintenance monitoring?`, evidence)).toBe(
      true,
    );
  });

  it.each([
    ["What FBC threshold should withhold clozapine?", "ANC is 1.5 × 10⁹/L."],
    ["What thyroid level is used for monitoring?", "TSH is 4.0 mIU/L."],
  ])("keeps equivalent assigned analyte labels in scope: %s", (query, evidence) => {
    expect(hasForeignThresholdLabel(query, evidence)).toBe(false);
  });

  it("does not mistake local monitoring grammar or analyte aliases for foreign labels", () => {
    expect(
      hasForeignThresholdLabel(
        "What monitoring is required for lithium therapy?",
        "Lithium monitoring requires serum levels and renal and thyroid function tests.",
      ),
    ).toBe(false);
    expect(
      hasForeignThresholdLabel(
        "What ANC and FBC thresholds apply to clozapine?",
        "Clozapine ANC and FBC monitoring for neutrophil thresholds.",
      ),
    ).toBe(false);
  });

  it("keeps a valid medication row when a separate row names another medication", () => {
    expect(
      hasMedicationMonitoringSubjectEvidence(
        "What lithium level range is used for maintenance monitoring?",
        result({
          title: "Lithium Therapy",
          content: "Lithium maintenance range is 0.6 to 0.8 mmol/L. Valproate therapeutic range is 50 to 100 mg/L.",
        }),
      ),
    ).toBe(true);
  });

  it("does not grant subject support from a generic medication sentence beside foreign-only monitoring evidence", () => {
    expect(
      hasMedicationMonitoringSubjectEvidence(
        "What lithium level range is used for maintenance monitoring?",
        result({
          title: "Lithium Therapy",
          content: "Lithium guidance. Valproate therapeutic range is 50 to 100 mg/L.",
        }),
      ),
    ).toBe(false);
  });

  it.each([
    [
      "What monitoring is required for lithium therapy?",
      "Lithium therapy is ongoing. Monitor renal and thyroid function every six months.",
    ],
    ["What FBC threshold should withhold clozapine?", "Red FBC results require action. Clozapine should be withheld."],
    [
      "What monitoring is required for lithium therapy?",
      "Lithium therapy is ongoing. The patient should have renal and thyroid function checked every six months.",
    ],
    [
      "What FBC threshold should discontinue clozapine?",
      "Red FBC results require action. Clozapine should be discontinued.",
    ],
  ])("binds an adjacent subject sentence to its monitoring atom: %s", (query, content) => {
    expect(hasMedicationMonitoringSubjectEvidence(query, result({ content }))).toBe(true);
  });

  it.each([
    "Methotrexate monitoring requires renal tests every six months. Lithium guidance.",
    "Lithium guidance. Methotrexate monitoring requires renal tests every six months.",
    "Lithium therapy is ongoing. Check methotrexate renal tests every six months.",
  ])("does not bind an unrecognized foreign medication across sentence adjacency", (content) => {
    expect(
      hasMedicationMonitoringSubjectEvidence("What monitoring is required for lithium therapy?", result({ content })),
    ).toBe(false);
  });

  it("keeps only the medication subject for monitoring questions", () => {
    expect(medicationMonitoringQuerySubjectTokens("What monitoring is required for lithium therapy?")).toEqual([
      "lithium",
    ]);
    expect(medicationMonitoringQuerySubjectTokens("What monitoring escalation is required?")).toEqual([]);
  });

  it.each(["Lithicarb", "Quilonum SR", "lithium carbonate"])(
    "canonicalizes %s to the lithium monitoring subject",
    (medication) => {
      expect(
        medicationMonitoringQuerySubjectTokens(`What ${medication} level range is used for maintenance monitoring?`),
      ).toEqual(["lithium"]);
    },
  );

  it("classifies common RAG query shapes for routing and observability", () => {
    expect(classifyRagQuery("Find the NOCC document").queryClass).toBe("document_lookup");
    expect(classifyRagQuery("What should a patient safety plan include?").queryClass).toBe("document_lookup");
    // M2/M3 (audit 2026-07-01): intent signals match at word boundaries, and
    // explicit dose vocabulary survives escalation-word cancellation.
    expect(classifyQueryIntent("What is the time limit for a notable review?").hasDosingSignals).toBe(false);
    expect(classifyQueryIntent("What is the time limit for a notable review?").imageEvidenceFocus).toBe(false);
    expect(classifyQueryIntent("clozapine dose review schedule").hasDosingSignals).toBe(true);
    expect(classifyQueryIntent("What IM options are listed for agitation?").hasDosingSignals).toBe(true);
    expect(classifyQueryIntent("clozapine 100mg starting schedule").hasDosingSignals).toBe(true);
    expect(classifyQueryIntent("Show the monitoring table for lithium").imageEvidenceFocus).toBe(true);

    expect(classifyRagQuery("What forms are required for a patient safety plan?").queryClass).toBe("document_lookup");
    expect(classifyRagQuery("What are NOCC requirements?").queryClass).toBe("document_lookup");
    expect(classifyRagQuery("What assessment documentation is required?").queryClass).toBe("document_lookup");
    expect(classifyRagQuery("What ANC threshold should stop clozapine?").queryClass).toBe("table_threshold");
    expect(classifyRagQuery("What is the target concentration for lithium?").queryClass).toBe("table_threshold");
    expect(classifyRagQuery("What is the therapeutic concentration for lithium?").queryClass).toBe("table_threshold");
    expect(classifyRagQuery("What is the trough concentration for lithium?").queryClass).toBe("table_threshold");
    expect(classifyRagQuery("How are long acting injectable medications managed?").queryClass).toBe(
      "medication_dose_risk",
    );
    expect(classifyRagQuery("How are long acting injectables managed?").queryClass).toBe("medication_dose_risk");
    expect(classifyRagQuery("agitation and arousal dosing in psychiatric patients").queryClass).toBe(
      "medication_dose_risk",
    );
    expect(classifyRagQuery("How are active community patients in ED managed?").queryClass).toBe("document_lookup");
    expect(classifyRagQuery("In the clinical flowchart, what is the next step after red-zone risk?").queryClass).toBe(
      "document_lookup",
    );
    expect(classifyRagQuery("What dose and route are shown in the agitation medication chart?").queryClass).toBe(
      "medication_dose_risk",
    );
    expect(classifyRagQuery("Compare admission and discharge requirements").queryClass).toBe("comparison");
    expect(
      classifyRagQuery("Combine community admission steps with discharge documentation requirements.").queryClass,
    ).toBe("comparison");
    expect(classifyRagQuery("Summarize the discharge guidance").queryClass).toBe("broad_summary");
    expect(classifyRagQuery("management of bulimia nervosa").queryClass).toBe("broad_summary");
    expect(classifyRagQuery("What is the diabetic ketoacidosis insulin protocol?").queryClass).toBe(
      "unsupported_or_general",
    );
    expect(classifyRagQuery("What antibiotic dose is recommended for community-acquired pneumonia?").queryClass).toBe(
      "unsupported_or_general",
    );
    expect(classifyRagQuery("Find the 2027 revised clozapine airport travel policy.").queryClass).toBe(
      "document_lookup",
    );
    expect(classifyRagQuery("What does the clozapine gardening equipment checklist require?").queryClass).toBe(
      "document_lookup",
    );
  });

  it("does not classify generic risk/urgent/escalation queries as medication_dose_risk (8a)", () => {
    // Bare "risk"/"urgent"/"escalation" with no medication/dose signal must not route to the
    // medication-dosing plan, which previously buried topical guidelines (e.g. suicide risk).
    expect(classifyRagQuery("What does the guideline say about suicide risk mitigation?").queryClass).not.toBe(
      "medication_dose_risk",
    );
    expect(classifyRagQuery("urgent clinical escalation pathway").queryClass).not.toBe("medication_dose_risk");
    // A genuine medication + risk query still routes correctly via the drug/dose signal.
    expect(classifyRagQuery("What are the risks of high-dose clozapine?").queryClass).toBe("medication_dose_risk");
  });

  it("requires medication context before monitoring becomes drug-dosing intent", () => {
    for (const query of ["ECT monitoring requirements", "suicide-risk observation monitoring"]) {
      expect(classifyRagQuery(query).queryClass).not.toBe("medication_dose_risk");
      expect(classifyQueryIntent(query).intent).not.toBe("drug_dosing");
    }
    for (const query of ["lithium monitoring", "maximum lithium dose"]) {
      expect(classifyRagQuery(query).queryClass).toBe("medication_dose_risk");
      expect(classifyQueryIntent(query).intent).toBe("drug_dosing");
    }
    expect(["medication_dose_risk", "table_threshold"]).toContain(
      classifyRagQuery("clozapine monitoring table").queryClass,
    );
    expect(classifyQueryIntent("clozapine monitoring table").intent).toBe("drug_dosing");
    expect(classifyRagQuery("lithium monitoring protocol").queryClass).toBe("medication_dose_risk");
    expect(classifyQueryIntent("lithium monitoring protocol").intent).toBe("drug_dosing");
  });

  it("keeps high-yield clinical terms and removes question filler", () => {
    expect(normalizedClinicalSearchTokens("What safety monitoring is required for clozapine?")).toEqual([
      "safety",
      "monitoring",
      "clozapine",
    ]);
  });

  it("expands local clinical vocabulary aliases for search", () => {
    const expanded = expandClinicalQuery("LAI depot ANC clozapin monitring");

    expect(expanded.toLowerCase()).toContain("long acting injectable");
    expect(expanded.toLowerCase()).toContain("absolute neutrophil count");
    expect(expanded.toLowerCase()).toContain("clozapine");
    expect(expanded.toLowerCase()).toContain("monitoring");
  });

  it("uses AND-style websearch text to avoid broad unsupported OR matches", () => {
    expect(buildClinicalTextSearchQuery("What antibiotic dose is recommended for community-acquired pneumonia?")).toBe(
      "antibiotic dose recommended community acquired pneumonia",
    );
    expect(buildClinicalTextSearchQuery("Please can you find agitation and arousal dosing for me?")).toBe(
      "agitation arousal dose",
    );
  });

  it("normalizes common typos, abbreviations, and local clinical aliases", () => {
    const analysis = analyzeClinicalQuery("clozapin agitaton arousl FBC ANC in ED");

    expect(analysis.typoCorrections).toEqual([
      { from: "clozapin", to: "clozapine" },
      { from: "agitaton", to: "agitation" },
      { from: "arousl", to: "arousal" },
    ]);
    expect(analysis.medications).toContain("clozapine");
    expect(analysis.acronyms).toEqual(expect.arrayContaining(["fbc", "anc", "ed"]));
    expect(buildClinicalTextSearchQuery("clozapin agitaton arousl")).toBe("clozapine agitation arousal");
  });

  it("does not retain mutable query analysis across calls", () => {
    const first = analyzeClinicalQuery("What ANC threshold should stop clozapine?");
    first.queryClass = "comparison";

    const second = analyzeClinicalQuery("What ANC threshold should stop clozapine?");

    expect(second.queryClass).toBe("table_threshold");
  });

  it("falls back to the original query when only one useful token remains", () => {
    expect(buildClinicalTextSearchQuery("What are NOCC requirements?")).toBe("nocc");
  });

  it("expands community patients to the local Pts abbreviation for title matching", () => {
    expect(buildClinicalTextSearchQuery("What is the process for admission of community patients?")).toBe(
      "admission community patients pts",
    );
  });

  it("expands admission and discharge comparisons toward local community patient titles", () => {
    expect(buildClinicalTextSearchQuery("Compare admission and discharge requirements")).toBe(
      "admission discharge community patients pts",
    );
  });

  it("expands risk matrix red-zone wording toward local visual-alert terms", () => {
    expect(buildClinicalTextSearchQuery("What action is shown for the risk matrix red zone?")).toBe(
      "action shown risk matrix red zone high visual alert",
    );
  });

  it("expands active community patients in ED to the local Pt ED title terms", () => {
    expect(buildClinicalTextSearchQuery("How are active community patients in ED managed?")).toBe(
      "active community pt ed",
    );
  });

  it("keeps clozapine blood-action thresholds precise without changing routine monitoring queries", () => {
    expect(buildClinicalTextSearchQuery("What FBC threshold should withhold clozapine?")).toBe(
      "clozapine wbc neutrophils red range stop",
    );
    expect(buildClinicalTextSearchQuery("When should clozapine blood monitoring occur?")).toBe("clozapine monitoring");
  });

  it("keeps patient property as a document title phrase", () => {
    expect(buildClinicalTextSearchQuery("What items are shown in the patient property restricted-items table?")).toBe(
      "patient property item shown restricted table",
    );
  });

  it("removes low-value identification filler from exact topic lookups", () => {
    expect(buildClinicalTextSearchQuery("What is required when illegal substances are identified?")).toBe(
      "illegal substance",
    );
  });

  it("removes table-coverage filler while keeping the clinical topic", () => {
    expect(buildClinicalTextSearchQuery("Which table covers agitation and arousal pharmacological management?")).toBe(
      "agitation arousal pharmacological management",
    );
  });

  it("does not over-expand broad agitation management queries into medication-chart terms", () => {
    expect(
      buildClinicalTextSearchQuery("What should be considered for agitation and arousal pharmacological management?"),
    ).toBe("agitation arousal pharmacological management");
  });

  it("keeps typo-heavy agitation dosing queries anchored to the local pharmacological chart", () => {
    expect(
      buildClinicalTextSearchQuery("What agitaton and arousl dosing guidance applies to psychiatric inpatients?"),
    ).toBe("agitation arousal dose");
  });

  it("preserves supported agitation amount, route, and frequency signals without broad expansion", () => {
    expect(buildClinicalTextSearchQuery("What 5 mg option is listed for agitation?")).toBe(
      "agitation arousal dose 5 mg",
    );
    expect(buildClinicalTextSearchQuery("Which subcutaneous dose is listed for agitation?")).toBe(
      "agitation arousal dose sc",
    );
    expect(buildClinicalTextSearchQuery("Which sublingual PRN option is listed for agitation?")).toBe(
      "agitation arousal sl prn",
    );
    expect(buildClinicalTextSearchQuery("What dosing frequency is listed for agitation?")).toBe(
      "agitation arousal dose frequency",
    );
  });

  it("anchors clozapine blood-monitoring paraphrases to clozapine FBC evidence", () => {
    expect(
      buildClinicalTextSearchQuery(
        "Which observations and blood monitoring are needed while a patient is taking clozapine?",
      ),
    ).toBe("clozapine monitoring");
  });

  it("anchors generic discharge summaries to mental health discharge sources", () => {
    expect(buildClinicalTextSearchQuery("Summarize the discharge guidance")).toBe("mental health discharge");
  });

  it("boosts exact treatment team process title matches above broader treatment-process hits", () => {
    const ranked = rankClinicalResults("What is the mental health treatment team process?", [
      result({
        id: "assessment-treatment",
        title: "MHSP.MHATT.AssessmentTreatmentProcess",
        file_name: "MHSP.MHATT.AssessmentTreatmentProcess.pdf",
        hybrid_score: 0.65,
      }),
      result({
        id: "treatment-team",
        title: "MHSP.MHAT.MHCT.TreatmentTeamProcess",
        file_name: "MHSP.MHAT.MHCT.TreatmentTeamProcess.pdf",
        hybrid_score: 0.61,
      }),
    ]);

    expect(ranked[0].id).toBe("treatment-team");
  });

  it("keeps lookup scoring path stable when section and content have clinical tokens", () => {
    const searchQuery = "document lookup section page 3 treatment team review";
    const ranked = rankClinicalResults(searchQuery, [
      result({
        id: "lookup-match",
        title: "Clozapine Prescribing and Monitoring",
        file_name: "clozapine-prescribing.pdf",
        section_heading: "Section 3: Safety Monitoring",
        content: "Monitoring requirements and safety thresholds are listed by section and page.",
        hybrid_score: 0.61,
      }),
      result({
        id: "unrelated",
        title: "Generic Mental Health Notes",
        file_name: "notes.docx",
        section_heading: "Overview",
        content: "General team process and broad guidance references.",
        hybrid_score: 0.75,
      }),
    ]);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((item) => item.id).sort()).toEqual(["lookup-match", "unrelated"]);
  });

  it("uses generated labels and summaries as deterministic ranking signals", () => {
    const ranked = rankClinicalResults("Find the metabolic monitoring document", [
      result({
        id: "metadata-match",
        title: "General Monitoring",
        file_name: "general-monitoring.pdf",
        content: "General review text.",
        hybrid_score: 0.6,
        document_labels: [
          {
            id: "label-1",
            document_id: "doc-1",
            label: "metabolic monitoring",
            label_type: "topic",
            source: "generated",
            confidence: 0.91,
          },
        ],
        document_summary: "Metabolic monitoring requirements and review timing.",
      }),
      result({
        id: "higher-base",
        title: "Generic Monitoring",
        file_name: "generic-monitoring.pdf",
        content: "General monitoring review without specialty specifics.",
        hybrid_score: 0.66,
      }),
    ]);

    expect(ranked[0].id).toBe("metadata-match");
  });

  it("ranks arbitrary newly uploaded documents from generic labels and summaries", () => {
    const ranked = rankClinicalResults("future protocol escalation pathway", [
      result({
        id: "new-upload",
        title: "Ward Reference Pack",
        file_name: "new-upload.pdf",
        content: "General ward reference notes.",
        hybrid_score: 0.55,
        document_labels: [
          {
            id: "label-future",
            document_id: "doc-future",
            label: "escalation pathway",
            label_type: "workflow",
            source: "generated",
            confidence: 0.93,
          },
        ],
        document_summary: "Future protocol escalation pathway for clinical workflow decisions.",
      }),
      result({
        id: "generic",
        title: "Administrative Pack",
        file_name: "generic.pdf",
        content: "General administrative checklist.",
        hybrid_score: 0.66,
      }),
    ]);

    expect(ranked[0].id).toBe("new-upload");
  });

  it("still ranks source chunks when enrichment labels and summaries are absent", () => {
    const ranked = rankClinicalResults("observation interval after medication change", [
      result({
        id: "chunk-match",
        title: "Recently Uploaded Guideline",
        file_name: "recent-upload.pdf",
        content: "After a medication change, the observation interval must be reviewed and documented.",
        hybrid_score: 0.58,
      }),
      result({
        id: "metadata-absent-unrelated",
        title: "Unrelated Uploaded Guideline",
        file_name: "unrelated-upload.pdf",
        content: "Discharge appointment administration and filing process.",
        hybrid_score: 0.62,
      }),
    ]);

    expect(ranked[0].id).toBe("chunk-match");
  });

  it("keeps weighted hybrid as the served ranking for routine lexical matches", () => {
    const ranked = rankClinicalResults("monitoring requirements", [
      result({
        id: "weighted-winner",
        title: "Monitoring Requirements",
        file_name: "monitoring.pdf",
        content: "Monitoring requirements are documented here.",
        hybrid_score: 0.72,
        similarity: 0.7,
        text_rank: 0.4,
        rrf_score: 0.01,
      }),
      result({
        id: "rrf-only-contender",
        title: "Monitoring Requirements",
        file_name: "monitoring-alt.pdf",
        content: "Monitoring requirements are documented here.",
        hybrid_score: 0.64,
        similarity: 0.62,
        text_rank: 0.4,
        rrf_score: 0.5,
      }),
    ]);

    expect(ranked[0].id).toBe("weighted-winner");
    expect(ranked[0].score_explanation).toMatchObject({
      rrfScore: 0.01,
      rrfBoost: 0,
      strategy: "weighted_hybrid",
      finalRank: 1,
    });
  });

  it("blends RRF into served ranking for comparison queries", () => {
    const ranked = rankClinicalResults("Compare monitoring requirements across documents", [
      result({
        id: "weighted-contender",
        title: "Monitoring Requirements",
        file_name: "monitoring.pdf",
        content: "Monitoring requirements are documented here.",
        hybrid_score: 0.72,
        similarity: 0.7,
        text_rank: 0.4,
        rrf_score: 0.01,
      }),
      result({
        id: "rrf-contender",
        title: "Monitoring Requirements",
        file_name: "monitoring-alt.pdf",
        content: "Monitoring requirements are documented here.",
        hybrid_score: 0.64,
        similarity: 0.62,
        text_rank: 0.4,
        rrf_score: 0.5,
      }),
    ]);

    expect(ranked[0].id).toBe("rrf-contender");
    expect(ranked[0].score_explanation).toMatchObject({
      strategy: "weighted_hybrid_rrf_blend",
      rrfBoost: expect.any(Number),
      finalRank: 1,
    });
  });

  it("produces stable score-explanation components", () => {
    const explanation = clinicalRankExplanation(
      "ANC threshold stop clozapine",
      result({
        title: "Clozapine Prescribing and Monitoring",
        file_name: "clozapine.pdf",
        content: "If ANC is below threshold, stop clozapine and urgently review monitoring.",
        similarity: 0.71,
        hybrid_score: 0.74,
        text_rank: 0.6,
        rrf_score: 0.2,
        memory_score: 0.8,
      }),
    );

    expect(explanation.vectorScore).toBe(0.71);
    expect(explanation.weightedHybridScore).toBe(0.74);
    expect(explanation.rrfScore).toBe(0.2);
    expect(explanation.memoryBoost).toBeGreaterThan(0);
    expect(explanation.finalScore).toBeGreaterThan(0.74);
  });

  it("uses index quality as a ranking signal when lexical evidence is otherwise similar", () => {
    const ranked = rankClinicalResults("discharge guidance requirements", [
      result({
        id: "low-quality",
        title: "Discharge Guidance",
        content: "Discharge guidance requirements are listed here.",
        hybrid_score: 0.63,
        indexing_quality: {
          document_id: "doc-1",
          quality_score: 0.42,
          extraction_quality: "poor",
          metrics: {},
          issues: ["low extracted text volume", "low heading density"],
        },
      }),
      result({
        id: "high-quality",
        document_id: "doc-2",
        title: "Discharge Guidance",
        content: "Discharge guidance requirements are listed here.",
        hybrid_score: 0.61,
        indexing_quality: {
          document_id: "doc-2",
          quality_score: 0.95,
          extraction_quality: "good",
          metrics: {},
          issues: [],
        },
      }),
    ]);

    expect(ranked[0].id).toBe("high-quality");
    expect(ranked[0].score_explanation?.metadataBoost).toBeGreaterThan(ranked[1].score_explanation?.metadataBoost ?? 0);
  });

  it("prefers mental health discharge guidance over generic discharge policies", () => {
    const ranked = rankClinicalResults("Summarize the discharge guidance", [
      result({
        id: "generic-discharge",
        title: "Criteria-Led Discharge",
        file_name: "Criteria-Led Discharge (NMHS).pdf",
        content: "Generic discharge process and criteria-led discharge notes.",
        hybrid_score: 0.7,
      }),
      result({
        id: "mental-health-discharge",
        title: "Admission to Discharge for Mental Health Inpatients",
        file_name: "Admission to Discharge for Mental Health Inpatients (NMHS).pdf",
        content: "Mental health inpatient admission to discharge guidance and requirements.",
        hybrid_score: 0.62,
      }),
    ]);

    expect(ranked[0].id).toBe("mental-health-discharge");
  });

  it("boosts direct current validated table evidence above stale nearby evidence", () => {
    const ranked = rankClinicalResults("ANC threshold stop clozapine", [
      result({
        id: "stale-nearby",
        title: "Clozapine Monitoring",
        content: "Clozapine monitoring is discussed in nearby administrative notes.",
        hybrid_score: 0.66,
        source_strength: "limited",
        relevance: {
          verdict: "nearby",
          label: "Nearby only",
          matchedTerms: ["clozapine"],
          missingTerms: ["anc", "threshold"],
          directSourceCount: 0,
          weakSourceCount: 1,
          score: 0.25,
          supportReason: "Only adjacent concepts matched.",
          isSourceBacked: false,
          coverageScore: 0.25,
          rankScore: 0.25,
          titleMatchedTerms: ["clozapine"],
          contentMatchedTerms: [],
          metadataMatchedTerms: [],
          chips: ["nearby only"],
        },
        source_metadata: {
          source_title: "Older clozapine appendix",
          publisher: "External",
          jurisdiction: "Unknown",
          version: null,
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "outdated",
          clinical_validation_status: "unverified",
          extraction_quality: "poor",
        },
      }),
      result({
        id: "current-direct-table",
        document_id: "doc-2",
        title: "Clozapine Prescribing and Monitoring",
        content: "If ANC is below threshold, stop clozapine and urgently review monitoring.",
        hybrid_score: 0.58,
        source_strength: "strong",
        relevance: {
          verdict: "direct",
          label: "Direct support",
          matchedTerms: ["anc", "threshold", "clozapine"],
          missingTerms: [],
          directSourceCount: 1,
          weakSourceCount: 0,
          score: 0.88,
          supportReason: "The source directly answers the query.",
          isSourceBacked: true,
          coverageScore: 0.88,
          rankScore: 0.88,
          titleMatchedTerms: ["clozapine"],
          contentMatchedTerms: ["anc", "threshold"],
          metadataMatchedTerms: [],
          chips: ["direct"],
        },
        source_metadata: {
          source_title: "Clozapine Prescribing and Monitoring",
          publisher: "WA Health",
          jurisdiction: "Western Australia",
          version: null,
          publication_date: null,
          review_date: null,
          uploaded_at: null,
          indexed_at: null,
          uploaded_by: null,
          document_status: "current",
          clinical_validation_status: "approved",
          extraction_quality: "good",
        },
        table_facts: [
          {
            id: "fact-anc",
            document_id: "doc-2",
            source_chunk_id: "current-direct-table",
            source_image_id: null,
            page_number: 2,
            table_title: "FBC/ANC thresholds",
            row_label: "ANC",
            clinical_parameter: "ANC",
            threshold_value: "Below threshold",
            action: "Stop clozapine and review.",
            match_reason: "table_threshold",
          },
        ],
      }),
    ]);

    expect(ranked[0].id).toBe("current-direct-table");
    expect(ranked[0].score_explanation?.metadataBoost).toBeGreaterThan(ranked[1].score_explanation?.metadataBoost ?? 0);
  });

  it("penalizes non-clozapine blood/table hits for clozapine-specific monitoring queries", () => {
    const ranked = rankClinicalResults(
      "Which observations and blood monitoring are needed while a patient is taking clozapine?",
      [
        result({
          id: "generic-blood-monitoring",
          title: "Blood Glucose Level",
          file_name: "Blood Glucose Level (BGL) (AKG).pdf",
          content: "Patient status and frequency of BGL monitoring observations.",
          hybrid_score: 0.74,
        }),
        result({
          id: "clozapine-monitoring",
          title: "Clozapine Prescribing, Administration and Monitoring",
          file_name: "Clozapine Prescribing, Administration and Monitoring (AKG).pdf",
          content: "Clozapine requires observations and FBC blood monitoring according to the monitoring schedule.",
          hybrid_score: 0.6,
        }),
      ],
    );

    expect(ranked[0].id).toBe("clozapine-monitoring");
    expect(ranked[1].score_explanation?.penalty).toBeLessThan(0);
  });

  it("treats structured table facts as dose and threshold evidence", () => {
    const tableResult = result({
      content: "Administrative table text.",
      table_facts: [
        {
          id: "fact-1",
          document_id: "doc-1",
          source_chunk_id: "chunk-1",
          source_image_id: "image-1",
          page_number: 2,
          table_title: "Medication dose table",
          row_label: "Lorazepam",
          clinical_parameter: "Route",
          threshold_value: "1 mg IM",
          action: "Review before repeat PRN dose.",
          match_reason: "table_threshold",
        },
      ],
    });

    expect(hasDoseEvidenceSupport(tableResult)).toBe(true);
    expect(hasStructuredThresholdEvidence(tableResult)).toBe(true);
  });

  it("treats retrieval synopsis text as dose evidence support", () => {
    const synopsisResult = result({
      title: "Medication chart",
      content: "Administrative note only.",
      retrieval_synopsis: "Lorazepam 1 mg IM route with repeat dose review guidance.",
    });

    expect(hasDoseEvidenceSupport(synopsisResult)).toBe(true);
    expect(hasNumericOrTableEvidence(synopsisResult)).toBe(true);
    expect(
      rankClinicalResults("What dose and route are shown for lorazepam?", [
        result({
          id: "generic-higher-score",
          title: "Medication overview",
          content: "Administrative review note only.",
          hybrid_score: 0.72,
        }),
        { ...synopsisResult, id: "synopsis-dose", hybrid_score: 0.58 },
      ])[0].id,
    ).toBe("synopsis-dose");
  });

  it("detects structured threshold support from index units and table images", () => {
    expect(
      hasStructuredThresholdEvidence(
        result({
          content: "General clinical note.",
          match_explanation: { fieldType: "threshold_fact", reasons: ["threshold_fact"] },
        }),
      ),
    ).toBe(true);

    expect(
      hasStructuredThresholdEvidence(
        result({
          content: "General clinical note.",
          index_unit: {
            id: "unit-1",
            unit_type: "table_fact",
            title: "Threshold table",
            content: "ANC threshold and action",
            source_chunk_id: "chunk-1",
            source_image_id: null,
            page_start: 2,
            page_end: 2,
            heading_path: ["Monitoring"],
            normalized_terms: ["anc", "threshold"],
            quality_score: 0.9,
            extraction_mode: "hybrid",
          },
        }),
      ),
    ).toBe(true);

    const visualUnitResult = result({
      content: "General clinical note.",
      index_unit: {
        id: "unit-visual",
        unit_type: "table_threshold",
        title: "Visual ANC threshold",
        content: "ANC < 1.0 | Stop clozapine",
        source_chunk_id: "chunk-1",
        source_image_id: "image-1",
        page_start: 2,
        page_end: 2,
        heading_path: ["Monitoring"],
        normalized_terms: ["anc", "threshold", "clozapine"],
        quality_score: 0.9,
        extraction_mode: "hybrid",
        metadata: { source: "visual_intelligence" },
      },
    });

    expect(hasStructuredThresholdEvidence(visualUnitResult)).toBe(true);
    expect(hasNumericOrTableEvidence(visualUnitResult)).toBe(true);
  });

  it("boosts query-class matching embedding fields for threshold evidence", () => {
    const ranked = rankClinicalResults("What ANC threshold should withhold clozapine?", [
      result({
        id: "generic-clozapine",
        title: "Clozapine Monitoring",
        content: "Clozapine monitoring is discussed in this document.",
        hybrid_score: 0.68,
      }),
      result({
        id: "threshold-field",
        title: "Clozapine Monitoring",
        content: "ANC thresholds are listed with actions for withholding clozapine.",
        hybrid_score: 0.62,
        match_explanation: {
          fieldType: "threshold_fact",
          tableHit: true,
          reasons: ["threshold_fact"],
        },
        table_facts: [
          {
            id: "fact-threshold",
            document_id: "doc-1",
            source_chunk_id: "threshold-field",
            source_image_id: null,
            page_number: 4,
            table_title: "ANC thresholds",
            row_label: "ANC",
            clinical_parameter: "ANC",
            threshold_value: "Below threshold",
            action: "Withhold clozapine.",
          },
        ],
      }),
    ]);

    expect(ranked[0].id).toBe("threshold-field");
    expect(ranked[0].score_explanation?.clinicalSignalBoost).toBeGreaterThan(
      ranked[1].score_explanation?.clinicalSignalBoost ?? 0,
    );
  });
});

describe("clinical query mode ranking", () => {
  it("uses explicit modes to return different clinical source priorities for the same query", () => {
    const baseQuery = "clozapine guidance";
    const sources = [
      result({
        id: "dose-threshold-source",
        title: "Clozapine dose threshold table",
        file_name: "clozapine-dose-threshold.pdf",
        content:
          "Clozapine dose restart threshold table: 12.5 mg oral restart, maximum dose checks, route, blood test monitoring, and action points.",
        hybrid_score: 0.6,
      }),
      result({
        id: "escalation-source",
        title: "Clozapine escalation criteria",
        file_name: "clozapine-escalation.pdf",
        content:
          "Escalation criteria include urgent review triggers, red flags, senior specialist review, toxicity risk, and crisis action points.",
        hybrid_score: 0.6,
      }),
      result({
        id: "comparison-source",
        title: "Clozapine guidance document comparison",
        file_name: "clozapine-comparison.pdf",
        content:
          "Compare guidance across documents by requirement, process, criteria, included actions, conflicts, overlap, and source gaps.",
        hybrid_score: 0.56,
        rrf_score: 0.5,
      }),
    ];

    const doseTop = rankClinicalResults(queryForClinicalMode(baseQuery, "dose_threshold_lookup"), sources)[0].id;
    const escalationTop = rankClinicalResults(queryForClinicalMode(baseQuery, "escalation_criteria"), sources)[0].id;
    const comparisonTop = rankClinicalResults(queryForClinicalMode(baseQuery, "compare_guidance"), sources)[0].id;

    expect(doseTop).toBe("dose-threshold-source");
    expect(escalationTop).toBe("escalation-source");
    expect(comparisonTop).toBe("comparison-source");
  });
});

describe("clinical rank score bounding and penalty caps (RET-H1, RET-H2)", () => {
  // RET-H1
  it("clamps the final composite score to [0,1]", () => {
    const boosted = clinicalRankExplanation(
      "treatment team process",
      result({
        id: "boosted",
        title: "Treatment team process guideline",
        file_name: "treatment-team-process.pdf",
        section_heading: "Treatment team process",
        content:
          "Treatment team process: urgent escalation, red flag review, monitoring, and definition of the process workflow pathway.",
        hybrid_score: 0.96,
        similarity: 0.96,
        rrf_score: 0.9,
      }),
    );
    expect(boosted.finalScore).toBeLessThanOrEqual(1);
    expect(boosted.finalScore).toBeGreaterThanOrEqual(0);
  });

  // RET-H2
  it("caps total penalty so a heavily penalized result cannot fall far below zero", () => {
    const explanation = clinicalRankExplanation(
      "clozapine maximum dose",
      result({
        id: "boilerplate",
        title: "Clozapine prescribing procedure",
        file_name: "clozapine-procedure.pdf",
        // administrative boilerplate, no numeric evidence, drug only in title -> stacks penalties
        content:
          "Supporting information, relevant standards, references, document owner, authorisation, authorised by, published date, effective from, amendment.",
        hybrid_score: 0.4,
        similarity: 0.4,
      }),
    );
    expect(explanation.penalty).toBeGreaterThanOrEqual(-0.35);
    // raw (uncapped) penalty should be more negative than the capped value
    expect(explanation.rawPenalty ?? 0).toBeLessThanOrEqual(explanation.penalty);
  });

  // RET-H2 golden case: dose lives in a table row, drug only in the heading.
  it("does not demote a numeric/table dose row below drug-name boilerplate", () => {
    const query = "olanzapine maximum dose";
    const tableRow = result({
      id: "dose-table-row",
      title: "Acute behavioural disturbance guideline",
      file_name: "abd-guideline.pdf",
      section_heading: "Olanzapine",
      // numeric dose evidence, but the row text itself does not repeat "olanzapine"
      content: "Maximum 20 mg in 24 hours. Repeat doses 5 mg IM PO. Monitoring: observe sedation.",
      hybrid_score: 0.45,
      similarity: 0.45,
      table_facts: [
        {
          id: "tf-1",
          document_id: "doc-1",
          source_chunk_id: "dose-table-row",
          source_image_id: null,
          page_number: 1,
          table_title: "Dosing",
          row_label: "Maximum",
          clinical_parameter: "dose",
          threshold_value: "20 mg/24h",
          action: "do not exceed",
        },
      ],
    });
    const boilerplate = result({
      id: "drug-name-boilerplate",
      title: "Olanzapine prescribing procedure",
      file_name: "olanzapine-procedure.pdf",
      section_heading: "Olanzapine",
      content:
        "Olanzapine supporting information, relevant standards, references, document owner, authorisation, published date.",
      hybrid_score: 0.5,
      similarity: 0.5,
    });

    const ranked = rankClinicalResults(query, [boilerplate, tableRow]);
    expect(ranked[0].id).toBe("dose-table-row");
  });
});

describe("rank score and confidence emission", () => {
  it("emits an unbounded rankScore with preClampFinalScore as its compatibility alias", () => {
    const ranked = rankClinicalResults("clozapine monitoring requirements", [
      result({ id: "a", title: "Clozapine Prescribing and Monitoring", hybrid_score: 0.9 }),
      result({ id: "b", title: "General Notes", hybrid_score: 0.4 }),
    ]);

    for (const item of ranked) {
      expect(typeof item.score_explanation?.rankScore).toBe("number");
      expect(item.score_explanation?.preClampFinalScore).toBe(item.score_explanation?.rankScore);
      expect(typeof item.score_explanation?.preClampFinalScore).toBe("number");
      expect(Number.isFinite(item.score_explanation?.preClampFinalScore)).toBe(true);
      expect(item.score_explanation?.finalScore).toBeGreaterThanOrEqual(0);
      expect(item.score_explanation?.finalScore).toBeLessThanOrEqual(1);
    }
  });

  it("orders saturated candidates by rankScore while keeping confidence clamped", () => {
    const ranked = rankClinicalResults("clozapine monitoring requirements", [
      result({ id: "lower-rank", title: "Clozapine Notes", hybrid_score: 0.91 }),
      result({
        id: "higher-rank",
        title: "Clozapine Prescribing and Monitoring",
        content: "Clozapine monitoring safety protocol and blood monitoring requirements.",
        hybrid_score: 0.9,
      }),
    ]);

    expect(ranked[0].id).toBe("higher-rank");
    expect(ranked[0].score_explanation?.rankScore).toBeGreaterThan(1);
    expect(ranked[0].score_explanation?.finalScore).toBe(1);
  });
});
