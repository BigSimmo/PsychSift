# Verified incremental RAG delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. One implementer works at a time; a task reviewer must approve specification compliance and code quality before the next task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat begin showing useful answer text sooner, while preserving the rule that no raw token, provisional dose, incomplete JSON, or revisable clinical claim reaches the browser.

**Architecture:** Keep the existing `progress`/`final`/`error` SSE contract and implemented governed evidence preview. Add complete `answer_lead` and `answer_section` units. OpenAI response deltas remain private inside a server-side structured-output accumulator. It recognizes only complete JSON values, passes each eligible semantic unit through the same final verification/governance gates, emits immutable units in final order, globally verifies the completed answer, and reconciles every emitted byte against the authoritative `final` payload. If the installed provider path cannot prove complete unit boundaries, it emits no answer prose and falls back to evidence-preview-plus-final.

**Tech Stack:** OpenAI TypeScript SDK 7.4 Responses API, TypeScript 6 strict, Next.js 16 route handlers, React 19, SSE, Vitest, Playwright through repository wrappers.

**Spec:** [`docs/superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md`](../specs/2026-08-20-rag-answer-and-australian-sources-design.md)

**Existing design:** [`docs/verified-answer-incremental-delivery-design.md`](../../verified-answer-incremental-delivery-design.md). Phase 0, server evidence-preview emission, client parsing, and evidence-preview rendering exist on current main behind separate flags. Reconcile documentation/ledger state rather than reimplementing them.

**Dependencies:** Land the metric/telemetry contracts in [`2026-08-20-rag-evaluation-rollout.md`](2026-08-20-rag-evaluation-rollout.md) Tasks 1–2, the request-local site/document context snapshot in [`2026-08-21-rag-repository-content-sync.md`](2026-08-21-rag-repository-content-sync.md), and the stable final answer contract in [`2026-08-20-rag-adaptive-answer.md`](2026-08-20-rag-adaptive-answer.md) first. Streaming is a projection of final output, never its owner.

**Effort:** Plan/review `xhigh`. Tasks 1–4 build `high`; Task 5 build `medium-high`; Task 6 live rollout `high`. Use the most capable coding model with high reasoning for parser, verifier, provider, and reconciliation tasks; a standard coding model with medium-high reasoning is sufficient for the isolated UI task. Final whole-branch review uses the most capable reviewer at xhigh.

**Current-main reconciliation (2026-08-22):** the stream contract already accepts validated `answer_section` units, Phase 0 rejects malformed/out-of-order units, governed evidence-preview server/client paths are flag-gated, and final answer prose remains buffered. No provider-delta parser, citation-complete lead finalizer, generated-section emission, or pre-cache reconciliation exists. Existing prompt v19/schema v4 remains the legacy path; this plan consumes adaptive v20. `src/lib/rag/rag.ts` is at its enforced 4,362-line no-growth ceiling.

## Global Constraints

- Never add `token`, `delta`, `revising`, or partial-JSON events to the public stream.
- A unit is emitted only after it is complete, parsed, schema-valid, access-authorised, source-governed, citation-reconciled, claim-supported, numeric-verified, and immutable.
- An emitted unit is byte-identical to a subset of `final`. The browser never patches a preview.
- Every unit uses the same immutable `RagContextSnapshot` as `final`. A public site release activated mid-answer is used by the next question, never mixed into the current stream.
- Evidence preview is sequence `0`; lead is sequence `1`; sections follow in final order. Missing/ineligible units may create sequence gaps but never reordering or reuse.
- Comparison conclusions, conflict resolution, cross-section summaries, and sections dependent on later content remain buffered until their full dependency set verifies.
- Provider errors, abort, retry, cancellation, timeout, parse failure, or reconciliation mismatch clear every preview and cannot leave copyable clinical text behind.
- Copy, save, export, feedback, and persistence refer only to the authoritative final answer.
- eTG/AMH excerpts are forbidden in previews exactly as in final output.
- Telemetry records timestamps, counts, enums, and versions only; never query or answer text.
- This plan consumes adaptive schema/prompt v20 and owns `answer-semantic-unit-parser-v1`; it must not silently change provider-schema semantics under the same prompt/cache version.
- Import the canonical lead/heading/body/section limits from `src/lib/rag/rag-answer-contract-limits.ts`; do not keep independent parser-only numeric copies.
- Keep `src/lib/rag/rag.ts` at or below 4,362 lines. Attempt state and reconciliation belong in the new modules; never raise the maintainability budget.
- Provider-backed experiments, paid calls, live canaries, deployment, and hosted flags require explicit approval. Unit/parser/reconciliation work is fully offline-testable.

---

## File Structure

| File                                                               | Responsibility                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/lib/answer-stream-contract.ts`                                | Adds the typed lead unit and narrows support-level typing.                                                  |
| `src/lib/rag/answer-semantic-unit-parser.ts`                       | **New.** Recognizes citation-complete lead and complete section JSON values from a private provider buffer. |
| `src/lib/rag/answer-unit-finalization.ts`                          | **New.** Applies canonical verification/governance to one complete lead or section.                         |
| `src/lib/answer-stream-reconciliation.ts`                          | **New.** Proves emitted units are exact ordered subsets of final.                                           |
| `src/lib/openai.ts`                                                | Adds an opt-in structured streaming seam without changing buffered callers.                                 |
| `src/lib/rag/rag.ts`                                               | Supplies candidates, reconciles before logging/caching, and retains buffered fallback.                      |
| `src/app/api/answer/stream/route.ts`                               | Sequence enforcement plus a route-boundary reconciliation defense.                                          |
| `src/lib/env.ts`, `.env.example`                                   | Server emission flag.                                                                                       |
| `src/lib/client-env.ts`                                            | Client rendering flag.                                                                                      |
| `src/components/clinical-dashboard/search-utils.ts`                | Parses lead/section units, attempt-local state, discard/reconcile.                                          |
| `src/components/clinical-dashboard/answer-request.ts`              | Forwards incremental callbacks and final reconciliation outcome.                                            |
| `src/components/ClinicalDashboard.tsx`                             | Holds preview state and clears it on every non-final terminal path.                                         |
| `src/components/clinical-dashboard/answer-incremental-content.tsx` | **New.** Accessible append-only lead/section preview.                                                       |
| `tests/answer-semantic-unit-parser.test.ts`                        | **New.** Fragmentation, escaping, malformed, oversized, and ordering proof.                                 |
| `tests/answer-unit-finalization.test.ts`                           | **New.** Canonical verifier reuse and dependency eligibility.                                               |
| `tests/answer-stream-reconciliation.test.ts`                       | **New.** Exact final and cached-answer subset proof.                                                        |
| `tests/answer-incremental-delivery.test.ts`                        | Contract, monotonic sequence, forbidden shapes.                                                             |
| `tests/rag-incremental-attempt.test.ts`                            | **New.** Retry/fallback, pre-cache reconciliation, and abort rules.                                         |
| `tests/answer-progress.test.ts`                                    | Client discard and reconciliation paths.                                                                    |
| `tests/answer-stream-preview-order.test.ts`                        | Server event order and mismatch failure.                                                                    |
| `tests/answer-progress-ui-smoke.spec.ts`                           | Visible progressive experience and final-only actions.                                                      |
| `tests/ui-phone-motion.spec.ts`                                    | Phone, live-region, reduced-motion, and layout stability.                                                   |

---

## Completion Evidence

Report separately:

- offline parser/contract/finalizer/reconciliation evidence;
- browser/accessibility evidence;
- server-flag-off parity evidence;
- provider-backed evidence, if authorized;
- live observation window, if authorized;
- flags and rollback tested;
- issue/documentation state;
- commits/push/deploy status; and
- residual risk if unit-boundary or provider cost/latency proof remains incomplete.

---

### Task 1: Extend and pin the public semantic-unit contract

**Files:**

- Modify: `src/lib/answer-stream-contract.ts`
- Modify: `src/lib/answer-progress-public.ts`
- Modify: `src/components/clinical-dashboard/answer-progress.ts`
- Modify: `tests/answer-incremental-delivery.test.ts`
- Modify: `tests/answer-stream-contract.test.ts`

**Interfaces:**

Consumes final verified lead/section text, citations, support, and accepted ordering. Produces the three-way `VerifiedUnit` union using `VerifiedAnswerLeadUnit` and `VerifiedAnswerSectionUnit` below without changing the event-name vocabulary.

```ts
export type VerifiedAnswerLeadUnit = {
  schemaVersion: 1;
  kind: "answer_lead";
  sequence: 1;
  text: string;
  citations: Citation[];
};

export type VerifiedAnswerSectionUnit = {
  schemaVersion: 1;
  kind: "answer_section";
  sequence: number;
  sectionIndex: number;
  section: AnswerSection;
  citations: Citation[];
  supportLevel: Exclude<AnswerSectionSupportLevel, "unsupported">;
};
```

`VerifiedUnit` becomes the three-way union. `AnswerStreamEventName` remains unchanged.

- [ ] **Step 1: Add failing contract tests**

```ts
// tests/answer-incremental-delivery.test.ts
it("accepts a complete lead but rejects token-shaped or revisable prose", () => {
  expect(
    isDeliverableVerifiedUnit(
      {
        schemaVersion: 1,
        kind: "answer_lead",
        sequence: 1,
        text: "Use the current uploaded guideline as the local primary source.",
        citations: [citation("chunk-1")],
      },
      0,
    ),
  ).toBe(true);
  expect(isDeliverableVerifiedUnit({ schemaVersion: 1, kind: "token", sequence: 1, text: "Use" }, 0)).toBe(false);
  expect(isDeliverableVerifiedUnit({ schemaVersion: 1, kind: "revising", sequence: 1, text: "Changed" }, 0)).toBe(
    false,
  );
});

it("requires supported answer sections and their final index", () => {
  expect(
    isDeliverableVerifiedUnit(
      {
        schemaVersion: 1,
        kind: "answer_section",
        sequence: 2,
        sectionIndex: 0,
        section: section({ supportLevel: "direct" }),
        citations: [citation("chunk-1")],
        supportLevel: "direct",
      },
      1,
    ),
  ).toBe(true);
  expect(
    isDeliverableVerifiedUnit(
      {
        schemaVersion: 1,
        kind: "answer_section",
        sequence: 2,
        sectionIndex: 0,
        section: section({ supportLevel: "unsupported" }),
        citations: [],
        supportLevel: "unsupported",
      },
      1,
    ),
  ).toBe(false);
});
```

- [ ] **Step 2: Run contract tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/answer-incremental-delivery.test.ts tests/answer-stream-contract.test.ts`

Expected: FAIL because `answer_lead` and `sectionIndex` are not accepted.

- [ ] **Step 3: Implement strict allowlists and size bounds**

Add `answer_lead` to `verifiedUnitKinds`, exact allowed-key sets, non-empty bounded text validation, citation validation, and `sectionIndex >= 0`. Do not loosen the existing client-source allowlist. Keep the 64,000-character total unit bound. Export and reuse the authoritative structured-schema caps already applied in `rag.ts` (`answer` max 1,600 characters and section `body` max 600 characters); the stream must never accept content the final schema rejects.

- [ ] **Step 4: Verify and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/answer-incremental-delivery.test.ts tests/answer-stream-contract.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Format, review, and conditionally commit:

```bash
npm run format
git add src/lib/answer-stream-contract.ts src/lib/answer-progress-public.ts src/components/clinical-dashboard/answer-progress.ts tests/answer-incremental-delivery.test.ts tests/answer-stream-contract.test.ts
git commit -m "feat(chat): define verified lead and section units"
```

---

### Task 2: Parse complete semantic values from private structured-output deltas

**Files:**

- Create: `src/lib/rag/answer-semantic-unit-parser.ts`
- Create: `tests/answer-semantic-unit-parser.test.ts`
- Modify: `tests/rag-answer-composition-prompt.test.ts`
- Modify: `tests/openai-cache.test.ts`

**Interfaces:**

Consumes ordered provider JSON text deltas under the v20 schema and canonical contract limits. Produces citation-complete `AnswerSemanticCandidate[]`, exact final JSON text, and reset semantics through `createAnswerSemanticUnitParser(args?: { maxJsonChars?: number; maxSectionCount?: number }): AnswerSemanticUnitParser`.

```ts
export type AnswerSemanticCandidate =
  | {
      kind: "answer_lead";
      text: string;
      grounded: boolean;
      confidence: RagAnswer["confidence"];
      citations: Citation[];
    }
  | { kind: "answer_section"; rawSectionIndex: number; section: AnswerSection };

export type AnswerSemanticUnitParser = {
  contractVersion: "answer-semantic-unit-parser-v1";
  push(delta: string): AnswerSemanticCandidate[];
  finish(): { jsonText: string; candidates: AnswerSemanticCandidate[] };
  reset(): void;
};

export function createAnswerSemanticUnitParser(args?: {
  maxJsonChars?: number;
  maxSectionCount?: number;
}): AnswerSemanticUnitParser;
```

The parser is a JSON lexical scanner, not a regex. It tracks strings, escapes, unicode escapes, arrays, objects, and depth. It consumes and asserts the v20 structured-schema property order already established by adaptive-answer Task 2: `answer`, `grounded`, `confidence`, `citations`, `answerSections`, then the remaining fields. This task does not reorder or otherwise change the provider schema. The lead candidate emits only after the complete citations array closes and lead text, grounded flag, confidence, and citations all parse. A complete `answerSections[index]` object may then emit when `JSON.parse` succeeds. All other properties remain buffered. A candidate is emitted once.

- [ ] **Step 1: Add fragmentation and safety tests**

```ts
// tests/answer-semantic-unit-parser.test.ts
import { describe, expect, it } from "vitest";
import { createAnswerSemanticUnitParser } from "@/lib/rag/answer-semantic-unit-parser";

const payload = JSON.stringify({
  answer: "Withhold only when the cited threshold is met.",
  grounded: true,
  confidence: "high",
  citations: [{ chunk_id: "chunk-1" }],
  answerSections: [
    { heading: "Action", body: "Arrange review.", citation_chunk_ids: ["chunk-1"], kind: "required_actions", supportLevel: "direct" },
  ],
});

it("emits only complete JSON values even when every character is a delta", () => {
  const parser = createAnswerSemanticUnitParser();
  const candidates = [...payload].flatMap((character) => parser.push(character));
  expect(candidates).toEqual([
    {
      kind: "answer_lead",
      text: "Withhold only when the cited threshold is met.",
      grounded: true,
      confidence: "high",
      citations: [{ chunk_id: "chunk-1" }],
    },
    { kind: "answer_section", rawSectionIndex: 0, section: expect.objectContaining({ heading: "Action" }) },
  ]);
  expect(parser.finish().jsonText).toBe(payload);
});

it("does not treat braces, quotes, or escaped unicode inside prose as boundaries", () => {
  const parser = createAnswerSemanticUnitParser();
  const tricky = JSON.stringify({ answer: "A {quoted} value says \\"review\\" and \\u003c 2.", grounded: true, confidence: "medium", citations: [], answerSections: [] });
  expect([...tricky].flatMap((character) => parser.push(character))).toHaveLength(1);
});

it("fails closed for malformed, duplicate, reordered, or oversized semantic fields", () => {
  const parser = createAnswerSemanticUnitParser({ maxJsonChars: 80 });
  parser.push('{"answer":"');
  expect(() => parser.push("x".repeat(100))).toThrow(/structured output exceeds/i);
});

it("is pinned to the adaptive v20 schema and parser contract", () => {
  expect(ragAnswerPromptVersion).toBe("clinical-rag-answer-v20");
  expect(Object.keys(answerJsonOutputSchemaForResults([]).properties).slice(0, 5)).toEqual([
    "answer",
    "grounded",
    "confidence",
    "citations",
    "answerSections",
  ]);
  expect(createAnswerSemanticUnitParser().contractVersion).toBe("answer-semantic-unit-parser-v1");
});
```

- [ ] **Step 2: Prove the module is absent**

Run: `node scripts/run-vitest.mjs run tests/answer-semantic-unit-parser.test.ts tests/rag-answer-composition-prompt.test.ts tests/openai-cache.test.ts`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement the bounded lexical state machine**

Implement the exact property-order checks above, citation-complete lead emission, candidate deduplication, maximum eight sections, and reset-on-error. Prompt/schema/cache tests must prove adaptive Task 2 already rolled and pinned `clinical-rag-answer-v20`; if that precondition is missing or a later implementation changes schema semantics, stop and roll the prompt/cache version in the schema-owning task before enabling streaming. Never log the private buffer. `finish()` must reject an incomplete JSON document; it does not repair it. Cached v20 answers bypass private-delta parsing and may produce units only from the already-finalized cached answer under Task 4, so they cannot replay unverified parser candidates.

- [ ] **Step 4: Add a fragmentation property sweep**

For the fixed payload, test every two-way split point and several randomized chunk-size patterns using a deterministic seed. Assert identical candidates and final text for all partitions.

- [ ] **Step 5: Verify and checkpoint**

Run: `node scripts/run-vitest.mjs run tests/answer-semantic-unit-parser.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

Format, inspect the parser for quadratic concatenation and unbounded memory, then conditionally commit:

```bash
npm run format
git add src/lib/rag/answer-semantic-unit-parser.ts tests/answer-semantic-unit-parser.test.ts tests/rag-answer-composition-prompt.test.ts tests/openai-cache.test.ts
git commit -m "feat(rag): parse complete streamed answer units"
```

---

### Task 3: Finalize units with canonical gates and reconcile final output

**Files:**

- Create: `src/lib/rag/answer-unit-finalization.ts`
- Create: `src/lib/answer-stream-reconciliation.ts`
- Modify: `src/lib/answer-verification.ts`
- Modify: `src/lib/answer-render-policy.ts`
- Create: `tests/answer-unit-finalization.test.ts`
- Create: `tests/answer-stream-reconciliation.test.ts`
- Modify: `tests/answer-incremental-delivery.test.ts`

**Interfaces:**

Consumes semantic candidates, final evidence, answer shell, coverage, sequence, and accepted-section count. Produces finalized verified lead/section units plus deterministic final-answer unit construction and full reconciliation results.

```ts
export function finalizeVerifiedSemanticCandidate(args: {
  candidate: AnswerSemanticCandidate;
  sequence: number;
  selectedEvidence: SearchResult[];
  answerShell: RagAnswer;
  coveragePlan: AnswerCoveragePlan;
  acceptedSectionCount: number;
}): VerifiedAnswerLeadUnit | VerifiedAnswerSectionUnit | null;

export function buildVerifiedUnitsFromFinal(answer: RagAnswer): VerifiedUnit[];

export function reconcileVerifiedUnits(args: { units: VerifiedUnit[]; finalAnswer: RagAnswer }):
  | { ok: true }
  | {
      ok: false;
      reason: "lead_mismatch" | "section_mismatch" | "citation_mismatch" | "source_mismatch" | "order_mismatch";
    };
```

- [ ] **Step 1: Add failing verifier and reconciliation tests**

```ts
// tests/answer-unit-finalization.test.ts
it("rejects a complete numeric section until its exact citation verifies", () => {
  expect(
    finalizeVerifiedSemanticCandidate({
      candidate: {
        kind: "answer_section",
        rawSectionIndex: 0,
        section: {
          heading: "Dose",
          body: "Give 50 mg.",
          citation_chunk_ids: ["chunk-without-50"],
          kind: "medication_dose",
          supportLevel: "direct",
        },
      },
      sequence: 2,
      selectedEvidence: [searchResult("chunk-without-50", "Use the medicine as directed.")],
      answerShell: answerShell(),
      coveragePlan: completeCoverage(),
      acceptedSectionCount: 0,
    }),
  ).toBeNull();
});

it("buffers a comparison conclusion with unresolved later dependencies", () => {
  expect(
    finalizeVerifiedSemanticCandidate({
      ...baseArgs(),
      candidate: { kind: "answer_section", rawSectionIndex: 0, section: comparisonSection() },
    }),
  ).toBeNull();
});

it("requires emitted bytes and citation identities to match final", () => {
  expect(reconcileVerifiedUnits({ units: [leadUnit("Use A.")], finalAnswer: finalAnswer("Use B.") })).toEqual({
    ok: false,
    reason: "lead_mismatch",
  });
});
```

- [ ] **Step 2: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/answer-unit-finalization.test.ts tests/answer-incremental-delivery.test.ts`

Expected: FAIL because finalization/reconciliation modules are absent.

- [ ] **Step 3: Extract reusable canonical predicates**

Refactor existing answer verification into pure fragment-level predicates used by both full-answer finalization and unit finalization. Do not duplicate regexes, numeric rules, source membership, governance refusal, or render trust. Preserve every existing test before adding emission.

Lead eligibility requires the citation-complete candidate from Task 2. Sanitize and resolve those `answer.citations`; do not use `renderModel.primarySources` and do not infer citations from sections.

Section eligibility excludes:

- `supportLevel: "unsupported"`;
- `comparison`, unresolved `source_gap`, or any dependency-marked section until final global verification;
- a chunk ID absent from the selected governed evidence set;
- danger-level source-governance results;
- unverified numeric or labelled-band content;
- sanitized output that differs from candidate bytes; and
- content mode `link_only`.

The parser’s `rawSectionIndex` is candidate order only. If an earlier section is rejected, assign each emitted unit `sectionIndex = acceptedSectionCount` after that candidate passes the canonical gates; later sections cannot change the index of an already accepted section. Final reconciliation confirms the accepted index against the authoritative answer. Never expose a raw candidate index that can shift.

- [ ] **Step 4: Implement exact reconciliation**

Compare normalised serialized fields only after the final answer has passed `buildGovernedAnswerClientResponse`. For an evidence preview, compare source identity and every exposed field. For lead/sections, compare exact text, final section index/object, and citation identity/order. Never reconcile by substring alone.

`buildVerifiedUnitsFromFinal` is the only cache-hit projection. It derives lead/sections from an already finalized cached answer, applies the same deliverability checks, and must reconcile exactly before any cached unit is emitted. Add tests for cache hit success, an older cache entry without the new contract, and a malformed cached answer that emits no units but still follows the governed final/cache-invalidating path.

- [ ] **Step 5: Verify canonical parity**

Run: `node scripts/run-vitest.mjs run tests/answer-unit-finalization.test.ts tests/answer-stream-reconciliation.test.ts tests/answer-incremental-delivery.test.ts tests/answer-verification.test.ts tests/answer-render-policy.test.ts tests/rag-trust.test.ts`

Expected: PASS.

- [ ] **Step 6: Review and checkpoint**

Have the task reviewer explicitly compare the unit path to the authoritative final path and reject any second verifier. Format and conditionally commit:

```bash
npm run format
git add src/lib/rag/answer-unit-finalization.ts src/lib/answer-stream-reconciliation.ts src/lib/answer-verification.ts src/lib/answer-render-policy.ts tests/answer-unit-finalization.test.ts tests/answer-stream-reconciliation.test.ts tests/answer-incremental-delivery.test.ts
git commit -m "feat(rag): verify and reconcile incremental answer units"
```

---

### Task 4: Add an opt-in provider stream without changing buffered fallback

**Files:**

- Modify: `src/lib/openai.ts`
- Modify: `src/lib/rag/rag.ts`
- Modify: `src/app/api/answer/stream/route.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Create: `tests/openai-structured-stream.test.ts`
- Create: `tests/rag-incremental-attempt.test.ts`
- Modify: `tests/answer-stream-preview-order.test.ts`
- Modify: `tests/openai-cache.test.ts`

**Interfaces:**

Consumes the same request body, model/schema/options, timeout/abort/cache/safety inputs as buffered generation plus an internal semantic-candidate callback. Produces a final `OpenAITextResult` while exposing only parsed semantic candidates internally.

```ts
export async function generateStructuredTextStreamResult(
  input: OpenAIResponseInput,
  schema: Record<string, unknown>,
  options: TextGenerationOptions & {
    onSemanticCandidate: (candidate: AnswerSemanticCandidate) => void | Promise<void>;
  },
): Promise<OpenAITextResult>;
```

It uses the same `responseBody`, model, schema, timeout, abort signal, safety identifier, cache key, usage extraction, status checks, and public error mapping as `generateStructuredTextResult`. Provider deltas are pushed only into `createAnswerSemanticUnitParser`; callers never receive a raw delta.

- [ ] **Step 1: Add a fake-provider stream test**

Mock the SDK stream with typed `response.output_text.delta`, `response.completed`, and failure events. Assert callbacks receive only complete semantic candidates, final text matches buffered output, request metadata is preserved, abort stops iteration, and provider delta text is absent from logs/errors. In `tests/rag-incremental-attempt.test.ts`, prove generated-unit emission prohibits same-attempt fast→strong/repair/fallback, reconciliation occurs before log/cache calls, an evidence-preview-only attempt retains current fallback, and cache hits use only `buildVerifiedUnitsFromFinal`.

- [ ] **Step 2: Run tests to establish red**

Run: `node scripts/run-vitest.mjs run tests/openai-structured-stream.test.ts tests/rag-incremental-attempt.test.ts tests/openai-cache.test.ts tests/answer-stream-preview-order.test.ts`

Expected: FAIL because the opt-in provider seam is absent.

- [ ] **Step 3: Implement the SDK 7.4 Responses stream seam**

Use the installed official SDK types and `client.responses.create({ ...body, stream: true }, requestOptions)` or its version-matched `responses.stream` helper. Read the installed SDK source/docs again at implementation time. Do not call the provider in tests.

Add server flag:

```dotenv
RAG_INCREMENTAL_ANSWER_UNITS=false
```

When false, use the existing buffered `generateStructuredTextResult` byte-for-byte. When true, call the streaming seam, finalize candidates, and pass only verified units through the existing `onProgress` callback. A candidate rejection is silent except for a bounded telemetry reason.

- [ ] **Step 4: Reconcile before final event**

In `rag.ts`, retain attempt-local emitted units. Reconcile the fully finalized answer **before** `logRagQuery`, `logAnswerDiagnostics`, persistence, or `setCachedAnswer`; a mismatch throws sanitized code `answer_stream_reconciliation_failed` and cannot write a successful answer/cache entry. The route repeats reconciliation after `buildGovernedAnswerClientResponse` as defense in depth before `complete`/`final`.

Once any generated lead/section unit has crossed the progress callback, the same HTTP attempt cannot internally switch fast→strong, structured repair, or a different generated fallback. A later quality/reconciliation/provider failure ends that stream with `error`; the browser clears previews and an explicit new HTTP retry starts from empty state. Evidence-preview-only attempts may still follow the existing generation route/fallback because no generated prose has been exposed.

- [ ] **Step 5: Verify offline provider and route behaviour**

Run: `node scripts/run-vitest.mjs run tests/openai-structured-stream.test.ts tests/rag-incremental-attempt.test.ts tests/openai-cache.test.ts tests/answer-stream-preview-order.test.ts tests/answer-request.test.ts`

Expected: PASS.

Run: `npm run check:rag:fixtures`

Expected: PASS with the server flag off.

- [ ] **Step 6: Review and checkpoint**

Confirm the disabled path remains the current buffered path; confirm no raw deltas escape callbacks, errors, telemetry, or logs. Format and conditionally commit:

```bash
npm run format
git add src/lib/openai.ts src/lib/rag/rag.ts src/app/api/answer/stream/route.ts src/lib/env.ts .env.example tests/openai-structured-stream.test.ts tests/rag-incremental-attempt.test.ts tests/answer-stream-preview-order.test.ts tests/openai-cache.test.ts
git commit -m "feat(rag): emit verified units from private provider streams"
```

---

### Task 5: Render append-only lead and sections accessibly

**Files:**

- Modify: `src/lib/client-env.ts`
- Modify: `src/components/clinical-dashboard/search-utils.ts`
- Modify: `src/components/clinical-dashboard/answer-request.ts`
- Modify: `src/components/ClinicalDashboard.tsx`
- Create: `src/components/clinical-dashboard/answer-incremental-content.tsx`
- Modify: `.env.example`
- Modify: `tests/answer-progress.test.ts`
- Modify: `tests/answer-request.test.ts`
- Modify: `tests/answer-progress-ui-smoke.spec.ts`
- Modify: `tests/ui-phone-motion.spec.ts`

**Interfaces:** Consumes verified attempt-local lead/section/evidence events and final reconciliation. Produces the attempt-local `IncrementalAnswerPreview` below and append-only accessible rendering; it never renders raw deltas.

```ts
type IncrementalAnswerPreview = {
  evidence: VerifiedEvidencePreviewUnit | null;
  lead: VerifiedAnswerLeadUnit | null;
  sections: VerifiedAnswerSectionUnit[];
  lastSequence: number | null;
};
```

Flag:

```dotenv
NEXT_PUBLIC_RAG_INCREMENTAL_ANSWER_UNITS_RENDER=false
```

- [ ] **Step 1: Add discard, order, and reconciliation tests**

Test that the parser appends sequence 1 then 2, rejects duplicate/out-of-order/unknown units, clears on error/cancel/retry/abort/malformed progress, and replaces preview with the final answer only after exact reconciliation. A final mismatch rejects the request and clears state.

- [ ] **Step 2: Add failing UI smoke cases**

The route stub sends evidence preview, verified lead, verified section, then final with delays. Assert:

- selected evidence appears first;
- a labelled “Answer being verified” region then shows the complete lead and section;
- earlier text never changes;
- only the newly appended unit is announced;
- copy/save/feedback controls remain absent or inert until final;
- final replaces the provisional label without layout collapse; and
- error/retry removes every unit from the failed attempt.

- [ ] **Step 3: Implement the append-only component**

Render complete units through the existing answer text/section components. Use a small `aria-live="polite"` status containing only the newest unit’s heading or “Answer update available”; do not put the entire accumulated answer in a live region. Do not move focus. Reserve layout space with existing design tokens and honour reduced motion.

- [ ] **Step 4: Run focused DOM/client tests**

Run: `node scripts/run-vitest.mjs run tests/answer-progress.test.ts tests/answer-request.test.ts`

Expected: PASS.

- [ ] **Step 5: Run repository browser proof**

Run: `npm run ensure` and use only the printed project URL.

Run the exact repository wrapper:

```text
npm run test:e2e -- tests/answer-progress-ui-smoke.spec.ts tests/ui-phone-motion.spec.ts --project=chromium
```

Expected: PASS at desktop, 390px, and 320px, with reduced motion and no repeated full-answer announcement. Never invoke Playwright directly.

Run `npm run verify:ui` only if the repository selector or PR-handoff policy requires the complete shared-UI gate.

- [ ] **Step 6: Review and checkpoint**

Confirm no final-only action accepts preview content and no preview persists. Format and conditionally commit:

```bash
npm run format
git add src/lib/client-env.ts src/components/clinical-dashboard/search-utils.ts src/components/clinical-dashboard/answer-request.ts src/components/ClinicalDashboard.tsx src/components/clinical-dashboard/answer-incremental-content.tsx .env.example tests/answer-progress.test.ts tests/answer-request.test.ts tests/answer-progress-ui-smoke.spec.ts tests/ui-phone-motion.spec.ts
git commit -m "feat(chat): render verified answer units progressively"
```

---

### Task 6: Telemetry, documentation reconciliation, and staged rollout

**Files:**

- Modify: `src/lib/answer-telemetry.ts`
- Modify: `tests/answer-telemetry.test.ts`
- Modify: `docs/verified-answer-incremental-delivery-design.md`
- Modify: `docs/search-rag-master-context.md`
- Modify: `src/lib/answer-client-payload.ts` comment that still implies prose already streams
- Inspect: `docs/outstanding-issues.md`

**Interfaces:** Consumes accepted final incremental-delivery behavior and evaluation telemetry vocabulary. Produces `recordAnswerDeliveryMetric(event: AnswerDeliveryMetricEvent): void` with content-free fields, reconciled current-state documentation, and an approval-gated rollout handoff; it changes no answer semantics.

- [ ] **Step 1: Add content-free metrics**

Record `first_verified_content_ms`, `first_verified_lead_ms`, `first_verified_section_ms`, emitted/rejected counts by enum, reconciliation result, abort-before-final, cache/buffered/stream route, model class, prompt version, and index generation. Tests must prove query text, answer text, section bodies, citations, and source snippets are absent.

- [ ] **Step 2: Reconcile current documentation**

Update the design’s current-state section to reflect that evidence preview client parsing/rendering landed in `4b601e34f` and remains default-off. Record precisely which Phase 2 tasks are code-ready, provider-gated, canary-gated, or unrun. Correct `answer-client-payload.ts` documentation so it does not claim production prose already streams. Queue the issue correction through:

```text
npm run issues:update -- '#100' --detail "Phase 0 and Phase 1 remain landed and default-off. Phase 2 verified lead and section delivery is code-ready on the reviewed head; provider canary and production activation remain unrun." --source "docs/verified-answer-incremental-delivery-design.md; PR #1909; PR #1999"
```

Do not hand-write the outstanding-issues ledger.

- [ ] **Step 3: Run offline domain gates**

Run: `node scripts/run-vitest.mjs run tests/answer-telemetry.test.ts tests/answer-incremental-delivery.test.ts tests/answer-semantic-unit-parser.test.ts tests/answer-unit-finalization.test.ts tests/answer-progress.test.ts tests/answer-stream-preview-order.test.ts`

Expected: PASS.

Run: `npm run eval:rag:offline`

Expected: PASS.

Run: `npm run check:production-readiness`

Expected: PASS or an accurately reported environment/provider prerequisite; do not bypass it.

Run `npm run verify:pr-local -- --dry-run` on the changed worktree, then run the selected handoff gate once when ready.

- [ ] **Step 4: Stop before paid/live proof without approval**

With separate explicit approval only:

1. capture the buffered baseline using the same de-identified must-pass cases;
2. enable server emission for an internal canary while client rendering remains off and measure reconciliation;
3. require zero reconciliation/access/numeric/citation failures before enabling internal rendering;
4. run `npm run eval:rag -- --limit 15` and `npm run eval:quality -- --rag-only` as authorized;
5. compare final answer identity/quality, p50 first useful content, p95 final latency, cost, abort rate, and provider errors; and
6. stage cohort rollout with independent server/client rollback flags.

- [ ] **Step 5: Final whole-branch review**

The SDD final reviewer must trace one success, verifier rejection, provider failure, abort, retry, cache hit, rolling-deploy old-client path, governance refusal, and final mismatch from provider through UI. Any route that leaves provisional content visible blocks rollout.
