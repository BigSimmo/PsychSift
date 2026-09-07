## Task 2: Produce one validated source-anchored summary payload

**Audit acceptance requirements (under current authority and unit gates):** F02 corrective acceptance uses the actual provider-response adapter, projection and validator for one, two and eight supported items. Canonical individual text and aggregate formatting must agree, with strict projection equality and existing bounds intact. Reject wrong aggregate, noncanonical item, invalid nested anchors/generation and field shapes. Keep this correction separate from F03 semantic-support design, F08 persistence/schema work and Answer/search. Use the new audit-correction brief; preserve the accepted original brief and exception record.

**Files:**

- Create: `supabase/functions/_shared/source-anchored-summary.ts`
- Modify: `supabase/functions/indexing-v3-agent/index.ts`
- Modify: `supabase/functions/indexing-v3-agent/behavior.ts`
- Modify: `supabase/functions/indexing-v3-agent/utils.ts`
- Modify: `src/lib/document-enrichment.ts`
- Modify: `src/lib/types.ts`
- Modify: `worker/main.ts`
- Modify: `tests/indexing-v3-agent.test.ts`
- Modify: `tests/document-enrichment.test.ts`
- Modify: `tests/worker-shadow-extraction.test.ts`
- Modify: `tests/check-indexing-contract.test.ts`

**Step 1: Define the transport-neutral contract and RED cases**

```ts
export type SourceAnchoredSummaryProfileItem = Readonly<{
  text: string;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  pages: readonly number[];
  evidence_type: "text" | "table" | "image" | "mixed" | "metadata";
  support: "direct" | "partial" | "not_found";
}>;

export type SourceAnchoredClinicalProfile = Readonly<{
  overview: string;
  applies_to: readonly SourceAnchoredSummaryProfileItem[];
  key_clinical_actions: readonly SourceAnchoredSummaryProfileItem[];
  medication_dose_monitoring: readonly SourceAnchoredSummaryProfileItem[];
  thresholds_timing: readonly SourceAnchoredSummaryProfileItem[];
  escalation_risk_warnings: readonly SourceAnchoredSummaryProfileItem[];
  required_forms_documentation: readonly SourceAnchoredSummaryProfileItem[];
  not_covered: readonly SourceAnchoredSummaryProfileItem[];
  important_tables_images: readonly SourceAnchoredSummaryProfileItem[];
  best_questions: readonly SourceAnchoredSummaryProfileItem[];
  source_quality_notes: readonly SourceAnchoredSummaryProfileItem[];
}>;

export type SourceAnchoredSummaryLabelType =
  | "site"
  | "topic"
  | "document_type"
  | "medication"
  | "risk"
  | "setting"
  | "workflow"
  | "population"
  | "service"
  | "clinical_action"
  | "care_phase"
  | "document_intent"
  | "content_feature"
  | "custom";

export type SourceAnchoredSummaryPayload = Readonly<{
  summary_kind: "structured" | "heuristic_fallback";
  summary_version: "source-anchored-summary-v1";
  document_id: string;
  index_generation_id: string;
  model: string;
  model_version: string;
  generated_at: string;
  source_chunk_ids: readonly string[];
  source_image_ids: readonly string[];
  summary: string;
  clinical_specifics: Readonly<{
    profile: SourceAnchoredClinicalProfile;
    actions: readonly string[];
    thresholds_timing: readonly string[];
    medication_monitoring: readonly string[];
    risk_escalation: readonly string[];
    documentation_forms: readonly string[];
    exceptions_gaps: readonly string[];
  }>;
  labels: readonly Readonly<{
    label: string;
    label_type: SourceAnchoredSummaryLabelType;
    confidence: number;
  }>[];
  heuristic_fallback: boolean;
}>;
```

Test invalid document/generation/chunk/image UUIDs, unordered or duplicate whole-summary anchors, non-ISO time, conflicting `summary_kind`/`heuristic_fallback`, stale-generation reuse, late-section coverage, and replacement failure preserving the prior valid summary. For every profile item, test chunk/image allowlist membership, exact page derivation, evidence type, support level, and the rule that a `direct` or `partial` item must retain at least one claim-level anchor. Whole-summary anchors supplement those claim anchors and never replace them.

Run:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
```

Expected RED: the shared normalizer is missing and Edge still uses its first-N heuristic path.

**Step 2: Implement strict normalization**

`normalizeSourceAnchoredSummary(input)` validates bounded non-empty strings and arrays, canonical UUIDs, ordered unique whole-summary anchors, every claim-level chunk/image/page anchor against the selected source maps, profile-key completeness, evidence/support values, labels, exact version markers, ISO time, and consistent fallback/model markers. It returns a new frozen value and throws before persistence on any mismatch. Move or re-export the existing `DocumentSummaryProfileItem` and `ClinicalDocumentSummaryProfile` structural types through the shared contract so Node and Deno do not acquire divergent claim vocabularies.

Use `selectCoverageAwarePromptChunks` and `buildIndexingCoverageProfile` in Node and the same deterministic selection contract in Deno. Pass the already-created `indexGenerationId` from `worker/main.ts`. Generate and validate the complete replacement before upserting the summary; replace labels only after summary persistence succeeds. Edge skips only a current, validated structured payload and regenerates missing, fallback, old-version, or superseded-generation rows.

**Step 3: Run GREEN**

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
npm run check:edge:functions
npm run eval:rag:offline
```

Expected: Node/Deno contract parity passes, non-first-N coverage is retained, and no provider is called by the tests.

**Step 4: Review and checkpoint**

Reviewers: `ingestion-worker-reviewer` and `clinical-governance-reviewer`. Suggested local checkpoint message: `feat(ingestion): anchor summaries to committed sources`.

---

