# RAG query planning, combined retrieval, and fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use one implementer at a time and obtain a task-reviewer verdict on specification compliance and code quality before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false “not enough information” answers by decomposing only genuinely broad questions, searching shared uploaded guidance, current approved public Clinical KB site domains, and approved Australian corpora under one bounded plan, measuring support per subquestion, and returning typed, useful partial/fallback outcomes.

**Architecture:** Extend the existing `ClinicalQueryAnalysis`, retrieval variants, access-safe RPCs, registry projections, relevance comparators, Australian context selector, route budgets, and source-backed fallbacks. A pure `RagQueryPlan` introduces bounded subquestion identity and deterministic site-domain hints without a second classifier call. New v3 retrieval RPCs apply the canonical `SourceCorpusScope`, exact public site release/change epoch, pending-record exclusion, and optional site-domain filter. Answer retrieval uses one public call containing active shared `uploaded_local`, public `clinical_kb_site`, and Australian content for anonymous and authenticated users alike; legacy owner-private/staging documents remain ineligible. International-supplementary remains a separate conditional phase after an explicit coverage gap. An `AnswerCoveragePlan` records direct/partial/conflicting/absent support per subquestion. A central typed fallback taxonomy is additive to the existing `routingReason` until all consumers migrate.

**Tech Stack:** TypeScript 6 strict, Supabase/PostgreSQL retrieval RPCs as currently versioned, Vitest. No new model call is introduced for decomposition.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Dependencies:**

1. Land the metric/evaluation contracts in [`2026-08-20-rag-evaluation-rollout.md`](2026-08-20-rag-evaluation-rollout.md) Tasks 1–2 before serving candidate behaviour.
2. Land the source metadata, eligibility, and activation contracts in [`2026-08-20-rag-australian-source-governance.md`](2026-08-20-rag-australian-source-governance.md) Tasks 1–4 before corpus-scoped candidate retrieval and role-constrained merging.
3. Land Tasks 1–5 of [`2026-08-21-rag-repository-content-sync.md`](2026-08-21-rag-repository-content-sync.md) before Task 3 here so current registry projections are classified, partition-release-bound, snapshot-safe, and cache-isolated rather than rejected by the v3 scope filter.
4. This plan produces `AnswerCoveragePlan`, consumed by the adaptive-answer plan.

**Effort:** Plan/review `xhigh`; Tasks 1–5 build `high`; Task 6 typed-reason build `medium-high` with high timeout integration; Tasks 7–8 build/review `high`. Use the most capable coding model with high reasoning for query/corpus/access/coverage/context-packing/generation integration. Final review uses xhigh.

**Current-main reconciliation (2026-08-22):** retrieval still uses the legacy owner-plus-public scope, bounded query variants, optional registry projections, and source-backed fallbacks. Public site release/domain/coverage contracts do not exist. Existing Track A routing, v19 prompt/composition, truncation recovery, and S3 follow-ups are protected baseline behavior. The accepted Gate E diagnosis in `docs/rag-improvement/231-diagnosis-2026-08-22.md` measured retrieval at 955 ms text/6,720 ms hybrid and falsified retrieval starvation as the current timeout cause. Remaining timeouts split into response-bearing quality-retry exhaustion and zero-response initial-attempt failures; Task 7 must instrument and preserve that distinction before changing behaviour. `src/lib/rag/rag.ts` is at its enforced 4,362-line no-growth ceiling.

## Global Constraints

- Reuse `analyzeClinicalQuery`; do not build a second intent classifier or add a decomposition provider request.
- Always search the original query. Decomposition is additional and bounded.
- Simple definition, single-dose, single-threshold, document lookup, and unsupported-short-circuit queries create no extra subqueries.
- Keep the existing maximum of four retrieval query variants and three text-RPC variants across the request until evaluation proves a safe change. Subquestions share the budget; they do not multiply it per corpus.
- Resolve the fixed public Answer access scope once. Never interpolate the authenticated user/editor ID into site-content retrieval or accept a null-owner sentinel as authorization.
- Use the source-governance plan's canonical `SourceCorpusScope`; do not create a second provenance vocabulary. Public access alone does not prove Australian scope.
- Search `uploaded_local`, current `clinical_kb_site`, and `australian_public` first. Search `international_supplementary` only after primary-lane coverage is absent/partial and record the gap decision.
- Site-domain hints share the existing retrieval budget. Do not create one full RPC fan-out per repository mode or perform answer-time crawling/embedding.
- Resolve one `RagContextSnapshot` before cache lookup and keep it immutable through final reconciliation. A new question resolves the newest public release/change epoch; a stale/mismatched release yields no site candidates, while an updating release may return only public records outside the exact pending set.
- Gate the first-party lane through default-off `RAG_SITE_CONTENT_ENABLED` and Australian/international lanes through default-off `RAG_AUSTRALIAN_AUGMENTATION_ENABLED`. Either can be disabled independently; never fall back to live web.
- Keep `src/lib/rag/rag.ts` at or below 4,362 lines. Query planning, coverage, fallback reasons, and corpus orchestration live in their named modules; integration into `rag.ts` must be thin wiring and must not raise the budget.
- Preserve the current v19 route/prompt/composition behavior byte-for-byte in `legacy` and `shadow`. This plan does not redo Track A or treat the closed historical Gate E no-harm result as evidence for or against the new v20 programme.
- Uploaded priority is a coverage/conflict policy, not a score bonus. Directly relevant public evidence may beat irrelevant uploaded material; a current directly relevant uploaded guideline remains local primary.
- Source-role filtering occurs before synthesis. It must not globally boost Australian authority metadata.
- Never expose administrator/user IDs, subquery text, query text, source content, provider exception text, or patient information in telemetry.
- Preserve conservative numeric, citation, governance, comparison, and prompt-injection gates.
- Keep current route deadlines, `maxRetries: 0`, retry reserve, and degraded-cache refusal until measured tests justify a separate change.
- No unrestricted answer-time web search.

---

## File Structure

| File                                                                      | Responsibility                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/rag/rag-query-plan.ts`                                           | **New.** Pure bounded decomposition over existing query analysis.                                            |
| `src/lib/rag/rag-context-snapshot.ts`                                     | **New.** Pins shared document/source/public-site identities for one request.                                 |
| `src/lib/types.ts`                                                        | Adds query-plan, canonical corpus scope on results, coverage, ambiguity, and typed insufficiency contracts.  |
| `src/lib/rag/rag-coverage.ts`                                             | **New.** Per-subquestion evidence coverage and clarification decision.                                       |
| `src/lib/rag/rag-fallback-reason.ts`                                      | **New.** Stable sanitized fallback taxonomy and legacy mapping.                                              |
| `src/lib/rag/rag-contracts.ts`                                            | Query-plan/corpus/coverage telemetry fields and orchestration args.                                          |
| `src/lib/rag/rag-candidate-sources.ts`                                    | Explicit uploaded/site/Australian/conditional-international retrieval lanes and scope validation.            |
| `src/lib/rag/rag-context-selection.ts`                                    | Coverage-aware, relevance-first corpus merge.                                                                |
| `src/lib/australian-source-priority.ts`                                   | Extends existing within-band context policy; no authority score boost.                                       |
| `src/lib/rag/rag-cache.ts`                                                | Query-plan/corpus-policy version isolation.                                                                  |
| `src/lib/rag/rag.ts`                                                      | Single orchestration owner and answer coverage handoff.                                                      |
| `supabase/migrations/20260820122000_add_corpus_scoped_retrieval_v3.sql`   | **New.** Public Answer text/hybrid/vector RPC v3 corpus filters, private-row exclusion, and canonical scope. |
| `src/lib/supabase/database.types.ts`                                      | Regenerated v3 RPC signatures after the reviewed migration.                                                  |
| `src/lib/rag/rag-provider.ts`                                             | Maps provider failures into central taxonomy.                                                                |
| `src/lib/rag/rag-answer-support.ts`                                       | Replaces regex-first fallback interpretation with typed-first compatibility.                                 |
| `src/components/ui/answer-state.ts`                                       | Distinct public states for exact gap/degradation categories.                                                 |
| `tests/rag-query-plan.test.ts`                                            | **New.** Decomposition bounds and determinism.                                                               |
| `tests/rag-coverage.test.ts`                                              | **New.** Supported-part/ambiguity/gap decisions.                                                             |
| `tests/rag-governed-corpus-retrieval.test.ts`                             | **New.** Owner A/B/site/public isolation and merge policy.                                                   |
| `tests/rag-site-content-retrieval.test.ts`                                | **New.** Domain routing, site-release freshness, lineage, and uploaded-priority matrix.                      |
| `tests/rag-fallback-reason.test.ts`                                       | **New.** Stable sanitized reason mapping.                                                                    |
| Existing owner, routing, cache, latency, fallback, and answer-state tests | Protected regression suite listed task-by-task below.                                                        |

---

## Completion Evidence

Report separately:

- query-plan and coverage unit proof;
- anonymous/authenticated public parity, administrator-only publication, private-row exclusion, and exact public-release proof;
- direct and cross-domain specifier/differential/medication retrieval proof;
- claim-oriented context-pack proof for population/rule/exception/action/units and structured tables within the route budget;
- protected relevance/recall proof;
- timeout/fallback invariant proof plus the healthy-retrieval generation-degradation target-slice result;
- offline fixture/adversarial evaluation results;
- production-readiness result;
- hosted/provider/live checks run or not run;
- rollout mode activated or not activated;
- files/commits/push/deploy status; and
- approval-gated provider comparison status. The programme cannot claim the reported brief/source-only symptom resolved while healthy-retrieval generation degradation remains above its accepted threshold; if provider evidence is unrun, report code-ready/source-only rather than complete.

---

### Task 1: Define query-plan, coverage, and fallback contracts

**Files:**

- Modify: `src/lib/types.ts`
- Create: `src/lib/rag/rag-query-plan.ts`
- Create: `src/lib/rag/rag-coverage.ts`
- Create: `src/lib/rag/rag-fallback-reason.ts`
- Create: `tests/rag-query-plan.test.ts`
- Create: `tests/rag-coverage.test.ts`
- Create: `tests/rag-fallback-reason.test.ts`

**Interfaces:**

Consumes normalized question/query class/intent, material ambiguity signals, and canonical site/source vocabularies. Produces bounded `RagQueryPlan`, `ClinicalAmbiguity`, `AnswerCoveragePlan`, and server-only result scope fields below.

```ts
export type RagSubquestion = {
  id: string;
  question: string; // request-local only; never persisted in telemetry
  purpose: RagSubquestionPurpose;
  required: boolean;
};

export type RagQueryPlan = {
  version: "rag-query-plan-v1";
  kind: RagQueryPlanKind;
  originalQuery: string;
  interpretation: string;
  subquestions: RagSubquestion[];
  targetSiteDomains: SiteContentDomain[];
  siteDomainDecision: "explicit" | "inferred" | "none";
  reasonCodes: string[];
};

export type ClinicalAmbiguity = {
  material: boolean;
  dimensions: Array<"population" | "setting" | "medicine" | "document" | "jurisdiction" | "decision">;
  clarificationQuestion: string;
};

export type SubquestionCoverage = {
  subquestionId: string;
  status: "direct" | "partial" | "conflicting" | "absent";
  chunkIds: string[];
  reasonCodes: string[];
};

// Reuse canonical RagSubquestionPurpose and RagInsufficiencyReason from
// evaluation Task 1; this plan adds behaviour, not parallel enums.

export type AnswerCoveragePlan = {
  interpretation: string;
  ambiguity: ClinicalAmbiguity | null;
  subquestions: Array<{ id: string; question: string; required: boolean }>;
  coverage: SubquestionCoverage[];
  conflicts: SourcePolicyConflict[];
  overall: "complete" | "partial" | "conflicting" | "absent";
  insufficiencyReason: RagInsufficiencyReason | null;
};
```

Reuse `SourceCorpusScope` and `SiteContentDomain` from evaluation Task 1. `SearchResult` gains optional server-side `corpus_scope: SourceCorpusScope` and `site_content_domain: SiteContentDomain | null`; retrieval rejects an absent/unknown scope on candidate paths instead of guessing. Existing `registry_record` projections must first be migrated through the first-party site-content plan to `clinical_kb_site`; they must not be projected as `uploaded_local`. `trimSourceForClient` continues to exclude direct orchestration/release fields unless governed source metadata already permits a bounded corpus/domain label and user-facing route.

Fallback taxonomy:

```ts
export type RagFallbackReasonCode =
  | "provider_offline"
  | "provider_missing_key"
  | "provider_auth"
  | "provider_quota"
  | "provider_rate_limit"
  | "provider_timeout"
  | "provider_failure"
  | "retrieval_degraded"
  | "no_candidates"
  | "low_signal"
  | "coverage_gap"
  | "source_role_mismatch"
  | "source_conflict"
  | "source_governance_block"
  | "site_content_updating"
  | "site_content_stale"
  | "site_content_unavailable"
  | "citation_or_claim_gate"
  | "unsupported"
  | "unknown";
```

- [ ] **Step 1: Write the contract tests**

```ts
// tests/rag-query-plan.test.ts
it("keeps a simple threshold query single and always retains the original query", () => {
  const analysis = analyzeClinicalQuery("What ANC means withhold clozapine?");
  expect(buildRagQueryPlan("What ANC means withhold clozapine?", analysis)).toMatchObject({
    version: "rag-query-plan-v1",
    kind: "single",
    originalQuery: "What ANC means withhold clozapine?",
    subquestions: [{ id: "sq-1", purpose: "primary", required: true }],
  });
});

it("decomposes a broad management question deterministically within four subquestions", () => {
  const query = "How should this condition be managed, including treatment, monitoring and escalation?";
  const first = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  const second = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(first).toEqual(second);
  expect(first.kind).toBe("decomposed");
  expect(first.subquestions.length).toBeLessThanOrEqual(4);
  expect(first.subquestions.map((item) => item.purpose)).toEqual(["primary", "required_action", "monitoring", "risk"]);
});

it.each([
  ["ANC threshold in the clozapine monitoring guideline", "document"],
  ["clozapin withholding neutrophils", "medicine"],
  ["the section titled restarting after interruption", "document"],
  ["monitoring in adolescents in WA", "population"],
])("preserves query-understanding dimensions for %s", (query, expectedDimension) => {
  const plan = buildRagQueryPlan(query, analyzeClinicalQuery(query));
  expect(plan.originalQuery).toBe(query);
  expect(`${plan.interpretation} ${plan.reasonCodes.join(" ")}`).toMatch(new RegExp(expectedDimension, "i"));
});

it("asks one clarification only when population or jurisdiction changes retrieval", () => {
  const plan = buildRagQueryPlan(
    "What is the required observation period?",
    analyzeClinicalQuery("What is the required observation period?"),
  );
  expect(plan.kind).toBe("clarification_required");
  expect(plan.subquestions).toEqual([]);
});
```

```ts
// tests/rag-fallback-reason.test.ts
it("maps legacy/provider failures to stable public codes without internals", () => {
  expect(classifyRagFallbackReason({ providerFailure: "timeout" })).toBe("provider_timeout");
  expect(
    classifyRagFallbackReason({ routingReason: "hybrid_error; generation_fallback:socket ETIMEDOUT secret-host" }),
  ).toBe("provider_failure");
  expect(publicFallbackReason("provider_failure")).not.toMatch(/socket|host|secret/i);
});
```

- [ ] **Step 2: Run the new tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts tests/rag-fallback-reason.test.ts`

Expected: FAIL because the modules/types do not exist.

- [ ] **Step 3: Implement total pure builders**

`buildRagQueryPlan` consumes existing `ClinicalQueryAnalysis`. Comparison plans create primary plus two sides only when sides can be identified. Broad plans use the intent signals shown above and cap at four. Preserve acronym expansion, medicine aliases/common misspellings, exact document title/section lookup, population, and jurisdiction signals in deterministic reason codes; do not add another model call. Material ambiguity is deterministic and only set when multiple interpretations change retrieval; ordinary uncertainty becomes a stated interpretation.

`evaluateAnswerCoverage` reuses `evaluateEvidenceCoverageGate`, retrieval selection, source-role decisions, and directly cited chunk membership. It does not infer clinical support from metadata alone.

`classifyRagFallbackReason` gives typed fields precedence and uses legacy free-form parsing only as a compatibility fallback. Unknown text maps to `unknown`, never to a copied exception.

- [ ] **Step 4: Verify pure contracts**

Run: `node scripts/run-vitest.mjs run tests/rag-query-plan.test.ts tests/rag-coverage.test.ts tests/rag-fallback-reason.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Review and checkpoint**

Confirm query/subquestion strings appear in no telemetry builder. Format and conditionally commit:

```bash
npm run format
git add src/lib/types.ts src/lib/rag/rag-query-plan.ts src/lib/rag/rag-coverage.ts src/lib/rag/rag-fallback-reason.ts tests/rag-query-plan.test.ts tests/rag-coverage.test.ts tests/rag-fallback-reason.test.ts
git commit -m "feat(rag): define bounded query and coverage plans"
```

---

### Task 2: Integrate bounded decomposition in shadow mode

**Files:**

- Inspect: `src/lib/clinical-search.ts`
- Modify: `src/lib/rag/rag-retrieval-variants.ts`
- Modify: `src/lib/rag/rag-contracts.ts`
- Modify: `src/lib/rag/rag-cache.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `tests/clinical-search.test.ts`
- Modify: `tests/retrieval-query-variants.test.ts`
- Modify: `tests/rag-routing.test.ts`
- Modify: `tests/rag-classifier-memo.test.ts`

**Interfaces:** Consumes `query: string`, `analysis: ClinicalQueryAnalysis`, existing `aliases: RagAliasInput[]`, and the request-local shadow `plan: RagQueryPlan | undefined`. Produces `buildRetrievalQueryVariants(query, analysis, aliases = [], plan?): string[]` with at most four variants, plus `ragQueryPlanVersion: string` in search cache inputs and `ragCacheDependencyVersion: string`.

- [ ] **Step 1: Add failing budget/compatibility tests**

Assert:

- simple queries yield exactly the existing variants;
- explicit specifier, differential, and medication vocabulary sets the corresponding site-domain hint without a provider call;
- clinical pathway questions such as the duress procedure and when IM medication is used in agitation remain pathway/clinical questions rather than being converted into source-inventory document lookups;
- ambiguous queries keep the site-domain filter open instead of hiding potentially relevant records;
- a bounded cross-domain query may select multiple domains without multiplying the four-variant budget;
- broad/comparison plans include the original query and no more than four total variants;
- the classifier memo is still called at most as before;
- unsupported short-circuit still performs no provider/retrieval fanout;
- cache keys differ between plan versions but contain no raw subquery beyond the existing privacy-hashed storage path; and
- telemetry contains `query_plan_kind`, `subquestion_count`, and reason codes only.

- [ ] **Step 2: Run focused tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/clinical-search.test.ts tests/retrieval-query-variants.test.ts tests/rag-routing.test.ts tests/rag-classifier-memo.test.ts`

Expected: FAIL on absent query-plan integration.

- [ ] **Step 3: Compute candidate plan without serving it**

Build `RagQueryPlan` once after the existing analysis/classifier fallback. In `shadow` rollout mode, calculate candidate variants/coverage counters but return the legacy retrieval query/result. Shadow work must be abortable, bounded, excluded from legacy cache writes, and content-free in telemetry.

- [ ] **Step 4: Verify legacy identity in shadow**

Add a deterministic fixture asserting legacy and shadow returned `SearchResult` IDs/order are byte-identical while candidate counts appear only in telemetry.

Run the focused tests above. Expected: PASS.

- [ ] **Step 5: Review and checkpoint**

Format and conditionally commit:

```bash
npm run format
git add src/lib/clinical-search.ts src/lib/rag/rag-retrieval-variants.ts src/lib/rag/rag-contracts.ts src/lib/rag/rag-cache.ts src/lib/rag/rag.ts tests/clinical-search.test.ts tests/retrieval-query-variants.test.ts tests/rag-routing.test.ts tests/rag-classifier-memo.test.ts
git commit -m "feat(rag): shadow bounded query decomposition"
```

Omit any file that did not change.

---

### Task 3: Search shared uploaded, current first-party site, and public corpora under one explicit public scope

**Files:**

- Modify: `src/lib/owner-scope.ts`
- Modify: `src/lib/rag/rag-candidate-sources.ts`
- Modify: `src/lib/rag/rag-contracts.ts`
- Modify: `src/lib/rag/rag.ts`
- Create: `supabase/migrations/20260820122000_add_corpus_scoped_retrieval_v3.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `tests/rag-governed-corpus-retrieval.test.ts`
- Create: `tests/rag-site-content-retrieval.test.ts`
- Modify: `tests/owner-scope.test.ts`
- Modify: `tests/owner-scope-guard.test.ts`
- Modify: `tests/retrieval-access-scope.test.ts`
- Modify: `tests/retrieval-owner-filter-guard.test.ts`
- Modify: `tests/retrieval-hydration-scope.test.ts`
- Modify: `tests/search-round-trip-budget.test.ts`
- Modify: `tests/rag-tail-latency.test.ts`
- Modify: `tests/rag-abort-signal.test.ts`
- Modify: `tests/function-grants.test.ts`
- Modify: `tests/supabase-schema.test.ts`

**Interfaces:**

Consumes the request snapshot, active shared uploaded generations, public site release, enabled source components, and public-only access scope. Produces ordered primary/supplementary `retrievalCorpusScopes()` with anonymous/authenticated/administrator candidate parity and no owner partition.

```ts
export function retrievalCorpusScopes(): Array<{
  corpusScopes: SourceCorpusScope[];
  accessScope: RetrievalAccessScope;
  phase: "primary" | "supplementary";
}>;
```

The primary phase always returns public-only `{ includePublic: true }` + `[uploaded_local, clinical_kb_site, australian_public]`, bound to the active shared uploaded generations and public site release. Anonymous and authenticated users receive the same governed candidate population. `uploaded_local` and database-published `clinical_kb_site` are administrator/backend-admitted shared content only; ordinary users cannot upload or add site records, and owned document staging, legacy owner-private documents, drafts, and non-canonical editor rows never enter Answer retrieval. The site scope is included only when its request snapshot is valid and `RAG_SITE_CONTENT_ENABLED`. The Australian scope is included only when its independent component is enabled/current. The supplementary phase returns public-only + `international_supplementary` only after an explicit coverage-gap decision. Administrator/user IDs and site release/digest values never enter `SearchResult` or client payloads.

- [ ] **Step 1: Add the public-parity and private-row exclusion matrix**

```ts
// tests/rag-governed-corpus-retrieval.test.ts
it("searches shared uploaded, current site, and Australian scopes only through public access", async () => {
  const calls: Array<{ include_public: boolean; corpus_scopes: SourceCorpusScope[] }> = [];
  const results = await searchGovernedCorporaFixture({
    authenticatedUserId: USER_A,
    calls,
    australianCoverage: "direct",
  });
  expect(calls).toContainEqual({
    include_public: true,
    corpus_scopes: ["uploaded_local", "clinical_kb_site", "australian_public"],
  });
  expect(calls.some((call) => call.include_public === false)).toBe(false);
  expect(results.some((result) => result.document_id === LEGACY_PRIVATE_DOCUMENT)).toBe(false);
  expect(results.filter((result) => result.corpus_scope === "uploaded_local").length).toBeGreaterThan(0);
  expect(results.filter((result) => result.corpus_scope === "clinical_kb_site").length).toBeGreaterThan(0);
  expect(results.filter((result) => result.corpus_scope === "australian_public").length).toBeGreaterThan(0);
  expect(calls.some((call) => call.corpus_scopes.includes("international_supplementary"))).toBe(false);
});

it("keeps anonymous and authenticated site retrieval identical", async () => {
  const anonymous = await searchGovernedCorporaFixture({ authenticatedUserId: null });
  const authenticated = await searchGovernedCorporaFixture({ authenticatedUserId: USER_A });
  expect(authenticated.publicCandidateIds).toEqual(anonymous.publicCandidateIds);
  expect(authenticated.siteReleaseFingerprint).toBe(anonymous.siteReleaseFingerprint);
});

it("excludes only site scope when expected and active static-manifest digests differ", async () => {
  const result = await searchGovernedCorporaFixture({ authenticatedUserId: USER_A, siteManifestState: "stale" });
  expect(result.calls.filter((call) => call.include_public).flatMap((call) => call.corpus_scopes)).not.toContain(
    "clinical_kb_site",
  );
  expect(result.calls.filter((call) => call.include_public).flatMap((call) => call.corpus_scopes)).toContain(
    "uploaded_local",
  );
  expect(result.insufficiencyReason).toBe("site_content_stale");
});

it("never retrieves drafts, non-canonical editor rows, or legacy private documents", async () => {
  const result = await searchGovernedCorporaFixture({ authenticatedUserId: ADMIN_USER_ID });
  expect(result.results.some((candidate) => candidate.document_id === DRAFT_SITE_RECORD)).toBe(false);
  expect(result.results.some((candidate) => candidate.document_id === NON_CANONICAL_EDITOR_ROW)).toBe(false);
  expect(result.results.some((candidate) => candidate.document_id === LEGACY_PRIVATE_DOCUMENT)).toBe(false);
});

it("adds international public retrieval only after an explicit Australian coverage gap", async () => {
  const complete = await searchGovernedCorporaFixture({ authenticatedUserId: USER_A, australianCoverage: "direct" });
  expect(complete.calls.some((call) => call.corpus_scopes.includes("international_supplementary"))).toBe(false);
  const gap = await searchGovernedCorporaFixture({ authenticatedUserId: USER_A, australianCoverage: "absent" });
  expect(gap.calls.at(-1)).toMatchObject({ include_public: true, corpus_scopes: ["international_supplementary"] });
});
```

- [ ] **Step 2: Run access tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/rag-governed-corpus-retrieval.test.ts tests/rag-site-content-retrieval.test.ts tests/owner-scope.test.ts tests/owner-scope-guard.test.ts tests/retrieval-access-scope.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-hydration-scope.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts`

Expected: new test FAIL; existing owner-scope tests remain PASS.

- [ ] **Step 3: Add fail-closed corpus-scoped v3 RPCs**

Create service-role-only `match_document_chunks_text_v3`, `match_document_chunks_hybrid_v3`, and `match_document_chunks_v3` with the existing access arguments plus `corpus_scopes text[]`, exact active public site release, and optional `site_content_domains text[]`. Force the Answer call to public access; apply corpus scope, matching public release, domain filters, and a database-side anti-join against pending logical IDs before scoring/limit; return the stored canonical scope/domain; use fixed search paths; and preserve existing v2 grants/revocations. An `updating` snapshot may use the public site release only when its anti-join and transactional change epoch are exact; otherwise the site lane fails closed. Authenticated user/admin IDs cannot select an additional site population. Only the trusted-ingestion activation RPC may classify a document as shared `uploaded_local`; owner-private/staging documents with missing or historical scope are ineligible and require a separately reviewed reconciliation. `source_kind = registry_record` must instead be migrated to public-release-bound `clinical_kb_site`. Public or site rows with missing/unknown scope/release are ineligible for candidate mode until exact governance/synchronization classifies them.

Legacy mode continues to use v2 unchanged. Shadow/candidate mode requires v3 and fails that candidate lane closed if v3 is absent; it must never silently fall back to mixed v2 public results.

- [ ] **Step 4: Add one bounded governed-corpus orchestration seam**

At the current candidate-source functions, execute shared uploaded/current-site/Australian-public primary retrieval under the shared route abort signal and request budget. The original query runs against the public primary lane; remaining plan variants are allocated only to uncovered subquestions and never exceed the current overall caps. Each result must match the canonical scope/domain/release returned by its filtered call, then pass the existing row contract and public-scope hydration. Only a coverage gap may issue the separately budgeted international-supplementary lane.

Do not construct two independent full RAG pipelines. Do not add a user/admin-specific site retrieval call. Do not let a shadow candidate write legacy search caches.

- [ ] **Step 5: Prove round-trip and latency bounds**

Update `tests/search-round-trip-budget.test.ts` and `tests/rag-tail-latency.test.ts` with maximum call counts per route. Parallel corpus calls must not double variant count. Abort must cancel both.

Run: `node scripts/run-vitest.mjs run tests/rag-governed-corpus-retrieval.test.ts tests/rag-site-content-retrieval.test.ts tests/search-round-trip-budget.test.ts tests/rag-tail-latency.test.ts tests/rag-abort-signal.test.ts`

Expected: PASS.

Run: `npm run check:migration-role && npm run check:function-grants && npm run check:owner-scope`

Expected: PASS without applying or linking a hosted project.

- [ ] **Step 6: Review and checkpoint**

Have the task reviewer trace anonymous/authenticated parity, administrator/non-administrator publication boundaries, legacy private-row exclusion, explicit document IDs, document lookup fast path, text fast path, hybrid, vector fallback, and hydration. Format and conditionally commit:

```bash
npm run format
git add src/lib/owner-scope.ts src/lib/rag/rag-candidate-sources.ts src/lib/rag/rag-contracts.ts src/lib/rag/rag.ts supabase/migrations/20260820122000_add_corpus_scoped_retrieval_v3.sql src/lib/supabase/database.types.ts tests/rag-governed-corpus-retrieval.test.ts tests/rag-site-content-retrieval.test.ts tests/owner-scope.test.ts tests/owner-scope-guard.test.ts tests/retrieval-access-scope.test.ts tests/retrieval-owner-filter-guard.test.ts tests/retrieval-hydration-scope.test.ts tests/search-round-trip-budget.test.ts tests/rag-tail-latency.test.ts tests/rag-abort-signal.test.ts tests/function-grants.test.ts tests/supabase-schema.test.ts
git commit -m "feat(rag): orchestrate governed public retrieval"
```

---

### Task 4: Merge by relevance, role, local priority, and subquestion coverage

**Files:**

- Modify: `src/lib/rag/rag-coverage.ts`
- Modify: `src/lib/rag/rag-context-selection.ts`
- Modify: `src/lib/australian-source-priority.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `tests/rag-context-budget.test.ts`
- Modify: `tests/rag-eval-source-governance.test.ts`
- Modify: `tests/rag-comparison.test.ts`
- Modify: `tests/rag-governed-corpus-retrieval.test.ts`

**Interfaces:** Consumes eligible deduplicated candidates, source-role decisions, local-primary conflicts, and per-subquestion coverage. Produces `mergeEvidenceByCoverageAndSourceRole(input: CoverageMergeInput): CoverageEvidenceSelection[]`, where each selection records `subquestionId`, ordered eligible `SearchResult[]`, collapsed evidence-family IDs, selected `SourcePolicyConflict[]`, and an exact coverage reason without an authority-weight boost.

- [ ] **Step 1: Add the policy examples**

Test all of these:

1. directly relevant current uploaded guidance remains primary while Australian evidence fills an uncovered monitoring subquestion;
2. an explicit Clinical KB product/catalogue question may use the current matching site record as primary product evidence;
3. a site medication/differential/specifier summary cannot override a directly relevant uploaded guideline or count as independent corroboration when its lineage points to that guideline;
4. divergent legacy editor rows cannot enter retrieval until an administrator selects one canonical public publication, and duplicated text/lineage collapses to one evidence family;
5. irrelevant uploaded evidence does not outrank directly relevant Australian guidance;
6. a newer material conflict keeps valid local guidance primary, returns both sources, carries the canonical `SourcePolicyConflict` with both identities/dates/jurisdictions/roles/material-difference/local-primary decision, and emits its review target;
7. PBS/legal/link-only/service-directory/tool-reference sources cannot satisfy a treatment subquestion;
8. one absent subquestion yields `overall: "partial"`, preserves direct chunk IDs for supported subquestions, and creates an exact `not_in_corpus`, `site_content_updating`, `site_content_stale`, or `source_role_mismatch` reason;
9. sufficient current Australian evidence suppresses international supplementation, but uniquely relevant international evidence remains available when Australian coverage is absent;
10. all candidates in one eligible corpus retain their current relevance order;
11. disabling `RAG_SITE_CONTENT_ENABLED` removes site candidates without changing uploaded/Australian retrieval; and
12. disabling `RAG_AUSTRALIAN_AUGMENTATION_ENABLED` makes no Australian/international RPC, leaves uploaded/site retrieval unchanged, changes the candidate cache namespace, and reports the bounded disabled state.

- [ ] **Step 2: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/rag-governed-corpus-retrieval.test.ts tests/rag-site-content-retrieval.test.ts tests/rag-context-budget.test.ts tests/rag-eval-source-governance.test.ts tests/rag-comparison.test.ts tests/source-role-policy.test.ts`

Expected: FAIL on coverage-aware merge/current conflict behaviour.

- [ ] **Step 3: Implement eligibility then coverage then relevance**

The order is:

1. fixed public access, active shared uploaded-generation, and exact public site-release filtering;
2. content-mode/currentness/governance/source-role eligibility;
3. source-lineage collapse so derivative summaries do not double-count support;
4. canonical-public logical-entity resolution after administrator publication;
5. directness/relevance within each subquestion and product/domain intent;
6. local-primary conflict resolution for directly relevant current local guidance;
7. bounded document/domain/subquestion diversity; and
8. supplementary fallback only for remaining gaps.

Do not add administrator/user/Australian numeric score multipliers. Extend `selectModelContextResults` and the existing `selectAustralianClinicalContext` within-band contract.

The orchestrator consumes `RagProgrammeRolloutDecision.components.siteContent` and `.australianAugmentation`; it does not reread environment variables in lane helpers. This creates one testable rollback owner and prevents flag drift between text, hybrid, vector, document-lookup, hydration, cache, and health paths.

- [ ] **Step 4: Attach `AnswerCoveragePlan` to the RAG answer plan**

Build coverage after final context selection and before generation. Add it to the internal smart answer plan and the prompt’s interpreted-task block in a bounded line containing IDs/status/reason codes but no telemetry persistence of subquestion text. Attach the canonical request-local `SourcePolicyConflict[]` without re-deriving it; any conflict whose source/chunk IDs fail final access, lifecycle, or citation reconciliation is removed and cannot create a visible claim or review flag. The adaptive-answer plan consumes the full request-local object.

- [ ] **Step 5: Verify relevance and protected slices**

Run: `node scripts/run-vitest.mjs run tests/rag-governed-corpus-retrieval.test.ts tests/rag-site-content-retrieval.test.ts tests/rag-context-budget.test.ts tests/rag-eval-source-governance.test.ts tests/rag-comparison.test.ts tests/rag-score.test.ts`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS with public golden recall unchanged and the new public-parity/private-exclusion fixtures passing.

- [ ] **Step 6: Review and checkpoint**

Format and conditionally commit:

```bash
npm run format
git add src/lib/rag/rag-coverage.ts src/lib/rag/rag-context-selection.ts src/lib/australian-source-priority.ts src/lib/rag/rag.ts tests/rag-context-budget.test.ts tests/rag-eval-source-governance.test.ts tests/rag-comparison.test.ts tests/rag-governed-corpus-retrieval.test.ts
git commit -m "feat(rag): merge evidence by coverage and source role"
```

---

### Task 5: Pack claim-oriented context without losing rules, exceptions, tables, or units

**Files:**

- Create: `src/lib/rag/rag-context-pack.ts`
- Modify: `src/lib/rag/rag-context-selection.ts`
- Modify: `src/lib/rag/rag-source-block.ts`
- Modify: `src/lib/rag/rag.ts`
- Create: `tests/rag-context-pack.test.ts`
- Modify: `tests/rag-context-budget.test.ts`
- Modify: `tests/rag-claim-support.test.ts`
- Modify: `tests/table-fact-ranking.test.ts`

**Interfaces:** Consumes Task 4's eligible ranked candidates plus `AnswerCoveragePlan`. Produces `packClaimOrientedContext(input: { selections: CoverageEvidenceSelection[]; coverage: AnswerCoveragePlan; tokenBudget: number }): { groups: PackedEvidenceGroup[]; usedTokens: number; omittedOptionalGroupIds: string[] }`, where each group retains source/generation/access/role identity and may contain a rule, population, exception, action, units, structured-table row/header context, and bounded adjacent support.

- [ ] **Step 1: Add RED packing cases**

Add cases proving: a population-specific exception stays with its action; a dose/threshold keeps its units and qualifier; a table cell keeps the required row/column headers; same-generation adjacent context can join but cross-generation/private/role-ineligible context cannot; duplicate evidence families do not consume budget twice; broad questions allocate a bounded minimum per required subquestion; and the final pack never exceeds the route token ceiling.

- [ ] **Step 2: Implement deterministic claim groups and accounting**

Extend, do not merely rename, `packAdjacentSourceContext`. Build groups from structured index/table facts, heading/section adjacency, and verified source lineage. Keep rule + population + exception + action + units together when available, then allocate by required subquestion coverage before relevance-only fill. Apply access/currentness/role/generation gates before grouping. Truncation must use the existing number-safe boundary logic and may drop a whole optional group, never half of a numeric or exception-bearing claim.

- [ ] **Step 3: Prove context and verification parity**

Run: `node scripts/run-vitest.mjs run tests/rag-context-pack.test.ts tests/rag-context-budget.test.ts tests/rag-claim-support.test.ts tests/table-fact-ranking.test.ts tests/rag-governed-corpus-retrieval.test.ts`

Expected: PASS with the exception/table/numeric cases fitting within the existing route budget and no inaccessible or cross-generation context admitted.

- [ ] **Step 4: Review and checkpoint**

The reviewer must trace a broad case and a numeric exception case from retrieved candidates through packed groups to claim verification. Checkpoint only if task commits were explicitly authorized.

---

### Task 6: Expose exact fallback reasons and retain conservative timeout behaviour

**Files:**

- Modify: `src/lib/rag/rag-fallback-reason.ts`
- Modify: `src/lib/rag/rag-provider.ts`
- Modify: `src/lib/rag/rag-answer-support.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/answer-response.ts`
- Modify: `src/components/ui/answer-state.ts`
- Modify: `tests/rag-provider.test.ts`
- Modify: `tests/rag-answer-support.test.ts`
- Modify: `tests/answer-response.test.ts`
- Modify: `tests/answer-state-contract.test.ts`
- Modify: `tests/rag-route-budget.test.ts`
- Modify: `tests/rag-answer-fallback.test.ts`

**Interfaces:** `RagAnswer` gains optional `fallbackReasonCode: RagFallbackReasonCode | null`; `routingReason` remains for backward compatibility. Consumes retrieval/coverage/context and provider outcomes. Produces `fallbackReasonFromRouting(input: RagFallbackInput): RagFallbackReasonCode` and identical bounded API/SSE projection with no raw provider detail.

- [ ] **Step 1: Add typed-first compatibility tests**

Assert every provider failure, retrieval degradation, empty/low-signal/coverage gap, source governance/role/conflict, claim gate, unsupported, and unknown route maps deterministically. Assert API/SSE parity and no provider error detail. Existing answers without the new field still map through the legacy parser.

- [ ] **Step 2: Add timeout invariants before editing**

Pin current `OPENAI_ANSWER_TIMEOUT_MS = 30000`, extractive/fast/strong route budgets of 12/25/35 seconds, recovery reserve, `maxRetries: 0`, abort behaviour, source-backed fallback, and `answerRouteResultCanBeCached === false` for generation fallback. These are the baseline, not values to increase casually.

- [ ] **Step 3: Run focused tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/rag-provider.test.ts tests/rag-answer-support.test.ts tests/answer-response.test.ts tests/answer-state-contract.test.ts tests/rag-route-budget.test.ts tests/rag-answer-fallback.test.ts`

Expected: typed-field assertions FAIL; existing timeout invariants PASS.

- [ ] **Step 4: Integrate the central enum**

Set the typed reason at the point the condition is known. `fallbackReasonFromRouting` first returns the typed value and only parses legacy text for older cached answers. Map public UI states to useful phrases such as “The sources support part of this answer, but the active corpus does not cover [bounded gap]” or “Generation timed out; here is the verified source-backed portion.” Do not reveal infrastructure.

- [ ] **Step 5: Do not add blind retries**

Keep route deadlines and retry policy unchanged in this task. The evaluation plan will measure timeout by route/query class and test context/prompt/route alternatives in shadow. A later timeout change is eligible only if injected-abort tests prove no request starts after abort/deadline, at most one bounded recovery attempt occurs, p95 remains within the current ceiling, and citation/numeric/grounding metrics do not regress.

- [ ] **Step 6: Verify and checkpoint**

Run the focused test command from Step 3. Expected: PASS.

Run: `node scripts/run-vitest.mjs run tests/rag-tail-latency.test.ts tests/rag-abort-signal.test.ts tests/rag-offline-answer.test.ts tests/answer-slo.test.ts`

Expected: PASS.

Format and conditionally commit:

```bash
npm run format
git add src/lib/rag/rag-fallback-reason.ts src/lib/rag/rag-provider.ts src/lib/rag/rag-answer-support.ts src/lib/rag/rag.ts src/lib/types.ts src/lib/answer-response.ts src/components/ui/answer-state.ts tests/rag-provider.test.ts tests/rag-answer-support.test.ts tests/answer-response.test.ts tests/answer-state-contract.test.ts tests/rag-route-budget.test.ts tests/rag-answer-fallback.test.ts
git commit -m "feat(rag): expose typed fallback and gap reasons"
```

---

### Task 7: Diagnose and remediate healthy-retrieval generation degradation

**Files:**

- Inspect: `docs/rag-improvement/231-diagnosis-2026-08-22.md`
- Reuse: `src/lib/rag/rag-extractive-answer.ts`
- Reuse: `tests/rag-guidance-wrapper-quality-gate.test.ts`
- Create: `src/lib/rag/rag-generation-degradation.ts`
- Modify: `src/lib/rag/rag-provider.ts`
- Modify: `src/lib/rag/rag-route-budget.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/rag/rag-eval-diagnostics.ts`
- Create: `tests/rag-generation-degradation.test.ts`
- Modify: `tests/rag-provider.test.ts`
- Modify: `tests/rag-route-budget.test.ts`
- Modify: `tests/rag-answer-fallback.test.ts`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `tests/rag-eval-cases.test.ts`

**Interfaces:** Consumes a successful retrieval/coverage result, route deadline, ordered per-attempt provider response/latency outcome, quality-retry reason, prompt/schema/cache version, and packed-context diagnostics. Produces `RagGenerationDegradationReason` (`provider_initial_attempt_timeout`, `provider_quality_retry_exhausted`, `provider_incomplete_max_output_tokens`, `parse_failure_after_healthy_retrieval`, `verification_collapse_after_healthy_retrieval`) plus a content-free evidence-only comparison record for candidate admission/prompt/context/model-route/output-budget alternatives. The public fallback reason remains the coarser `provider_timeout` where appropriate.

- [ ] **Step 1: Reproduce the reported symptom deterministically**

Add offline cases where retrieval and `AnswerCoveragePlan` are healthy but generation times out, truncates, fails parsing, or collapses at verification and falls back to a brief source-only answer. Include both evidence-supported mechanisms from the accepted Gate E diagnosis: a response-bearing first attempt rejected for an allowlisted quality reason before timeout/exhaustion, and an initial attempt that returns no response. Assert exact classification, per-attempt content-free response/latency telemetry, useful supported fallback, preserved citations/numbers, abort propagation, and no retry after the route reserve is exhausted. Treat the current `rag-extractive-answer.ts` predicate hardening and `rag-guidance-wrapper-quality-gate.test.ts` as the reconciled baseline: verify and extend those owners rather than recreating their already-landed incoherent-shape rejection. Do not claim reachability until the provider/fallback path is proven to invoke the selected predicate.

- [ ] **Step 2: Add a shadow-only alternative comparator**

First add per-attempt response/latency and retry-admission telemetry so response-bearing retry-ladder exhaustion cannot be conflated with zero-response initial timeout. Then compare only bounded alternatives that preserve the same evidence and safety contract: deadline admission before a quality retry, prompt/context packing, suitable fast/strong route, output/reasoning budget, and existing single truncation self-heal. Do not add an unconditional retry, extra provider call, or longer production deadline. Record content-free outcome/latency/coverage enums and keep candidate cache identity isolated.

- [ ] **Step 3: Implement only the smallest measured fix**

Offline code may land behind the programme shadow flag. Implement only the measured mechanism: a deadline-admission change is eligible for the response-bearing quality-retry subset after the new telemetry proves it, while zero-response initial timeouts remain separately diagnosed and cannot be claimed fixed by retry admission. Preserve the current predicate hardening; any further predicate change requires new focused clinical-quality fixtures and proof that it fixes a still-reachable failure. Behaviour activation requires separately approved provider baseline/post evidence showing the chosen alternative reduces its exact target slice while keeping useful supported output, citation/numeric/role invariants, abort/deadline behavior, and p95 inside the existing route ceiling. If no alternative meets those gates, retain legacy behavior and leave this task operationally blocked rather than claiming the significant answer-quality issue fixed.

- [ ] **Step 4: Run the focused offline proof**

Run: `node scripts/run-vitest.mjs run tests/rag-generation-degradation.test.ts tests/rag-provider.test.ts tests/rag-route-budget.test.ts tests/rag-answer-fallback.test.ts tests/rag-eval-cases.test.ts tests/rag-guidance-wrapper-quality-gate.test.ts`

Expected: PASS/source-only. Provider comparison and the target-slice acceptance threshold remain explicitly unrun until authorized.

- [ ] **Step 5: Review and checkpoint**

The reviewer must reject blind retries, unbounded timeouts, changed evidence, weaker verification, or a claimed fix without the approval-gated comparison. Checkpoint only if task commits were explicitly authorized.

---

### Task 8: Cache isolation, privacy-safe telemetry, and domain handoff

**Files:**

- Modify: `src/lib/rag/rag-cache.ts`
- Modify: `src/lib/rag/rag-contracts.ts`
- Modify: `src/lib/rag/rag-eval-diagnostics.ts`
- Modify: `src/lib/answer-telemetry.ts`
- Modify: `tests/rag-cache-invalidation.test.ts`
- Modify: `tests/answer-telemetry.test.ts`
- Modify: `tests/rag-telemetry-canary-absence.test.ts`
- Modify: `tests/rag-eval-cases.test.ts`
- Modify: `docs/search-rag-master-plan.md`
- Modify: `docs/search-rag-master-context.md`

**Interfaces:** Consumes Tasks 1–7 query/coverage/context/fallback/generation contracts and the request snapshot. Produces `ragCacheFingerprint(input: RagCacheFingerprintInput): string` and `sanitizeRagEvalDiagnostics(input: RagEvalDiagnosticsInput): ContentFreeRagDiagnostics`, plus the offline evaluation handoff with no raw query/source/admin identifiers.

- [ ] **Step 1: Version every behaviour-affecting cache input**

Add query-plan version, corpus-policy version, source-policy version, site registry version, public release digest/epoch, and rollout mode to search/answer cache fingerprints. Site-backed candidates use the shared public cache only when every selected source is public. Shadow candidates never write legacy cache entries. Cached answers carry typed fallback/coverage/context-snapshot contracts or are invalidated by the dependency version.

- [ ] **Step 2: Add content-free diagnostics**

Record only plan kind/count, per-status coverage counts, public-site/Australian candidate and selected counts, bounded selected-site-domain enums, public release state, public static-manifest match, pending-count buckets, augmentation reason, role exclusion counts, typed fallback code, generation outcome, and recovery eligibility. Tests inject canary strings into original/subquery/answer/source/provider error fields, routes, lineage IDs, change epochs, administrator/user IDs, release/digest values, and manifest inputs and assert they appear in no logged row.

- [ ] **Step 3: Run privacy/cache tests**

Run: `node scripts/run-vitest.mjs run tests/rag-cache-invalidation.test.ts tests/answer-telemetry.test.ts tests/rag-telemetry-canary-absence.test.ts tests/rag-eval-cases.test.ts`

Expected: PASS.

- [ ] **Step 4: Reconcile stale RAG documentation**

Update historical statements that say stitched source-backed fallback is forbidden, cite a 12-second global timeout, prescribe direct Playwright, or describe current mixed-corpus retrieval as uploaded-first. Preserve historical evidence but label it superseded by current code and this approved design.

- [ ] **Step 5: Run offline domain gates**

Run: `npm run check:rag:fixtures`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS.

Run: `npm run eval:rag:adversarial:offline`

Expected: PASS.

Run: `npm run check:production-readiness`

Expected: PASS or an accurately classified environment/provider prerequisite.

Inspect the selected PR gate with `npm run verify:pr-local -- --dry-run`, which derives the exact phase diff from Git, then run the selected gate once when the complete workstream is ready for handoff.

- [ ] **Step 6: Stop before hosted proof**

Do not run live retrieval quality/latency, `eval:rag`, `eval:quality`, Supabase project checks, hosted workflow dispatch, migration, deployment, or feature activation without explicit approval. Hand those steps to the evaluation/rollout plan.

- [ ] **Step 7: Final review**

The SDD final reviewer traces every retrieval path, cache mode, public scope, corpus, site domain/release, subquestion status, typed fallback, and client state. Any private/draft site result, anonymous/authenticated mismatch, stale site projection, unbounded per-domain fanout, raw subquery telemetry, authority score boost, derivative double-counting, or degraded cache write blocks handoff.
