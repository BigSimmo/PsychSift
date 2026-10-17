# Mode-aware Clinical Ask Implementation Plan

_Cloud admission refreshed 2026-10-16 to follow current-host policy; implementation scope and
clinical acceptance criteria are unchanged._

> **For agentic workers:** use `superpowers:executing-plans` and
> `superpowers:subagent-driven-development` when available. Otherwise follow the same admission,
> task tracking, verification and independent-review contracts directly with current host tools.
> Missing optional skills are not a general task blocker; unavailable independent review remains
> explicitly unmet. Neither route authorises push, PR mutation, merge, deployment, hosted migration,
> or live-provider work.

**Goal:** Add an explicit typed-or-dictated Clinical Ask action to Services, Forms, Differentials, Formulation,
DSM-5 Diagnosis, Specifiers, and Therapy that returns the best-supported mode-shaped response from governed
local, indexed, and allowlisted external evidence.

**Architecture:** Extend the existing `GlobalSearchShell` and `MasterSearchHeader` with one in-memory Clinical
Ask session and a responsive answer workspace. A server orchestrator uses an exhaustive mode-profile registry,
then walks a deterministic evidence ladder (catalogue, access-scoped index, allowlisted external authority),
applies evidence-sufficiency and claim-support gates, and streams only public progress plus a governed response.
Speech capture is explicit browser `MediaRecorder` input to a bounded server transcription route; it never
submits automatically.

**Tech stack:** Next.js 16.3 route handlers, React 19.2, TypeScript 6, Zod 4.4, OpenAI JavaScript SDK 7.4
Responses and Audio Transcriptions APIs, Supabase JavaScript 2.112, Vitest 4.1/React DOM tests, repository
Playwright wrappers, existing Clinical KB search/RAG/source-governance primitives.

**Binding design:**
[Mode-aware Clinical Ask specification](../specs/2026-08-21-mode-aware-clinical-ask-design.md) and
[ADR 0001](../../adr/0001-use-a-shared-local-first-clinical-ask-orchestrator.md).

## Current-main refresh record

This revision was reconciled on 22 August 2026 against `origin/main` at
`11550416206e8c90900ddeea0993337824873a55` (`fix(test): stop the provisioner tests reading the
machine's real HOME (#2247)`). That commit is 129 commits ahead of the original approved planning
baseline `4685547904f544fa9e6e27dd07f44b66ac653383`.

The approved product and safety decisions still fit the repository, but implementation must start by
revalidating the current versions of the shared owners. Since the old baseline, current main changed
`ClinicalDashboard`, `GlobalSearchShell`, `MasterSearchHeader`, universal-search mode context, answer routes,
clinical safety, source governance, answer telemetry/thread storage, API errors, logging, security headers,
rate limiting, and relevant tests. It also added the tracked Codex Cloud setup/maintenance/acceptance contracts
in `docs/codex-cloud.md` and the repository's current Node 24/npm 11 environment gate.

Corrections already incorporated in this revision:

- the current header test owner is `tests/master-search-header.dom.test.tsx`;
- rate-limit regression ownership is `tests/api-rate-limit-fallback.test.ts`, with a new focused
  `tests/clinical-ask-rate-limit.test.ts` for the new buckets;
- production-readiness offline/Cloud ownership is `tests/production-readiness-offline.test.ts`;
- `tests/answer-feedback.test.ts` is a new unit contract rather than an existing file;
- the unapplied migration filename is `20260822120000_expand_answer_feedback_for_clinical_ask.sql`, after the
  latest current-main migration `20260820120000_migration_history_versions_rpc.sql`; and
- the old worktree-specific flightplan receipt is historical only. The implementation task must generate a new
  receipt from its own exact changed-path set.

Before Task 1 in a future session, fetch only for read-only comparison when allowed, record the exact current
`origin/main` SHA, and inspect `git diff --name-only
11550416206e8c90900ddeea0993337824873a55..origin/main` for additional drift. Do not merge, rebase, or pull a
stale planning branch into the implementation branch. If a current owner was renamed, adapt that implementation
detail while preserving the binding specification and record a controller ruling. If drift materially changes a
binding product, clinical, privacy, evidence, or interaction decision, stop and ask one consolidated question.

## Codex Cloud execution contract

### Route selection: use available skills without making the feature plugin-dependent

When available, `superpowers:executing-plans` supports plan admission, plan review, sequential advancement through Tasks 1–12,
blocker handling, completion evidence, and branch closeout. Without it, follow the same lifecycle directly;
do not install a plugin or stop the task merely to obtain the skill.
Inside that lifecycle, prefer `superpowers:subagent-driven-development` for each task when the current Codex
Cloud task exposes the named skills and the callable multi-agent tools. This is one controller and one shared
checkout; implementation agents are never parallel.

At task admission, inspect the skills and tools actually exposed to the current session. The preferred route
requires all of:

- `superpowers:executing-plans`, `superpowers:subagent-driven-development`,
  `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch`;
- callable `spawn_agent`, `followup_task`, `wait_agent`, and `list_agents` equivalents;
- at least one worker slot in addition to the controller; and
- a current allowed model list so every spawn can name an available model and explicit reasoning effort rather
  than copying a stale model identifier from this document.

Repository setup does not install Superpowers or enable Codex multi-agent support. Never infer capability from a
local Desktop profile, plugin cache, repository prose, or `[features] multi_agent=true` on another machine. Do
not edit tracked product files, weaken Cloud setup, or copy a local plugin into the repository to manufacture the
capability. If SDD is unavailable but executing-plans exists, record `Execution route: inline executing-plans`.
If the execution skills are unavailable, record `Execution route: direct sequential` and follow the same
checkboxes, verification and independent-review requirements with current tools. Missing optional skills
are not a product blocker; unavailable independent review remains explicitly unmet.

Do not switch routes in the middle of a task. If a subagent tool fails, finish or roll back only the current
task-owned uncommitted increment, update the ledger, and resume inline at the first incomplete checkbox. A route
change never permits duplicate implementation or parallel writers.

### Cloud admission gate

Run this provider-free task using the current host's supported setup. Read `AGENTS.md`,
`docs/agents/codex-cloud-environment.md`, `docs/codex-cloud.md`,
`.agents/skills/prompt-perfector/references/repository-workflow.md`, this complete plan, the binding
specification, and the ADR before writing. Then:

1. Establish current-host capabilities and readiness without printing credential values. The archived
   raw-probe/profile acceptance applies only when the owner or environment explicitly selects that legacy
   setup; preserve its fail-closed checks in that case. Do not force the setup on another Cloud host.
2. Run `npm run check:runtime`, `npm run check:installed-lock-parity`, and
   `npm run check:playwright-browser-revision` for this implementation. Record the decisive line and exit
   code from each. Run `check:codex-cloud` static/runtime acceptance only for the selected legacy profile.
3. Confirm repository identity is `BigSimmo/PsychSift` and verify the intended base commit and ancestry
   from the actual checkout. The legacy profile additionally requires its verified
   `CODEX_CLOUD_EXPECTED_BASE_SHA`. If the host supplied a shallow checkout, use an authorised
   maintenance/refresh path; do not reason about missing history as if it were complete.
4. Confirm the task-specific non-protected branch, expected repository/HEAD and absence of an active Git
   operation. A new task starts clean. For verified same-task continuation, inventory every changed path,
   preserve unrelated work, and bind the continuation to the verifier's `SAFE_STATUS_HASH` using
   `--allow-dirty --expected-status-hash` plus exact expected repository, branch and HEAD. Use `--cloud`
   only after current-host evidence establishes the supplied Cloud workflow. Proceed only on
   `SAFE_TO_EDIT=true` and `PRECHECK_RESULT=SAFE`; dirty state alone does not require a new session.
5. Build `planned_files` from every path in the plan's `Create:` and `Modify:` lists, joined by commas, then run
   `npm run workflow:flightplan -- --write-evidence --files "$planned_files"` and retain its new `.local` receipt.
   The expected domains are `ui`, `database`, `retrieval`, `clinical`, and `privacy`; treat actual output as
   authoritative.
6. Read the version-matched Next 16 guides under `node_modules/next/dist/docs/` before changing any Next route,
   cache, request, streaming, or client/server boundary. Training-data knowledge is not acceptance evidence.

If Cloud reports `CODEX_CLOUD_SKIP_BROWSER_INSTALL=1` or a locked Playwright revision mismatch, classify the task
as source-only. Continue Tasks 1–11 and non-browser Task 12 checks, but leave browser proof explicitly
environment-gated and delegate it to a matching-browser Cloud/CI or local task. Do not point Playwright at a
mismatched system browser and do not claim UI readiness.

### Sequential subagent-driven task loop

When the preferred route is admitted, the controller must:

1. Initialise the skill's persistent ignored ledger at
   `.superpowers/sdd/2026-08-22-mode-aware-clinical-ask-implementation/progress.md`. Verify it is ignored before
   writing clinical/task content; do not accidentally stage it. Record base SHA, route, model/effort choices,
   current task, checkbox state, task commits, commands/results, controller rulings, parked findings, and
   approval/environment gates so context compaction in the same Cloud checkout can resume safely. An ignored
   ledger is not remotely durable: a brand-new checkout can recover only commits that were published or files the
   user explicitly reattaches, and publication remains separately approval-gated.
2. Read each task and its binding specification sections itself, prepare the exact task brief/review package with
   the Superpowers scripts when available, and spawn one fresh implementer with clean context. Always set
   `fork_turns: "none"`, an available model, and explicit reasoning effort. Do not ask the worker to rediscover
   the whole repository or read this 12-task plan from scratch.
3. Allow the implementer to edit only that task's files, write the failing test first, run the named focused
   check, self-review, and create the task-local commit(s). The Codex Cloud handover grants local task-branch
   commits for this route; it does not grant push, PR, merge, rebase, or amend of another task's commits.
4. Wait with bounded event waits of roughly 5–10 minutes rather than short polling. Verify the worker's reported
   diff, commit, test command, exit code, and decisive output in the controller. A report is not evidence by
   itself.
5. Spawn a fresh task reviewer from the generated review package for both specification compliance and code
   quality. The reviewer is read-only and must not broaden scope or rerun costly gates without a concrete doubt.
   Return required fixes to the same implementer via `followup_task`; re-review up to five bounded rounds. Stop
   rather than silently accepting an unresolved material finding.
6. Mark the task complete in the ledger only after focused proof, review approval, and a clean task boundary.
   Then advance sequentially. Never run two implementation agents or overlapping test/build leases at once.
7. After Task 12, use one fresh whole-branch reviewer and at most one controller-owned fix wave. Then run the
   plan's selected final gate and the `finishing-a-development-branch` closeout. Do not publish or merge without
   separate authority.

When the inline route is selected, the controller performs the same checkboxes, TDD steps, focused checks,
controller rulings, and final whole-diff review itself. It may keep an equivalent ignored progress ledger, but it
must not invent subagent review evidence or task commits when commits were not authorised for that route.

Use an available Cloud model suitable for the task; never copy a model name from an older transcript. Apply this
reasoning and commit calibration on the preferred route:

| Task | Build effort | Task-local commit subject                                    | Reviewer emphasis                                    |
| ---- | ------------ | ------------------------------------------------------------ | ---------------------------------------------------- |
| 1    | high         | `feat(clinical-ask): define mode contracts and profiles`     | Exhaustiveness, schema bounds, prohibited outcomes   |
| 2    | high         | `feat(clinical-ask): add ephemeral confirmed case context`   | Memory-only state and handoff leakage                |
| 3    | medium       | `feat(clinical-ask): adapt all mode catalogues to evidence`  | Seven-mode parity and source attribution             |
| 4    | high         | `feat(clinical-ask): add scoped retrieval sufficiency gates` | Owner scope, review state, deterministic gaps        |
| 5    | high         | `feat(clinical-ask): orchestrate governed mode answers`      | Claim support, failure closure, clinical evaluation  |
| 6    | high         | `feat(clinical-ask): stream governed ask responses`          | Abort, terminal events, public errors, rate limits   |
| 7    | high         | `feat(clinical-ask): govern external authority fallback`     | Allowlist, redirects, hostile content, exact extract |
| 8    | high         | `feat(clinical-ask): add bounded speech transcription`       | Consent, caps, cleanup, no automatic submission      |
| 9    | high         | `feat(clinical-ask): integrate the shared ask workspace`     | One composer, accessibility, phone geometry          |
| 10   | high         | `feat(clinical-ask): add structured clinical ask feedback`   | Compatibility, no free text, migration isolation     |
| 11   | high         | `feat(clinical-ask): add privacy and readiness gates`        | Honest readiness states and browser policy           |
| 12   | high         | `test(clinical-ask): prove seven-mode guarded journeys`      | Leakage, failures, accessibility, regression scope   |

If a task necessarily touches files assigned to a later task, keep the smallest compilable seam and record the
dependency in the ledger; do not pre-implement the later behaviour. If a generated documentation update is
required by Task 11, keep it in Task 11's commit after reviewing the generated diff.

### Communication, locks, and stop rules

- Do not ask routine or low-yield questions. Make reversible in-scope assumptions, record material rulings, and
  present all genuinely blocking questions in one ask with a recommendation for each.
- Respect `scripts/test-run-lock.mjs` and repository wrappers. One writer plus sequential tasks avoids checkout
  races; do not install while a repository test, lint, typecheck, build, or server lease is active.
- Never call OpenAI, Supabase, external search, hosted retrieval, ingestion, or another provider in the offline
  task. Use synthetic fixtures and injected mocks. Provider credentials or connector visibility never imply
  authorization.
- Stop immediately for real/sensitive data, destructive or irreversible action, a new dependency/table/durable
  content store, arbitrary external domains, existing ranking changes, hosted migration, live provider use,
  deployment, push/PR/merge, or a binding specification conflict. Otherwise continue to the next checkbox.
- After three repeated attempts with the same failure, classify it, record evidence, and stop or choose the
  documented safe fallback. Never burn the Cloud session by repeating an unchanged failing command.

### Cloud checkpoint and continuation protocol

Do not assume all 12 tasks fit safely in one Cloud context. A task is the smallest resumable boundary; never stop
between its implementation and review if avoidable. Before starting a task, confirm there is enough session budget
to implement, run focused proof, review/fix, and update the ledger. If not, stop at the previous clean reviewed
task commit and produce a continuation block containing:

- repository/branch, full HEAD, refreshed base SHA, execution route, and current model/effort policy;
- completed tasks and their commit SHAs, the next incomplete task/checkbox, and every controller ruling;
- exact checks with exit codes/decisive lines, active or released repository leases, and untracked/ignored state;
- current diff/status, source-only/browser-ready state, environment/approval gates, and parked findings; and
- the six binding repository-relative documents a fresh controller must read before resuming.

Recommended Cloud tranches are Tasks 1–4 (contracts/evidence foundations), 5–8 (orchestration/routes/external/
speech), and 9–12 (shared UI/feedback/governance/end-to-end proof). These are checkpoint recommendations, not
permission to skip cross-tranche dependencies or claim partial work complete. If the same task checkout can be
continued, read the ignored ledger and verify HEAD/status before resuming. If a new checkout is required and the
task branch was not published, stop and explain that the local commits/ledger are unavailable rather than
reimplementing from memory.

## Global constraints

- Support exactly `services`, `forms`, `differentials`, `formulation`, `dsm`, `specifiers`, and
  `therapy-compass`; the repeated Differentials request is one mode.
- Keep ordinary Search, generic Answer, catalogue detail routes, and `appModeHomeHref` behaviour unchanged.
- Preserve the repository's current public-access behaviour while leaving a server-side access-gate seam; the
  clinician/institution access policy is intentionally deferred and must not be silently decided in this build.
- Release all seven modes together. Use a master Clinical Ask flag, an independent external-search flag, and an
  emergency per-mode denylist; ordinary Search remains available when any Clinical Ask flag disables the feature.
- Say “best-supported mode answer”; never promise “most correct”, diagnosis, treatment, eligibility, referral,
  legal determination, allocation, escalation, or disposition.
- A generated/model statement is never evidence. Only catalogue records, original indexed excerpts, and exact
  attributable extracts from an allowlisted HTTPS authority can support an answer claim.
- Keep source review state separate from relevance. Review state can restrict claims or trigger fallback, but
  cannot boost or penalise the existing retrieval ordering.
- Store the question, transcript, context, clarification, response, and external extracts in React memory only.
  Never place them in a URL, `localStorage`, `sessionStorage`, telemetry, logs, feedback text, or provider user ID.
- Case-context suggestions are editable and visually unconfirmed. Retrieval/synthesis may use only
  clinician-confirmed context.
- An identifier-shaped warning blocks provider-backed Clinical Ask until the clinician edits or abandons the
  input. It never auto-redacts or logs the matched value; ordinary local Search remains available.
- The identifier check is a server-enforced control, not a UI convenience. The same `identifierShapeWarning` runs
  on the server for every Clinical Ask and transcription request, before context suggestion, retrieval, synthesis,
  or external search, so a caller that bypasses the browser and posts identifier-shaped clinical text directly to
  the route cannot reach a provider. Both the route gate and the orchestrator gate are mandatory and separately
  tested; the composer warning is an affordance layered on top of them.
- The microphone is tap-to-start/tap-to-stop, hard-stops at 60 seconds and 10 MiB, returns an editable
  transcript, and never auto-submits.
- External fallback is server-only, feature-flagged off by default, and restricted to a repository-owned domain
  registry. A citation without an exact returned extract is navigation-only and cannot support a claim.
- External fallback also runs when directly relevant local support is only `needs_review`, materially
  stale/unknown for a time-sensitive claim, or conflicted. It never removes or upgrades the local evidence.
- Use the existing fast-answer model for context extraction and the existing strong-answer model for final
  synthesis. Evidence sufficiency/governance are deterministic; enforce a 45-second overall deadline and at most
  one explicit bounded retry.
- OpenAI Responses calls set `store: false`. The Audio Transcriptions endpoint has no `store` request field in
  the installed SDK, so use a direct multipart transcription call without Files API upload and keep retention
  claims conditional on verified account/contract controls.
- Preserve authentication, public-access subject, owner-scoped retrieval, abort, timeout, rate-limit,
  synthetic-interaction-ID, and content-free error patterns from `/api/answer/stream`.
- Keep the phone safe-area and fixed-composer ownership. At 320px, render a labelled Search/Ask rail above the
  existing single-row pill and increase the measured reserve; do not squeeze an ambiguous fifth icon into it.
- Preserve 48px targets, keyboard/focus order, reduced motion, forced colours, dark mode, print, and screen-reader
  live-status contracts. Chromium phone proof does not close physical iPhone Safari/PWA microphone acceptance.
- Use synthetic clinical fixtures only. No real patient data or live clinical query is permitted in local proof.
- The eventual PR must declare `RAG impact: behaviour change`; offline green does not establish provider,
  production, privacy-contract, source-governance, or clinical-validation readiness.
- Bound the active conversation to six prior messages plus the current question. Every clinically material
  follow-up reruns evidence sufficiency, and prior generated prose is never promoted to evidence.
- This plan was refreshed from current main at `11550416206e8c90900ddeea0993337824873a55`; every later
  implementation session must still perform the bounded current-main drift check above.

## File responsibility map

### Contracts and orchestration

- Create `src/lib/clinical-ask/contracts.ts`: public mode, context, evidence, claim, section, response, request,
  dependency, and handoff types; no provider SDK types cross this boundary.
- Create `src/lib/clinical-ask/mode-profiles.ts`: exhaustive seven-mode registry, section order, accepted context,
  clarification rules, evidence domains, handoffs, and prohibited outcomes.
- Create `src/lib/clinical-ask/context.ts`: suggestion sanitisation, confirmed-context projection, identifier-shaped
  warning, deterministic material-clarification evaluation, and cross-mode context reduction. The module stays pure
  and runtime-agnostic so the SSE route and the orchestrator import the same identifier check the composer uses.
- Create `src/lib/clinical-ask/catalogue-evidence.ts`: adapters over the existing seven local catalogues.
- Create `src/lib/clinical-ask/indexed-evidence.ts`: owner-scoped `searchChunksWithTelemetry` adapter and
  `SearchResult` to `ClinicalAskEvidence` projection.
- Create `src/lib/clinical-ask/authority-registry.ts`: per-mode publisher/domain allowlists and strict URL checks.
- Create `src/lib/clinical-ask/external-evidence.ts`: OpenAI web-search request plus exact-result normalisation;
  no provider narrative enters evidence.
- Create `src/lib/clinical-ask/evidence-sufficiency.ts`: deterministic coverage/conflict/currentness/review-state
  decision without LLM confidence. Coverage is computed against the specific request rather than the profile alone,
  so the gate takes typed per-evidence coverage annotations instead of inferring support from source metadata.
- Create `src/lib/clinical-ask/synthesis.ts`: context-suggestion and mode-response structured-output calls using
  evidence IDs only.
- Create `src/lib/clinical-ask/response-governance.ts`: section validation, clinical-value atom checks,
  claim-to-evidence support, prohibited-output checks, and fail-closed response shaping.
- Create `src/lib/clinical-ask/orchestrator.ts`: ordered state machine with injected dependencies.
- Create `src/lib/clinical-ask/telemetry.ts`: content-free mode/tier/state/latency/failure metadata only.
- Create `src/lib/clinical-ask-stream-contract.ts`: SSE event schemas, encoder, parser, and public error codes.
- Create `src/lib/clinical-ask/client-stream.ts`: browser stream reader with abort and terminal-event enforcement.
- Create `src/lib/validation/clinical-ask-request.ts`: bounded request Zod schema.
- Create `src/lib/validation/speech-transcription-request.ts`: MIME, byte, and duration constants plus multipart
  validation helpers.

### Routes, provider configuration, and governance

- Create `src/app/api/clinical-ask/stream/route.ts`: validated auth/rate-limited SSE route.
- Create `src/app/api/speech/transcribe/route.ts`: validated auth/rate-limited transcription route.
- Modify `src/lib/openai.ts`: add `clinical_ask`, `external_search`, and `transcription` operation labels while
  retaining the existing client, retry, timeout, and error mapping.
- Modify `src/lib/env.ts` and `.env.example`: parse/document `OPENAI_TRANSCRIPTION_MODEL`,
  `CLINICAL_ASK_ENABLED`, `CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED`, and `CLINICAL_ASK_DISABLED_MODES`; default the
  master and external flags to disabled, the emergency denylist to empty, and transcription model to
  `gpt-4o-mini-transcribe`.
- Modify `src/lib/api-rate-limit.ts`: add authenticated/anonymous `clinical_ask` and `speech_transcription`
  buckets, and extend both the `failsClosedOnLimiterUnavailable` predicate and the anonymous aggregate-ceiling
  branch to recognise them. Adding bucket names and defaults alone leaves both new buckets on the per-process
  in-memory fallback during a durable-limiter outage.
- Modify `src/lib/security-headers.ts`: change `Permissions-Policy` microphone from `()` to `(self)`; keep provider
  origins out of browser `connect-src`.
- Modify `src/lib/privacy-page-content.tsx`: explain ephemeral sessions, transcription, external search,
  cross-border processing, audio disposal, and the limits of retention/de-identification claims.
- Modify `scripts/production-readiness.ts`, `docs/production-readiness-checklist.md`,
  `docs/privacy-impact-assessment.md`, `docs/clinical-governance.md`, and `docs/openai-rag-operations.md`: add
  the feature flag, provider/model, privacy, source-governance, evaluation, and canary gates.
- Modify `docs/codebase-index.md` through `npm run docs:update`: record both additive API routes and shared UI
  owners; there is no new production page route.

### Shared UI and session

- Create `src/components/clinical-dashboard/clinical-ask-session-context.tsx`: memory-only reducer/provider and
  supported-mode handoff.
- Create `src/components/clinical-dashboard/clinical-ask-composer-actions.tsx`: Search/Ask rail, microphone button,
  recording/transcription states, transcript review, context confirmation, and privacy pause.
- Create `src/components/clinical-dashboard/use-clinical-ask-speech.ts`: MediaRecorder state machine, timer, byte
  cap, upload, abort, retry, URL revocation, and disposal.
- Create `src/components/clinical-dashboard/clinical-ask-workspace.tsx`: clarification, progress, evidence preview,
  final response, failure, clear-case, and handoff review states.
- Create `src/components/clinical-dashboard/clinical-ask-answer-surface.tsx`: typed mode sections rendered with
  existing source/evidence/copy/feedback/follow-up primitives.
- Modify `src/components/clinical-dashboard/global-search-shell.tsx`: mount one provider outside dashboard and
  standalone branches, preserve ordinary query routing, and swap the active main-content surface only after an
  explicit Ask action.
- Modify `src/components/ClinicalDashboard.tsx`: consume the same provider/workspace and pass supported-mode
  composer state to the existing header.
- Modify `src/components/clinical-dashboard/master-search-header.tsx`: keep one form/input, wire explicit Search,
  Ask, and mic controls, and preserve search submit semantics.
- Modify `src/components/clinical-dashboard/mobile-composer-reserve.ts` and `src/app/globals.css`: add supported
  Clinical Ask and combined Differentials-compare reserve/backdrop/hide-transform tokens.

### Structured feedback

- Modify `src/lib/answer-feedback.ts` and `src/app/api/answer-feedback/route.ts`: accept the seven structured
  Clinical Ask reasons with no free text.
- Create `supabase/migrations/20260822120000_expand_answer_feedback_for_clinical_ask.sql`: replace the feedback
  category check constraint with the existing plus new values.

### Tests and fixtures

- Create `tests/fixtures/clinical-ask-cases.ts`: synthetic cases for all modes, missing context, negation,
  contradiction, review state, jurisdiction conflict, unsupported numbers, prompt injection, provider failure,
  speech error, and abort.
- Create the `tests/clinical-ask-*.test.ts` unit/contract/evaluation files named in the tasks below.
- Create `tests/speech-transcription-route.test.ts` and `tests/ui-clinical-ask.spec.ts`.
- Modify `tests/master-search-header.dom.test.tsx`, `tests/mobile-composer-reserve.test.ts`,
  `tests/mobile-chrome-paint-contract.test.ts`, `tests/phone-dock-addon-contract.test.ts`,
  `tests/security-headers.test.ts`, `tests/privacy-ui.test.ts`, `tests/answer-feedback-route.test.ts`, and
  `tests/production-readiness-offline.test.ts`.
- Create `tests/clinical-ask-rate-limit.test.ts` and `tests/answer-feedback.test.ts` for the new focused contracts.

## Stable interfaces used by every task

Create these public contracts once in Task 1 and keep later names/signatures exact:

```ts
export const clinicalAskModeIds = [
  "services",
  "forms",
  "differentials",
  "formulation",
  "dsm",
  "specifiers",
  "therapy-compass",
] as const;
export type ClinicalAskModeId = (typeof clinicalAskModeIds)[number];

export type ClinicalAskContextField =
  | "ageGroup"
  | "careSetting"
  | "jurisdiction"
  | "workingDiagnosis"
  | "presentationFeatures"
  | "duration"
  | "impairment"
  | "exclusions"
  | "course"
  | "serviceLocation"
  | "eligibilityFacts"
  | "pathwayStage"
  | "referralPurpose"
  | "formPurpose"
  | "clinicalLegalStage"
  | "responsibleRole"
  | "therapyGoals"
  | "population"
  | "cautions"
  | "availabilityConstraints"
  | "priorResponse";

export type ConfirmedCaseContext = Partial<Record<ClinicalAskContextField, string | string[]>>;

export type ContextSuggestion = {
  id: string;
  field: ClinicalAskContextField;
  value: string | string[];
  status: "suggested" | "confirmed" | "rejected";
};

export type EvidenceTier = "catalogue" | "indexed" | "external";
export type SourceReviewState = "reviewed" | "needs_review" | "unknown";

export type ClinicalAskEvidence = {
  id: string;
  tier: EvidenceTier;
  title: string;
  publisher: string;
  jurisdiction: string | null;
  href: string;
  extract: string;
  reviewState: SourceReviewState;
  publishedAt: string | null;
  updatedAt: string | null;
  retrievedAt: string | null;
};

export type ClinicalAskClaim = {
  id: string;
  text: string;
  evidenceIds: string[];
};

export type ClinicalAskSection = {
  id: string;
  title: string;
  claims: ClinicalAskClaim[];
};

export type ClinicalAskClarification = {
  id: string;
  field: ClinicalAskContextField;
  prompt: string;
  required: true;
};

export type ClinicalAskHandoff = {
  targetMode: ClinicalAskModeId;
  label: string;
  acceptedContext: ConfirmedCaseContext;
};

export type ClinicalAskPublicErrorCode =
  | "invalid_request"
  | "identifiable_input_blocked"
  | "unauthorized"
  | "rate_limited"
  | "retrieval_unavailable"
  | "external_unavailable"
  | "synthesis_invalid"
  | "provider_unavailable"
  | "timeout"
  | "aborted"
  | "internal_error";

export type ClinicalAskDraft = {
  mode: ClinicalAskModeId;
  lead: ClinicalAskClaim;
  sections: ClinicalAskSection[];
  conflicts: ClinicalAskClaim[];
  missingInformation: string[];
  followUps: string[];
  handoffs: ClinicalAskHandoff[];
};

export type ClinicalAskFeedbackMetadata = {
  interactionId: string;
  answerHash: string;
  feedbackToken: string;
};

export type ClinicalAskFinalPayload = {
  response: ClinicalAskResponse;
  feedback: ClinicalAskFeedbackMetadata | null;
};

export type ClinicalAskProgressStage =
  | "validating"
  | "confirming_context"
  | "clarifying"
  | "catalogue"
  | "indexed"
  | "external"
  | "synthesizing"
  | "governing"
  | "complete";

export type ClinicalAskProgressEvent = {
  type: "progress";
  stage: ClinicalAskProgressStage;
  elapsedMs: number;
};

export type ClinicalAskStreamEvent =
  | ClinicalAskProgressEvent
  | { type: "context_suggestions"; suggestions: ContextSuggestion[] }
  | { type: "clarification"; response: Extract<ClinicalAskResponse, { state: "clarification_required" }> }
  | { type: "evidence"; evidence: ClinicalAskEvidence[] }
  | { type: "final"; payload: ClinicalAskFinalPayload }
  | {
      type: "error";
      code: ClinicalAskPublicErrorCode;
      retryable: boolean;
      message: string;
    };

export type ClinicalAskResponse =
  | {
      state: "clarification_required";
      mode: ClinicalAskModeId;
      suggestions: ContextSuggestion[];
      clarifications: ClinicalAskClarification[];
    }
  | {
      state: "answered";
      mode: ClinicalAskModeId;
      lead: ClinicalAskClaim;
      sections: ClinicalAskSection[];
      evidence: ClinicalAskEvidence[];
      conflicts: ClinicalAskClaim[];
      missingInformation: string[];
      followUps: string[];
      handoffs: ClinicalAskHandoff[];
    }
  | {
      state: "evidence_gap";
      mode: ClinicalAskModeId;
      explanation: string;
      evidence: ClinicalAskEvidence[];
      missingInformation: string[];
      nextActions: string[];
    }
  | {
      state: "failed";
      mode: ClinicalAskModeId;
      code: ClinicalAskPublicErrorCode;
      retryable: boolean;
      message: string;
    };

export type ClinicalAskRequest = {
  mode: ClinicalAskModeId;
  question: string;
  confirmedContext: ConfirmedCaseContext;
  clarificationAnswers: Partial<Record<string, string>>;
  priorTurns: Array<{ role: "user" | "assistant"; text: string }>;
  allowExternalFallback: boolean;
  inputTransport: "typed" | "voice";
};

export type ClinicalAskDependencies = {
  suggestContext(input: ClinicalAskRequest, signal: AbortSignal): Promise<ContextSuggestion[]>;
  retrieveCatalogue(input: ClinicalAskRequest, signal: AbortSignal): Promise<ClinicalAskEvidence[]>;
  retrieveIndexed(
    input: ClinicalAskRequest,
    accessScope: RetrievalAccessScope,
    signal: AbortSignal,
  ): Promise<ClinicalAskEvidence[]>;
  retrieveExternal(
    input: ClinicalAskRequest,
    allowedDomains: readonly string[],
    signal: AbortSignal,
  ): Promise<ClinicalAskEvidence[]>;
  synthesize(
    input: ClinicalAskRequest,
    evidence: readonly ClinicalAskEvidence[],
    signal: AbortSignal,
  ): Promise<ClinicalAskDraft>;
};
```

The internal `ClinicalAskDraft` is never sent to the client until `governClinicalAskDraft(...)` returns an
`answered` or `evidence_gap` response.

## Task 1: Freeze public contracts, request validation, profiles, and synthetic cases

**Files**

- Create: `src/lib/clinical-ask/contracts.ts`
- Create: `src/lib/clinical-ask/mode-profiles.ts`
- Create: `src/lib/validation/clinical-ask-request.ts`
- Create: `tests/fixtures/clinical-ask-cases.ts`
- Create: `tests/clinical-ask-mode-profiles.test.ts`
- Create: `tests/clinical-ask-request.test.ts`

**Interfaces**

- Produces: all stable interfaces above.
- Produces:
  `clinicalAskModeProfile(mode: ClinicalAskModeId): ClinicalAskModeProfile` and
  `isClinicalAskModeId(value: AppModeId): value is ClinicalAskModeId`.
- Produces: `clinicalAskRequestSchema: z.ZodType<ClinicalAskRequest>`.

**Steps**

- [ ] Add a failing exhaustive-profile test:

  ```ts
  import { describe, expect, it } from "vitest";
  import { clinicalAskModeIds } from "@/lib/clinical-ask/contracts";
  import { clinicalAskModeProfiles } from "@/lib/clinical-ask/mode-profiles";

  describe("Clinical Ask mode profiles", () => {
    it("defines one profile for every supported mode and no extras", () => {
      expect(Object.keys(clinicalAskModeProfiles).sort()).toEqual([...clinicalAskModeIds].sort());
    });

    it.each(clinicalAskModeIds)("%s declares sections, context, sources, handoffs, and prohibitions", (mode) => {
      const profile = clinicalAskModeProfiles[mode];
      expect(profile.sectionOrder.length).toBeGreaterThan(2);
      expect(profile.acceptedContextFields.length).toBeGreaterThan(0);
      expect(profile.indexedDomains.length).toBeGreaterThan(0);
      expect(profile.allowedAuthorityIds.length).toBeGreaterThan(0);
      expect(profile.prohibitedOutcomes.length).toBeGreaterThan(0);
      expect(new Set(profile.sectionOrder).size).toBe(profile.sectionOrder.length);
    });
  });
  ```

- [ ] Run `npm test -- tests/clinical-ask-mode-profiles.test.ts`; expect failure because the contracts/profile
      modules do not exist.
- [ ] Implement the stable contracts and this exact profile table:

  | Mode            | Section order                                                                                                                       | Material clarification fields                                            | Handoffs                     |
  | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
  | Services        | `potential_matches`, `fit_reasons`, `eligibility`, `access_pathway`, `missing_information`                                          | `serviceLocation`, `population`, `pathwayStage`, `referralPurpose`       | Forms                        |
  | Forms           | `potential_forms`, `jurisdiction_stage`, `purpose`, `prerequisites`, `responsibility`, `submission_pathway`                         | `jurisdiction`, `clinicalLegalStage`, `formPurpose`, `responsibleRole`   | Services                     |
  | Differentials   | `candidate_possibilities`, `supporting_clues`, `contradicting_clues`, `discriminators`, `must_not_miss`, `missing_assessment`       | `presentationFeatures`, `duration`, `careSetting`                        | DSM-5 Diagnosis, Formulation |
  | Formulation     | `mechanism_hypotheses`, `predisposing`, `precipitating`, `perpetuating`, `protective`, `evidence_against`, `questions_to_test`      | `presentationFeatures`, `course`, `careSetting`                          | Differentials, Therapy       |
  | DSM-5 Diagnosis | `candidate_mapping`, `apparently_supported`, `duration`, `impairment`, `exclusions`, `differential_gaps`                            | `workingDiagnosis`, `duration`, `impairment`, `exclusions`               | Specifiers, Differentials    |
  | Specifiers      | `potential_specifiers`, `base_diagnosis_applicability`, `features_for`, `features_against`, `missing_criteria`, `incompatibilities` | `workingDiagnosis`, `course`, `impairment`, `presentationFeatures`       | DSM-5 Diagnosis              |
  | Therapy         | `potential_options`, `rationale`, `population_setting_fit`, `cautions`, `practical_requirements`, `alternatives`                    | `therapyGoals`, `population`, `careSetting`, `cautions`, `priorResponse` | Formulation                  |

  The profile type is:

  ```ts
  export type ClinicalAskModeProfile = {
    id: ClinicalAskModeId;
    label: string;
    sectionOrder: readonly string[];
    acceptedContextFields: readonly ClinicalAskContextField[];
    materialClarificationFields: readonly ClinicalAskContextField[];
    catalogueDomains: readonly string[];
    indexedDomains: readonly string[];
    allowedAuthorityIds: readonly string[];
    handoffModes: readonly ClinicalAskModeId[];
    prohibitedOutcomes: readonly string[];
  };
  ```

- [ ] Implement `clinicalAskRequestSchema` with: 2,000-character trimmed question; at most 21 known context
      fields; 20 strings per array and 500 characters per scalar; at most 8 clarification answers; at most 6 prior
      turns of 2,000 characters; strict objects; no arbitrary metadata.
- [ ] Add validation tests that reject unsupported modes, unknown context keys, blank/oversized questions,
      excessive turns, and unknown top-level keys, while accepting all seven fixture requests.
- [ ] Build one synthetic fixture per mode plus explicit variants for missing context, negation, conflicting
      jurisdiction, needs-review evidence, unsupported duration/number, external prompt injection, rejected redirect,
      provider failure, aborted recording, and expired session. Use fictional names such as “Example Community
      Clinic”; include no real person or record identifier.
- [ ] Run
      `npm test -- tests/clinical-ask-mode-profiles.test.ts tests/clinical-ask-request.test.ts`; expect all assertions
      green.

## Task 2: Implement confirmed-context projection and the memory-only session

**Files**

- Create: `src/lib/clinical-ask/context.ts`
- Create: `src/components/clinical-dashboard/clinical-ask-session-context.tsx`
- Create: `tests/clinical-ask-context.test.ts`
- Create: `tests/clinical-ask-session.dom.test.tsx`
- Modify: `src/components/clinical-dashboard/global-search-shell.tsx`

**Interfaces**

- Consumes: `ClinicalAskModeId`, `ConfirmedCaseContext`, `ContextSuggestion`, `ClinicalAskResponse`.
- Produces:
  `clarificationsFor(mode, context): ClinicalAskClarification[]`,
  `projectConfirmedContext(mode, context, suggestions?): ConfirmedCaseContext`,
  `identifierShapeWarning(text): boolean`, and
  `handoffContext(source, target, context): ConfirmedCaseContext`.
- Produces: `ClinicalAskSessionProvider`, `useClinicalAskSession()`, and reducer actions
  `setDraft`, `setSuggestions`, `confirmSuggestion`, `rejectSuggestion`, `submit`, `receiveEvent`, `prepareHandoff`,
  `acceptHandoff`, `cancel`, and `clear`.

**Steps**

- [ ] Add deterministic context tests:

  ```ts
  it("never treats a suggestion as confirmed context", () => {
    const suggestions = [
      { id: "s1", field: "workingDiagnosis", value: "bipolar disorder", status: "suggested" },
    ] as const;
    expect(projectConfirmedContext("specifiers", {}, suggestions)).toEqual({});
  });

  it("reduces a handoff to fields accepted by the target profile", () => {
    expect(
      handoffContext("dsm", "specifiers", {
        workingDiagnosis: "bipolar disorder",
        course: "current episode",
        serviceLocation: "Perth",
      }),
    ).toEqual({ workingDiagnosis: "bipolar disorder", course: "current episode" });
  });
  ```

- [ ] Run `npm test -- tests/clinical-ask-context.test.ts`; expect module-not-found failure.
- [ ] Implement context projection by iterating the target profile’s `acceptedContextFields`; never spread the
      inbound object. Generate clarification IDs as `${mode}:${field}` and copy prompts from a constant exhaustive
      `Record<ClinicalAskContextField, string>`.
- [ ] Implement a warning-only identifier-shape detector for email, telephone, Medicare-like digit groups,
      common record-number labels, and exact dates of birth. It returns only a boolean and does not log, redact, or
      mutate the text.
- [ ] Keep `identifierShapeWarning` pure and runtime-agnostic: no DOM, `window`, `document`, React, or
      browser-only imports, so the SSE route, the transcription route, and the orchestrator can enforce the identical
      check server-side. Add a test that imports it in a server-style module context and asserts verdicts identical
      to the composer's for the shared fixture strings.
- [ ] Add a DOM test that mounts `ClinicalAskSessionProvider`, writes draft/context/answer, calls `clear`, and
      proves an empty initial state. Spy on `Storage.prototype.setItem`, `history.pushState`, and
      `history.replaceState`; expect zero calls containing the synthetic question.
- [ ] Implement the provider with `useReducer` only. Do not add persistence effects. Keep `AbortController` and
      retry audio Blob in refs; `clear`, unmount, account change, and abort revoke/discard them.
- [ ] Mount exactly one provider at the outer `GlobalSearchShell` level so both `ClinicalDashboard` and
      standalone mode surfaces consume the same session. Do not change existing query state or search navigation.
- [ ] Wire the provider’s `clear` action into Clear case, the existing New chat action, sign-out/account-change
      cleanup, and shell unmount. Browser refresh naturally recreates the provider with its empty initial state; no
      rehydration path is allowed.
- [ ] Run
      `npm test -- tests/clinical-ask-context.test.ts tests/clinical-ask-session.dom.test.tsx`; expect green and no
      storage/history leak assertion failures.

## Task 3: Normalize local catalogue evidence for every mode

**Files**

- Create: `src/lib/clinical-ask/catalogue-evidence.ts`
- Create: `tests/clinical-ask-catalogue-evidence.test.ts`

**Interfaces**

- Consumes: `ClinicalAskRequest`, `ClinicalAskEvidence`.
- Produces:
  `retrieveCatalogueEvidence(request: ClinicalAskRequest, signal: AbortSignal): Promise<ClinicalAskEvidence[]>`.
- Reuses exactly: `searchServiceRecords`, `searchFormRecords`, `searchDifferentialRecords`,
  `searchPresentationWorkflows`, `searchFormulationMechanisms`, `rankDsmDiagnoses`, `searchSpecifiers`,
  `specifierCatalogItems`, `searchTherapyRecords`, and `therapySourceMetadata`.

**Steps**

- [ ] Add a table-driven test that calls the adapter for all seven fixtures and asserts: at least one result;
      `tier === "catalogue"`; a stable prefixed ID; non-empty title, extract, href, publisher; and a valid review
      state. Assert a therapy needs-review record remains `needs_review` and is not ranked up because of governance.
- [ ] Run `npm test -- tests/clinical-ask-catalogue-evidence.test.ts`; expect module-not-found failure.
- [ ] Implement one private pure adapter per mode and one exhaustive switch. Build extracts only from repository
      record fields; never call a model. Limit each mode to 12 records and each extract to 2,000 characters.
- [ ] Preserve existing ranking order and map source governance without feeding it back into ordering. Use stable
      IDs such as `catalogue:services:${slug}` and canonical internal detail hrefs from existing navigation helpers.
- [ ] For DSM/Specifiers, use the repository’s authorised summaries and links only; do not add or reconstruct
      copyrighted criteria text.
- [ ] Check `signal.aborted` before and after catalogue work and throw `AbortError` without logging the request.
- [ ] Run the focused test; expect all mode rows green.

## Task 4: Add owner-scoped indexed evidence and deterministic sufficiency

**Files**

- Create: `src/lib/clinical-ask/indexed-evidence.ts`
- Create: `src/lib/clinical-ask/evidence-sufficiency.ts`
- Create: `tests/clinical-ask-evidence-sufficiency.test.ts`
- Create: `tests/clinical-ask-indexed-evidence.test.ts`

**Interfaces**

- Consumes: `ClinicalAskRequest`, `ClinicalAskEvidence`, `RetrievalAccessScope`, profile indexed domains.
- Produces:
  `retrieveIndexedEvidence(request, accessScope, signal): Promise<ClinicalAskEvidence[]>`,
  `annotateEvidenceCoverage(profile, request, evidence): EvidenceCoverageAnnotation[]`, and
  `assessEvidenceSufficiency(input: EvidenceSufficiencyInput): EvidenceSufficiencyDecision`.
- Sufficiency is request-dependent by construction. A `(profile, evidence)` signature cannot decide whether the
  requested claim is supported: `ClinicalAskEvidence` carries only generic source metadata plus an extract, so two
  materially different questions retrieving the same evidence set would produce an identical decision even when
  only one of them is actually supported - permitting unsupported synthesis, or skipping the external fallback that
  the coverage gap should have triggered. The requested claim and its typed per-evidence coverage/conflict
  annotations are therefore explicit inputs rather than something the gate is expected to infer.
- `ClinicalClaimKind`, `EvidenceCoverageAnnotation`, and `EvidenceSufficiencyInput` are:

  ```ts
  export type ClinicalClaimKind =
    | "numeric"
    | "duration"
    | "threshold"
    | "criterion"
    | "eligibility"
    | "form_requirement"
    | "contact"
    | "therapy"
    | "narrative";

  export type EvidenceCoverageAnnotation = {
    evidenceId: string;
    sectionId: string;
    claimKind: ClinicalClaimKind;
    /** Request/section atoms this extract literally supports. */
    matchedAtoms: string[];
    /** Request/section atoms this extract does not support. */
    unmatchedAtoms: string[];
    directlySupports: boolean;
    conflictsWithEvidenceIds: string[];
  };

  export type EvidenceSufficiencyInput = {
    profile: ClinicalAskModeProfile;
    request: ClinicalAskRequest;
    evidence: readonly ClinicalAskEvidence[];
    coverage: readonly EvidenceCoverageAnnotation[];
  };
  ```

- `EvidenceSufficiencyDecision` is:

  ```ts
  export type EvidenceSufficiencyDecision = {
    sufficient: boolean;
    coveredSectionIds: string[];
    missingSectionIds: string[];
    unresolvedConflictIds: string[];
    /** Request atoms no supplied evidence covers; must be empty for `sufficient: true`. */
    uncoveredRequestAtoms: string[];
    externalFallbackReason: "coverage_gap" | "needs_review" | "stale_or_unknown" | "conflict" | null;
  };
  ```

**Steps**

- [ ] Add indexed-adapter tests that mock `searchChunksWithTelemetry` and assert it receives the selected mode’s
      query, `accessScope`, `allowGlobalSearch: !accessScope.ownerId`, the request signal, and no fabricated owner ID.
- [ ] Implement the adapter over `searchChunksWithTelemetry`. Convert only returned `SearchResult` excerpts into
      `indexed:*` evidence and keep the original document href/publisher/jurisdiction/review metadata. Do not return
      retrieval score, query correction, internal document ID, telemetry, or embedding details to the client.
- [ ] Add sufficiency fixtures proving: review state never changes relevance order; missing numerical support is
      insufficient; a needs-review-only source triggers fallback; conflict stays insufficient; unknown currentness
      remains unknown; and direct covered reviewed evidence can be sufficient.
- [ ] Add the request-dependence test that pins this interface: run two materially different questions for the
      same mode against one identical `ClinicalAskEvidence[]`, where the extracts cover the first question's required
      atoms and not the second. Assert the covered question returns `sufficient: true` with an empty
      `uncoveredRequestAtoms`, and the uncovered question returns `sufficient: false` with
      `externalFallbackReason: "coverage_gap"` and the missing atoms listed. Any change that makes both questions
      return the same decision must fail this test.
- [ ] Implement `annotateEvidenceCoverage` as a pure deterministic function of profile, request, and evidence.
      Derive the required atoms from the confirmed request and the profile's required section fields with
      `extractClinicalValueAtoms`, and decide `directlySupports` per evidence item with
      `sourceDirectlySupportsAnswerText` over the same minimal `SearchResult` adaptation Task 5 uses. Never call a
      model, and never let review state or tier alter the atom match.
- [ ] Implement sufficiency as pure deterministic functions over the supplied coverage annotations, cited extracts,
      review state, dates, and conflicts. Do not accept a model confidence input, and do not re-derive coverage from
      the evidence alone: `sufficient: true` requires every required section id covered by at least one
      `directlySupports` annotation and an empty `uncoveredRequestAtoms`.
- [ ] Run
      `npm test -- tests/clinical-ask-indexed-evidence.test.ts tests/clinical-ask-evidence-sufficiency.test.ts`; expect
      green.

## Task 5: Build synthesis, response governance, and the injectable orchestrator

**Files**

- Create: `src/lib/clinical-ask/synthesis.ts`
- Create: `src/lib/clinical-ask/response-governance.ts`
- Create: `src/lib/clinical-ask/orchestrator.ts`
- Create: `src/lib/clinical-ask/telemetry.ts`
- Create: `tests/clinical-ask-response-governance.test.ts`
- Create: `tests/clinical-ask-orchestrator.test.ts`
- Create: `tests/clinical-ask-eval.test.ts`

**Interfaces**

- Produces:
  `suggestClinicalAskContext(request, signal): Promise<ContextSuggestion[]>`,
  `synthesizeClinicalAskDraft(request, evidence, signal): Promise<ClinicalAskDraft>`,
  `governClinicalAskDraft(profile, draft, evidence): ClinicalAskResponse`, and
  `runClinicalAsk(request: ClinicalAskRequest, accessScope: RetrievalAccessScope, dependencies: ClinicalAskDependencies, signal: AbortSignal, onEvent: (event: ClinicalAskProgressEvent) => void): Promise<ClinicalAskResponse>`.
- `onEvent` accepts public stages only:
  `validating`, `confirming_context`, `clarifying`, `catalogue`, `indexed`, `external`, `synthesizing`,
  `governing`, `complete`.

**Steps**

- [ ] Add governance tests with actual adversarial drafts: an uncited clinical claim, evidence ID not in the
      supplied set, unsupported duration, copied prompt-injection instruction, wrong section ID/order, definitive
      diagnosis wording, automatic referral wording, and a valid Specifiers answer. Expect invalid claims omitted;
      expect an `evidence_gap` if the lead or a required section loses support.
- [ ] Adapt each evidence item to the minimal existing `SearchResult` shape and reuse
      `sourceDirectlySupportsAnswerText`. Reuse `extractClinicalValueAtoms` to require direct extract support for every
      number, duration, threshold, criterion, eligibility condition, form requirement, contact, and therapy claim.
- [ ] Implement an exhaustive mode-specific prohibited-phrase/pattern gate plus neutral claim verbs. It is a final
      safety gate, not a replacement for the evidence check. Preserve conflicts rather than choosing a winner.
- [ ] Implement structured OpenAI calls through `createOpenAIClient`. The system input contains the profile,
      confirmed context, and evidence records marked as untrusted data. The response schema permits only profile
      section IDs and evidence IDs supplied in the request. Use `store: false`, synthetic interaction ID, explicit
      timeout/abort, and no raw question in provider `user` metadata.
- [ ] Route context suggestion extraction through `OPENAI_FAST_ANSWER_MODEL` and final synthesis through
      `OPENAI_STRONG_ANSWER_MODEL`. Wrap the complete orchestration in a 45-second deadline. Permit one explicit
      bounded retry only for a transient provider failure or invalid structured output; abort and deadline errors do
      not retry, and no retry may bypass evidence or governance gates.
- [ ] Add orchestrator tests using injected fakes for these exact paths:
  1. missing material context returns `clarification_required` before retrieval;
  2. sufficient catalogue/indexed evidence skips external search;
  3. insufficient evidence calls external only when request preference and feature gate allow it;
  4. external failure degrades to local answer or `evidence_gap`;
  5. invalid synthesis returns `evidence_gap`, never an uncited fallback;
  6. abort stops later tiers and returns no final clinical answer;
  7. every state event is monotonic and content-free;
  8. the 45-second deadline returns a safe failure/evidence-only fallback;
  9. one retry is the maximum and reruns response governance; and
  10. an identifier-shaped question returns `failed` with `identifiable_input_blocked` while every injected
      dependency fake - `suggestContext`, `retrieveCatalogue`, `retrieveIndexed`, `retrieveExternal`, and
      `synthesize` - records zero calls.
- [ ] Implement `runClinicalAsk` in this order: validate/project confirmed context; run the server identifier gate
      and return `failed` with `identifiable_input_blocked` before any provider or external call when it trips;
      suggest context; return material clarifications; catalogue; indexed; annotate coverage for this request;
      assess; optional external; reassess; synthesize; govern; terminal response. Keep each tier’s relevant evidence
      visible and stable-order concatenated. The identifier gate sits immediately after context projection precisely
      because the next step, context suggestion, is provider-backed.
- [ ] Implement telemetry as an allowlisted object:

  ```ts
  type ClinicalAskTelemetry = {
    mode: ClinicalAskModeId;
    inputTransport: "typed" | "voice";
    clarificationOccurred: boolean;
    tiersUsed: EvidenceTier[];
    externalResult: "not_attempted" | "used" | "empty" | "rejected" | "failed";
    responseState: ClinicalAskResponse["state"];
    failureClass: string | null;
    latencyBucket: "lt_1s" | "1_3s" | "3_10s" | "gte_10s";
  };
  ```

  Add a test that serialises telemetry and proves the synthetic question, transcript, context values, answer,
  extracts, and URLs are absent.

- [ ] Run the three focused suites; expect all synthetic seven-mode evaluation rows and adversarial rows green.

## Task 6: Define the SSE contract, route, and abortable browser reader

**Files**

- Create: `src/lib/clinical-ask-stream-contract.ts`
- Create: `src/lib/clinical-ask/client-stream.ts`
- Create: `src/app/api/clinical-ask/stream/route.ts`
- Create: `tests/clinical-ask-stream-contract.test.ts`
- Create: `tests/clinical-ask-route.test.ts`
- Modify: `src/lib/api-rate-limit.ts`
- Create: `tests/clinical-ask-rate-limit.test.ts`

**Interfaces**

- Produces: `ClinicalAskStreamEvent` union with `progress`, `context_suggestions`, `clarification`, `evidence`,
  `final`, and `error` events; `encodeClinicalAskSse(event): string`; `parseClinicalAskSseFrame(frame)`; and
  `streamClinicalAsk(request, signal, onEvent): Promise<ClinicalAskFinalPayload>`.
- Route consumes stable request/dependency contracts and `resolveRetrievalAccessScope(access.ownerId)`.

**Steps**

- [ ] Add contract tests that round-trip every event, reject unknown event/data keys, reject evidence extracts over
      2,000 characters, enforce one terminal event, and prove raw provider output cannot parse as a public event.
- [ ] Implement SSE encoding with named events, heartbeat comments, monotonic stages, and one final/error terminal
      frame. The error envelope exposes only an allowlisted code, retryability, and generic message.
- [ ] Add route tests that mock `publicAccessContext`, `consumeSubjectApiRateLimit`, the orchestrator, and owner
      scope. Assert auth happens before retrieval, bucket `clinical_ask` is consumed, owner scope is passed, validation
      rejects unknown input, 429 returns safely, abort reaches the orchestrator, and headers include
      `text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, and content-free `Server-Timing`.
- [ ] Implement `POST` by following `/api/answer/stream`: strict body parse; demo/local path only when existing env
      policy permits it; `publicAccessContext`; rate limit; `mergeAbortSignals`; synthetic UUID; `setAgentConversationId`;
      `runClinicalAsk`; `jsonError`/`PublicApiError` mapping. Never pass the question to logger/error details.
- [ ] Add the server identifier gate between the rate limit and `runClinicalAsk`. Run the shared
      `identifierShapeWarning` over the submitted question, clarification answers, and confirmed-context values; when
      it trips, return the `identifiable_input_blocked` error envelope (`retryable: false`, generic message) without
      building dependencies, resolving owner scope, or calling the orchestrator. Never log, echo, or return the
      matched substring. Apply the identical gate in `src/app/api/speech/transcribe/route.ts` for any text field it
      accepts. This is the enforcement point: a caller can bypass the composer, and without this gate
      identifier-shaped clinical text reaches the provider-backed context-suggestion step inside `runClinicalAsk`.
- [ ] Extend the route tests to prove it. POST identifier-shaped clinical text directly to the route with the
      orchestrator mocked, and assert an `identifiable_input_blocked` error frame, zero orchestrator invocations,
      zero OpenAI client construction, and the matched substring absent from the response body, `Server-Timing`, and
      the logger mock.
- [ ] Preserve the current `publicAccessContext` decision while keeping access resolution in one route-owned helper
      so a later authenticated/institutional gate does not require changes to orchestration, evidence, or UI code.
- [ ] For an `answered` response only, canonicalise the governed visible answer text and call the existing
      `answerFeedbackMetadata(interactionId, canonicalText)`. Send it as `ClinicalAskFinalPayload.feedback`; send
      `null` for clarification, Evidence Gap, and failure. Pass only existing UUID-backed indexed source IDs to the
      feedback route; catalogue slugs and external URLs stay out of UUID database columns.
- [ ] Add rate-limit buckets with authenticated defaults `20/minute` for `clinical_ask` and `12/minute` for
      `speech_transcription`; anonymous defaults `4/minute` and `3/minute`.
- [ ] Retaining fail-closed production behaviour needs a logic change, not just new bucket names and defaults. In
      `src/lib/api-rate-limit.ts`, `failsClosedOnLimiterUnavailable` currently returns
      `bucket === "answer" || bucket === "document_upload"`, and the anonymous aggregate-ceiling path is guarded by
      `if (args.bucket !== "answer" && args.bucket !== "document_upload")`. Add `clinical_ask` and
      `speech_transcription` to both branches and update the explanatory comment above the predicate. Left
      unchanged, a durable-limiter outage silently drops both new buckets onto the per-process in-memory fallback,
      giving N times the intended limit across N horizontally-scaled instances and multiplying paid-provider spend by
      the instance count - the exact failure the existing predicate exists to prevent for `answer`.
- [ ] Add limiter-outage tests in `tests/clinical-ask-rate-limit.test.ts` covering both new buckets. With
      `NODE_ENV=production` and the durable limiter RPC failing, an authenticated subject must fail closed rather
      than be allowed by the in-memory fallback; an anonymous subject must consume the stable
      `anon:<bucket>:global` aggregate ceiling as well as its own subject key, and be limited once that ceiling is
      exhausted even while its subject counter still has headroom. Assert the same behaviour for `answer` in the
      same test so the suite proves the shared branch rather than a bucket-specific special case.
- [ ] Implement the browser reader with a streaming `TextDecoder`, frame buffer, Zod parse, terminal-state guard,
      and AbortSignal. A malformed event aborts and yields a generic failed response without showing raw data.
- [ ] Run
      `npm test -- tests/clinical-ask-stream-contract.test.ts tests/clinical-ask-route.test.ts tests/clinical-ask-rate-limit.test.ts`;
      expect green.

## Task 7: Add governed external-authority fallback

**Files**

- Create: `src/lib/clinical-ask/authority-registry.ts`
- Create: `src/lib/clinical-ask/external-evidence.ts`
- Create: `tests/clinical-ask-authority-registry.test.ts`
- Create: `tests/clinical-ask-external-evidence.test.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Modify: `src/lib/openai.ts`

**Interfaces**

- Produces:
  `authorityDomainsForMode(mode): readonly string[]`,
  `validateAuthorityUrl(mode, rawUrl): URL | null`, and
  `retrieveExternalEvidence(request, allowedDomains, signal): Promise<ClinicalAskEvidence[]>`.

**Steps**

- [ ] Add registry tests that accept HTTPS canonical pages from `health.wa.gov.au`,
      `chiefpsychiatrist.wa.gov.au`, `safetyandquality.gov.au`, `healthdirect.gov.au`, `tga.gov.au`, `ranzcp.org`,
      `nice.org.uk`, and `who.int` only where the mode profile permits them. Reject HTTP, credentials, IP literals,
      lookalike suffixes, tracking-only redirects, fragments used as evidence identity, and unknown domains.
- [ ] Implement named publisher records with domain, publisher, jurisdiction, allowed modes, and review note.
      Return normalised lower-case hostnames and strip tracking parameters from canonical evidence hrefs.
- [ ] Add external-adapter tests around a fake OpenAI response containing: exact allowlisted result text; citation
      only without result text; an off-domain redirect; prompt injection in title/body; an overlong extract; duplicate
      URLs; and provider failure. Expect only the exact allowlisted result text to become evidence.
- [ ] Implement a Responses request equivalent to:

  ```ts
  await client.responses.create(
    {
      model: env.OPENAI_ANSWER_MODEL,
      store: false,
      input: governedSearchInput,
      tools: [{ type: "web_search", filters: { allowed_domains: [...allowedDomains] }, search_context_size: "medium" }],
      include: ["web_search_call.action.sources", "web_search_call.results"],
    },
    { signal, timeout: externalSearchTimeoutMs },
  );
  ```

  Parse raw `web_search_call.results` through a strict local Zod schema because SDK 7.4.0’s typed action source
  surface does not expose exact result extracts. A URL citation without a non-empty exact returned result extract
  remains a navigation link and is not emitted as `ClinicalAskEvidence`.

- [ ] Mark all page text/title/metadata as untrusted data in the provider input. Do not fetch arbitrary page bodies,
      follow non-allowlisted redirects, import results to the index, or use provider narrative/model knowledge as
      evidence. DSM/Specifier gaps stay gaps when no licensed approved source supports them.
- [ ] Parse `CLINICAL_ASK_ENABLED` and `CLINICAL_ASK_EXTERNAL_SEARCH_ENABLED` as false by default and
      `CLINICAL_ASK_DISABLED_MODES` as a strict comma-separated subset of the seven IDs. Test the master flag,
      external flag, and per-mode emergency denylist independently.
- [ ] Run the two focused suites; expect green without network access.

## Task 8: Add bounded speech transcription without automatic submission

**Files**

- Create: `src/lib/validation/speech-transcription-request.ts`
- Create: `src/app/api/speech/transcribe/route.ts`
- Create: `src/components/clinical-dashboard/use-clinical-ask-speech.ts`
- Create: `tests/speech-transcription-route.test.ts`
- Create: `tests/clinical-ask-speech.dom.test.tsx`
- Modify: `src/lib/openai.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

**Interfaces**

- Produces speech states `idle`, `requesting_permission`, `listening`, `stopping`, `transcribing`,
  `ready_to_review`, `permission_denied`, `unsupported`, `failed`, `cancelled`.
- Produces hook actions `start()`, `stop()`, `retryTranscription()`, `cancel()`, and `reset()` plus `transcript`,
  `elapsedMs`, `error`, and `canRetry`.
- Route returns `{ transcript: string; model: string; durationMs: number | null }`; it never returns audio,
  provider request body, or provider identifiers.

**Steps**

- [ ] Add route tests for authentication, `speech_transcription` rate limit, missing file, accepted browser MIME
      aliases, rejected MIME, zero bytes, over 10 MiB, declared duration over 60 seconds, abort, timeout, provider
      error, no-store response headers, and absence of file name/audio/account/clinical content in logger calls.
- [ ] Implement constants:

  ```ts
  export const maxClinicalAskAudioBytes = 10 * 1024 * 1024;
  export const maxClinicalAskRecordingMs = 60_000;
  export const clinicalAskAudioMimeTypes = new Set([
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
  ]);
  ```

- [ ] Implement the route with `request.formData()`, strict file/duration validation, existing public-access/rate
      limit patterns, and direct
      `client.audio.transcriptions.create({ file, model: env.OPENAI_TRANSCRIPTION_MODEL })`. Do not upload through the
      OpenAI Files API and do not add a nonexistent `store` property. Set `Cache-Control: no-store`.
- [ ] Add hook tests with fake `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, timers, and fetch. Prove:
      explicit stop; 60-second hard stop; size abort; permission-denied/unsupported paths; transcript remains editable;
      no call to Ask/Search on completion; retry reuses only the in-memory blob; cancel/unmount stops tracks, aborts
      fetch, clears timer, and drops the blob.
- [ ] Implement the hook with refs for stream/recorder/chunks/controller/timer. Prefer a supported MIME chosen via
      `MediaRecorder.isTypeSupported`; collect chunks only in memory; stop all tracks immediately after recorder stop;
      discard on success/cancel/unmount.
- [ ] Add `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe` to `.env.example` and the env parser; do not claim
      account retention controls are verified.
- [ ] Run the route and hook suites; expect green without microphone hardware or provider access.

## Task 9: Wire the shared composer, review flow, answer surface, and phone reserve

**Files**

- Create: `src/components/clinical-dashboard/clinical-ask-composer-actions.tsx`
- Create: `src/components/clinical-dashboard/clinical-ask-workspace.tsx`
- Create: `src/components/clinical-dashboard/clinical-ask-answer-surface.tsx`
- Modify: `src/components/clinical-dashboard/master-search-header.tsx`
- Modify: `src/components/clinical-dashboard/global-search-shell.tsx`
- Modify: `src/components/ClinicalDashboard.tsx`
- Modify: `src/components/clinical-dashboard/mobile-composer-reserve.ts`
- Modify: `src/app/globals.css`
- Modify: `tests/master-search-header.dom.test.tsx`
- Modify: `tests/mobile-composer-reserve.test.ts`
- Modify: `tests/mobile-chrome-paint-contract.test.ts`
- Modify: `tests/phone-dock-addon-contract.test.ts`
- Create: `tests/clinical-ask-workspace.dom.test.tsx`

**Interfaces**

- Consumes: session hook, stream client, speech hook, profile registry, governed response.
- `MasterSearchHeader` receives additive props:
  `clinicalAskMode?: ClinicalAskModeId`,
  `onClinicalAsk?: () => void`,
  `clinicalAskActive?: boolean`, and
  `clinicalAskActions?: ReactNode`.
- `resolveDashboardVisibleMobileComposerReserve` and `resolveShellVisibleMobileComposerReserve` receive
  `clinicalAskActionsVisible: boolean`.

**Steps**

- [ ] Add header tests proving Enter and the existing submit button still call ordinary Search; `Ask {Mode}` calls
      only `onClinicalAsk`; the mic never invokes either action; unsupported modes render no Ask/mic controls; and
      loading/recording have accessible names and transient native disabled states.
- [ ] Add workspace tests for transcript edit, suggestion confirm/reject, privacy-warning pause, material
      clarification focus, evidence expansion, failed/evidence-gap states, clear case, and handoff review. Assert the
      response never renders hidden prompt/provider/retrieval-score fields.
- [ ] Prove an identifier-shaped draft keeps ordinary Search enabled but disables microphone upload and Clinical
      Ask submission until the text is edited. The UI states only that identifiable details should be removed; it
      never displays the matched substring or claims de-identification.
- [ ] Implement a labelled Search/`Ask {Mode}` action rail immediately above the existing pill on phones and a
      compact adjacent labelled action on wider layouts. Keep the existing `<form onSubmit={onAsk}>` as Search; make
      Clinical Ask a separate `type="button"`. The mic is `type="button"`, announces recording/transcribing state, and
      inserts transcript into the controlled draft without submission.
- [ ] Keep the Clinical Ask review/workspace in the current main-content owner. Use existing `Sheet` only for
      responsive context/handoff review (`placement="responsive-right"`, `mobilePlacement="fullscreen"`); the answer
      itself is not a modal.
- [ ] Render the answer with existing evidence/source/copy/feedback/follow-up visual primitives, but use
      `ClinicalAskEvidence` directly instead of forcing it into `SearchResult`. The lead appears first; sections,
      missing information, conflicts, evidence ladder, and source-review states use progressive disclosure.
- [ ] When offline, leave the existing local catalogue Search enabled and disable only Ask with an accessible
      “Clinical Ask needs the server evidence path” reason. Do not fabricate a cached/generated answer. Restore Ask
      when the browser returns online without changing the draft.
- [ ] Copy/print omits the question unless explicitly checked and always includes mode, caveats, conflicts,
      citations, external retrieval date, and verification reminder. Never include audio or rejected suggestions.
- [ ] Add reserve constants keyed to CSS custom properties rather than duplicating arithmetic:

  ```ts
  export const mobileComposerClinicalAskReserve = "calc(9rem + var(--safe-area-bottom) + var(--keyboard-height, 0px))";
  export const mobileComposerDifferentialsCompareClinicalAskReserve =
    "calc(16rem + var(--safe-area-bottom) + var(--keyboard-height, 0px))";
  ```

  Exact rem values may change only after a live DOM measurement at 320px; if changed, update the matching CSS
  tokens and contract tests in the same diff. Clinical Ask wins over the normal dock reserve; combined
  Differentials compare+Ask wins over either individual reserve. Hero-owned composer surfaces retain in-flow
  layout and the idle content pad.

- [ ] Add `data-clinical-ask-actions="true"` separately from `data-footer-addon`. Preserve the one-page-addon rule;
      Clinical Ask is shared composer chrome, not a third page-owned addon kind. Add backdrop and hide-transform
      coverage for normal and combined states.
- [ ] Run
      `npm test -- tests/master-search-header.dom.test.tsx tests/clinical-ask-workspace.dom.test.tsx tests/mobile-composer-reserve.test.ts tests/mobile-chrome-paint-contract.test.ts tests/phone-dock-addon-contract.test.ts`;
      expect green.

## Task 10: Expand structured feedback through a separately deployable migration

**Files**

- Modify: `src/lib/answer-feedback.ts`
- Modify: `src/app/api/answer-feedback/route.ts`
- Create: `tests/answer-feedback.test.ts`
- Modify: `tests/answer-feedback-route.test.ts`
- Create: `supabase/migrations/20260822120000_expand_answer_feedback_for_clinical_ask.sql`

**Interfaces**

- Adds exact reasons: `wrong_mode`, `missed_source`, `unsupported_conclusion`,
  `important_information_missing`, `source_conflict`, `outdated_source`, `presentation_problem`.
- Retains the existing feedback token/interaction ownership and request authentication.

**Steps**

- [ ] Add tests that each new reason validates, free-text/unknown keys fail, existing reasons remain compatible,
      and no question/context/answer/extract can be attached to the request.
- [ ] Update the shared reason tuple and route schema; render the same structured choices in the answer surface.
- [ ] Replace the type-only declaration with
      `answerFeedbackTypes = ["verified", "needs_correction", "source_insufficient", "wrong_source", "missing_source", "unsupported_answer", "numeric_error", "outdated_guidance", "wrong_mode", "missed_source", "unsupported_conclusion", "important_information_missing", "source_conflict", "outdated_source", "presentation_problem"] as const`,
      derive `AnswerFeedbackType` from it, and use `z.enum(answerFeedbackTypes)` in the route.
- [ ] Write an idempotent migration that executes
      `alter table public.rag_answer_feedback drop constraint if exists rag_answer_feedback_feedback_category_check`
      followed by a new constraint with that exact name and the 15-value union above. Do not alter rows, retention,
      ownership, grants, or policies. `database.types.ts` remains unchanged because the generated column type is
      already `string`; the database check constraint is the enforcement owner.
- [ ] Run
      `npm test -- tests/answer-feedback.test.ts tests/answer-feedback-route.test.ts tests/hosted-migration-role-guard.test.ts`;
      expect green locally. Do not apply the migration to a hosted project in this task.

## Task 11: Complete security, privacy, operations, and production-readiness contracts

**Files**

- Modify: `src/lib/security-headers.ts`
- Modify: `tests/security-headers.test.ts`
- Modify: `src/lib/privacy-page-content.tsx`
- Modify: `tests/privacy-ui.test.ts`
- Modify: `scripts/production-readiness.ts`
- Modify: `tests/production-readiness-offline.test.ts`
- Modify: `docs/privacy-impact-assessment.md`
- Modify: `docs/clinical-governance.md`
- Modify: `docs/openai-rag-operations.md`
- Modify: `docs/production-readiness-checklist.md`
- Modify: `docs/codebase-index.md`

**Interfaces**

- Security policy exposes microphone to self only.
- Production-readiness reports code/config presence separately from live provider, hosted migration, source
  governance, contractual retention/region, physical-device, clinical evaluation, and canary evidence.

**Steps**

- [ ] Update the header test first to expect `microphone=(self)` and prove no OpenAI/provider origin was added to
      browser connection policy.
- [ ] Change the header and run `npm test -- tests/security-headers.test.ts`; expect green.
- [ ] Add privacy copy assertions for: do not enter identifiable details; Singapore/OpenAI cross-border
      processing; ephemeral memory-only case session; audio disposal; external authority citations; raw content absent
      from URL/history/feedback/telemetry; and no guarantee of de-identification, zero retention, approval, or
      production readiness.
- [ ] Update production-readiness checks to require explicit master/external flag state, empty emergency denylist
      for the launch claim, transcription model, migration state, approved authority registry, synthetic evaluation
      artefact, protected-staging live canary artefact, and physical iPhone acceptance. Missing live evidence must
      report blocked/not verified rather than pass.
- [ ] Update governance/operations docs with the seven-mode evidence ladder, exact authority change process,
      provider output boundary, no durable external import, source-review-state semantics, and rollback by feature
      flag. Run `npm run docs:update` and review the generated index diff.
- [ ] Run
      `npm test -- tests/privacy-ui.test.ts tests/production-readiness-offline.test.ts && npm run docs:check-links && npm run docs:check-inventory`;
      expect unit tests and documentation checks green.

## Task 12: Prove all seven journeys, accessibility, leakage boundaries, and handoff readiness

**Files**

- Create: `tests/ui-clinical-ask.spec.ts`
- Modify only if an assertion exposes a defect: files owned by Tasks 1–11

**Interfaces**

- Browser tests use mocked transcription, external-search, indexed retrieval, and synthesis responses; no live
  provider or patient data.
- Tag the core typed/voice/clarification journey `@critical` so the repository wrapper selects it.

**Steps**

- [ ] Add browser routes/fixtures that run one typed Ask per mode and assert the exact mode section order, evidence
      links, review state, missing-information/conflict rendering, and prohibited-outcome absence.
- [ ] Add mocked voice journey: grant fake permission, record, stop, receive transcript, edit it, confirm context,
      and explicitly press Ask. Assert zero request to Clinical Ask before the final button activation.
- [ ] Add material clarification, external fallback, external rejection, provider failure, clear-case, refresh,
      and cross-mode handoff journeys. Inspect the address bar and browser storage after each; raw fixture content must
      be absent.
- [ ] At 320, 390, 768, and 1440px prove no horizontal page scroll; Search/Ask/mic and recording controls remain
      above the effective safe-area reserve; Differentials compare+Ask does not cover results; keyboard focus moves to
      transcript, clarification, progress, then answer status.
- [ ] Add axe, keyboard-only, dark mode, reduced-motion, forced-colours, print/copy, and abort assertions. Keep
      screenshots synthetic and free of clinical text that resembles a real person.
- [ ] Run `npm run ensure`; use only the printed URL after `/api/local-project-id` confirms this worktree.
- [ ] Run `npm run test:e2e:critical`; expect the tagged Clinical Ask journey and existing critical journeys green.
- [ ] Inspect the final diff for accidental route/search changes, content leakage, debug output, arbitrary web
      access, source-ranking changes, generated/provider claims, and unrelated work.
- [ ] Run `npm run verify:pr-local` once as the fail-closed local handoff gate; record the exact exit code and
      decisive output. Do not stack `verify:cheap`, full Playwright, build, and other broad gates when this selector
      already covers the same failure classes.

## Specification coverage self-review

| Binding specification requirement                                                   | Owning tasks                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Seven modes, product boundary, ordinary Search/Answer unchanged                     | 1, 3, 5, 9                                                |
| Explicit typed/dictated review-confirm-clarify-answer flow                          | 2, 6, 8, 9                                                |
| Memory-only session, confirmed context, reduced handoff, destructive clear          | 2, 9, 12                                                  |
| Shared orchestrator and request/response contracts                                  | 1, 5, 6                                                   |
| Seven mode answer shapes and prohibited outcomes                                    | 1, 5, 12                                                  |
| Catalogue-indexed-external Evidence Ladder and deterministic sufficiency            | 3, 4, 5, 7                                                |
| Allowlisted external fallback, exact extracts, prompt-injection/redirect defence    | 5, 7, 12                                                  |
| Explicit 60-second/10-MiB speech and editable no-auto-submit transcript             | 8, 9, 12                                                  |
| Privacy, security, abort, owner scope, rate limit, no content leakage               | 2, 5, 6, 8, 11, 12                                        |
| Progressive answer, source review state, copy/print, accessibility, phone safe area | 9, 12                                                     |
| Clarification, offline, tier/provider/synthesis/conflict fallbacks                  | 5, 7, 8, 9, 12                                            |
| Structured feedback and content-free telemetry                                      | 5, 6, 10                                                  |
| Synthetic evaluation, RAG declaration, live/physical-device gates                   | 5, 11, 12                                                 |
| Non-goals and approval boundary                                                     | Global constraints, approval-gated proof, stop conditions |

No binding specification section is intentionally deferred from the code/test sequence. Hosted migration,
provider-backed evaluation, governance/contract sign-off, deployment, and physical-device acceptance remain
explicit evidence gates because repository implementation cannot perform or self-authorise them.

## Approval-gated proof after local implementation

The refreshed path inventory is expected to classify this change as `ui`, `database`, `retrieval`, `clinical`,
and `privacy`. The implementation session must run the current flightplan and record its own exact classification
and `.local/workflow-evidence/` receipt; the old planning-worktree receipt is not evidence for a future diff.

Do not run these until the user explicitly approves the exact protected staging target, provider data exposure,
spend ceiling, mutations, and hosted state:

1. `npm run check:supabase-project` — confirm the exact protected staging project before any migration or live
   evaluation.
2. Apply `20260822120000_expand_answer_feedback_for_clinical_ask.sql` through the repository's authorised hosted
   migration workflow; local migration presence is not deployment evidence.
3. `npm run check:production-readiness` — provider/config/governance readiness, not a substitute for clinical
   evaluation.
4. `npm run eval:retrieval:quality` — live 36-case golden retrieval evidence.
5. `npm run eval:rag -- --limit 15` — governed live answer sample with synthetic queries only.
6. `npm run eval:quality -- --rag-only` — live grounded-answer invariants.
7. Repository live baseline/post canary — required because `RAG impact: behaviour change`; use the exact approved
   protected staging environment and synthetic prompts only. Any unsupported clinical conclusion, unsupported
   number/criterion, invalid citation, authority violation, raw-content leak, or existing retrieval regression fails
   the canary; latency and cost are reported but cannot offset a critical failure.
8. Physical iPhone Safari and installed-PWA microphone acceptance — separate from Chromium emulation.
9. Source-governance, privacy/contract/retention/region, and clinical-safety sign-off — repository code cannot
   self-certify these.

## Completion evidence and stop conditions

Milestones are distinct:

- **Local implementation ready:** the source, synthetic/offline tests, mocked browser proof, and local handoff gate
  below pass.
- **Implementation complete:** all seven modes are merged after the hosted migration and zero-critical-failure
  provider canaries pass in the explicitly confirmed protected staging environment.
- **Production active:** a separate deployment decision after clinical/privacy/source-governance sign-off and
  physical-device acceptance. Neither of the earlier milestones implies this state.

Local implementation is ready for user review only when:

- all seven profiles have synthetic typed and mocked-voice coverage;
- unsupported, contradictory, needs-review, external-rejected, aborted, expired, and provider-failed cases expose
  clarification, Evidence Gap, conflict, or generic failure rather than an uncited conclusion;
- the raw-content leakage tests pass for URL, storage, telemetry, logs, error envelopes, feedback, copy defaults,
  and screenshots;
- ordinary Search/generic Answer regression tests pass unchanged;
- the focused browser proof and one `verify:pr-local` gate are recorded honestly;
- `git diff --check` is clean and the diff contains only this feature plus generated documentation/types required
  by repository contracts; and
- branch, worktree, behind/ahead status, local versus hosted migration state, provider checks, physical-device
  checks, and all unrun approval gates are reported separately.

Stop and ask before proceeding if implementation requires a new database table, durable case/transcript storage,
arbitrary external domains, real patient data, a new dependency, a change to existing search ranking, hosted
migration, live provider call, deployment, an unplanned commit outside the admitted SDD route, push, PR, or
material scope beyond this plan.
