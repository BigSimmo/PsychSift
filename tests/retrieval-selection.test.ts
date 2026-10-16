import { describe, expect, it } from "vitest";
import {
  buildRetrievalIntent,
  selectRetrievalEvidence,
  selectAnswerRouteEvidence,
  summarizeRetrievalSelection,
} from "../src/lib/retrieval-selection";
import type { SearchResult } from "../src/lib/types";

function source(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: overrides.id ?? "chunk-1",
    document_id: overrides.document_id ?? "doc-1",
    title: overrides.title ?? "Clinical Guideline",
    file_name: overrides.file_name ?? "guideline.pdf",
    page_number: overrides.page_number ?? 1,
    chunk_index: overrides.chunk_index ?? 0,
    section_heading: overrides.section_heading ?? null,
    content: overrides.content ?? "Clinical guidance text.",
    image_ids: [],
    similarity: overrides.similarity ?? 0.55,
    hybrid_score: overrides.hybrid_score ?? 0.55,
    images: [],
    ...overrides,
  };
}

describe("monitoring intent selection", () => {
  it("does not require dose amounts or boost medication charts for a monitoring schedule", () => {
    const intent = buildRetrievalIntent(
      "Give a detailed lithium monitoring schedule, including baseline tests and levels after dose changes.",
      "medication_dose_risk",
    );
    expect(intent.needsMedicationChart).toBe(false);
    expect(intent.needsDoseRouteFrequency).toBe(false);
    expect(intent.requiredTermSignals).toEqual(["clinical_subject"]);
  });

  it("retains chart preference when monitoring accompanies an explicit prescribed dose request", () => {
    const intent = buildRetrievalIntent(
      "What lithium dose should be prescribed and what monitoring is needed after dose changes?",
      "medication_dose_risk",
    );
    expect(intent.needsMedicationChart).toBe(true);
    expect(intent.requiredTermSignals).toContain("dose_amount");
  });
});

function sourceMetadata(
  overrides: Partial<NonNullable<SearchResult["source_metadata"]>> = {},
): NonNullable<SearchResult["source_metadata"]> {
  return {
    source_title: null,
    publisher: null,
    jurisdiction: null,
    version: null,
    publication_date: null,
    review_date: null,
    uploaded_at: null,
    indexed_at: null,
    uploaded_by: null,
    document_status: "current",
    clinical_validation_status: "locally_reviewed",
    extraction_quality: "good",
    ...overrides,
  };
}

describe("retrieval source selection", () => {
  it("FR2 retains the empty governed selection and its source-role reason", () => {
    const query = "How should acute psychosis be treated?";
    const selected = selectAnswerRouteEvidence({
      query,
      queryClass: "broad_summary",
      queryPlan: {
        version: "rag-query-plan-v1",
        kind: "single",
        originalQuery: query,
        interpretation: query,
        subquestions: [{ id: "sq-1", question: query, purpose: "primary", required: true }],
        targetSiteDomains: [],
        siteDomainDecision: "none",
        reasonCodes: [],
      },
      results: [
        source({
          id: "excluded-service-id",
          document_id: "excluded-service-doc",
          corpus_scope: "clinical_kb_site",
          site_content_domain: "services",
          content: "Acute psychosis treatment requires urgent specialist assessment.",
          source_metadata: sourceMetadata({
            source_kind: "registry_record",
            corpus_scope: "clinical_kb_site",
            source_role: "service_directory",
            content_mode: "link_only",
          }),
        }),
      ],
    });
    expect(selected.rawResults).toEqual([]);
    expect(selected.routeSelection.results).toEqual([]);
    expect(selected.routeSelection.coverage?.insufficiencyReason).toBe("source_role_mismatch");
    expect(JSON.stringify(selected.routeSelection)).not.toMatch(/excluded-service-id|excluded-service-doc/);
  });

  // Audit H3 disposition (2026-07-02): SUPERSEDED by PR #118, which removed
  // source-governance metadata weighting from retrieval selection entirely —
  // measured on the golden retrieval eval (doc-recall@5 1.0 -> 0.76 with
  // weighting). There are no freshness/validation penalties in selection to
  // propagate; governance is enforced by ranking penalties and the
  // answer/source-governance layer. See the amended governance contract test
  // below ("keeps relevance ordering ...").

  // L4: stacked boosts must never push the annotated score above 1.0.
  it("clamps the annotated hybrid_score to at most 1.0 (L4)", () => {
    const selection = selectRetrievalEvidence({
      query: "What IM or PO options are listed for agitation?",
      queryClass: "medication_dose_risk",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "high-base",
          title: "Agitation Medication Chart",
          content: "IM and PO options for agitation: olanzapine 5-10 mg PO, droperidol 5 mg IM.",
          hybrid_score: 0.98,
          source_metadata: sourceMetadata(),
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title"] },
        }),
      ],
    });

    const annotated = selection.results.find((result) => result.id === "high-base");
    expect(annotated).toBeDefined();
    expect(annotated!.hybrid_score).toBeLessThanOrEqual(1);
  });

  it("rescues active-community ED document evidence above generic community hits", () => {
    const selection = selectRetrievalEvidence({
      query: "How are active community patients in ED managed?",
      queryClass: "document_lookup",
      topK: 3,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "generic-community",
          document_id: "generic-doc",
          title: "Community Process Overview",
          file_name: "community-process.pdf",
          content: "Community mental health process overview.",
          hybrid_score: 0.76,
        }),
        source({
          id: "active-community-ed",
          document_id: "active-community-doc",
          title: "MHSP Active Community Pt ED",
          file_name: "MHSP.ActiveCommunityPtED.pdf",
          content:
            "Active community patients in the Emergency Department require liaison with the community team and ED handover.",
          hybrid_score: 0.52,
          match_explanation: { titleHit: true, contentHit: true, reasons: ["title"] },
        }),
      ],
    });

    expect(selection.results[0].id).toBe("active-community-ed");
    expect(selection.intent.needsPatientEducation).toBe(true);
    expect(selection.summary.requiredSignalsSatisfied).toBe(true);
    expect(selection.summary.matchedSignals).toEqual(expect.arrayContaining(["active_community", "ed"]));
    expect(selection.summary.rescueApplied).toBe(true);
  });

  it("promotes medication-chart route evidence for agitation IM/PO options without requiring a numeric dose", () => {
    const intent = buildRetrievalIntent("What IM or PO options are listed for agitation?", "medication_dose_risk");
    const selection = selectRetrievalEvidence({
      query: "What IM or PO options are listed for agitation?",
      queryClass: "medication_dose_risk",
      topK: 3,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "agitation-overview",
          title: "Agitation Overview",
          content: "Agitation management includes de-escalation and observation.",
          hybrid_score: 0.72,
        }),
        source({
          id: "agitation-route-row",
          document_id: "agitation-doc",
          title: "Agitation and Arousal Pharmacological Management",
          file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
          section_heading: "Medication chart",
          content:
            "Medication chart options list oral medication when accepted and IM medication when oral is refused.",
          hybrid_score: 0.5,
          index_unit: {
            id: "unit-agitation-route",
            unit_type: "medication_chart_row",
            title: "Agitation medication route options",
            content: "Oral and IM medication options for agitation.",
            source_chunk_id: "agitation-route-row",
            source_image_id: null,
            page_start: 4,
            page_end: 4,
            heading_path: ["Medication chart"],
            normalized_terms: ["agitation", "oral", "im"],
            quality_score: 0.88,
            extraction_mode: "hybrid",
          },
        }),
      ],
    });

    expect(intent.requiredTermSignals).toEqual(expect.arrayContaining(["agitation", "route"]));
    expect(intent.requiredTermSignals).not.toContain("dose_amount");
    expect(selection.results[0].id).toBe("agitation-route-row");
    expect(selection.summary.requiredSignalsSatisfied).toBe(true);
    expect(selection.summary.topChunkTypes.medication_chart).toBeGreaterThan(0);
  });

  it("treats SC and SL administration rows as dose-route evidence", () => {
    const intent = buildRetrievalIntent("What SC or SL route options are listed?", "medication_dose_risk");
    const selected = summarizeRetrievalSelection({
      query: "What SC or SL route options are listed?",
      queryClass: "medication_dose_risk",
      results: [
        source({
          id: "sc-sl-route-row",
          title: "Medication Route Chart",
          content: "Subcutaneous medication may be used for one option; sublingual medication is listed for another.",
          hybrid_score: 0.66,
          index_unit: {
            id: "unit-sc-sl-route",
            unit_type: "medication_chart_row",
            title: "SC and SL route options",
            content: "SC route and SL route options.",
            source_chunk_id: "sc-sl-route-row",
            source_image_id: null,
            page_start: 2,
            page_end: 2,
            heading_path: ["Medication chart"],
            normalized_terms: ["sc", "subcutaneous", "sl", "sublingual"],
            quality_score: 0.9,
            extraction_mode: "hybrid",
          },
        }),
      ],
    });

    expect(intent.requiredTermSignals).toContain("route");
    expect(selected.summary.requiredSignalsSatisfied).toBe(true);
    expect(selected.summary.matchedSignals).toContain("route");
  });

  it("anchors medication-monitoring selection to the requested clinical subject", () => {
    const selection = selectRetrievalEvidence({
      query: "What monitoring is required for lithium therapy?",
      queryClass: "medication_dose_risk",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "generic-cardiac-monitoring",
          document_id: "cardiac-doc",
          title: "Cardiac Monitoring",
          content: "Admission monitoring requirements include continuous cardiac observations.",
          hybrid_score: 0.95,
        }),
        source({
          id: "lithium-monitoring",
          document_id: "lithium-doc",
          title: "Lithium Therapy",
          content: "Lithium monitoring requires serum levels and renal and thyroid function tests.",
          hybrid_score: 0.55,
        }),
      ],
    });

    expect(selection.intent.requiredTermSignals).toContain("clinical_subject");
    expect(selection.results[0].id).toBe("lithium-monitoring");
    expect(selection.results[1].match_explanation?.reasons).toContain("retrieval_required_signal:clinical_subject");
    expect(selection.results[1].match_explanation?.reasons).not.toContain("retrieval_signal:clinical_subject");
  });

  it("keeps the medication subject required for monitoring-range table retrieval", () => {
    const selection = selectRetrievalEvidence({
      query: "What lithium level range is used for maintenance monitoring?",
      queryClass: "table_threshold",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "unrelated-bgl-threshold",
          document_id: "bgl-doc",
          title: "Blood Glucose Level",
          file_name: "blood-glucose-level.pdf",
          section_heading: "Escalation threshold",
          content: "Escalate when the blood glucose level is greater than 15 mmol/L.",
          hybrid_score: 0.96,
        }),
        source({
          id: "lithium-maintenance-range",
          document_id: "lithium-doc",
          title: "Lithium Therapy",
          file_name: "CG.MHSP.Lithium.pdf",
          section_heading: "Maintenance monitoring",
          content: "The lithium maintenance range is 0.6 to 0.8 mmol/L.",
          hybrid_score: 0.58,
        }),
      ],
    });

    expect(selection.intent.requiredTermSignals).toContain("clinical_subject");
    expect(selection.results.map((result) => result.id)).toEqual([
      "lithium-maintenance-range",
      "unrelated-bgl-threshold",
    ]);
  });

  it("does not let a separate foreign-medication row erase a correct subject signal", () => {
    const selection = selectRetrievalEvidence({
      query: "What lithium level range is used for maintenance monitoring?",
      queryClass: "table_threshold",
      topK: 1,
      maxResultsPerDocument: 1,
      results: [
        source({
          id: "mixed-lithium-range",
          document_id: "lithium-doc",
          title: "Lithium Therapy",
          content: "Lithium maintenance range is 0.6 to 0.8 mmol/L. Valproate therapeutic range is 50 to 100 mg/L.",
          hybrid_score: 0.58,
        }),
        source({
          id: "unrelated-bgl-threshold",
          document_id: "bgl-doc",
          title: "Blood Glucose Level",
          content: "Escalate when the blood glucose level is greater than 15 mmol/L.",
          hybrid_score: 0.7,
        }),
      ],
    });

    expect(selection.results.map((result) => result.id)).toEqual(["mixed-lithium-range"]);
    expect(selection.results[0]?.match_explanation?.reasons).toContain("retrieval_signal:clinical_subject");
  });

  it("does not let a generic medication sentence promote an otherwise foreign-only result", () => {
    const selection = selectRetrievalEvidence({
      query: "What lithium level range is used for maintenance monitoring?",
      queryClass: "table_threshold",
      topK: 1,
      maxResultsPerDocument: 1,
      results: [
        source({
          id: "generic-lithium-foreign-range",
          document_id: "foreign-doc",
          title: "Lithium Therapy",
          content: "Lithium guidance. Valproate therapeutic range is 50 to 100 mg/L.",
          hybrid_score: 0.7,
        }),
        source({
          id: "lithium-maintenance-range",
          document_id: "lithium-doc",
          title: "Lithium Therapy",
          content: "Lithium maintenance range is 0.6 to 0.8 mmol/L.",
          hybrid_score: 0.58,
        }),
      ],
    });

    expect(selection.results.map((result) => result.id)).toEqual(["lithium-maintenance-range"]);
  });

  it("keeps a medication subject bound to its immediately following monitoring sentence", () => {
    const selection = selectRetrievalEvidence({
      query: "What monitoring is required for lithium therapy?",
      queryClass: "medication_dose_risk",
      topK: 1,
      maxResultsPerDocument: 1,
      results: [
        source({
          id: "unrelated-monitoring",
          document_id: "unrelated-doc",
          title: "Cardiac Monitoring",
          content: "Continuous cardiac observations are required.",
          hybrid_score: 0.7,
        }),
        source({
          id: "lithium-split-monitoring",
          document_id: "lithium-doc",
          title: "Lithium Therapy",
          content: "Lithium therapy is ongoing. Monitor renal and thyroid function every six months.",
          hybrid_score: 0.58,
        }),
      ],
    });

    expect(selection.results.map((result) => result.id)).toEqual(["lithium-split-monitoring"]);
  });

  it("keeps a split FBC discontinuation action bound to clozapine", () => {
    const selection = selectRetrievalEvidence({
      query: "What FBC threshold should discontinue clozapine?",
      queryClass: "table_threshold",
      topK: 1,
      maxResultsPerDocument: 1,
      results: [
        source({
          id: "unrelated-monitoring",
          document_id: "unrelated-doc",
          title: "Cardiac Monitoring",
          content: "Continuous cardiac observations are required.",
          hybrid_score: 0.7,
        }),
        source({
          id: "clozapine-split-fbc-action",
          document_id: "clozapine-doc",
          title: "Clozapine Monitoring",
          content: "Red FBC results require action. Clozapine should be discontinued.",
          hybrid_score: 0.58,
        }),
      ],
    });

    expect(selection.results.map((result) => result.id)).toEqual(["clozapine-split-fbc-action"]);
  });

  it("recognizes co-located WBC and ANC rows as direct FBC evidence", () => {
    const summary = summarizeRetrievalSelection({
      query: "What FBC threshold should withhold clozapine?",
      queryClass: "table_threshold",
      results: [
        source({
          id: "clozapine-wbc-anc-red-row",
          document_id: "clozapine-doc",
          title: "Clozapine Prescribing",
          content: "Red range: WBC below 3.0 x 10^9/L and ANC below 1.5 x 10^9/L. Stop clozapine immediately.",
        }),
      ],
    });

    expect(summary.candidates[0].matchedSignals).toEqual(expect.arrayContaining(["clozapine", "fbc"]));
  });

  it("does not use a generic lithium sentence to promote an unrecognized foreign medication regimen", () => {
    const selection = selectRetrievalEvidence({
      query: "What monitoring is required for lithium therapy?",
      queryClass: "medication_dose_risk",
      topK: 1,
      maxResultsPerDocument: 1,
      results: [
        source({
          id: "foreign-methotrexate-monitoring",
          document_id: "foreign-doc",
          title: "Lithium Therapy",
          content: "Lithium therapy is ongoing. Check methotrexate renal tests every six months.",
          hybrid_score: 0.7,
        }),
        source({
          id: "lithium-split-monitoring",
          document_id: "lithium-doc",
          title: "Lithium Therapy",
          content: "Lithium therapy is ongoing. Monitor renal and thyroid function every six months.",
          hybrid_score: 0.58,
        }),
      ],
    });

    expect(selection.results.map((result) => result.id)).toEqual(["lithium-split-monitoring"]);
  });

  it.each([["What is the therapeutic range for lithium?"], ["What QTc threshold should stop haloperidol?"]])(
    "requires the named medication subject for explicit threshold lookup: %s",
    (query) => {
      const intent = buildRetrievalIntent(query, "table_threshold");

      expect(intent.requiredTermSignals).toContain("clinical_subject");
    },
  );

  it.each([
    ["What is the target concentration for lithium?"],
    ["What is the therapeutic concentration for lithium?"],
    ["What is the trough concentration for lithium?"],
  ])("requires the named medication subject for concentration lookup: %s", (query) => {
    const intent = buildRetrievalIntent(query, "medication_dose_risk");

    expect(intent.requiredTermSignals).toContain("clinical_subject");
  });

  it("promotes flowchart next-step evidence for red-zone pathway questions", () => {
    const selection = selectRetrievalEvidence({
      query: "In the clinical flowchart, what is the next step after red-zone risk?",
      queryClass: "document_lookup",
      topK: 3,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "risk-overview",
          title: "Risk Overview",
          content: "Risk review background.",
          hybrid_score: 0.74,
        }),
        source({
          id: "red-zone-flowchart",
          title: "Risk Matrix Flowchart",
          file_name: "risk-flowchart.pdf",
          section_heading: "Red zone flowchart",
          content: "Flowchart red zone: next step is urgent senior review and escalation.",
          hybrid_score: 0.48,
          index_unit: {
            id: "unit-red-zone",
            unit_type: "flowchart_step",
            title: "Red zone next step",
            content: "Next step after red zone risk is urgent senior review.",
            source_chunk_id: "red-zone-flowchart",
            source_image_id: "image-1",
            page_start: 3,
            page_end: 3,
            heading_path: ["Risk flowchart"],
            normalized_terms: ["red zone", "next step", "urgent review"],
            quality_score: 0.9,
            extraction_mode: "hybrid",
          },
        }),
      ],
    });

    expect(selection.results[0].id).toBe("red-zone-flowchart");
    expect(selection.intent.needsFlowchartStep).toBe(true);
    expect(selection.summary.requiredSignalsSatisfied).toBe(true);
    expect(selection.summary.matchedSignals).toEqual(
      expect.arrayContaining(["flowchart", "flowchart_or_pathway", "next_step_or_action"]),
    );
  });

  it("marks medication dose-route chart evidence as strong selected support", () => {
    const selected = summarizeRetrievalSelection({
      query: "What dose and route are shown in the agitation medication chart?",
      queryClass: "medication_dose_risk",
      results: [
        source({
          id: "agitation-dose-route",
          document_id: "agitation-doc",
          title: "Agitation and Arousal Pharmacological Management",
          file_name: "MHSP.AgitationArousalPharmaMgt.pdf",
          section_heading: "Medication chart",
          content: "Lorazepam 1 mg IM or PO is listed in the agitation medication chart.",
          hybrid_score: 0.66,
          index_unit: {
            id: "unit-dose-route",
            unit_type: "medication_chart_row",
            title: "Lorazepam dose route row",
            content: "Lorazepam 1 mg IM or PO.",
            source_chunk_id: "agitation-dose-route",
            source_image_id: null,
            page_start: 5,
            page_end: 5,
            heading_path: ["Medication chart"],
            normalized_terms: ["lorazepam", "1 mg", "im", "po"],
            quality_score: 0.92,
            extraction_mode: "hybrid",
          },
        }),
      ],
    });

    expect(selected.intent.needsMedicationChart).toBe(true);
    expect(selected.intent.needsDoseRouteFrequency).toBe(true);
    expect(selected.summary.requiredSignalsSatisfied).toBe(true);
    expect(selected.summary.matchedSignals).toEqual(
      expect.arrayContaining(["medication_chart", "dose_amount", "route", "agitation"]),
    );
  });

  it("promotes exact source-table image evidence for clozapine ANC visual requests", () => {
    const selection = selectRetrievalEvidence({
      query: "Show the source table image for the clozapine ANC monitoring table.",
      queryClass: "table_threshold",
      topK: 3,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "clozapine-overview",
          document_id: "clozapine-doc",
          title: "Clozapine Prescribing Administration Monitoring",
          file_name: "MHSP.ClozapinePrescribingAdministrationMonitoring.pdf",
          content: "Clozapine monitoring overview with blood-test guidance.",
          hybrid_score: 0.78,
        }),
        source({
          id: "clozapine-anc-table-image",
          document_id: "clozapine-doc",
          title: "Clozapine Prescribing Administration Monitoring",
          file_name: "MHSP.ClozapinePrescribingAdministrationMonitoring.pdf",
          section_heading: "ANC monitoring table",
          content: "The clozapine ANC monitoring table is available as a source image.",
          image_ids: ["image-anc"],
          hybrid_score: 0.5,
          table_facts: [
            {
              id: "fact-anc",
              document_id: "clozapine-doc",
              source_chunk_id: "clozapine-anc-table-image",
              source_image_id: "image-anc",
              page_number: 2,
              table_title: "Clozapine ANC monitoring table",
              row_label: "ANC",
              clinical_parameter: "ANC",
              threshold_value: "ANC threshold",
              action: "Review according to the table.",
            },
          ],
          images: [
            {
              id: "image-anc",
              page_number: 2,
              storage_path: "documents/clozapine/page-2/table.png",
              caption: "Clozapine ANC monitoring table",
              image_type: "clinical_table",
              searchable: true,
              clinical_relevance_score: 0.95,
              sourceKind: "table_crop",
              tableTitle: "Clozapine ANC monitoring table",
              tableTextSnippet: "ANC threshold monitoring table",
            },
          ],
        }),
      ],
    });

    expect(selection.results[0].id).toBe("clozapine-anc-table-image");
    expect(selection.intent.needsSourceImage).toBe(true);
    expect(selection.intent.needsExactVisualTable).toBe(true);
    expect(selection.summary.requiredSignalsSatisfied).toBe(true);
    expect(selection.summary.matchedSignals).toEqual(
      expect.arrayContaining(["source_image", "visual_table", "table", "clozapine", "anc"]),
    );
  });

  it("keeps directly relevant content selectable when review metadata is absent", () => {
    const selection = selectRetrievalEvidence({
      query: "What is the next step after red-zone risk?",
      queryClass: "document_lookup",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "metadata-missing-flowchart",
          document_id: "metadata-missing-doc",
          title: "Risk Matrix Flowchart",
          file_name: "risk-matrix.pdf",
          section_heading: "Red zone",
          content: "Risk matrix flowchart red zone: next step is urgent review and escalation.",
          hybrid_score: 0.52,
          source_metadata: undefined,
          index_unit: {
            id: "unit-red-risk",
            unit_type: "flowchart_step",
            title: "Red-zone risk next step",
            content: "Red-zone risk requires urgent review and escalation.",
            source_chunk_id: "metadata-missing-flowchart",
            source_image_id: "image-red-risk",
            page_start: 3,
            page_end: 3,
            heading_path: ["Risk matrix", "Red zone"],
            normalized_terms: ["risk", "red zone", "next step", "urgent review"],
            quality_score: 0.9,
            extraction_mode: "hybrid",
          },
        }),
        source({
          id: "current-generic",
          document_id: "current-generic-doc",
          title: "Generic Current Source",
          file_name: "generic-current.pdf",
          content: "Generic process overview and routine administrative guidance.",
          hybrid_score: 0.66,
          source_metadata: sourceMetadata(),
        }),
      ],
    });

    expect(selection.results[0].id).toBe("metadata-missing-flowchart");
    expect(selection.results[0].source_metadata).toBeUndefined();
    expect(selection.summary.requiredSignalsSatisfied).toBe(true);
    expect(selection.summary.matchedSignals).toEqual(expect.arrayContaining(["risk", "red_zone"]));
  });

  // Contract changed 2026-07-02 (measured): source-governance metadata must NOT reorder retrieval
  // selection. The corpus is only partially enriched — unenriched documents normalize to
  // unknown/unverified — so metadata weighting in selection buried correct documents on the golden
  // retrieval eval (doc-recall@5 1.0 -> 0.76, 7/23 failures). Selection orders by relevance
  // (clamped score -> lexical -> rerank); governance is enforced by ranking penalties and the
  // answer/source-governance layer instead (RC8 tracked in docs/rag-hybrid-findings-and-todo.md).
  it("keeps relevance ordering and does not let source-governance metadata reorder selection", () => {
    const selection = selectRetrievalEvidence({
      query: "What ANC or FBC threshold should withhold clozapine?",
      queryClass: "table_threshold",
      topK: 5,
      maxResultsPerDocument: 1,
      results: [
        source({
          id: "review-due-shared-care",
          document_id: "review-due-doc",
          title: "Clozapine GP Shared Care",
          file_name: "Clozapine GP Shared Care (FSH).pdf",
          content: "Clozapine FBC and ANC blood count monitoring threshold information.",
          hybrid_score: 0.99,
          source_metadata: sourceMetadata({
            document_status: "review_due",
            clinical_validation_status: "unverified",
          }),
        }),
        source({
          id: "current-unverified-bmj",
          document_id: "bmj-doc",
          title: "Schizophrenia",
          file_name: "Schizophrenia.pdf",
          content: "Clozapine ANC and FBC monitoring for neutrophil thresholds.",
          hybrid_score: 0.98,
          source_metadata: sourceMetadata({
            publisher: "BMJ Best Practice",
            jurisdiction: "International",
            clinical_validation_status: "unverified",
          }),
        }),
        ...["fsh", "nmhs", "akg", "camhs", "smhs"].map((site, index) =>
          source({
            id: `current-local-${site}`,
            document_id: `current-local-${site}-doc`,
            title: "Clozapine Prescribing Administration Monitoring",
            file_name: `Clozapine Prescribing Administration Monitoring (${site.toUpperCase()}).pdf`,
            content: "Clozapine ANC and FBC threshold table: withhold clozapine and review blood results.",
            hybrid_score: 0.94 - index * 0.01,
            source_metadata: sourceMetadata({
              publisher: "WA Health",
              jurisdiction: "Australia/WA",
            }),
          }),
        ),
      ],
    });

    expect(selection.results).toHaveLength(5);
    // Relevance (hybrid) order is preserved; the review-due and unverified sources are NOT demoted
    // here — their governance state is surfaced/penalised by the ranking and answer layers.
    expect(selection.results.map((result) => result.id)).toEqual([
      "review-due-shared-care",
      "current-unverified-bmj",
      "current-local-fsh",
      "current-local-nmhs",
      "current-local-akg",
    ]);
  });

  it("does not let unverified validation displace directly relevant evidence", () => {
    const selection = selectRetrievalEvidence({
      query: "What dose and route are shown in the agitation medication chart?",
      queryClass: "medication_dose_risk",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "unverified-dose-route",
          document_id: "unverified-dose-doc",
          title: "Agitation Medication Chart",
          file_name: "agitation-chart.pdf",
          section_heading: "Medication chart",
          content: "Agitation medication chart lists lorazepam 1 mg IM or PO.",
          hybrid_score: 0.56,
          source_metadata: sourceMetadata({
            document_status: "current",
            clinical_validation_status: "unverified",
            extraction_quality: "good",
          }),
          index_unit: {
            id: "unit-unverified-dose-route",
            unit_type: "medication_chart_row",
            title: "Lorazepam route row",
            content: "Lorazepam 1 mg IM or PO.",
            source_chunk_id: "unverified-dose-route",
            source_image_id: null,
            page_start: 5,
            page_end: 5,
            heading_path: ["Medication chart"],
            normalized_terms: ["agitation", "lorazepam", "1 mg", "im", "po"],
            quality_score: 0.9,
            extraction_mode: "hybrid",
          },
        }),
        source({
          id: "current-generic-policy",
          document_id: "current-generic-policy-doc",
          title: "Current Medication Policy",
          file_name: "current-medication-policy.pdf",
          content: "General current medication governance policy without agitation dose or route detail.",
          hybrid_score: 0.64,
          source_metadata: sourceMetadata({
            document_status: "current",
            clinical_validation_status: "locally_reviewed",
            extraction_quality: "good",
          }),
        }),
      ],
    });

    expect(selection.results[0].id).toBe("unverified-dose-route");
    expect(selection.results[0].source_metadata?.clinical_validation_status).toBe("unverified");
  });

  it("prefers risk/red-zone flowchart evidence over generic flowchart evidence", () => {
    const selection = selectRetrievalEvidence({
      query: "In the clinical flowchart, what is the next step after red-zone risk?",
      queryClass: "document_lookup",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "generic-flowchart",
          title: "Generic Admission Flowchart",
          file_name: "generic-flowchart.pdf",
          content: "Flowchart pathway overview with general process steps.",
          hybrid_score: 0.72,
          index_unit: {
            id: "unit-generic-flowchart",
            unit_type: "flowchart_step",
            title: "Generic flowchart",
            content: "General flowchart process step.",
            source_chunk_id: "generic-flowchart",
            source_image_id: "image-generic",
            page_start: 1,
            page_end: 1,
            heading_path: ["Flowchart"],
            normalized_terms: ["flowchart", "process"],
            quality_score: 0.9,
            extraction_mode: "hybrid",
          },
        }),
        source({
          id: "risk-red-zone-flowchart",
          title: "Risk Matrix Flowchart",
          file_name: "risk-flowchart.pdf",
          section_heading: "Red zone risk",
          content: "Risk matrix flowchart red zone: next step is urgent senior review and escalation.",
          hybrid_score: 0.5,
          images: [
            {
              id: "image-risk",
              page_number: 3,
              storage_path: "documents/risk/page-3/flowchart.png",
              caption: "Red-zone risk flowchart",
              image_type: "flowchart_algorithm",
              searchable: true,
              clinical_relevance_score: 0.94,
              sourceKind: "diagram_crop",
            },
          ],
          index_unit: {
            id: "unit-risk-red",
            unit_type: "flowchart_step",
            title: "Red-zone risk next step",
            content: "Red-zone risk requires urgent senior review and escalation.",
            source_chunk_id: "risk-red-zone-flowchart",
            source_image_id: "image-risk",
            page_start: 3,
            page_end: 3,
            heading_path: ["Risk matrix", "Red zone"],
            normalized_terms: ["risk", "red zone", "next step", "urgent escalation"],
            quality_score: 0.92,
            extraction_mode: "hybrid",
          },
        }),
      ],
    });

    expect(selection.results[0].id).toBe("risk-red-zone-flowchart");
    expect(selection.intent.needsRiskFlowchart).toBe(true);
    expect(selection.summary.requiredSignalsSatisfied).toBe(true);
    expect(selection.summary.matchedSignals).toEqual(expect.arrayContaining(["risk", "red_zone"]));
  });

  it("does not let routine governance metadata displace stronger risk-flowchart action evidence", () => {
    const selection = selectRetrievalEvidence({
      query: "In the clinical flowchart, what is the next step after red-zone risk?",
      queryClass: "document_lookup",
      topK: 2,
      maxResultsPerDocument: 2,
      results: [
        source({
          id: "review-due-action",
          document_id: "review-due-doc",
          title: "Mental Health Emergency Flowchart",
          file_name: "review-due-flowchart.pdf",
          content: "Flowchart red-zone risk: urgent psychiatric review is required.",
          hybrid_score: 0.72,
          source_metadata: sourceMetadata({
            document_status: "review_due",
            clinical_validation_status: "unverified",
            extraction_quality: "good",
          }),
        }),
        source({
          id: "current-action",
          document_id: "current-doc",
          title: "Acute Deterioration Risk Pathway",
          file_name: "current-risk-pathway.pdf",
          content: "Risk pathway red-zone risk: next step is urgent senior review and escalation.",
          hybrid_score: 0.69,
          source_metadata: sourceMetadata({
            document_status: "current",
            clinical_validation_status: "locally_reviewed",
            extraction_quality: "good",
          }),
        }),
      ],
    });

    expect(selection.results[0].id).toBe("review-due-action");
    expect(selection.results[0].source_metadata?.document_status).toBe("review_due");
    expect(selection.results[0].source_metadata?.clinical_validation_status).toBe("unverified");
  });
});

describe("saturated-score tie-breaking", () => {
  function saturatedExplanation(
    preClampFinalScore: number,
    lexicalCoverageScore = 0.5,
  ): NonNullable<SearchResult["score_explanation"]> {
    return {
      vectorScore: 0.9,
      textRank: 0.3,
      lexicalCoverageScore,
      metadataMatchScore: 0.2,
      sectionTitleMatchBoost: 0.1,
      freshnessRecencyBoost: 0,
      weightedHybridScore: 0.9,
      rrfScore: null,
      rrfBoost: 0,
      memoryBoost: 0,
      titleBoost: 0.3,
      metadataBoost: 0.2,
      clinicalSignalBoost: 0.3,
      penalty: 0,
      rankScore: preClampFinalScore,
      finalScore: 1,
      preClampFinalScore,
      strategy: "weighted_hybrid",
    };
  }

  it("breaks saturated-score ties by query-term coverage, then chunk id", () => {
    // Amended from #901's chunk-id-only pin (never live-eval-validated — the only golden eval on
    // the #901 state failed 4/36): among candidates whose clamped score, lexical signal score, and
    // clamped rerank confidence all tie exactly, the clinical rank's QUERY-TERM COVERAGE decides
    // before the chunk-id fallback. Coverage — not the boost-laden rankScore — is deliberate:
    // the 2026-07-20 live golden run (eval-canary #50) proved a rankScore tie-break lets generic
    // clinicalSignalBoost stacking outvote the chunk that contains the queried terms
    // (alcohol-ciwa-threshold regressed to FAIL). Note the chunk-b fixture carries the LOWER
    // rankScore: boost magnitude must not win a saturated tie, coverage must.
    const higherCoverage = source({
      id: "chunk-b",
      hybrid_score: 1,
      similarity: 0.9,
      score_explanation: saturatedExplanation(1.2, 0.9),
    });
    const lowerCoverage = source({
      id: "chunk-a",
      hybrid_score: 1,
      similarity: 0.9,
      score_explanation: saturatedExplanation(1.8, 0.5),
    });

    const selection = selectRetrievalEvidence({
      query: "clinical guidance",
      queryClass: "broad_summary",
      results: [lowerCoverage, higherCoverage],
      topK: 2,
      maxResultsPerDocument: 2,
    });

    expect(selection.results.map((item) => item.id)).toEqual(["chunk-b", "chunk-a"]);
    // The prior recall fix remains: selection never lowers the raw hybrid score.
    expect(selection.results.map((item) => item.hybrid_score)).toEqual([1, 1]);

    // Identical coverage still falls back to the stable chunk-id order, regardless of rankScore.
    const tiedSelection = selectRetrievalEvidence({
      query: "clinical guidance",
      queryClass: "broad_summary",
      results: [
        source({ id: "chunk-d", hybrid_score: 1, similarity: 0.9, score_explanation: saturatedExplanation(1.6) }),
        source({ id: "chunk-c", hybrid_score: 1, similarity: 0.9, score_explanation: saturatedExplanation(1.4) }),
      ],
      topK: 2,
      maxResultsPerDocument: 2,
    });
    expect(tiedSelection.results.map((item) => item.id)).toEqual(["chunk-c", "chunk-d"]);
  });
});

describe("prevalidated atomic retrieval groups", () => {
  it("displaces lower-priority singletons so a late cross-document conflict survives the unchanged caps", () => {
    const sameDocumentSingles = [1, 2, 3, 4].map((index) =>
      source({
        id: `local-singleton-${index}`,
        document_id: "local-guideline",
        content: `Lithium monitoring background ${index}.`,
        hybrid_score: 0.99 - index * 0.01,
      }),
    );
    const localConflict = source({
      id: "late-local-conflict",
      document_id: "local-guideline",
      content: "The local lithium guideline requires renal monitoring every month.",
      hybrid_score: 0.61,
    });
    const australianConflict = source({
      id: "late-australian-conflict",
      document_id: "australian-guideline",
      content: "The Australian lithium guideline requires renal monitoring every three months.",
      hybrid_score: 0.6,
    });

    const selection = selectRetrievalEvidence({
      query: "Compare local and Australian lithium renal monitoring guidance",
      queryClass: "comparison",
      results: [...sameDocumentSingles, localConflict, australianConflict],
      topK: 4,
      maxResultsPerDocument: 4,
      prevalidatedAtomicGroups: [[localConflict.id, australianConflict.id]],
    });

    const selectedIds = selection.results.map((result) => result.id);
    expect(selectedIds).toHaveLength(4);
    expect(selectedIds).toEqual(expect.arrayContaining([localConflict.id, australianConflict.id]));
  });

  it("does not pin any candidate from an incomplete prevalidated group", () => {
    const localConflict = source({
      id: "stale-local-conflict",
      document_id: "local-guideline",
      content: "Lithium monitoring background only.",
      hybrid_score: 0.2,
    });
    const selection = selectRetrievalEvidence({
      query: "Compare local and Australian lithium renal monitoring guidance",
      queryClass: "comparison",
      results: [
        source({ id: "strong-1", document_id: "strong-doc-1", hybrid_score: 0.95 }),
        source({ id: "strong-2", document_id: "strong-doc-2", hybrid_score: 0.94 }),
        localConflict,
      ],
      topK: 2,
      maxResultsPerDocument: 2,
      prevalidatedAtomicGroups: [[localConflict.id, "missing-australian-conflict"]],
    });

    expect(selection.results.map((result) => result.id)).toEqual(["strong-1", "strong-2"]);
  });
});

describe("whole document title named in the query", () => {
  const query = "What assessment documentation is required?";
  const candidates = () => [
    source({
      id: "admissions",
      document_id: "admissions",
      title: "Admissions Policy and Procedure (RKPG)",
      file_name: "Admissions Policy and Procedure (RKPG).pdf",
      content: "Assessment documentation required on admission includes the risk assessment.",
      hybrid_score: 0.52,
    }),
    source({
      id: "radiotherapy",
      document_id: "radiotherapy",
      title: "Radiotherapy Skin Care Assessment and Management (FSH)",
      file_name: "Radiotherapy Skin Care Assessment and Management (FSH).pdf",
      content: "Skin assessment documentation is required at each review.",
      hybrid_score: 0.52,
    }),
    source({
      id: "pressure-injury",
      document_id: "pressure-injury",
      title: "Pressure Injury Prevention and Management (FSH)",
      file_name: "Pressure Injury Prevention and Management (FSH).pdf",
      content: "In the ICU environment, all risk assessment documentation is required.",
      hybrid_score: 0.52,
    }),
    source({
      id: "assessment-documentation",
      document_id: "assessment-documentation",
      title: "Assessment Documentation(AKG)",
      file_name: "Assessment Documentation (AKG).pdf",
      content: "CRHTT suitability assessment (pre-admission). CRHTT complete the following documentation.",
      hybrid_score: 0.48,
    }),
  ];

  it("ranks the document whose whole title the query names above documents sharing one word", () => {
    const selection = selectRetrievalEvidence({
      query,
      queryClass: "document_lookup",
      results: candidates(),
      topK: 8,
      maxResultsPerDocument: 4,
    });

    expect(selection.results[0]?.id).toBe("assessment-documentation");
  });

  it("still matches when the query ends with punctuation", () => {
    const selection = selectRetrievalEvidence({
      query: "Find Assessment Documentation.",
      queryClass: "document_lookup",
      results: candidates(),
      topK: 8,
      maxResultsPerDocument: 4,
    });

    expect(selection.results[0]?.id).toBe("assessment-documentation");
  });

  it("does not treat one shared title word as naming the document", () => {
    const selection = selectRetrievalEvidence({
      query: "What skin assessment is required?",
      queryClass: "document_lookup",
      results: candidates().filter((candidate) => candidate.id !== "assessment-documentation"),
      topK: 8,
      maxResultsPerDocument: 4,
    });
    const scores = new Map(selection.candidates.map((candidate) => [candidate.chunkId, candidate.score]));

    expect(scores.get("radiotherapy")).toBe(scores.get("admissions"));
  });

  it("keeps the boost inside the clamped score", () => {
    const selection = selectRetrievalEvidence({
      query,
      queryClass: "document_lookup",
      results: candidates().map((candidate) => ({ ...candidate, hybrid_score: 0.98 })),
      topK: 8,
      maxResultsPerDocument: 4,
    });

    expect(Math.max(...selection.candidates.map((candidate) => candidate.score))).toBeLessThanOrEqual(1);
  });
});
