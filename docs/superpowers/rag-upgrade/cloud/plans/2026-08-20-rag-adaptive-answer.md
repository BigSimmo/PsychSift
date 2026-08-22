# Adaptive RAG answer and display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Dispatch one implementer at a time, then a task reviewer for specification compliance and code quality before continuing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the landed v19 moderate-length/related-information contract into evidence-gated adaptive answers, and remove the independent silent 85-word display cap so narrow questions stay concise, broad questions can be complete, and supported parts remain useful when another part is missing.

**Architecture:** A pure `AdaptiveAnswerPlan` is derived from query class, intent, simple-question detection, and the `AnswerCoveragePlan` produced by the retrieval plan. The same plan controls the generation prompt, schema/verification limits, deterministic fallback, and renderer. The server remains the authority: the browser displays all governed answer prose and sections without inventing, expanding, or clipping them.

**Tech Stack:** TypeScript 6 strict, Next.js 16, React 19, Vitest. This is a protected RAG behaviour change; provider-backed baseline/post canaries require separate explicit approval.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Dependencies:** Task 0 is a v19-compatible display correction and may land after its focused UI/clipboard proof without waiting for retrieval, synchronization, migrations, or v20. For Tasks 1–6, land [`2026-08-20-rag-evaluation-rollout.md`](2026-08-20-rag-evaluation-rollout.md) Task 1 so adaptive/false-insufficiency cases use the shared gate, implement the first-party context/freshness contracts in [`2026-08-21-rag-repository-content-sync.md`](2026-08-21-rag-repository-content-sync.md), then implement the public types from [`2026-08-20-rag-retrieval-composition.md`](2026-08-20-rag-retrieval-composition.md) Task 1. This plan consumes `AnswerCoveragePlan` and request snapshot metadata but does not own retrieval or synchronization.

**Effort:** Plan/review `high`; Task 0 build `medium-high`; Tasks 1–3 build `high` because they alter clinical answer contracts; Task 4 build `medium-high`; Tasks 5–6 build `high`. Use a frontier coding model with high reasoning for server behaviour and medium-high for the isolated renderer tasks.

**Current-main reconciliation (2026-08-22):** v19/schema v4, the related-information menu, six-section support, and S3 follow-up suggestions are existing baseline behaviour, not work in this plan. Gate E tooling is merged in PR #2208 and the historical v18-versus-v19 capture/owner blinded read is closed at v18 3, v19 3, tie 24, neither 0, with the recorded source-only/byte-identical caveats. Do not re-run that paid comparison without a fresh explicit provider request. `src/lib/rag/rag.ts` is at its enforced 4,362/4,362-line ceiling.

## Global Constraints

- Uploaded indexed guidelines remain primary when current, valid, accessible, and directly supportive.
- First-party site content may answer product/catalogue facts and add role-eligible context, but derivative summaries cannot silently become independent authority or override eligible uploaded guidance.
- Render only site sources from the request’s exact current public release snapshot; never expose internal repository paths, manifest/release digests, or administrator/user identifiers in answer prose/citations.
- Every clinical claim and every number must pass existing claim/citation verification. Adaptive length never permits unsupported expansion.
- The main answer is complete without relying on Safety findings, Clinical notes, or Evidence panels. Do not remove or weaken those independent controls.
- A narrow question stays narrow. “Adaptive” means evidence-appropriate, not always longer.
- Preserve independently supported lead/sections when another subquestion is unsupported; never turn one missing subtopic into a blanket refusal.
- Do not add eTG/AMH content. Link-only references cannot support a claim.
- Do not add unrestricted answer-time web search.
- `RAG_ADAPTIVE_ANSWER_ENABLED` and `RAG_ADAPTIVE_ANSWER_RENDER_ENABLED` are independent server-only, default-off rollback controls owned by the evaluation rollout contract. The first selects prompt/schema/composition; the second permits the final client payload to render a matching adaptive-version answer.
- Task 0 changes only the already-finalized v19 lead display and copy projection. It must not render v20-only sections, alter generation, or wait on a new answer-contract discriminator. If it cannot remain a lossless sanitation-only correction with exact clipboard parity, stop and fold it back into Task 4.
- Change `ragAnswerPromptVersion` whenever prompt/schema semantics change so response and provider prompt caches cannot serve mixed contracts.
- `src/lib/rag/rag.ts` cannot grow beyond 4,362 lines. Put policy, limits, coverage, and finalization in cohesive modules and keep `rag.ts` integration to thin wiring; never raise the maintainability budget.
- Reuse one exported answer-contract limits owner for the 1,600-character lead, 48-character heading, 600-character section body, and eight-section adaptive maximum. Schema validation, verified delivery, and evaluation must not carry independent numeric copies.
- Before editing Next.js/React code, read the relevant installed Next 16 guide under `node_modules/next/dist/docs/`.
- Run no provider-backed evaluation, live Supabase command, production mutation, deployment, commit, or push without the authorization required by repository policy.

---

## File Structure

| File                                                               | Responsibility                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `src/lib/rag/adaptive-answer-plan.ts`                              | **New.** Pure answer-shape policy derived from query and evidence coverage.                      |
| `src/lib/rag/rag-answer-contract-limits.ts`                        | **New.** Canonical lead/heading/body/section limits shared by schema, evaluation, and streaming. |
| `src/lib/types.ts`                                                 | Adds `AdaptiveAnswerPlan` and exposes it through `SmartRagAnswerPlan`.                           |
| `src/lib/rag/answer-composition.ts`                                | Builds the section menu from the adaptive plan, retaining the narrow-question rules.             |
| `src/lib/rag/rag-answer-instructions.ts`                           | Replaces hard global word targets with the adaptive contract.                                    |
| `src/lib/rag/rag.ts`                                               | Adds the plan to interpreted task/schema/fallback and preserves supported partial results.       |
| `src/lib/rag/rag-versioning.ts`                                    | Rolls prompt/cache version.                                                                      |
| `src/components/clinical-dashboard/answer-content.tsx`             | Removes silent fragment/word clipping while retaining sanitation.                                |
| `src/components/clinical-dashboard/answer-section-projector.ts`    | **New.** Resolves governed lead/section citations against final sources.                         |
| `src/components/clinical-dashboard/answer-inline-sections.tsx`     | **New.** Renders all supported sections in the main answer with compact citations.               |
| `src/components/clinical-dashboard/answer-result-surface.tsx`      | Includes lead citations and sections inside the primary answer card.                             |
| `src/components/clinical-dashboard/answer-thread-turn.tsx`         | Gives prior turns the same complete answer projection.                                           |
| `src/lib/answer-render-policy.ts`                                  | Ensures partial answers render their exact gap and clarification.                                |
| `tests/adaptive-answer-plan.test.ts`                               | **New.** Shape-policy matrix.                                                                    |
| `tests/answer-composition.test.ts`                                 | Menu contract uses adaptive shape and coverage.                                                  |
| `tests/rag-answer-composition-prompt.test.ts`                      | Prompt/schema/version pins.                                                                      |
| `tests/rag-answer-fallback.test.ts`                                | Supported-part retention and exact gap reasons.                                                  |
| `tests/answer-content.test.ts`                                     | Full governed answer reaches the display.                                                        |
| `tests/answer-inline-sections.dom.test.tsx`                        | **New.** Section order, citations, gaps, and main-surface completeness.                          |
| `tests/answer-thread-turn.dom.test.tsx`                            | **New.** Prior-turn parity.                                                                      |
| `tests/answer-render-policy.test.ts`                               | Partial/gap rendering contract.                                                                  |
| `src/lib/rag/rag-eval-cases.ts` and `tests/rag-eval-cases.test.ts` | Offline usefulness and false-insufficiency cases.                                                |

---

## Completion Evidence

Report separately:

- policy/unit tests;
- offline RAG fixture/evaluation results;
- production-readiness result and any environment gate;
- browser/UI checks run or not run;
- provider/live canary run or not run;
- the closed Gate E v18-versus-v19 baseline and the separate v19-versus-v20 capture/read status, without treating unrun v20 work as a pass;
- prompt/cache version changed;
- files changed;
- commit/push/deploy status; and
- residual risk: adaptive usefulness and latency are not production-proven until the approved canary and staged rollout complete.

---

### Task 0: Remove the v19 display-only clipping first

**Files:**

- Modify: `src/components/clinical-dashboard/answer-content.tsx`
- Modify: `tests/answer-content.test.ts`
- Modify: `src/components/clinical-dashboard/answer-copy-payload.ts`
- Modify: `tests/answer-copy-payload.test.ts`

**Interfaces:** Consumes the already-finalized v19 lead string. Produces `primaryAnswerDisplayText(value: string, options?: AnswerDisplayTextOptions): string` and `answerTextForClipboard(answer: RagAnswer): string` as one losslessly sanitized display/copy projection with exact screen/clipboard parity; it creates no v20 answer contract.

**Boundary:** This is deliberately independent of adaptive v20. `primaryAnswerDisplayText` becomes lossless sanitation only for the already-governed final lead: no clinical-usefulness filtering, fragment deduplication, three-fragment cap, 85-word budget, or generated ellipsis. It preserves the current sanitizer, synthetic-demo stripping, bold handling, preformatted path, and exact copy/screen parity. It does not render `answerSections`, change a prompt/schema/cache key, introduce a feature lane, or expose a preview.

- [ ] **Step 1: Pin the current regression**

Add a v19-shaped five-sentence finalized answer and prove the current helper drops or truncates it. Add negative cases for source-noise removal, synthetic-demo stripping, preformatted output, and unsafe markup so “lossless” cannot become “raw.”

- [ ] **Step 2: Implement sanitation without selection**

Delete only the fragment selection, usefulness, deduplication, count, word-budget, and ellipsis logic. Return the complete sanitized lead. Keep the canonical copy payload derived from the same finalized answer rather than scraping rendered DOM.

- [ ] **Step 3: Run the focused compatibility gate**

Run:

```text
node scripts/run-vitest.mjs run tests/answer-content.test.ts tests/answer-copy-payload.test.ts
```

Expected: PASS with full v19 lead text on screen and clipboard, unchanged sanitation, and no prompt/retrieval/provider change. Review this as a bounded display fix; do not wait for Tasks 1–6.

---

### Task 1: Define the adaptive answer policy

**Files:**

- Create: `src/lib/rag/adaptive-answer-plan.ts`
- Modify: `src/lib/types.ts`
- Create: `tests/adaptive-answer-plan.test.ts`

**Interfaces:**

```ts
// src/lib/types.ts
// Reuse AdaptiveAnswerShape from the evaluation contract; do not redefine it.
// Extend AnswerSectionKind with "source_conflict".

export type AdaptiveAnswerPlan = {
  shape: AdaptiveAnswerShape;
  leadSentenceRange: readonly [number, number];
  sectionRange: readonly [number, number];
  eligibleSectionKinds: AnswerSectionKind[];
  requireExactGap: boolean;
  requireConflictSection: boolean;
  clarificationQuestion: string | null;
};
```

Consumes `AnswerCoveragePlan`, `RagQueryClass`, `ClinicalQueryIntent`, and `simpleDirect`. Produces `buildAdaptiveAnswerPlan(args: { queryClass: RagQueryClass; intent: ClinicalQueryIntent; simpleDirect: boolean; coverage: AnswerCoveragePlan }): AdaptiveAnswerPlan` and adds `adaptiveAnswer: AdaptiveAnswerPlan` to `SmartRagAnswerPlan`.

- [ ] **Step 1: Write the failing policy matrix**

```ts
// tests/adaptive-answer-plan.test.ts
import { describe, expect, it } from "vitest";
import { buildAdaptiveAnswerPlan } from "@/lib/rag/adaptive-answer-plan";
import type { AnswerCoveragePlan } from "@/lib/types";

const complete = {
  interpretation: "adult clozapine monitoring",
  ambiguity: null,
  subquestions: [{ id: "sq-1", question: "What monitoring is required?", required: true }],
  coverage: [{ subquestionId: "sq-1", status: "direct", chunkIds: ["chunk-1"], reasonCodes: [] }],
  conflicts: [],
  overall: "complete",
  insufficiencyReason: null,
} satisfies AnswerCoveragePlan;

describe("adaptive answer plan", () => {
  it("keeps a simple direct fact narrow", () => {
    expect(
      buildAdaptiveAnswerPlan({
        queryClass: "table_threshold",
        intent: "drug_dosing",
        simpleDirect: true,
        coverage: complete,
      }),
    ).toMatchObject({ shape: "narrow", leadSentenceRange: [1, 3], sectionRange: [0, 1] });
  });

  it("permits a complete broad answer without a fixed word cap", () => {
    expect(
      buildAdaptiveAnswerPlan({
        queryClass: "broad_summary",
        intent: "protocol",
        simpleDirect: false,
        coverage: complete,
      }),
    ).toMatchObject({ shape: "comprehensive", leadSentenceRange: [2, 5], sectionRange: [3, 7] });
  });

  it("switches to a partial shape and carries the targeted clarification", () => {
    const partial: AnswerCoveragePlan = {
      ...complete,
      overall: "partial",
      insufficiencyReason: "not_in_corpus",
      ambiguity: {
        material: true,
        dimensions: ["population"],
        clarificationQuestion: "Is this for an adult or an adolescent?",
      },
      coverage: [
        { subquestionId: "sq-1", status: "partial", chunkIds: ["chunk-1"], reasonCodes: ["missing_population"] },
      ],
    };
    expect(
      buildAdaptiveAnswerPlan({
        queryClass: "broad_summary",
        intent: "protocol",
        simpleDirect: false,
        coverage: partial,
      }),
    ).toMatchObject({
      shape: "partial",
      requireExactGap: true,
      clarificationQuestion: "Is this for an adult or an adolescent?",
    });
  });

  it("keeps comparisons as a dependency-aware shape", () => {
    expect(
      buildAdaptiveAnswerPlan({
        queryClass: "comparison",
        intent: "comparison",
        simpleDirect: false,
        coverage: complete,
      }).shape,
    ).toBe("comparison");
  });

  it("requires a visible conflict section with the canonical conflict payload", () => {
    const conflicting: AnswerCoveragePlan = {
      ...complete,
      overall: "conflicting",
      insufficiencyReason: "source_conflict",
      coverage: [{ ...complete.coverage[0], status: "conflicting" }],
      conflicts: [sourcePolicyConflictFixture()],
    };
    expect(
      buildAdaptiveAnswerPlan({
        queryClass: "broad_summary",
        intent: "protocol",
        simpleDirect: false,
        coverage: conflicting,
      }),
    ).toMatchObject({
      shape: "partial",
      requireConflictSection: true,
      eligibleSectionKinds: expect.arrayContaining(["source_conflict"]),
    });
  });
});
```

- [ ] **Step 2: Prove the test fails for the missing module**

Run: `node scripts/run-vitest.mjs run tests/adaptive-answer-plan.test.ts`

Expected: FAIL because `@/lib/rag/adaptive-answer-plan` and the new types do not exist.

- [ ] **Step 3: Implement one exhaustive policy function**

```ts
// src/lib/rag/adaptive-answer-plan.ts
import type {
  AdaptiveAnswerPlan,
  AnswerCoveragePlan,
  AnswerSectionKind,
  ClinicalQueryIntent,
  RagQueryClass,
} from "@/lib/types";

const comprehensiveKinds: AnswerSectionKind[] = [
  "required_actions",
  "monitoring_timing",
  "medication_dose",
  "thresholds",
  "escalation_risk",
  "contraindications_cautions",
  "documentation",
];

export function buildAdaptiveAnswerPlan(args: {
  queryClass: RagQueryClass;
  intent: ClinicalQueryIntent;
  simpleDirect: boolean;
  coverage: AnswerCoveragePlan;
}): AdaptiveAnswerPlan {
  const conflicting = args.coverage.overall === "conflicting";
  const partial = args.coverage.overall === "partial" || conflicting;
  if (partial) {
    return {
      shape: "partial",
      leadSentenceRange: [1, 4],
      sectionRange: [1, 7],
      eligibleSectionKinds: [...comprehensiveKinds, "comparison", "source_gap", "source_conflict"],
      requireExactGap: true,
      requireConflictSection: conflicting,
      clarificationQuestion: args.coverage.ambiguity?.clarificationQuestion ?? null,
    };
  }
  if (args.simpleDirect) {
    return {
      shape: "narrow",
      leadSentenceRange: [1, 3],
      sectionRange: [0, 1],
      eligibleSectionKinds: ["thresholds", "medication_dose", "required_actions", "source_gap"],
      requireExactGap: false,
      requireConflictSection: false,
      clarificationQuestion: null,
    };
  }
  if (args.queryClass === "comparison") {
    return {
      shape: "comparison",
      leadSentenceRange: [2, 5],
      sectionRange: [2, 7],
      eligibleSectionKinds: ["comparison", "required_actions", "contraindications_cautions", "source_gap"],
      requireExactGap: false,
      requireConflictSection: false,
      clarificationQuestion: null,
    };
  }
  if (args.queryClass === "broad_summary" || args.intent === "protocol" || args.intent === "broad_summary") {
    return {
      shape: "comprehensive",
      leadSentenceRange: [2, 5],
      sectionRange: [3, 7],
      eligibleSectionKinds: comprehensiveKinds,
      requireExactGap: false,
      requireConflictSection: false,
      clarificationQuestion: null,
    };
  }
  return {
    shape: "focused",
    leadSentenceRange: [2, 5],
    sectionRange: [1, 3],
    eligibleSectionKinds: comprehensiveKinds,
    requireExactGap: false,
    requireConflictSection: false,
    clarificationQuestion: null,
  };
}
```

- [ ] **Step 4: Run the focused test and typecheck the contract**

Run: `node scripts/run-vitest.mjs run tests/adaptive-answer-plan.test.ts`

Expected: PASS (4 tests).

Run: `npm run typecheck`

Expected: PASS; if the run coordinator reports admission busy without executing, wait for its lease and run once.

- [ ] **Step 5: Review and checkpoint**

Inspect: `git diff -- src/lib/types.ts src/lib/rag/adaptive-answer-plan.ts tests/adaptive-answer-plan.test.ts`.

If the execution session authorizes local commits, run:

```bash
npm run format
git add src/lib/types.ts src/lib/rag/adaptive-answer-plan.ts tests/adaptive-answer-plan.test.ts
git commit -m "feat(rag): define adaptive answer shapes"
```

---

### Task 2: Drive composition, prompt, schema, and cache from the plan

**Files:**

- Modify: `src/lib/rag/adaptive-answer-plan.ts`
- Modify: `src/lib/rag/answer-composition.ts`
- Modify: `src/lib/rag/rag-answer-instructions.ts`
- Create: `src/lib/rag/rag-answer-contract-limits.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/rag/rag-versioning.ts`
- Modify: `src/lib/answer-client-payload.ts`
- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `tests/answer-composition.test.ts`
- Modify: `tests/answer-client-payload.test.ts`
- Modify: `tests/rag-answer-composition-prompt.test.ts`
- Modify: `tests/rag-eval-cases.test.ts`
- Modify: `tests/openai-cache.test.ts`

**Interfaces:** Consumes `AdaptiveAnswerPlan` and canonical answer verification inputs. Produces a stable `adaptive_answer:` prompt line, shared exported answer-contract limits, ordered v20 schema properties, final-only `RagAnswer.answerContractVersion = "clinical-rag-answer-v20"`, sanitized client discrimination, and matching cache fingerprints. `rag-answer-contract-limits.ts` exports the canonical 1,600-character answer, 48-character heading, 600-character section body, and eight-section adaptive maximum. `answerJsonOutputSchemaForResults`, Zod/final verification, the quality evaluator, and verified delivery import those values. The schema pins its first properties as `answer`, `grounded`, `confidence`, `citations`, `answerSections`; post-generation verification enforces the lower plan-specific section cap.

- [ ] **Step 1: Replace the old fixed-length test pins**

```ts
// tests/rag-answer-composition-prompt.test.ts
it("uses evidence-gated adaptive length instead of a global word cap", () => {
  expect(answerInstructions).toContain("Follow the adaptive_answer contract in the Interpreted clinical task block");
  expect(answerInstructions).toContain("Stop when the exact question and supported high-yield detail are complete");
  expect(answerInstructions).toContain("A narrow question remains narrow");
  expect(answerInstructions).not.toContain("usually 2-4 sentences, about 60-110 words");
  expect(answerInstructions).not.toContain("about 35-75 words");
});

it("carries the adaptive plan into the real prompt and structured schema", () => {
  const block = ragSource.slice(ragSource.indexOf("const interpretedTask = ["), ragSource.indexOf('].join("\\n");'));
  expect(block).toContain("formatAdaptiveAnswerPlanLine(adaptiveAnswerPlan)");
  const schema = answerJsonOutputSchemaForResults([]) as {
    properties: Record<string, unknown> & { answerSections: { maxItems: number } };
  };
  expect(Object.keys(schema.properties).slice(0, 5)).toEqual([
    "answer",
    "grounded",
    "confidence",
    "citations",
    "answerSections",
  ]);
  expect(schema.properties.answerSections.maxItems).toBe(8);
});
```

Update the cache assertion to the next prompt version, `clinical-rag-answer-v20`, in both `tests/rag-answer-composition-prompt.test.ts` and `tests/openai-cache.test.ts`.

- [ ] **Step 2: Run the prompt and composition tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/answer-composition.test.ts tests/rag-answer-composition-prompt.test.ts tests/answer-client-payload.test.ts tests/rag-eval-cases.test.ts tests/openai-cache.test.ts`

Expected: FAIL on fixed prompt text, absent adaptive line, unpinned schema property order, section max `6`, and version `v19`.

- [ ] **Step 3: Add a deterministic formatter and plan-conditioned menu**

```ts
// src/lib/rag/adaptive-answer-plan.ts
export function formatAdaptiveAnswerPlanLine(plan: AdaptiveAnswerPlan): string {
  return [
    `shape=${plan.shape}`,
    `lead_sentences=${plan.leadSentenceRange[0]}-${plan.leadSentenceRange[1]}`,
    `sections=${plan.sectionRange[0]}-${plan.sectionRange[1]}`,
    `exact_gap=${plan.requireExactGap ? "required" : "only_if_present"}`,
    `source_conflict=${plan.requireConflictSection ? "required" : "only_if_present"}`,
  ].join("; ");
}
```

Change `buildRelatedInformationMenu` to accept the plan and filter menu items through `eligibleSectionKinds`. Preserve existing class/intent ordering and the `none` contract for document lookup. Do not force the plan’s minimum section count when evidence is absent.

- [ ] **Step 4: Update the generation contract**

In `rag.ts`, build `adaptiveAnswerPlan` after `queryAnalysis` and `answerCoveragePlan` exist only when `RagProgrammeRolloutDecision.components.adaptiveAnswer` is true, add it to `SmartRagAnswerPlan`, and add:

```ts
`adaptive_answer: ${formatAdaptiveAnswerPlanLine(adaptiveAnswerPlan)}`,
```

Replace the fixed first-layer paragraph in `rag-answer-instructions.ts` with:

```text
## Answer length and shape
- Follow the adaptive_answer contract in the Interpreted clinical task block.
- The range describes the useful shape, not a quota. Stop when the exact question and supported high-yield detail are complete; never pad to reach a minimum.
- A narrow question remains narrow. A comprehensive question may use every independently supported section needed to answer it.
- When coverage is partial, answer the supported subquestions, name the exact unsupported subquestion and reason, then include the supplied targeted clarification only when it can change retrieval.
- When source_conflict is required, include one source_conflict section derived only from the supplied canonical conflict: identify both sources, the Australian publication/effective date, jurisdiction and role, the material difference, why the current uploaded guideline remains primary, and that the uploaded document is flagged for review.
```

Set the schema `answerSections.maxItems` to `8`, preserve the authoritative `answer` max of `1_600` characters and section `body` max of `600` characters, and order the first schema properties exactly as `answer`, `grounded`, `confidence`, `citations`, `answerSections`. This makes the later verified-delivery parser able to emit a citation-complete lead without another prompt/schema revision. Enforce `adaptiveAnswerPlan.sectionRange[1]` during finalization. Roll `ragAnswerPromptVersion` to `clinical-rag-answer-v20` and keep `src/lib/openai.ts` using that exported value.

Update `scoreAnswerQualityEvalCase` through the shared limits owner. Its current 900-word ceiling was derived from v19's six-section schema and must not reject a legal eight-section v20 answer or retain the stale 220-word HANDOVER claim. Keep fragmentation and runaway-duplication detection separate from style preference, add a discriminating max-shape test, and roll the committed evaluation-config fingerprint when the metric contract changes.

When the server component flag is false, use the unchanged legacy prompt/schema/version and finalization path; do not construct an adaptive plan and do not let v20 answers share a legacy cache namespace. Add a truth-table test for legacy mode, candidate+adaptive-off, and candidate+adaptive-on.

- [ ] **Step 5: Run focused verification**

Run: `node scripts/run-vitest.mjs run tests/adaptive-answer-plan.test.ts tests/answer-composition.test.ts tests/rag-answer-composition-prompt.test.ts tests/answer-client-payload.test.ts tests/rag-eval-cases.test.ts tests/openai-cache.test.ts`

Expected: PASS.

Run: `npm run check:rag:fixtures`

Expected: PASS; fixture prompt/version snapshots are internally consistent.

- [ ] **Step 6: Review and checkpoint**

Confirm the diff contains no instruction to use general model knowledge or live web content. Format, inspect, and conditionally commit:

```bash
npm run format
git add src/lib/rag/adaptive-answer-plan.ts src/lib/rag/answer-composition.ts src/lib/rag/rag-answer-instructions.ts src/lib/rag/rag-answer-contract-limits.ts src/lib/rag/rag.ts src/lib/rag/rag-versioning.ts src/lib/rag/rag-eval-cases.ts src/lib/answer-client-payload.ts tests/answer-composition.test.ts tests/rag-answer-composition-prompt.test.ts tests/rag-eval-cases.test.ts tests/answer-client-payload.test.ts tests/openai-cache.test.ts
git commit -m "feat(rag): generate evidence-adaptive answers"
```

---

### Task 3: Preserve supported subanswers and emit exact gaps

**Files:**

- Create: `src/lib/rag/source-conflict-section.ts`
- Modify: `src/lib/answer-verification.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/lib/rag/rag-extractive-answer.ts`
- Modify: `tests/rag-answer-fallback.test.ts`
- Modify: `tests/answer-verification.test.ts`

**Interfaces:** Consumes a generated answer, `AnswerCoveragePlan`, reconciled results, and canonical `SourcePolicyConflict`. Produces `retainVerifiedAnswerParts(answer, coveragePlan, results)` returning `{ answer, retainedSectionCount, droppedSectionCount, gapAdded, conflictAdded }` plus `buildSourceConflictSection(conflict, reconciledResults)`. It may retain a lead or section only when existing citation and claim-support gates pass independently and never salvages a failing numeric claim by editing it.

- [ ] **Step 1: Add failing supported-part tests**

```ts
// tests/answer-verification.test.ts
it("retains a directly supported section when a separate subquestion is absent", () => {
  const result = retainVerifiedAnswerParts(
    fakeAnswer({
      answer: "Use the uploaded monitoring schedule.",
      citations: [{ chunk_id: "chunk-monitoring" }],
      answerSections: [
        {
          heading: "Monitoring",
          body: "Check FBC at the interval stated in the guideline.",
          citation_chunk_ids: ["chunk-monitoring"],
          kind: "monitoring_timing",
          supportLevel: "direct",
        },
        {
          heading: "Adolescents",
          body: "Use the same schedule for adolescents.",
          citation_chunk_ids: [],
          kind: "monitoring_timing",
          supportLevel: "unsupported",
        },
      ],
    }),
    partialCoverage("What is the adolescent schedule?", "not_in_corpus"),
    [searchResult("chunk-monitoring")],
  );
  expect(result.answer.answerSections?.map((section) => section.heading)).toEqual(["Monitoring", "Source gap"]);
  expect(result.answer.answer).toBe("Use the uploaded monitoring schedule.");
  expect(result.answer.answerSections?.[1]?.body).toContain("adolescent schedule");
  expect(result.answer.answerSections?.[1]?.body).toContain("not covered by the active sources");
});

it("adds complete visible conflict provenance without letting the newer source silently override local guidance", () => {
  const conflict = sourcePolicyConflictFixture();
  const result = retainVerifiedAnswerParts(supportedLocalPrimaryAnswer(), conflictingCoverage(conflict), [
    searchResult(conflict.local.supportingChunkIds[0]),
    searchResult(conflict.australian.supportingChunkIds[0]),
  ]);
  const section = result.answer.answerSections?.find((item) => item.kind === "source_conflict");
  expect(result.conflictAdded).toBe(true);
  expect(section).toMatchObject({
    heading: "Guidance conflict",
    citation_chunk_ids: expect.arrayContaining([
      conflict.local.supportingChunkIds[0],
      conflict.australian.supportingChunkIds[0],
    ]),
  });
  const australianDate = requiredSourceDate(conflict.australian);
  expect(section?.body).toContain(conflict.australian.title);
  expect(section?.body).toContain(australianDate);
  expect(section?.body).toContain(conflict.australian.jurisdiction);
  expect(section?.body).toContain(clinicalSourceRoleLabel(conflict.australian.sourceRole));
  expect(section?.body).toContain("uploaded guideline remains primary");
  expect(section?.body).toContain("flagged for review");
});
```

Add integration cases to `tests/rag-answer-fallback.test.ts` for `provider_failure`, `timeout`, `source_role_mismatch`, and `source_conflict`, proving each retains supported evidence and returns a distinct reason instead of the generic refusal.

- [ ] **Step 2: Run the focused tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/answer-verification.test.ts tests/rag-answer-fallback.test.ts`

Expected: FAIL because supported-part retention and typed gap reasons are absent.

- [ ] **Step 3: Implement claim-by-claim retention**

Reuse existing citation reconciliation, numeric verification, source-governance, and render-trust functions. Do not create a weaker verifier. Construct source-gap and source-conflict sections deterministically from `AnswerCoveragePlan`; do not ask the model to explain its own retrieval failure or conflict provenance.

```ts
const sourceGap: AnswerSection = {
  heading: "Source gap",
  body: exactCoverageGapText(coveragePlan),
  citation_chunk_ids: [],
  kind: "source_gap",
  supportLevel: "unsupported",
};
```

`buildSourceConflictSection` must include both source titles/publishers, publication/effective dates when present, jurisdiction, role, the supplied material-difference reason, the local-primary reason, and the review target. Its citations are exactly the reconciled local and Australian supporting chunk IDs. If either side is inaccessible, inactive, unverified, absent from final sources, or no longer materially overlapping, emit no conflict section/review flag and fail that conflict expectation; never degrade it into a one-sided comparison.

Use `source_gap` only for the missing portion. If no lead or section survives, retain the existing fail-closed evidence-gap answer. Comparisons and conflicts remain all-or-buffered unless each side and the conclusion verify together.

- [ ] **Step 4: Make generation fallbacks use the same helper**

Route structured-parse fallback, provider failure, route timeout, and extractive fallback through `retainVerifiedAnswerParts`. Add the typed insufficiency reason to `routingReason` and telemetry, but do not expose internal exception strings in prose.

- [ ] **Step 5: Verify the full fallback surface**

Run: `node scripts/run-vitest.mjs run tests/answer-verification.test.ts tests/rag-answer-fallback.test.ts tests/rag-comparison.test.ts tests/rag-trust.test.ts`

Expected: PASS.

Run: `npm run check:rag:fixtures`

Expected: PASS.

- [ ] **Step 6: Review and checkpoint**

Inspect every new path for unsupported numeric salvage, invented citations, and cross-user source leakage. Format and conditionally commit:

```bash
npm run format
git add src/lib/rag/source-conflict-section.ts src/lib/answer-verification.ts src/lib/rag/rag.ts src/lib/rag/rag-extractive-answer.ts tests/answer-verification.test.ts tests/rag-answer-fallback.test.ts
git commit -m "fix(rag): retain supported answers across evidence gaps"
```

---

### Task 4: Render the complete governed answer in the main surface

**Files:**

- Modify: `src/components/clinical-dashboard/answer-content.tsx`
- Create: `src/components/clinical-dashboard/answer-section-projector.ts`
- Create: `src/components/clinical-dashboard/answer-inline-sections.tsx`
- Modify: `src/components/clinical-dashboard/answer-result-surface.tsx`
- Modify: `src/components/clinical-dashboard/answer-thread-turn.tsx`
- Modify: `src/components/ClinicalDashboard.tsx`
- Modify: `tests/answer-content.test.ts`
- Create: `tests/answer-inline-sections.dom.test.tsx`
- Create: `tests/answer-thread-turn.dom.test.tsx`
- Create: `tests/adaptive-answer-ui.spec.ts`
- Modify: `tests/answer-render-policy.test.ts`

**Interfaces:** Consumes finalized `RagAnswer`, final `SearchResult[]`, preformatted state, sanitized `answer.citations`, and section `citation_chunk_ids`. Produces `projectAnswerForMainSurface(args: { answer: RagAnswer; sources: SearchResult[]; preformatted: boolean }): ProjectedAnswerForMainSurface` with lossless lead text, lead citation sources, and ordered `ProjectedAnswerSection[]`, preserving Task 0's v19-compatible sanitation. `renderModel.primarySources` is not a citation set because it may include uncited retrievals.

```ts
export type ProjectedAnswerSection = AnswerSection & { citationSources: SearchResult[] };

export function projectAnswerForMainSurface(args: {
  answer: RagAnswer;
  sources: SearchResult[];
  preformatted: boolean;
}): {
  leadText: string;
  leadCitationSources: SearchResult[];
  sections: ProjectedAnswerSection[];
};
```

- [ ] **Step 1: Add the failing complete-projection tests**

Keep Task 0's lossless-lead tests green, then add DOM cases proving:

- every supported section renders once in original final order beneath the lead;
- each section’s compact `CitationList` activates only sources named by its `citation_chunk_ids`;
- lead citations resolve from `answer.citations`, never every `primarySource`;
- unsupported or rejected sections do not render;
- a partial answer shows the supported lead, supported sections, and exact source-gap section without opening Safety findings, Clinical notes, or Evidence;
- a source conflict shows both identities, Australian publication/effective date, jurisdiction, role, material difference, uploaded-primary decision, review flag, and only the two reconciled citation sets in the main answer;
- prior expanded conversation turns render the same lead/sections/citations as the latest turn; and
- copy text remains the canonical final clipboard projection rather than a preview-only DOM scrape.
- `RAG_ADAPTIVE_ANSWER_RENDER_ENABLED=false` projects `renderAdaptiveAnswer: false` and keeps the legacy surface; when enabled, the client renders sections only when the authoritative final payload also declares the adaptive v20 answer contract. A legacy or mismatched payload never enters the adaptive projector.

Add `tests/adaptive-answer-ui.spec.ts` with a stubbed authoritative final payload (`answerContractVersion: "clinical-rag-answer-v20"`, `renderAdaptiveAnswer: true`) containing a lead and every supported section. At 320×740, 390×844, and 1280×900, assert the lead/sections appear once in order, compact citations activate, no ellipsis/clipped governed prose appears, and the answer is complete while Safety findings, Clinical notes, and Evidence remain unopened.

- [ ] **Step 2: Run tests to prove sections are not in the main surface**

Run: `node scripts/run-vitest.mjs run tests/answer-content.test.ts tests/answer-inline-sections.dom.test.tsx tests/answer-thread-turn.dom.test.tsx tests/answer-render-policy.test.ts`

Expected: FAIL because `NaturalLanguageAnswer` receives only `answer.answer` while sections remain confined to optional support panels. The Task 0 lead-losslessness tests remain green.

- [ ] **Step 3: Add projection and inline rendering without reintroducing clipping**

Keep `sanitizeAndStripSyntheticNotice`, bold preservation, and established source-noise removal, but return the full sanitized string. Do not run `clinicalProseUsefulness`, split/deduplicate fragments, or reconstruct prose: those operations can still silently delete governed sentences. Do not move adaptive policy into the browser.

```ts
export function primaryAnswerDisplayText(value: string, options: AnswerDisplayTextOptions = {}) {
  if (options.preformatted) return plainAnswerText(value, options);
  return sanitizeAndStripSyntheticNotice(value, {
    preformatted: false,
    preserveBold: options.preserveBold,
  });
}
```

Move the `safeAnswerSections` projection currently owned by `ClinicalDashboard.tsx` into `projectAnswerForMainSurface`. Render `AnswerInlineSections` immediately after `NaturalLanguageAnswer` inside `AnswerCard`; do not duplicate the answer in the optional panels. Use existing `Citation` and `CitationList` primitives with `citedDocumentHref`/the established activation handler.

Do not read `process.env` in components. `answer-client-payload.ts` projects the server rollout decision into a bounded `renderAdaptiveAnswer` boolean only after final verification. The final payload’s `answerContractVersion` must equal `clinical-rag-answer-v20` as well; otherwise use the legacy renderer even when the server render flag is on. This is display rollback only and cannot change retrieval, evidence, or canonical server prose; the rollout owner still versions response/cache fingerprints so stale projection bits cannot replay.

- [ ] **Step 4: Verify renderer behaviour**

Run: `node scripts/run-vitest.mjs run tests/answer-content.test.ts tests/answer-inline-sections.dom.test.tsx tests/answer-thread-turn.dom.test.tsx tests/answer-render-policy.test.ts`

Expected: PASS, including all existing short safety-cue tests, full section order, citation scoping, and prior-turn parity.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run ensure` and use only the printed project URL.

Run the exact repository wrapper:

```text
npm run test:e2e -- tests/adaptive-answer-ui.spec.ts --project=chromium
```

Expected: PASS at 320px, 390px, and desktop. This is responsive Chromium proof, not physical iPhone Safari/PWA acceptance.

- [ ] **Step 5: Review and checkpoint**

Confirm the browser displays all server-governed prose verbatim apart from established sanitation, and that required details no longer depend on optional panels. Format and conditionally commit:

```bash
npm run format
git add src/components/clinical-dashboard/answer-content.tsx src/components/clinical-dashboard/answer-section-projector.ts src/components/clinical-dashboard/answer-inline-sections.tsx src/components/clinical-dashboard/answer-result-surface.tsx src/components/clinical-dashboard/answer-thread-turn.tsx src/components/ClinicalDashboard.tsx tests/answer-content.test.ts tests/answer-inline-sections.dom.test.tsx tests/answer-thread-turn.dom.test.tsx tests/adaptive-answer-ui.spec.ts tests/answer-render-policy.test.ts
git commit -m "fix(chat): display complete cited answers"
```

---

### Task 5: Add real false-insufficiency and usefulness cases

**Files:**

- Modify: `src/lib/rag/rag-eval-cases.ts`
- Modify: `tests/rag-eval-cases.test.ts`

**Interfaces:** Consumes the canonical offline RAG case registry and accepted adaptive/coverage contracts. Produces tagged `adaptive_answer`, `partial_coverage`, and `false_insufficiency` cases whose assertions pin required concepts, prohibited generic refusal, section range, and exact gap reason.

- [ ] **Step 1: Add three failing cases**

```ts
// tests/rag-eval-cases.test.ts
it("scores a supported broad answer as incomplete when it collapses to generic prose", () => {
  const result = evaluateRagCase(
    caseById("adaptive-broad-management"),
    fakeAnswer({
      answer: "Management should follow the relevant guideline.",
      answerSections: [],
    }),
  );
  expect(result.pass).toBe(false);
  expect(result.failures).toContain("missing_required_subquestion_coverage");
});

it("rejects blanket insufficiency when one supported subquestion exists", () => {
  const result = evaluateRagCase(caseById("partial-supported-monitoring"), genericEvidenceGapAnswer());
  expect(result.failures).toContain("false_insufficiency");
});
```

The third case is a narrow fact and proves adaptive length does not bloat it. Add repository-content cases that prove a cross-domain medication/differential/specifier question retains every supported domain section, a product/catalogue question can remain concise, and a stale site lane preserves a supported uploaded-guideline answer while naming only the exact remaining site-content gap.

- [ ] **Step 2: Run the offline evaluation test to establish red**

Run: `node scripts/run-vitest.mjs run tests/rag-eval-cases.test.ts`

Expected: FAIL because the new cases/tags/assertions do not exist.

- [ ] **Step 3: Implement fixture assertions without patient data**

Use synthetic documents and de-identified question wording. Add no real user query until it has been reviewed and converted into a privacy-safe evaluation case. Keep exact required concepts source-backed.

- [ ] **Step 4: Run offline gates**

Run: `node scripts/run-vitest.mjs run tests/rag-eval-cases.test.ts`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS with the new adaptive/partial cases included and no protected-slice regression.

- [ ] **Step 5: Review and checkpoint**

Format and conditionally commit:

```bash
npm run format
git add src/lib/rag/rag-eval-cases.ts tests/rag-eval-cases.test.ts
git commit -m "test(rag): cover adaptive and partial answers"
```

---

### Task 6: Domain handoff and approval-gated canary

**Files:**

- Modify: `docs/rag-behaviour/safeguards.md`
- Modify: `docs/search-rag-master-plan.md`
- Modify: `docs/search-rag-master-context.md`

**Interfaces:** Consumes the accepted adaptive-answer code/evaluation evidence and programme rollout owner. Produces: no runtime interface. It updates current RAG behavior/rollback documentation plus an approval request for provider canaries.

- [ ] **Step 1: Document the RAG impact**

Record:

- old versus new answer-shape contract;
- why the UI cap was an independent defect;
- protected narrow-question, numeric, comparison, access, and citation invariants;
- new false-insufficiency metrics;
- server/client flags and rollback;
- local/offline evidence; and
- provider/live evidence still required for this programme, including the new v19-versus-v20 blinded comparison; the closed historical v18-versus-v19 Gate E result is baseline context, not v20 acceptance.

- [ ] **Step 2: Run the smallest offline domain gate**

Run: `npm run check:rag:fixtures`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS.

Run: `npm run check:production-readiness`

Expected: PASS or an accurately classified environment/provider gate. Do not bypass a failed prerequisite.

Use `npm run verify:pr-local -- --dry-run --files src/lib/rag/adaptive-answer-plan.ts,src/lib/rag/answer-composition.ts,src/lib/rag/rag-answer-instructions.ts,src/lib/rag/rag.ts,src/lib/answer-verification.ts,src/components/clinical-dashboard/answer-content.tsx` to see the repository-selected handoff plan. Run the selected gate once only when the change is ready for PR handoff.

Before an applicable expensive gate, quote the literal arbiter command: `npm run arbiter -- typecheck`, `npm run arbiter -- test`, or `npm run arbiter -- verify:pr-local`. This RAG/UI scope normally returns `RUN` unless exact content is already `PROVEN`. If a gate reports a content-addressed receipt, record it as a reused receipt with its emitted timestamp. Do not describe a receipt, `DEFER`, or `PROVEN` verdict as a fresh execution or rerun unchanged work merely to replace it.

- [ ] **Step 3: Stop at the hosted boundary unless separately authorized**

Do **not** run `npm run eval:rag`, `npm run eval:quality`, `npm run eval:answer-quality`, `npm run check:supabase-project`, live canaries, deployment, or production feature activation as an implied part of this plan. The historical v18-versus-v19 Gate E read is closed; do not re-run that paid provider comparison without a fresh explicit request. Before v20 production promotion, use the merged PR #2208 blinding tooling to capture identical current-v19 and candidate-v20 question sets, let the owner read only the blinded pack, unblind only after every verdict is recorded, and require the programme thresholds plus no usefulness regression. With explicit approval, also capture the same-query baseline/post canary pair.

- [ ] **Step 4: Final review**

Inspect the complete diff for prompt-cache version alignment, no silent clipping, no unsupported partial salvage, no raw queries in logs, and no change to source priority. Run `npm run format`, review its diff, and only commit if authorized.
