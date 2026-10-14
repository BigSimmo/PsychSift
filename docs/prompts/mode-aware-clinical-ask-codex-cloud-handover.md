# Codex Cloud handover: implement Mode-aware Clinical Ask

Paste the prompt below into a fresh Codex Cloud task whose checkout contains this entire planning pack. Use the
repository's offline Cloud environment. The prompt deliberately stops at hosted/provider, migration,
publication, and physical-device gates until those actions are separately authorised.

---

You are Codex Cloud completing **Mode-aware Clinical Ask** in the PsychSift (`BigSimmo/PsychSift`) repository.
Implement the approved feature end to end through the **Local implementation ready** milestone. Work
directly from the approved design and executable 12-task plan; do not redesign the feature from
memory or replace it with a generic chatbot.

## Outcome

In each of the seven unique supported modes — Services, Forms, Differentials, Formulation, DSM-5
Diagnosis, Specifiers, and Therapy — a clinician can type or dictate natural language, review and
edit the transcript, confirm non-identifying Case Context, explicitly choose `Ask {Mode}`, and receive
a concise, source-linked, mode-shaped best-supported answer. Ordinary Search and generic Answer must
retain their existing behaviour.

The feature is clinician-facing reference and decision support. It is not an autonomous diagnostic,
treatment, legal, referral-allocation, form-submission, or patient-record system. Unsupported claims
must become an Evidence Gap; conflicts and source review states remain visible; clinically material
suggestions require Clinician Confirmation.

## Binding input pack: availability gate

Read these files completely, in this order, before editing:

1. [Repository instructions](../../AGENTS.md)
2. [Clinical Knowledge Support terminology](../../CONTEXT.md)
3. [Accepted architecture decision](../adr/0001-use-a-shared-local-first-clinical-ask-orchestrator.md)
4. [Approved binding design specification](../superpowers/specs/2026-08-21-mode-aware-clinical-ask-design.md)
5. [Executable 12-task implementation plan](../superpowers/plans/2026-08-22-mode-aware-clinical-ask-implementation.md)
6. [Codex Cloud environment contract](../codex-cloud.md)

Codex Cloud cannot follow the Windows worktree paths where this pack was authored. The branch/commit selected in
Cloud must contain these repository-relative documents, or the complete files must be attached to the task. A
local uncommitted plan is not Cloud-visible. Before doing any work, verify that all six files are present and
readable. If any are missing, stop and request every missing file in one consolidated message. Do not reconstruct
them from this summary or model memory.

Treat the specification and plan as binding. If current `origin/main` makes a named implementation
detail obsolete, preserve the approved product, clinical, privacy, evidence, and interaction
contracts while adapting the smallest implementation detail to the current owner. Record the drift
and rationale. If adaptation would materially change a binding decision, stop and ask.

## Repository documents to review

After the binding input pack, read the relevant sections of every document below before changing its
domain:

- [Wiring conventions](../wiring-conventions.md) — required before adding or moving buttons, links,
  or routes.
- [Search chrome behaviour](../search-chrome-behaviour.md) — preserve the one-composer and current
  Search ownership contracts.
- [Codebase index](../codebase-index.md) — locate current shared owners; regenerate only through the
  repository workflow when the plan requires it.
- [Clinical governance](../clinical-governance.md) — clinical-output and source-governance boundary.
- [OpenAI and RAG operations](../openai-rag-operations.md) — provider, retrieval, evaluation, and
  canary contracts.
- [Privacy impact assessment](../privacy-impact-assessment.md) — identifiers, data minimisation,
  cross-border processing, retention, and logging constraints.
- [Production-readiness checklist](../production-readiness-checklist.md) — keep code readiness,
  protected-staging acceptance, and production activation separate.
- [Codex Cloud execution guide](../codex-cloud.md) — Cloud is provider-free unless an exact live
  action is separately authorised.
- [Repository isolation workflow](../../.agents/skills/prompt-perfector/references/repository-workflow.md)
  — verify the exact clean Cloud checkout or intentionally dirty same-task continuation before
  writing.
- [Process hardening](../process-hardening.md) — select the smallest distinct checks and use the
  repository run coordinator.
- [Review protocol](../codex-review-protocol.md) — required only if a review, audit, PR-readiness, or
  release-readiness pass is later requested.
- [Pull-request governance checklist](../../.github/pull_request_template.md) — use as a governance
  completeness reference; this prompt does not authorise opening or updating a PR.

For every Next.js file you change, first read the version-matched relevant guide under
`node_modules/next/dist/docs/`, as required by `AGENTS.md`. Do not rely on generic Next.js knowledge.

## Current implementation owners to inspect

Ground the work in these current repository owners. Follow renamed/replaced owners on refreshed
`origin/main`; do not create parallel navigation, search, composer, answer, privacy, retrieval, or
source-governance stacks.

### Shared modes, composer, and responsive UI

- [Canonical app modes](../../src/lib/app-modes.ts)
- [Universal-search mode context](../../src/lib/universal-search-mode-context.ts)
- [Global search shell](../../src/components/clinical-dashboard/global-search-shell.tsx)
- [Master search header](../../src/components/clinical-dashboard/master-search-header.tsx)
- [Mobile composer reserve owner](../../src/components/clinical-dashboard/mobile-composer-reserve.ts)
- [Clinical dashboard composition root](../../src/components/ClinicalDashboard.tsx)

### Retrieval, evidence, answers, safety, and observability

- [RAG orchestrator](../../src/lib/rag/rag.ts)
- [RAG claim support](../../src/lib/rag/rag-claim-support.ts)
- [Answer verification](../../src/lib/answer-verification.ts)
- [OpenAI server boundary](../../src/lib/openai.ts)
- [Existing answer stream route](../../src/app/api/answer/stream/route.ts)
- [Clinical safety](../../src/lib/clinical-safety.ts)
- [Source governance](../../src/lib/source-governance.ts)
- [Answer telemetry](../../src/lib/answer-telemetry.ts)
- [Logger](../../src/lib/logger.ts)
- [API rate limiting](../../src/lib/api-rate-limit.ts)
- [API client error contract](../../src/lib/api-client-error.ts)

### Privacy, feedback, and browser security

- [Security headers](../../src/lib/security-headers.ts)
- [Privacy page content](../../src/lib/privacy-page-content.tsx)
- [Answer feedback contract](../../src/lib/answer-feedback.ts)
- [Answer feedback route](../../src/app/api/answer-feedback/route.ts)
- [Answer thread storage](../../src/lib/answer-thread-storage.ts)

### Mode catalogues and source policy

- [Services catalogue](../../src/lib/services.ts)
- [Forms catalogue](../../src/lib/forms.ts)
- [Differentials catalogue](../../src/lib/differentials.ts)
- [Formulation catalogue](../../src/lib/formulation.ts)
- [DSM catalogue](../../src/lib/dsm.ts)
- [Specifiers catalogue](../../src/lib/specifiers.ts)
- [Therapies catalogue](../../src/lib/therapies.ts)
- [Therapy source governance](../../src/lib/therapy-source-governance.ts)

The approved plan has been refreshed against `origin/main` at
`11550416206e8c90900ddeea0993337824873a55`, 129 commits after the original approval baseline
`4685547904f544fa9e6e27dd07f44b66ac653383`. That refresh rechecked the shared owners and corrected drifted test,
migration, readiness, and Cloud paths. Treat the SHA and count as a dated lower bound, not current proof. At task
start, record the current `origin/main` SHA and inspect only the additional drift from the refreshed SHA. Do not
merge, rebase, or pull the stale original planning branch into the implementation branch.

## Preflight and isolation

1. Work from a fresh, clean Codex Cloud checkout based on current `origin/main`. Fetching for read-only
   comparison is allowed. Do not edit protected `main`, a detached checkout, or a dirty/shared worktree.
2. Create or use a task-specific non-protected branch following the Cloud isolation contract. Do not run the
   Windows task-start script in Linux and do not overwrite, stash, reset, clean, or absorb existing work.
3. Run `bash --noprofile --norc scripts/check-codex-cloud-raw-env.sh`, then the acceptance commands named in
   `docs/codex-cloud.md`: `npm run check:codex-cloud`, `npm run check:runtime`,
   `npm run check:installed-lock-parity`, `npm run check:playwright-browser-revision`, and
   `npm run check:codex-cloud -- --runtime`. Record every exit code and decisive line without printing
   environment values.
4. Inspect branch, upstream, full HEAD, worktree list, concise status, relevant recent history, runtime,
   package-manager version, and active repository-owned processes.
5. In Cloud, keep the repository's strict Node 24 and npm 11 contract. Use the documented Cloud setup;
   do not weaken engines or package-manager checks.
6. If the prompt-perfector verifier exists, run it before editing. For a clean Cloud task, use its
   `--cloud` mode with the expected repository, branch, and HEAD. Proceed only on
   `SAFE_TO_EDIT=true` and `PRECHECK_RESULT=SAFE`.
7. Run the plan's repository flightplan against the refreshed path set and retain its new evidence. Use
   its current classification to refine verification, not to broaden product scope.

Stop before editing if the checkout is dirty or protected, the binding files are missing, another
task owns the worktree, the plan has already been partially implemented in an incompatible shape, or
the current mainline creates a material design conflict. Report all blockers together in one concise
ask. Do not ask low-yield or routine questions that inspection can answer.

## Approved decisions that must not be reopened

- Access gating is deliberately deferred. Preserve the current public-access behaviour and a clean
  future gating seam; do not invent authentication scope now.
- All seven modes launch through one exhaustive typed registry and one shared local-first
  orchestrator. The repeated Differentials in the original request is not an eighth mode.
- Use a master Clinical Ask flag, a separate external-fallback flag, and an emergency per-mode
  denylist. Disabled Ask must leave ordinary Search available.
- Ordinary Search remains the form submit/Enter behaviour. `Ask {Mode}` is a separate explicit button.
  The microphone records only after user action, never auto-submits, and never silently changes mode.
- The Clinical Ask Session and confirmed Case Context are memory-only and tab-scoped. No local
  storage, session storage, durable database record, URL content, or hidden patient profile.
- Identifier-shaped input blocks microphone upload and Clinical Ask submission until edited, while
  ordinary Search remains available. Never echo the detected substring or claim de-identification.
- Evidence order is Catalogue, then authorised Indexed, then approved External Authority only when a
  deterministic gap, `needs_review`/staleness, or unresolved conflict requires it. External evidence
  cannot overwrite local evidence or make an unreviewed record reviewed.
- External access is server-only, allowlisted by exact HTTPS authority policy, redirect-checked,
  attributable, metered, and content-discarding after the session. No arbitrary web browsing.
- Use fast deterministic/context work, a stronger final synthesis boundary, deterministic governance
  gates, a 45-second orchestration deadline, and at most one bounded retry. Never use model confidence
  as evidence sufficiency.
- Carry no more than the six prior in-memory messages required for a follow-up.
- Cross-mode handoffs are curated, clinician-triggered, reduced to target-accepted confirmed fields,
  and reviewed before the target mode runs.
- Protected-staging hosted migration and zero-critical-failure provider canaries define the later
  **Implementation complete** milestone. Production activation remains a separate decision after
  governance and physical-device acceptance.
- The strict canary has zero tolerance for unsupported clinical conclusions or numbers/criteria,
  invalid citations, authority violations, raw-content leakage, or existing retrieval regression.
  Latency and cost cannot offset a critical failure.

## Authority and prohibited actions

This prompt authorises:

- read-only repository and public official-documentation inspection;
- a safe task branch/worktree;
- in-scope source, test, migration-file, and documentation edits required by the approved plan;
- dependency restoration from the existing lockfile when the clean task environment needs it;
- offline/synthetic/mock provider verification; and
- local browser verification through repository wrappers with synthetic fixtures; and
- local task-branch commits required by the admitted Subagent-Driven Development route. Use one coherent task
  commit boundary after focused proof/review; do not amend or rewrite another task's commits.

This prompt does **not** authorise:

- OpenAI, Supabase, external-search, hosted retrieval, ingestion, or any other live-provider call;
- access to real patient, clinician, customer, production, or sensitive organisational content;
- applying a migration to any hosted project or changing hosted configuration;
- publishing, push, pull into a working branch, rebase, merge, PR creation/update, hosted CI rerun, deployment,
  release, or communication to another person/service;
- physical-device claims; or
- new dependencies, a new database table, durable Case Context/transcript/answer storage, arbitrary
  external domains, existing retrieval-ranking changes, or material scope expansion.

Implement the server routes and provider boundaries with mocks and existing abstractions, but do not
exercise live APIs. If a protected-staging or publication action becomes the next required step, stop
with one consolidated approval request naming the exact provider/project, read/write scope, proposed
mutation, data exposure, synthetic inputs, spend ceiling, rollback, and stop conditions.

## Execution contract

Execute the [12-task plan](../superpowers/plans/2026-08-22-mode-aware-clinical-ask-implementation.md)
in order. Its named files, interfaces, test-first steps, exact limits, and gates are the implementation
contract:

1. Define the exhaustive seven Mode Answer Profiles and feature-control boundary.
2. Add the ephemeral session, confirmed Case Context, clarification, and handoff contracts.
3. Build mode catalogue evidence adapters without changing ordinary search ranking.
4. Reuse authorised indexed retrieval and deterministic evidence-sufficiency rules.
5. Add the shared local-first orchestrator and governed response envelope.
6. Add the streaming Clinical Ask route with abort, rate limit, owner scope, validation, and
   content-free observability.
7. Add allowlisted external-authority fallback and hostile-content/redirect defences.
8. Add bounded server-side transcription with privacy, MIME/size/duration, and failure contracts.
9. Integrate explicit Search, `Ask {Mode}`, microphone, review, progressive answer, accessibility,
   offline, and responsive phone geometry into the one shared composer/content owner.
10. Expand structured answer feedback and create the separately deployable idempotent constraint
    migration file; do not apply it.
11. Complete security headers, privacy, governance, operations, and production-readiness contracts.
12. Prove all seven synthetic journeys, mocked voice, accessibility, leakage boundaries, failure
    states, and handoff readiness.

Use existing abstractions before adding new ones. Make the smallest coherent change that fully meets
the approved contract. Do not replace source evidence with generated summaries, expose chain of
thought/provider internals/retrieval scores, log raw questions or context, or weaken validation,
access scope, clinical safety, tests, types, or source governance to get green checks.

Load `superpowers:executing-plans` first. It owns admission, the sequential task graph, blocker handling, and
closeout. Then inspect the current session's actual skills and tools:

- If `superpowers:subagent-driven-development`, its review/finish dependencies, callable `spawn_agent`,
  `followup_task`, `wait_agent`, and `list_agents` equivalents, and a worker slot are all available, use the
  plan's **sequential SDD route**. Create the persistent ignored ledger;
  dispatch one fresh clean-context implementer per task; require a local task commit; verify the report; dispatch
  a fresh read-only task reviewer; send fixes back to the same implementer; and advance only after approval.
  Never run parallel implementation agents in the shared checkout.
- If any capability is absent, record the reason once and use the plan's **inline executing-plans route** for the
  identical checkboxes. Do not pause merely because a local-only plugin or subagent tool is unavailable, and do
  not fabricate subagent/review evidence.

For every subagent spawn, explicitly select a model from the current allowed list, set reasoning effort, and use
clean context rather than inheriting the full controller conversation. Use bounded 5–10 minute event waits rather
than short polling. The controller must verify diffs, commits, and decisive test output itself. After Task 12, run
one fresh whole-branch review and at most one fix wave before the selected final gate.

Do not force all 12 tasks into one Cloud context. Use clean, reviewed task commits and the plan's ignored SDD
ledger as same-checkout compaction recovery. Prefer checkpoint tranches 1–4, 5–8, and 9–12. If session budget is
insufficient for the next complete task/review loop, stop at the prior task boundary and emit the plan's complete
continuation block. Be explicit that an ignored ledger and unpushed commits are not available in a brand-new
checkout; do not reimplement missing work from memory. Publication remains separately approval-gated.

Keep progress updates brief and evidence-based. Make reasonable reversible in-scope assumptions and record
material controller rulings. If questions become necessary, remove low-yield items and ask all material blockers
together with your recommended answer for each. Do not request routine approval between tasks.

## Iteration and verification

- Use the exact focused tests named in each task. Establish failing contract tests before behaviour
  changes where the plan specifies test-first work.
- Use repository test/e2e wrappers and the run coordinator. Never invoke Playwright directly or
  bypass its lease.
- For UI/browser work, run `npm run ensure`, use only its printed URL, and confirm
  `/api/local-project-id` before testing. Do not assume a port or attach to another project.
- Use synthetic presentations only. Mock transcription, indexed retrieval, external search, and
  synthesis. Mocked browser microphone proof is not physical iPhone evidence.
- At 320, 390, 768, and 1440 px verify the approved safe-area/composer geometry, combined
  Differentials compare+Ask reserve, keyboard/focus order, no horizontal scroll, dark mode,
  reduced-motion, forced-colours, copy/print defaults, abort, and clear/refresh leakage behaviour.
- Run documentation generation/checks only when their contract requires it and review generated
  diffs.
- Before the final gate, inspect the complete diff for unrelated work, accidental Search/Answer
  changes, raw-content leakage, arbitrary domains, debug output, source-ranking changes, generated
  clinical claims, secrets, and formatting noise.
- Run `npm run format` for the task-owned diff. Then run the plan's one final
  `npm run verify:pr-local` handoff gate exactly once unless a classified failure requires a focused
  fix and rerun. Do not stack equivalent broad lint/typecheck/test/build/browser gates.
- Run `npm run check:production-readiness` only in its documented offline/static mode if the plan's
  local contract supports that distinction. Never present config presence or a static pass as live
  provider, hosted migration, clinical, or production acceptance.
- Finish with `git diff --check` and a fresh status/branch/upstream/HEAD comparison.

For every command, record the exact command, exit code, and decisive result. Classify failures as
introduced, pre-existing/baseline-confirmed, environment-gated, approval-gated, partial, or unrun;
never infer success from partial output.

## Definition of done for this Codex Cloud task

Stop only when either the local milestone is genuinely reached or a defined hard blocker remains.
**Local implementation ready** requires all conditions in the plan, including:

- all seven profiles have typed and mocked-voice synthetic coverage;
- clarification, Evidence Gap, conflicts, `needs_review`, external rejection, abort, expiry, and
  provider failure cannot expose an uncited clinical conclusion;
- raw question/context/audio/answer content is absent from URL, storage, logs, telemetry, error
  envelopes, feedback, default copy, and screenshots;
- ordinary Search and generic Answer regressions remain green;
- focused browser proof and the single local handoff gate are recorded honestly;
- the migration exists locally but is explicitly **not applied**;
- `git diff --check` is clean and the diff contains only this feature and required generated files;
  and
- current branch/worktree/upstream state plus every hosted/provider/device/governance gate is
  reported separately.

Do not call the feature **Implementation complete**, merged, deployed, production-ready, or active.
Those states require separately authorised protected-staging migration/provider canaries, Git/PR
operations, governance sign-off, deployment, and physical-device evidence.

If publication is later authorised, the pull request must declare `RAG impact: behaviour change` and complete
the clinical governance preflight. This handover does not itself authorise that publication.

## Required final handover

Lead with the achieved outcome. Then report:

1. branch, worktree, HEAD, upstream, and ahead/behind state;
2. every changed/created/generated file, grouped by the 12 plan tasks;
3. important architecture and current-main adaptations, with reasons;
4. exact checks and outcomes, including the final `verify:pr-local` decisive line;
5. failed, partial, blocked, skipped, and unrun checks with truthful reasons;
6. local migration-file state versus hosted migration state;
7. offline/mock evidence versus live-provider and clinical-safety evaluation evidence;
8. browser emulation versus physical iPhone Safari/installed-PWA evidence;
9. remaining risks and the exact next approval-gated action; and
10. confirmation that no live provider, real data, hosted mutation, push, PR, or deployment occurred; list local
    task commits separately if the admitted SDD route used them.

Do not create an extra handoff-only commit, push, open a PR, deploy, apply the migration, or run a live canary at
the end merely because the local implementation is ready. Preserve the task branch and ask once for the exact
next authority needed.
