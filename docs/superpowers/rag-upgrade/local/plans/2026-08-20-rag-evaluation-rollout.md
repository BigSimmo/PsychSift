# RAG programme evaluation, rollout, and operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use one fresh implementer at a time, followed by a task reviewer for specification compliance and code quality. Remediate every finding before starting the next task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every source, retrieval, answer, fallback, re-index, and incremental-delivery improvement measurable, privacy-minimised, reversible, and operationally visible before it can affect broad production traffic.

**Architecture:** Extend the existing RAG fixtures and two existing telemetry stores instead of creating a third observability system. `rag_queries.metadata` remains the answer/SLO aggregate; `rag_retrieval_logs.metadata` remains route-level retrieval detail. Both receive the same opaque `interaction_id` so existing privacy-minimised feedback can be joined without storing query or answer prose. A pure programme evaluator and comparator define hard safety/governance gates, target-slice usefulness gates, and bounded latency/cost gates. A single typed rollout helper owns `legacy`, `shadow`, and deterministic `canary` selection and cache isolation. Live/provider evaluation remains separately authorized and runs only from the default branch through the existing `repository_dispatch` canary.

**Tech Stack:** TypeScript 6 strict, Next.js 16, Supabase/PostgreSQL JSONB telemetry, Vitest, existing offline RAG fixtures, and the existing `eval-canary` workflow. Live Supabase/OpenAI/GitHub actions are approval-gated.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Dependency ownership:** Tasks 1–2 land first and unblock the source, first-party site-content, and retrieval implementation plans. Task 4 consumes the query-plan, coverage, source-policy, site-release, and cache-version contracts. Task 5 consumes the stable adaptive-answer and verified-unit contracts. Task 6 is the final production gate after every contributing plan is offline-green.

**Effort:** Plan/review `high`, with `xhigh` final cross-plan review. Tasks 1–2 build `high`; Task 3 build `medium-high`; Tasks 4–5 build `high`; Task 6 operator execution `high`. Use a frontier coding model with high reasoning for metrics, privacy, rollout/cache isolation, and canary comparison. Documentation-only reconciliation may use medium effort. A live promotion decision uses xhigh review even though the operator commands are mechanical.

**Current-main reconciliation (2026-08-22):** existing RAG Track A is complete through S3, prompt v19’s recorded canary pair is green, and Gate E blinded capture/pairing tooling merged in PR #2208. The historical paid v18-versus-v19 capture/owner read is closed over 30 fixed cases with no added live questions at v18 3, v19 3, tie 24, neither 0; its source-only/byte-identical caveats make it no-harm baseline evidence, not demonstrated benefit. Do not re-run it without a fresh explicit provider request. `scoreAnswerQualityEvalCase` in source uses a 900-word v19 contract ceiling while the HANDOVER records the older 220-word metric confound; v20’s eight-section schema must re-derive this gate. `src/lib/rag/rag.ts` is at its enforced 4,362-line no-growth ceiling.

## Global Constraints

- Real failed questions enter fixtures only after privacy review and de-identification. Never persist patient-identifiable query text or answer prose for this programme.
- Reuse `rag_queries`, `rag_retrieval_logs`, `rag_answer_feedback`, and the existing captured-eval workflow. Do not add a third answer telemetry table.
- Feedback never changes a prompt, ranker, source approval, or rollout automatically. A human reviews, de-identifies, and explicitly promotes a reproducible case.
- An interaction join is an opaque UUID only. Do not log owner IDs inside JSON metadata, raw subquestions, source content, provider exception text, eTG/AMH material, or protected link-only content.
- `shadow` must serve byte-identical legacy output and must not write candidate answers into legacy caches. Live shadow does not make a second provider generation call.
- `canary` selection is deterministic, owner-safe, server-only, independently testable, and isolated in cache keys.
- No hard access, link-only, Healthdirect, source-role, citation, numeric, prompt-injection, governance, or incremental-reconciliation violation is tolerated.
- Offline fixtures are necessary but do not prove live corpus, provider, migration, recovery, or production readiness.
- The existing canary is `repository_dispatch`/schedule on the default branch. Do not document or add a branch/ref input that would run untrusted branch code with secrets.
- No provider call, production telemetry read, GitHub dispatch, migration, environment change, deployment, source activation, re-index, commit, push, or PR is authorized by this plan alone.
- Preserve and reuse `scripts/eval-answer-quality.ts` and `scripts/blind-answer-pairs.ts`; do not create a second human-quality pack format. The closed v18-versus-v19 owner read is historical baseline evidence, while v19-versus-v20 is the separate promotion comparison for this programme.
- Keep `src/lib/rag/rag.ts` at or below 4,362 lines by placing evaluator, rollout, telemetry, and reconciliation logic in their named modules. Never raise the maintainability budget.
- Gate receipts are valid local evidence only when reported as reused receipts with their timestamp. They are not fresh executions and never substitute for hosted/provider proof.
- Before an applicable expensive gate, run its exact arbiter command and quote the verdict: `npm run arbiter -- lint`, `npm run arbiter -- typecheck`, `npm run arbiter -- test`, `npm run arbiter -- verify:cheap`, or `npm run arbiter -- verify:pr-local`. RAG/database/UI scopes are deliberately non-deferrable; `RUN` is expected unless exact content is already `PROVEN`.

---

## File Structure

| File                                                                                                                                                               | Responsibility                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/rag/rag-programme-eval.ts`                                                                                                                                | **New.** Case expectations, result projection, hard violations, aggregate metrics, and gate policy.                                        |
| `src/lib/rag/rag-eval-cases.ts`                                                                                                                                    | Adds privacy-reviewed programme failure cases to the existing fixture owner.                                                               |
| `scripts/fixtures/rag-programme-failures.v1.json`                                                                                                                  | **New.** De-identified must-pass case metadata and stable case-set fingerprint input.                                                      |
| `scripts/check-rag-fixtures.mjs`                                                                                                                                   | Validates the new programme expectations with existing RAG fixtures.                                                                       |
| `tests/rag-programme-eval.test.ts`                                                                                                                                 | **New.** Per-case and aggregate gate contract.                                                                                             |
| `src/lib/rag/rag-programme-telemetry.ts`                                                                                                                           | **New.** Allow-listed numeric/enum telemetry projection; no prose.                                                                         |
| `src/lib/rag/rag-contracts.ts`                                                                                                                                     | Carries the opaque interaction and programme diagnostic context.                                                                           |
| `src/lib/rag/rag-answer-telemetry-metadata.ts`                                                                                                                     | Adds bounded answer/SLO aggregate fields to `rag_queries.metadata`.                                                                        |
| `src/lib/answer-telemetry.ts`                                                                                                                                      | Adds the same interaction ID and route-level programme counts to `rag_retrieval_logs.metadata`.                                            |
| `src/lib/rag/rag.ts`                                                                                                                                               | Produces diagnostics once and writes reconciled final telemetry.                                                                           |
| `src/app/api/answer/route.ts`, `src/app/api/answer/stream/route.ts`                                                                                                | Pass the already-created interaction ID into RAG and both telemetry sinks.                                                                 |
| `tests/rag-programme-telemetry.test.ts`                                                                                                                            | **New.** Allowlist, join, and no-prose contract.                                                                                           |
| `tests/rag-telemetry-canary-absence.test.ts`, `tests/answer-telemetry.test.ts`                                                                                     | Protect canary-token absence and route log shape.                                                                                          |
| `src/lib/rag/feedback-eval-triage.ts`                                                                                                                              | **New.** Pure, non-automatic feedback-to-review classification.                                                                            |
| `scripts/report-answer-feedback.ts`                                                                                                                                | **New.** Offline adapter and separately approved live aggregate report.                                                                    |
| `tests/feedback-eval-triage.test.ts`                                                                                                                               | **New.** No automatic promotion or behaviour mutation.                                                                                     |
| `src/lib/rag/rag-rollout.ts`                                                                                                                                       | **New.** Single owner for `legacy`/`shadow`/`canary` mode and deterministic cohort selection.                                              |
| `src/lib/env.ts`, `.env.example`                                                                                                                                   | Typed default-off server rollout controls; cohort configuration is never client-exposed.                                                   |
| `src/lib/rag/rag-cache.ts`                                                                                                                                         | Mode/query-plan/source-policy/index-generation cache isolation.                                                                            |
| `src/lib/health-response.ts`, `src/lib/observability/answer-slo.ts`                                                                                                | Authenticated operator visibility for programme health and rollback signals.                                                               |
| `tests/rag-rollout.test.ts`, `tests/rag-cache-utils.test.ts`, `tests/rag-cache-invalidation.test.ts`, `tests/rag-shared-cache.test.ts`, `tests/answer-slo.test.ts` | Rollout, isolation, and SLO contract.                                                                                                      |
| `scripts/compare-rag-programme-eval.ts`                                                                                                                            | **New.** Baseline/candidate fingerprint and protected-slice comparator.                                                                    |
| `scripts/eval-answer-quality.ts`, `scripts/blind-answer-pairs.ts`                                                                                                  | Reuse current Gate E capture and blinded human comparison for v19 versus v20.                                                              |
| `tests/eval-answer-quality.test.ts`, `tests/blind-answer-pairs.test.ts`                                                                                            | Protect shape-aware limits, pairing, blinding, and unblinding.                                                                             |
| `tests/compare-rag-programme-eval.test.ts`                                                                                                                         | **New.** Fail-closed comparison matrix.                                                                                                    |
| `scripts/eval-rag.ts`, `scripts/eval-rag-offline.mjs`, `package.json`                                                                                              | Programme case selection and offline/provider entry points.                                                                                |
| `.github/workflows/eval-canary.yml`                                                                                                                                | Default-branch-only optional programme canary and artifact capture.                                                                        |
| `docs/rag-upgrade-rollout-runbook.md`                                                                                                                              | Created initially by Repository Task 6/P10; finalized here with exact offline, shadow, canary, promotion, rollback, and incident sequence. |
| `docs/observability-slos.md`, `docs/launch-operator-runbook.md`                                                                                                    | Correct dispatch instructions and name programme signals/ownership.                                                                        |
| `docs/search-rag-master-plan.md`, `docs/search-rag-master-context.md`                                                                                              | Mark stale fallback, timeout, and direct-Playwright instructions as historical.                                                            |

---

## Ordered Programme Gate

1. Task 1 case/metric contract and Task 2 telemetry contract.
2. Australian source metadata/eligibility, read-only document/site audits, and first-party registry/static-manifest contracts.
3. Reversible generation/recovery primitives plus first-party dynamic synchronization, activation, and request-snapshot/cache contracts.
4. Query planning, explicit uploaded/site/public retrieval lanes, cross-domain coverage, typed updating/fallback behavior, and repository-content Task 6.
5. Adaptive answer contract and complete main-surface rendering.
6. Verified lead/section delivery only after the final answer and request-snapshot contracts are stable.
7. Targeted reversible shadow re-index and public-source lifecycle waves.
8. Task 4 rollout/cache owner, then offline paired comparison.
9. Approved default-branch provider/corpus baseline and canary.
10. Approved blinded v19-versus-v20 usefulness verdict using the existing Gate E tooling.
11. Production promotion only with named alerts, recovery proof, exact expected/active public static-manifest match, a valid public release, administrator-only publication proof, and independent rollback controls.

## Stop Conditions

- Stop behaviour work if Tasks 1–2 are not green; unmeasured improvements do not enter canary.
- Stop corpus-scoped retrieval if current registry/site projections have not been classified as `clinical_kb_site` and bound to an exact valid public release.
- Stop if a new telemetry field can carry prose, patient detail, provider errors, source content, administrator/user IDs, or protected reference material.
- Stop if shadow changes served bytes, adds a live provider call, or writes candidate answers into legacy caches.
- Stop canary if artifacts do not represent identical cases and corpus population.
- Stop on any hard violation, must-pass false insufficiency, per-case rank regression, or reconciliation mismatch.
- Stop before live telemetry/feedback reads, provider calls, GitHub dispatch, environment changes, migrations, re-indexing, source activation, deployment, or rollback testing without explicit authorization.
- Stop before promotion if the accountable RAG owner, monitored channel, prior-generation rollback, or recovery evidence is not recorded.

---

### Task 1: Define the programme case and gate contract

**Files:**

- Modify: `src/lib/types.ts`
- Create: `src/lib/rag/rag-programme-eval.ts`
- Create: `scripts/fixtures/rag-programme-failures.v1.json`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `scripts/check-rag-fixtures.mjs`
- Create: `tests/rag-programme-eval.test.ts`
- Modify: `tests/rag-eval-cases.test.ts`
- Modify: `tests/rag-routing.test.ts`
- Modify: `tests/rag-generation-quality-diagnostics.test.ts`
- Modify: `tests/answer-follow-up.test.ts`

**Interfaces:**

Consumes existing `src/lib/types.ts` RAG/public-content contracts and the approved programme vocabulary. Produces the canonical shared enums and programme case/artifact types below; later plans import them rather than redefining them.

```ts
export type SourceCorpusScope =
  "uploaded_local" | "clinical_kb_site" | "australian_public" | "international_supplementary";
export type ClinicalSourceRole =
  | "local_guideline"
  | "clinical_guideline"
  | "clinical_reference"
  | "service_directory"
  | "form_reference"
  | "tool_reference"
  | "safety_alert"
  | "regulatory"
  | "quality_standard"
  | "legal"
  | "subsidy"
  | "professional_review"
  | "service_policy"
  | "reference_link";
export type SiteContentDomain =
  | "services"
  | "forms"
  | "medications"
  | "differentials"
  | "specifiers"
  | "dsm"
  | "formulation"
  | "therapies"
  | "dictionary"
  | "factsheets"
  | "calculators"
  | "tools";
export type SiteContentPartitionState = "current" | "updating" | "stale" | "unavailable" | "disabled";
export type RagSubquestionPurpose =
  "primary" | "comparison_side" | "required_action" | "monitoring" | "risk" | "special_population";
export type RagQueryPlanKind = "single" | "decomposed" | "clarification_required";
export type AdaptiveAnswerShape = "narrow" | "focused" | "comprehensive" | "comparison" | "partial";
export type RagProgrammeMode = "legacy" | "shadow" | "canary";
export type RagAugmentationOutcome = "not_needed" | "used" | "no_eligible_evidence" | "unavailable" | "disabled";
export type RagGenerationOutcome = "generated" | "extractive" | "source_only" | "failed";
export type RagReconciliationOutcome = "not_applicable" | "matched" | "mismatch";
export type RagInsufficiencyReason =
  | "not_in_corpus"
  | "retrieval_miss"
  | "insufficient_claim_support"
  | "source_role_mismatch"
  | "source_conflict"
  | "governance_block"
  | "site_content_updating"
  | "site_content_stale"
  | "site_content_unavailable"
  | "timeout"
  | "provider_failure";

export type RagProgrammeExpectation = {
  expectedCorpusScopes: SourceCorpusScope[];
  expectedSourceRoles: ClinicalSourceRole[];
  expectedSiteDomains: SiteContentDomain[];
  expectedPublicSiteContentState: SiteContentPartitionState | "not_applicable";
  expectedSubquestionPurposes: RagSubquestionPurpose[];
  minimumDirectSubquestions: number;
  allowedAnswerShapes: AdaptiveAnswerShape[];
  requireSupportedPart: boolean;
  requireExactGap: boolean;
  expectedConflict: {
    localDocumentId: string;
    australianDocumentId: string;
    requireVisibleFields: Array<
      | "source_identity"
      | "publication_or_effective_date"
      | "jurisdiction"
      | "source_role"
      | "material_difference"
      | "local_primary_decision"
      | "review_flag"
    >;
  } | null;
  forbiddenFallbackReasons: RagInsufficiencyReason[];
  requiredFacts: string[];
  forbiddenPatterns: string[];
  incrementalEligibility: "none" | "lead" | "independent_sections";
};

export type RagProgrammeHardViolation =
  | "access_boundary"
  | "healthdirect_used"
  | "link_only_content_used"
  | "source_role_mismatch"
  | "unsupported_citation"
  | "unsupported_number"
  | "prompt_injection"
  | "governance"
  | "conflict_contract"
  | "stale_site_content"
  | "site_public_read_mismatch"
  | "site_non_admin_mutation"
  | "site_authority_escalation"
  | "site_domain_miss"
  | "incremental_reconciliation";

export type RagProgrammeCaseResult = {
  id: string;
  caseFingerprint: string;
  passed: boolean;
  falseInsufficiency: boolean;
  supportedPartRetained: boolean;
  documentReciprocalRank: number;
  contentReciprocalRank: number;
  hardViolations: RagProgrammeHardViolation[];
  failedExpectations: string[];
  totalLatencyMs: number | null;
  estimatedCostUsd: number | null;
};

export type RagProgrammeGatePolicy = {
  version: "rag-programme-gate-v1";
  requireDocumentRecall: 1;
  requireContentRecall: 1;
  maximumHardViolations: 0;
  maximumPerCaseRankRegressions: 0;
  maximumP95LatencyMultiplier: 1.1;
  maximumEstimatedCostMultiplier: 1.15;
};
```

Task 1 seeds the canonical shared aliases in `src/lib/types.ts`: `SourceCorpusScope`, `ClinicalSourceRole`, `SiteContentDomain`, `SiteContentPartitionState`, `RagSubquestionPurpose`, `AdaptiveAnswerShape`, and `RagInsufficiencyReason`. The source, first-party site-content, retrieval, and adaptive plans import and extend these owners; they must not introduce parallel string vocabularies. This contract-only seeding is why evaluation Task 1 precedes the behavioural plans.

The JSON fixture stores case IDs, de-identification review metadata, expected documents/roles/corpora/site domains, expected public site-release state, and structured expectations. It does not store patient details, production trace data, provider output, full first-party record bodies, administrator/user identifiers, or copied eTG/AMH content. The TypeScript fixture loader verifies its stable fingerprint.

- [ ] **Step 1: Write failing per-case and aggregate gate tests**

```ts
// tests/rag-programme-eval.test.ts
import { describe, expect, it } from "vitest";
import { compareRagProgrammeRuns, evaluateRagProgrammeCase } from "@/lib/rag/rag-programme-eval";

describe("RAG programme gate", () => {
  it("marks a generic refusal as false insufficiency when a required subquestion has direct evidence", () => {
    const result = evaluateRagProgrammeCase(fixture.directEvidenceGenericRefusal);
    expect(result).toMatchObject({ falseInsufficiency: true, passed: false });
  });

  it("passes a partial answer only when it retains support and names the exact gap", () => {
    const result = evaluateRagProgrammeCase(fixture.supportedPartWithExactGap);
    expect(result).toMatchObject({ supportedPartRetained: true, falseInsufficiency: false, passed: true });
  });

  it("fails a conflict case unless the complete canonical conflict is visible", () => {
    const result = evaluateRagProgrammeCase(fixture.conflictMissingAustralianDateAndRole);
    expect(result).toMatchObject({ passed: false, hardViolations: expect.arrayContaining(["conflict_contract"]) });
    expect(result.failedExpectations).toEqual(expect.arrayContaining(["publication_or_effective_date", "source_role"]));
  });

  it.each([
    "healthdirect_used",
    "link_only_content_used",
    "access_boundary",
    "site_public_read_mismatch",
    "site_non_admin_mutation",
    "conflict_contract",
    "incremental_reconciliation",
  ])("fails the run for one %s violation", (violation) => {
    expect(compareRagProgrammeRuns(baseline, candidateWith(violation)).decision).toBe("NO_GO");
  });

  it("fails when either the case set or evaluated population fingerprint differs", () => {
    expect(compareRagProgrammeRuns(baseline, { ...candidate, caseSetFingerprint: "different" }).decision).toBe("NO_GO");
    expect(compareRagProgrammeRuns(baseline, { ...candidate, populationFingerprint: "different" }).decision).toBe(
      "NO_GO",
    );
  });

  it("fails when any must-pass case fails even if aggregate recall remains perfect", () => {
    const failedCase = {
      ...candidate.cases[0],
      passed: false,
      failedExpectations: ["visible_conflict_metadata_missing"],
    };
    expect(
      compareRagProgrammeRuns(baseline, { ...candidate, cases: [failedCase, ...candidate.cases.slice(1)] }).decision,
    ).toBe("NO_GO");
  });
});
```

- [ ] **Step 2: Prove the new contract is absent**

Run: `node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts`

Expected: FAIL because the module, types, and fixture do not exist.

- [ ] **Step 3: Implement the pure evaluator and fixture validation**

The evaluator receives already-sanitized answer, retrieval, coverage, source-governance, and verified-unit diagnostics. It never calls Supabase or a provider. Extend `RagEvalCase` with optional `programmeExpectation`; do not create a parallel case registry.

Seed the first target slice with privacy-reviewed reproductions of the reported failures:

- directly supported question that previously returned a generic gap;
- administrator/backend trusted admission followed by technical activation, with ordinary-user upload denial and owned staging/legacy owner-private document exclusion before Answer retrieval;
- broad multi-intent question with one missing subtopic;
- current uploaded guideline plus eligible Australian augmentation;
- direct specifier, differential, and medication questions that require current `clinical_kb_site` records;
- a cross-domain site question that must cover each required domain without unbounded retrieval fan-out;
- a clinical recommendation that keeps the uploaded guideline primary over a derivative site summary;
- a product/catalogue question where the matching site record is appropriately primary;
- a changed/deleted site record and a stale manifest/cache mismatch that can never serve the prior content;
- uploaded/public conflict that keeps the uploaded local source primary and raises review provenance;
- anonymous/authenticated parity for the canonical public site release, administrator-only site mutation/publication, and private/staging document exclusion;
- role mismatch where PBS/legal/regulatory evidence cannot substitute for treatment guidance;
- first-party site synchronization unavailable, requiring explicit site-lane degradation while retaining valid uploaded/Australian evidence;
- Australian augmentation unavailable, requiring explicit uploaded/site degradation;
- Healthdirect exclusion;
- eTG and AMH link-only enforcement;
- a declared or locally detected Healthdirect/eTG/AMH upload attempt that fails before provider/index artifacts while preserving only bounded policy diagnostics;
- narrow fact that must remain concise;
- broad question that must retain all supported sections; and
- broad management question that must choose the existing appropriate model route;
- eight-section structured output that must complete without silent `max_output_tokens` degradation, while preserving the current bounded self-heal contract;
- an anaphoric follow-up that must retain the prior topic through the existing bounded `buildAnswerFollowUpQuery` path without persisting conversation text; and
- incremental lead/section eligibility and reconciliation.

The protected-owner tests pin current behaviour rather than tune it: broad management remains eligible for the current strong route, `max_output_tokens` incompleteness reaches the existing bounded recovery/fallback diagnostics without returning a partial structured answer, and the follow-up wrapper retains one prior question only when continuation cues require it. Do not raise token limits, change model routing, or add a conversation-history payload unless the measured candidate case first demonstrates a defect and a separately reviewed change improves it.

- [ ] **Step 4: Make the focused fixture tests pass**

Run:

```text
node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts tests/rag-eval-cases.test.ts tests/rag-eval-source-governance.test.ts tests/rag-routing.test.ts tests/rag-generation-quality-diagnostics.test.ts tests/answer-follow-up.test.ts
npm run check:rag:fixtures
npm run check:rag:adversarial-fixtures
```

Expected: PASS; fixture fingerprints are stable and every protected failure class has an explicit expectation.

- [ ] **Step 5: Record the initial recommended thresholds in one policy constant**

Use the policy above as the initial recommendation: zero hard violations, document/content recall `1.0`, zero per-case reciprocal-rank regressions, target-slice false insufficiency strictly better unless already zero, supported-part retention at `1.0`, p95 latency no more than `1.10×` baseline and within existing route budgets, and estimated cost no more than `1.15×` baseline. A threshold change is an explicit reviewed policy edit, not a command-line escape hatch.

---

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

### Task 3: Close the reviewed feedback-to-evaluation loop

**Files:**

- Create: `src/lib/rag/feedback-eval-triage.ts`
- Create: `scripts/report-answer-feedback.ts`
- Create: `tests/feedback-eval-triage.test.ts`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `tests/eval-cases-route.test.ts`
- Modify: `docs/observability-slos.md`

**Interfaces:**

Consumes reviewed user feedback plus allow-listed answer/retrieval diagnostic metadata. Produces `classifyFeedbackForEval(args: { feedback: { interactionId: string; category: string }; answerMetadata: Record<string, unknown> | null; retrievalMetadata: Record<string, unknown> | null }): FeedbackEvalTriage`; it never auto-promotes a case or changes production behavior.

```ts
export type FeedbackEvalTriage = {
  interactionId: string;
  category: string;
  diagnosticReasonCodes: string[];
  recommendedAction: "aggregate_only" | "request_reproduction" | "candidate_eval_case" | "clinical_review";
  requiresDeidentificationReview: true;
  mayAutoPromote: false;
};

export function classifyFeedbackForEval(args: {
  feedback: { interactionId: string; category: string };
  answerMetadata: Record<string, unknown> | null;
  retrievalMetadata: Record<string, unknown> | null;
}): FeedbackEvalTriage;
```

- [ ] **Step 1: Write failing no-automation tests**

Pin that `numeric_error`, `unsupported_answer`, `source_insufficient`, `wrong_source`, and `outdated_guidance` become review candidates with diagnostic codes; `verified` stays aggregate-only. Every output has `mayAutoPromote: false` and contains no query, answer, chunk content, owner ID, or provider error.

- [ ] **Step 2: Implement the pure join/classifier**

Use the interaction ID to join already-sanitized metadata. If either telemetry side is absent, produce a reason-coded incomplete triage record rather than guessing. Never read `rag_queries.answer` or raw query columns.

- [ ] **Step 3: Add the report adapter with a hard live boundary**

Default mode reads an operator-supplied JSON export and produces aggregate counts plus candidate interaction IDs. `--live` requires the repository’s explicit Supabase-read approval/identity guard and still selects only feedback plus allow-listed metadata. The report never writes an eval case.

- [ ] **Step 4: Reuse the existing captured-eval review path**

A reviewer obtains a reproducible question from the reporter, removes patient/site-specific details, confirms expected evidence/behaviour, then submits it through the existing eval-case capture path. The programme fixture changes only in a normal reviewed code change.

- [ ] **Step 5: Verify the closure contract**

Run:

```text
node scripts/run-vitest.mjs run tests/feedback-eval-triage.test.ts tests/answer-feedback-route.test.ts tests/eval-cases-route.test.ts tests/rag-eval-cases.test.ts
```

Expected: PASS; feedback is diagnosable but cannot mutate production behaviour or fixtures automatically.

Do not run `scripts/report-answer-feedback.ts --live` without separate authorization for production telemetry access.

---

### Task 4: Add one typed shadow/canary owner and isolate caches

**Files:**

- Create: `src/lib/rag/rag-rollout.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Modify: `src/lib/rag/rag-cache.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/health-response.ts`
- Create: `tests/rag-rollout.test.ts`
- Modify: `tests/rag-cache-utils.test.ts`
- Modify: `tests/rag-cache-invalidation.test.ts`
- Modify: `tests/rag-shared-cache.test.ts`
- Modify: `tests/health-route.test.ts`

**Interfaces:**

Consumes configured mode, cohort inputs, component flags, cache dependencies, and the request-local public content snapshot. Produces `decideRagProgrammeRollout(args: RagProgrammeRolloutInput): RagProgrammeRolloutDecision` and the default-off environment contract below; `RagProgrammeRolloutInput` contains exactly the fields enumerated in the following declaration.

```ts
// Reuse RagProgrammeMode from the Task 1 canonical contract.

export type RagProgrammeRolloutDecision = {
  configuredMode: RagProgrammeMode;
  servedMode: "legacy" | "candidate";
  runShadowRetrieval: boolean;
  components: {
    siteContent: boolean;
    australianAugmentation: boolean;
    adaptiveAnswer: boolean;
    adaptiveRender: boolean;
  };
  cohortBucket: number | null;
  cacheNamespace: string;
};

export function decideRagProgrammeRollout(args: {
  configuredMode: RagProgrammeMode;
  ownerId: string | null;
  canaryBasisPoints: number;
  serverSalt: string | undefined;
  queryPlanVersion: string;
  sourcePolicyVersion: string;
  indexGeneration: string;
  publicSiteContentReleaseId: string | null;
  publicSiteContentStaticManifestDigest: string | null;
  publicSiteContentReleaseDigest: string | null;
  publicSiteContentChangeEpoch: string | null;
  publicSiteContentState: SiteContentPartitionState;
  siteContentEnabled: boolean;
  australianAugmentationEnabled: boolean;
  adaptiveAnswerEnabled: boolean;
  adaptiveRenderEnabled: boolean;
}): RagProgrammeRolloutDecision;
```

Environment contract:

```text
RAG_PROGRAMME_MODE=legacy
RAG_PROGRAMME_CANARY_BASIS_POINTS=0
# RAG_PROGRAMME_ROLLOUT_SALT is injected by the approved server-only secret store; never NEXT_PUBLIC.
RAG_SITE_CONTENT_ENABLED=false
RAG_AUSTRALIAN_AUGMENTATION_ENABLED=false
RAG_ADAPTIVE_ANSWER_ENABLED=false
RAG_ADAPTIVE_ANSWER_RENDER_ENABLED=false
```

All four component flags are server-only, typed in `src/lib/env.ts`, default false, included in candidate response/cache fingerprints, exposed as booleans in authenticated health, and ignored while `servedMode = legacy`. The adaptive plan projects a bounded `renderAdaptiveAnswer` boolean into the final client payload only when both adaptive server flags are enabled and the final answer declares the matching answer-contract version. No component flag contains cohort or owner data.

- [ ] **Step 1: Write the rollout truth table**

Tests must prove:

- `legacy` serves only legacy and uses the legacy cache namespace;
- `shadow` serves byte-identical legacy, runs candidate retrieval only, and forbids candidate writes to answer/search legacy caches;
- `canary` is stable for the same owner and salt, bounded to `0..9999`, and falls back to legacy when owner/salt is unavailable;
- changing query-plan, source-policy, index-generation, public site manifest/release/epoch, or served mode changes every applicable candidate namespace;
- anonymous and authenticated requests at the same public release use the same site-content candidate namespace;
- changing any server component flag changes the candidate namespace;
- candidate mode with Australian augmentation disabled searches uploaded-local plus any independently current/enabled site scope and reports augmentation disabled;
- candidate mode with site content disabled excludes only `clinical_kb_site` while retaining uploaded/Australian behavior;
- site content enabled with a missing/mismatched public static manifest or invalid public release fails closed for the site lane and cannot hit a stale cache;
- a valid pending site update changes only its eligible cache namespaces immediately, excludes affected same-partition logical records, and reports `site_content_updating` without suppressing unaffected records;
- candidate mode with adaptive answer disabled uses the legacy prompt/schema/composition contract even if Australian retrieval remains enabled;
- adaptive rendering requires both adaptive server flags and an adaptive-version final payload; disabling only the render flag restores the legacy answer surface without changing retrieval, generated evidence, or canonical server prose;
- no owner ID or salt appears in the decision, cache key, health response, or telemetry; and
- client environment exposes no cohort controls.

- [ ] **Step 2: Prove the helper and cache namespace are absent**

Run: `node scripts/run-vitest.mjs run tests/rag-rollout.test.ts tests/rag-cache-utils.test.ts tests/rag-cache-invalidation.test.ts tests/rag-shared-cache.test.ts`

Expected: FAIL for the missing helper/keys.

- [ ] **Step 3: Implement server-only deterministic selection**

Use HMAC-SHA256 over the owner ID and server salt, reduce to basis points, and discard the digest. Never persist the cohort input. A missing or malformed rollout configuration fails closed to legacy.

- [ ] **Step 4: Integrate shadow without changing the served path**

The single retrieval orchestrator may compute candidate retrieval/coverage diagnostics in shadow. It must:

- reuse the request access scope and deadline;
- make no second answer-generation provider call;
- write no candidate result into legacy caches;
- never alter legacy candidates, prompt, answer, citations, latency deadline, fallback, or response bytes; and
- swallow candidate failure into sanitized shadow diagnostics without changing the response.

- [ ] **Step 5: Integrate canary and the rollback surface**

Only `servedMode: "candidate"` enters new retrieval/composition contracts. Keep all component flags default-off until their own plans are green. Independent rollback order is: disable `RAG_ADAPTIVE_ANSWER_RENDER_ENABLED` for a display-only defect; disable `RAG_ADAPTIVE_ANSWER_ENABLED` for prompt/composition/schema defects; disable `RAG_SITE_CONTENT_ENABLED` for first-party synchronization/domain defects while preserving uploaded/Australian retrieval; disable `RAG_AUSTRALIAN_AUGMENTATION_ENABLED` for public-corpus defects while preserving uploaded/site candidate retrieval; set `RAG_PROGRAMME_MODE=legacy` for whole-programme rollback; then use the normal code/config revert. Health shows configured mode, all four server component flags, candidate percentage, public site-release freshness, augmentation health, and evaluated versions without exposing the salt or cohort identifiers.

- [ ] **Step 6: Run focused rollout checks**

Run:

```text
node scripts/run-vitest.mjs run tests/rag-rollout.test.ts tests/rag-cache-utils.test.ts tests/rag-cache-invalidation.test.ts tests/rag-shared-cache.test.ts tests/health-route.test.ts tests/answer-coalescing-metrics.test.ts
npm run check:production-readiness
```

Expected: PASS with default `legacy` and all component flags false; production readiness rejects unsafe canary configuration such as canary mode without salt, zero telemetry, no valid rollback owner, adaptive rendering without an enabled/matching adaptive answer contract, site content enabled without an expected/active public static-manifest match and valid public release or without administrator-only publication proof, or Australian augmentation enabled without an active source-policy version and health signal.

---

### Task 5: Build the paired comparator and default-branch canary

**Files:**

- Create: `scripts/eval-rag-programme-offline.ts`
- Create: `scripts/compare-rag-programme-eval.ts`
- Create: `tests/eval-rag-programme-offline.test.ts`
- Create: `tests/compare-rag-programme-eval.test.ts`
- Modify: `scripts/eval-rag.ts`
- Modify: `scripts/eval-rag-offline.mjs`
- Modify: `scripts/eval-answer-quality.ts`
- Modify: `scripts/blind-answer-pairs.ts`
- Modify: `package.json`
- Modify: `.github/workflows/eval-canary.yml`
- Modify: `tests/eval-answer-quality.test.ts`
- Modify: `tests/blind-answer-pairs.test.ts`
- Modify: `tests/eval-canary-workflow.test.ts`

**Interfaces:** Consumes programme cases, evaluator outcomes, telemetry/rollout mode, and exact evaluated Git SHA. Produces `runRagProgrammeEvaluation(input: RagProgrammeEvalInput): Promise<RagProgrammeEvalArtifact>`, `compareRagProgrammeRuns(baseline: RagProgrammeEvalArtifact, candidate: RagProgrammeEvalArtifact): RagProgrammeComparison`, and the exact offline artifact CLIs named below; blinded packs and the default-branch canary remain separate workflow outputs.

**Artifact contract:**

```ts
export type RagProgrammeEvalArtifact = {
  schemaVersion: 1;
  evaluatedGitSha: string;
  evaluationVariant: "legacy" | "candidate";
  caseSetFingerprint: string;
  populationFingerprint: string;
  sourcePolicyVersion: string;
  indexGeneration: string;
  siteContentRegistryVersion: string;
  publicSiteContentReleaseId: string | null;
  publicSiteContentStaticManifestDigest: string | null;
  publicSiteContentDynamicStateDigest: string | null;
  publicSiteContentReleaseDigest: string | null;
  publicSiteContentState: SiteContentPartitionState;
  publicSiteContentSnapshotFingerprint: string | null;
  promptVersion: string;
  rolloutMode: "legacy" | "shadow" | "canary";
  cases: RagProgrammeCaseResult[];
  aggregates: {
    documentRecall: number;
    contentRecall: number;
    falseInsufficiencyRate: number;
    supportedPartRetentionRate: number;
    p95TotalLatencyMs: number;
    estimatedCostUsd: number | null;
  };
};
```

- [ ] **Step 1: Write a fail-closed comparator matrix**

The test must reject:

- missing/different schema, evaluated Git SHA, case-set, population, site-registry, or public site release/manifest fingerprints;
- a baseline not labelled `legacy` or candidate not labelled `candidate`;
- duplicate/missing case IDs;
- any must-pass case with `passed !== true` or a non-empty `failedExpectations` array;
- document/content recall below `1.0`;
- any per-case document/content reciprocal-rank regression;
- any hard violation or dirty existing answer-quality gate;
- a supported must-pass case that still falsely refuses;
- supported-part retention below `1.0`;
- p95 beyond both the existing route/eval budget and `1.10×` baseline; or
- estimated cost above `1.15×` baseline when both artifacts contain cost evidence.

The target false-insufficiency slice must strictly improve unless the baseline is already zero, in which case it must remain zero.

Before comparing adaptive v20, add a discriminating evaluator test that derives the legal maximum from the shared answer-contract character/section limits. The current 900-word value was derived from six-section v19 and the HANDOVER’s 220-word statement is stale. A legal eight-section candidate must not fail readability solely for exceeding either historical number; fragmentation, duplication, targeting, and unsupported expansion remain independently detectable. Roll the evaluation-config fingerprint when this contract changes.

- [ ] **Step 2: Implement deterministic JSON output and comparison**

Add package scripts:

```json
{
  "eval:rag:programme:offline": "node scripts/run-tsx.mjs scripts/eval-rag-programme-offline.ts",
  "eval:rag:programme": "node scripts/run-eval-safe.mjs scripts/eval-rag.ts --programme-cases",
  "eval:rag:programme:compare": "node scripts/run-tsx.mjs scripts/compare-rag-programme-eval.ts"
}
```

`scripts/eval-rag-programme-offline.ts` is an artifact-producing CLI, not a Vitest wrapper. It requires `--variant legacy|candidate` and a repository-local output path supplied through `--out`, executes the committed synthetic programme cases through the selected offline contract, writes one `RagProgrammeEvalArtifact` atomically, and refuses an existing output unless `--replace` is explicitly supplied. Its test proves the file exists, parses, contains the exact evaluated case set once, records the current Git SHA and variant, and fails closed on an unknown variant, duplicate case ID, missing case result, or unwritable output. `scripts/eval-rag-offline.mjs` remains the existing test wrapper and is not overloaded with artifact flags.

Do not add `--ignore-regression`, `--skip-hard-gates`, or another bypass. A planned threshold change edits and reviews `RagProgrammeGatePolicy`.

- [ ] **Step 3: Run the complete offline envelope**

Run:

```text
node scripts/run-vitest.mjs run tests/rag-programme-eval.test.ts tests/eval-rag-programme-offline.test.ts tests/compare-rag-programme-eval.test.ts tests/rag-eval-cases.test.ts tests/rag-eval-source-governance.test.ts
npm run check:rag:fixtures
npm run check:rag:adversarial-fixtures
npm run eval:rag:offline
npm run eval:rag:adversarial:offline
npm run eval:rag:programme:offline -- --variant legacy --out .local/rag-programme/baseline.json
npm run eval:rag:programme:offline -- --variant candidate --out .local/rag-programme/candidate.json
npm run eval:rag:programme:compare -- --baseline .local/rag-programme/baseline.json --candidate .local/rag-programme/candidate.json --out .local/rag-programme/comparison.json --fail-on-regression
npm run check:production-readiness
```

Expected: PASS; the two artifact files contain identical case-set/population fingerprints, distinct explicit variants, and the comparator returns `GO`. These are offline/source-only results, not provider or production proof.

- [ ] **Step 4: Extend the existing canary without weakening its trust boundary**

Add optional `github.event.client_payload.rag_programme_eval == 'true'`. The workflow still:

- loads only from the default branch through `repository_dispatch` or schedule;
- accepts no ref/SHA checkout input;
- records `EVAL_GIT_SHA` from the actual checkout;
- guards the Supabase project identity;
- captures baseline/candidate artifacts even when a gate fails; and
- opens/updates the existing canary failure issue rather than creating a second alert system.

Do not upload raw production query/answer text. Programme artifacts contain fixture questions only, governed source identifiers/titles already permitted by the existing eval artifact contract, counts, hashes, and sanitized verdicts.

- [ ] **Step 5: Verify workflow and comparator syntax offline**

Run:

```text
node scripts/run-vitest.mjs run tests/compare-rag-programme-eval.test.ts tests/eval-canary-workflow.test.ts
npm run check:github-actions
```

Expected: PASS; repository dispatch remains default-branch-only and the evaluated SHA is mandatory.

- [ ] **Step 6: Prepare one blinded v19-versus-v20 usefulness comparison**

Reuse the merged Gate E workflow from `docs/rag-improvement/HANDOVER.md` §2a. The before capture is current prompt v19 and the after capture is candidate v20. Both use the identical 30 fixed cases; the historical run added no live questions. Any new owner-approved extra questions require fresh provider approval and must be supplied identically to both halves. Build the reading pack with `scripts/blind-answer-pairs.ts`; the reader opens only `reading-pack.md` and records every verdict before unblinding. Store dumps/keys under ignored local output only, never CI artifacts or telemetry. Record the closed historical v18-versus-v19 result separately and do not re-run it; only the v19-versus-v20 comparison is pending for this programme and it cannot be called passed while unrun.

The capture is paid/provider-backed and requires explicit approval. The offline pairing/unblinding steps may run after approved dumps exist. Promotion requires no human usefulness regression, no must-pass failure, and the automated comparator gates.

- [ ] **Step 7: Keep provider execution as a separately authorized gate**

After the candidate code is merged to the default branch and only with explicit GitHub/provider approval:

```text
gh api repos/BigSimmo/Database/dispatches -f event_type=eval-canary -f 'client_payload[rag_programme_eval]=true'
npm run eval:rag:programme:compare -- --baseline rag-programme-baseline.json --candidate rag-programme-candidate.json --out rag-programme-comparison.json --fail-on-regression
```

The default-branch workflow runs the same case set twice at the same `EVAL_GIT_SHA`: once with `RAG_PROGRAMME_MODE=legacy` into `rag-programme-baseline.json`, then with the reviewed candidate flags into `rag-programme-candidate.json`, before comparing those exact filenames. The dispatch has no branch/ref input. A green hosted run proves only the exact recorded default-branch SHA, corpus fingerprint, source-policy version, site registry/release/manifest, prompt version, and index generation.

---

### Task 6: Finalize SLOs, runbook, programme ownership, and production gates

**Files:**

- Modify: `docs/rag-upgrade-rollout-runbook.md`
- Modify: `src/lib/observability/answer-slo.ts`
- Modify: `src/lib/health-response.ts`
- Modify: `tests/answer-slo.test.ts`
- Modify: `tests/health-route.test.ts`
- Modify: `docs/observability-slos.md`
- Modify: `docs/launch-operator-runbook.md`
- Modify: `docs/search-rag-master-plan.md`
- Modify: `docs/search-rag-master-context.md`
- Modify: `docs/rag-improvement/HANDOVER.md`
- Modify: `docs/verified-answer-incremental-delivery-design.md`
- Inspect: `docs/outstanding-issues.md`

**Interfaces:** Consumes all accepted programme metrics, rollout/cache owner, comparison artifacts, and phase receipts. Produces `buildAnswerSloSnapshot(input: AnswerSloInput): AnswerSloSnapshot` and `buildRagHealthResponse(input: RagHealthInput): AuthenticatedRagHealthResponse` plus the canonical final operator runbook and stop/promotion criteria.

- [ ] **Step 1: Add actionable aggregate signals**

Extend the authenticated deep-health/SLO snapshot with:

- Australian augmentation eligible/requested/used/unavailable counts and rates;
- first-party public site-content current/updating/stale/unavailable/disabled counts, bounded selected-domain counts, anonymous/authenticated parity failures, non-admin mutation denials, and public static-manifest-match rate;
- typed insufficiency and generation-fallback counts/rates;
- verified-unit emitted/discarded counts;
- reconciliation mismatch count/rate;
- active rollout mode and programme versions; and
- canary-vs-legacy deltas only when the minimum sample threshold is met.

Keep existing hybrid-RPC, timeout, truncation, cache, coalescing, and spend signals. Do not turn missing samples into healthy zeroes.

- [ ] **Step 2: Pin the initial alert recommendations**

| Signal                                                                                                                 | Warn                                 | Page/stop                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Access, Healthdirect, link-only, role, citation, numeric, prompt-injection, conflict-contract, or governance violation | Not applicable                       | Any event: stop canary and investigate              |
| Incremental reconciliation mismatch                                                                                    | Not applicable                       | Any event: disable incremental units/candidate mode |
| Site manifest mismatch, stale projection served, or site-authority escalation                                          | Not applicable                       | Any event: disable site content/candidate mode      |
| Site synchronization unavailable, at least 20 eligible requests                                                        | `>2%` over 15 min                    | `>10%` over 15 min; disable site lane               |
| Administrator publication-to-RAG activation lag                                                                        | `>5 min` for any published item      | `>10 min` or failed item; stop/rollback site update |
| Australian augmentation unavailable, at least 20 eligible requests                                                     | `>2%` over 15 min                    | `>10%` over 15 min; degrade to uploaded/site        |
| Candidate fallback/insufficiency delta, at least 20 candidate requests                                                 | `>5` percentage points above legacy  | `>10` points; revert to legacy                      |
| Candidate p95 latency                                                                                                  | `>1.10×` legacy or existing warn SLO | Existing page SLO/route budget breached; revert     |
| Candidate cost                                                                                                         | `>1.15×` paired baseline             | Budget owner threshold breached; stop expansion     |

The runbook must name the accountable RAG owner and the actual monitored incident channel before any live canary. Recommendation: use the existing project incident channel and one named RAG on-call owner, not a new programme-specific inbox. If neither exists, production canary is blocked rather than silently unowned.

- [ ] **Step 3: Write the exact rollout and rollback sequence**

The runbook separates:

1. offline code/fixture readiness;
2. hosted schema/source/recovery readiness;
3. approved baseline artifact on the exact active corpus;
4. source/audit and first-party site-manifest shadow work;
5. `legacy` deployment with flags off;
6. retrieval-only shadow with byte-identical served answers;
7. deterministic candidate canary;
8. adaptive display and verified-unit flags independently;
9. wider promotion only after the sample/alert window; and
10. rollback: disable the implicated client flag, server feature, site-content lane, candidate mode, Australian augmentation, public site release, or active index generation independently.

Include these hard stops:

- PITR/recovery or Storage recovery evidence absent before live re-index;
- source/link licence or activation evidence missing;
- expected/deployed versus active public static manifest differs, the required public release is invalid, anonymous/authenticated candidates differ, a registered domain is silently omitted, a non-admin mutation succeeds, or a stale projection remains eligible;
- baseline/candidate population mismatch;
- hard violation or must-pass case failure;
- no accountable alert owner/channel;
- rollback pointer/previous generation not proven;
- provider or hosted approval absent; or
- any unreconciled emitted semantic unit.

- [ ] **Step 4: Correct stale operating instructions**

- `docs/observability-slos.md` and `docs/launch-operator-runbook.md`: replace `workflow_dispatch` claims with the current `repository_dispatch`/default-branch contract.
- `docs/search-rag-master-plan.md` / context: label the old rejection of conservative source-backed fallback and historical 12-second timeout as superseded; use repository Playwright wrappers rather than direct Playwright commands.
- `docs/rag-improvement/HANDOVER.md`: reconcile the stale S2 statement that still names a 220-word readability ceiling with the current source-derived v19 limit, then record the v20 shape-aware metric/version without rewriting historical result values.
- `docs/verified-answer-incremental-delivery-design.md` and issue `#100`: preserve the verified Phase 0 and flag-gated evidence-preview client/server history, then record the exact status reached by the incremental-delivery plan at the evaluated SHA. Do not keep the pre-programme “verified lead/section generation remains unimplemented” wording after that work has landed, and do not claim activation or provider/canary proof that has not occurred.

- [ ] **Step 5: Queue programme and decision ownership through supported issue tooling**

Never hand-edit `docs/outstanding-issues.md`. During implementation, queue one programme row referencing the spec and all eight plans:

```text
npm run issues:add -- --pri P1 --type RAG --summary "Deliver governed repository-wide RAG answer-quality programme" --detail "Implement the eight ordered plans, preserve uploaded-guideline priority, synchronize approved Clinical KB site content, and close offline/hosted/provider gates separately." --source "docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md; docs/superpowers/specs/2026-08-21-trusted-admin-document-ingestion-design.md"
```

Create separate decision rows only when still unresolved at that point:

- source-role taxonomy and trusted input owner;
- uploaded-priority versus relevance/conflict boundary;
- telemetry-table ownership and privacy-safe interaction join;
- production canary owner, alert channel, and enablement approval.

Update existing `#231`, `#2AB2NJ`, `#001`, `#018`, and `#100` only where the delivered evidence genuinely changes their status. Invoke `npm run issues:update` separately for each changed issue with its literal ID plus a phase-report-derived `--detail` and `--source`; never duplicate or prematurely close residual scope and never invent evidence in advance of execution.

- [ ] **Step 6: Run the final offline/domain handoff gates**

Run, once the complete cross-plan diff exists:

```text
npm run verify:pr-local -- --dry-run
npm run verify:pr-local
npm run check:rag:fixtures
npm run check:rag:adversarial-fixtures
npm run eval:rag:offline
npm run eval:rag:adversarial:offline
npm run eval:rag:programme:offline -- --variant legacy --out .local/rag-programme/final-baseline.json
npm run eval:rag:programme:offline -- --variant candidate --out .local/rag-programme/final-candidate.json
npm run eval:rag:programme:compare -- --baseline .local/rag-programme/final-baseline.json --candidate .local/rag-programme/final-candidate.json --out .local/rag-programme/final-comparison.json --fail-on-regression
npm run check:production-readiness
```

For source-governance, migration, retrieval/RPC, clinical output, or UI files, include the additional domain checks selected by their respective plans. Run `npm run format` and commit the result before any separately authorized push.

Before each selected expensive gate, quote the matching literal arbiter command from the global constraints above. When a content-addressed gate receipt is reused, report the command as “reused receipt” with the timestamp emitted by that receipt and preserve its decisive output. A `DEFER` is “deferred to CI,” not passed; a `PROVEN` verdict names the exact SHA. Use `GATE_RECEIPTS=refresh` only when fresh evidence is itself required; do not rerun unchanged gates by habit.

Provider-backed evals, live Supabase/recovery/drift checks, migrations, source acquisition/activation, re-index staging/promotion, GitHub dispatch, deployment, production flag changes, and live alert verification remain explicitly unrun until each is authorized and its exact target is confirmed.

---
