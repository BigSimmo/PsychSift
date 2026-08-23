### Task 2: Unify privacy-safe telemetry ownership and interaction joins

**Files:**

- Create: `src/lib/rag/rag-programme-telemetry.ts`
- Modify: `src/lib/rag/rag-contracts.ts`
- Modify: `src/lib/rag/rag-answer-telemetry-metadata.ts`
- Modify: `src/lib/answer-telemetry.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/app/api/answer/route.ts`
- Modify: `src/app/api/answer/stream/route.ts`
- Create: `tests/rag-programme-telemetry.test.ts`
- Modify: `tests/rag-telemetry-canary-absence.test.ts`
- Modify: `tests/answer-telemetry.test.ts`
- Modify: `tests/answer-stream-preview-order.test.ts`

**Ownership contract:**

| Store                         | Owns                                                                                                                       | Must not contain                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rag_queries.metadata`        | One final answer/SLO outcome, coverage totals, fallback category, rollout mode, generation/reconciliation outcome          | Raw query/subquery/answer/source text, provider error text, owner ID in JSON |
| `rag_retrieval_logs.metadata` | Per-answer retrieval route/corpus candidate and selected counts, exclusions, augmentation outcome, latency/cost primitives | Raw query/subquery/answer/source text, protected reference content           |
| `rag_answer_feedback`         | Existing anonymous category plus opaque `interaction_id`                                                                   | Query or answer prose                                                        |

All three join only through the existing route-created UUID. Retention and RLS remain owned by their existing tables.

**Interfaces:**

Consumes request/retrieval/coverage/generation/finalization outcomes keyed by `interaction_id`. Produces the allow-listed, privacy-safe `RagProgrammeTelemetry` projection below in both answer and retrieval metadata owners.

```ts
export type RagProgrammeTelemetry = {
  version: "rag-programme-telemetry-v1";
  interaction_id: string;
  rollout_mode: RagProgrammeMode;
  query_plan_kind: RagQueryPlanKind;
  subquestion_count: number;
  material_ambiguity: boolean;
  coverage_counts: { direct: number; partial: number; conflicting: number; absent: number };
  candidate_counts: {
    uploaded_local: number;
    clinical_kb_site: number;
    australian_public: number;
    international_supplementary: number;
  };
  selected_counts: {
    uploaded_local: number;
    clinical_kb_site: number;
    australian_public: number;
    international_supplementary: number;
  };
  selected_site_domains: SiteContentDomain[];
  site_candidate_count: number;
  site_selected_count: number;
  public_site_content_state: SiteContentPartitionState;
  site_static_manifest_match: boolean | null;
  site_pending_count_bucket: "0" | "1" | "2_to_5" | "6_plus" | null;
  augmentation_outcome: RagAugmentationOutcome;
  role_exclusion_count: number;
  insufficiency_reason: RagInsufficiencyReason | null;
  generation_outcome: RagGenerationOutcome;
  verified_units_emitted: number;
  verified_units_discarded: number;
  reconciliation_outcome: RagReconciliationOutcome;
};
```

- [ ] **Step 1: Write tests that pin the two-store projection and forbidden fields**

```ts
it("projects only allow-listed counts, enums, booleans, and the opaque interaction id", () => {
  const projected = buildRagProgrammeTelemetry(contaminatedInput);
  expect(projected.interaction_id).toBe(INTERACTION_ID);
  expect(JSON.stringify(projected)).not.toContain("patient-name-canary");
  expect(JSON.stringify(projected)).not.toContain("subquestion-text-canary");
  expect(JSON.stringify(projected)).not.toContain("provider-error-canary");
});

it("places the same interaction id in rag_queries and rag_retrieval_logs metadata", () => {
  expect(buildRagQueryMetadata(input).interaction_id).toBe(INTERACTION_ID);
  expect(buildAnswerLogRow(input).metadata.answer.interaction_id).toBe(INTERACTION_ID);
});
```

- [ ] **Step 2: Prove the join is currently missing**

Run: `node scripts/run-vitest.mjs run tests/rag-programme-telemetry.test.ts tests/answer-telemetry.test.ts`

Expected: FAIL because `interaction_id` is not carried into both metadata owners and the allow-listed projection does not exist.

- [ ] **Step 3: Add one request observation context**

Add an `observationContext` to the answer orchestration arguments:

```ts
export type RagObservationContext = {
  interactionId: string;
  rolloutMode: RagProgrammeMode;
};
```

The answer and stream routes already create `interactionId`; pass it into `answerQuestionWithScope` and `logAnswerDiagnostics`. Produce the programme projection only after the final answer is reconciled. Do not generate a second ID inside `rag.ts`.

- [ ] **Step 4: Extend the existing telemetry allowlists**

Keep legacy metadata byte-compatible when no programme diagnostics exist. Use `RAG_TELEMETRY_EXTENDED` for the new diagnostic projection until the rollout plan explicitly promotes it. `interaction_id` may be emitted independently because it is required to join feedback and is already exposed to the requesting browser.

- [ ] **Step 5: Prove privacy, compatibility, and route parity**

Run:

```text
node scripts/run-vitest.mjs run tests/rag-programme-telemetry.test.ts tests/rag-telemetry-canary-absence.test.ts tests/answer-telemetry.test.ts tests/answer-stream-preview-order.test.ts tests/answer-feedback-route.test.ts
```

Expected: PASS; normal and streaming routes write the same opaque join, flag-off legacy fields remain compatible, and registered canary strings are absent.

---

