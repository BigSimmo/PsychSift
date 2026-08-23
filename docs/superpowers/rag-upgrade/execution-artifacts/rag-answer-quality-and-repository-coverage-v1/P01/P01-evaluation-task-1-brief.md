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

