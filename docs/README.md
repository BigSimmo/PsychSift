# PsychSift Documentation Index

_Updated 2026-10-01 - index the on-demand focused-task workflow; Documentation owns._

Categorised map of every tracked Markdown document under `docs/`: the load-bearing docs lead
each category, and an "Also catalogued" list completes it (the immutable
`branch-review-records/` and `outstanding-issues-inbox/` files are indexed by their own
generators, not here). Categories distinguish **maintained** documents (keep these current when
behavior changes) from **point-in-time records** (historical; do not update, supersede with a
new dated doc instead). No check fails when a document is missing from this index, so add each
new document here when you write it. Owner decisions are indexed separately in
[decisions/README.md](decisions/README.md).

Check that repo paths referenced from the maintained docs still resolve with:

```bash
npm run docs:check-links
```

## Start here

Choose the task and the kind of evidence before following an instruction:

| Need                                 | Entry point                                                            | Read it as                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| PsychSift development                | [Repository README](../README.md), [codebase index](codebase-index.md) | Setup and architecture, subject to the current manifests and provider boundaries |
| Agent instructions or platform setup | [Task navigator](agents-guide.md), [AGENTS.md](../AGENTS.md)           | Find the applicable rule; do not run every referenced workflow                   |
| Current work or acceptance           | The existing task checkpoint                                           | Check its identity, scope and evidence before relying on its status              |
| A past decision or incident          | The historical records below                                           | Evidence of what happened then, not a current completion or deployment claim     |

## Documentation ownership and maintenance

| Document type                                  | How to maintain it                                                                                                                  | What its presence proves                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Maintained guide or runbook                    | Correct the relevant source and necessary references when behaviour changes. Check commands against the current script definitions. | Instructions exist; current execution and access still need evidence.                 |
| Generated index or snapshot                    | Use its named generator and inspect the resulting diff. Do not hand-edit generated facts or run unrelated generators.               | The recorded inventory or snapshot, within its declared scope and capture conditions. |
| Task checkpoint                                | Keep one current record per task with ownership, scope, decisions, evidence, blockers and next action. Preserve concurrent work.    | Reported task status, which must be reconciled with the actual working state.         |
| Historical report, lesson or immutable receipt | Preserve the original record; add a dated correction or superseding reference through the appropriate workflow.                     | Historical evidence, including its original failures and limitations.                 |

Use `npm run docs:check-links` for maintained-document references and
`npm run docs:check-scripts` for npm script references. These are static checks;
they do not prove that instructions are semantically correct, providers work or a
screen matches its design. When the checker is blocked, report that limitation
and use a clearly scoped check for the affected documents without weakening the
repository gate. The generated inventories remain governed by their own contracts.

### Also catalogued (2026-09-26)

- [DOCS-SYSTEM.md](DOCS-SYSTEM.md) — Documentation system — how project docs are kept accurate, logged and non-stale

## Core reference map

| Doc                                               | What it is                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [codebase-index.md](codebase-index.md)            | Structured architecture map: layout, module map, Supabase schema, scripts, domain concepts                 |
| [README.md](README.md)                            | This index — every tracked document under `docs/`, categorised                                             |
| [site-map.md](site-map.md)                        | **Generated** route map — regenerate with `npm run docs:update`, verify with `npm run sitemap:check`       |
| [agents-guide.md](agents-guide.md)                | Task navigator, platform setup and skill ownership; rules in `AGENTS.md`                                   |
| [scripts-index.md](scripts-index.md)              | Curated map of `scripts/` and the `package.json` command surface by purpose                                |
| [organisation/](organisation/README.md)           | Organisation map: which area owns every file, checked by `npm run check:organisation`                      |
| [personal-practice/](personal-practice/README.md) | Personal practice area: what it owns and the rules every change there follows                              |
| [codex-cloud.md](codex-cloud.md)                  | Codex Cloud setup, access profiles, profile-loading command shims, GitHub exception, and acceptance checks |
| [claude-cloud.md](claude-cloud.md)                | Claude Code on the web: the tiered container provisioner and the checked-in user profile                   |

## Architecture

- [frontend-architecture.md](frontend-architecture.md) — shell, routing, dashboard module structure
- [wiring-conventions.md](wiring-conventions.md) — page/button wiring conventions and the dead-button / orphan-route gates
- [search-chrome-behaviour.md](search-chrome-behaviour.md) — shared search-chrome contract: composer ownership, phone edge-to-edge dock, hide/reveal reserves
- [mockup-retirement-policy.md](mockup-retirement-policy.md) — when a mockup may be deleted, who decides, what evidence is required, and the three tiers that keep developer-gated prototypes out of cleanup scope
- [developer-area-access.md](developer-area-access.md) — how the developer-gated `/mockups` subtrees are protected, the passwordless `?devkey` link and its setup, what the link deliberately does not grant, and how to revoke it
- [search-results-bar-decisions.md](search-results-bar-decisions.md) — shared results-bar anatomy, why the filter shelf is scoped to two modes, and what is deliberately not done
- [on-call/design/2026-09-20-admin-compliance-and-folders.md](on-call/design/2026-09-20-admin-compliance-and-folders.md) — On Call's Admin/Compliance split: why Compliance rides the `logistics` section behind a `details.kind` discriminator instead of costing a CHECK-constraint migration, why the page may never render a verdict, why it sorts by consequence rather than expiry, the one-word folder rule, and what making Compliance a real section would actually cost
- [deployment-architecture.md](deployment-architecture.md) — app/worker/Supabase deployment topology
- [ingestion-state-machine.md](ingestion-state-machine.md) — ingestion job lifecycle and states (dated 2026-07-07 race analysis; the lease is heartbeated and fenced since 2026-07-08 — see its status banner)
- [design-system/README.md](design-system/README.md) — front door for the v2 design system (tokens, components, gates)
- [design-system.md](design-system.md) — live-layer notes during the v1→v2 transition (superseded as spec)
- [design-system/SPEC.md](design-system/SPEC.md) — the complete v2 design system: roles, rules, rationale (never values)
- [design-system/TOKENS.md](design-system/TOKENS.md) — reconciled token inventory: every role, winning name, owner, and what it replaces
- [design-system/COMPONENTS.md](design-system/COMPONENTS.md) — the eight safety-component specifications plus the maturity matrix
- [brand/psychsift-logo.md](brand/psychsift-logo.md) — the PsychSift mark: arc-by-arc construction, colours, file set, and usage rules
- [brand/design-handover.md](brand/design-handover.md) — the outward-facing brand spec: geometry, colour, type, rules, asset URLs, and open items in one self-contained page
- [brand/canvas/README.md](brand/canvas/README.md) — the generator behind the published six-artboard design canvas, and what must be kept in step with it
- [design-system/DECISIONS.md](design-system/DECISIONS.md) — conflicts C1–C5 resolved, clinical Q&A record, assumptions, blocked items
- [design-system/GATES.md](design-system/GATES.md) — every design-system rule paired with its enforcement status
- [design-system/FIX-GUIDE.md](design-system/FIX-GUIDE.md) — Hazard 1–2 sweep dispositions (Fixed / Documented / Deferred / Out-of-scope)
- [design-system/ADOPTION.md](design-system/ADOPTION.md) — PR 13 registration record: adoption order, per-surface file allowlists, exclusions, pins, proof shots
- [dictionary-editorial-drafts.md](dictionary-editorial-drafts.md) — the unpublished Dictionary draft layer: sense-first abbreviation drafts, hash-reconciled definition reviews, per-source acquisition outcomes, and what a register candidate is and is not
- [comparison-behaviour.md](comparison-behaviour.md) — shared selection, state, responsive, and accessibility contract for comparison surfaces
- [clinical-chat-ui-component-map.md](clinical-chat-ui-component-map.md) — chat UI component inventory
- [clinical-badge-system-guide.md](clinical-badge-system-guide.md) — clinical badge semantics
- [multi-user-auth-setup.md](multi-user-auth-setup.md) — auth, sessions, owner scoping
- [pwa.md](pwa.md) — PWA install assets, privacy-first service worker, offline shell
- [webhooks.md](webhooks.md) — the two inbound webhook receivers and the outbound Actions notifier
- [api-jobs-ops-surface.md](api-jobs-ops-surface.md) — standing decision to keep `GET /api/jobs` as an ops/admin surface
- [verified-answer-incremental-delivery-design.md](verified-answer-incremental-delivery-design.md) — staged, clinical-safety-preserving design for delivering verified evidence and answer sections before the canonical final SSE frame

### Also catalogued (2026-09-02)

Every remaining tracked document in this category (architecture and design, plus the `design-system/`, `redesign/`, `adr/`, `decisions/` and `product/` folders), one line each; the description is the document's own title, with its opening sentence where that adds something.

- [app-modes-decision-brief.md](app-modes-decision-brief.md) — Fifteen modes, or one search with fifteen lenses? — A decision brief for the owner.
- [design-system-contract.md](design-system-contract.md) — Design System Contract & Standards — This document specifies the blocking design system token rules, touch/tap target standards, and enforcement mechanisms for the PsychSift app…
- [filter-contract.md](filter-contract.md) — The filter contract — One filter surface, shared by every mode.
- [design-system/HANDOVER-2026-08-07.md](design-system/HANDOVER-2026-08-07.md) — Design system — handover, 7 August 2026 — Read AGENTS.md first — it is the highest-priority source of truth for rules and gates.
- [design-system/sweep-2026-08-29-structure.md](design-system/sweep-2026-08-29-structure.md) — Structural sweep — 2026-08-29 — Read-only audit for defects the enforced lint/test gates cannot see:
- [design-system/sweep-2026-08-29-unenforced-rules.md](design-system/sweep-2026-08-29-unenforced-rules.md) — Unenforced-rule sweep — 29 August 2026 — Scope. The rules in this document set whose enforcement status is _absent, manual, partial, advisory or deferred_, checked against the actua…
- [design-system/sweep-2026-08-29-visual.md](design-system/sweep-2026-08-29-visual.md) — Visual sweep — 2026-08-29 — Read-only visual/DOM audit of the running dev app at http://localhost:3350.
- [design-system/sweep-fix-duration-display.md](design-system/sweep-fix-duration-display.md) — Design sweep fix: readable durations on the Team screen — Date: 2026-08-29 File touched:
- [design-system/sweep-fix-missing-values-round-2.md](design-system/sweep-fix-missing-values-round-2.md) — Missing values, round 2 — two new phrases (29 Aug 2026) — Round 1 (sweep-fix-missing-values.md) changed four call sites and left nineteen alone.
- [design-system/sweep-fix-missing-values.md](design-system/sweep-fix-missing-values.md) — Missing values — call-site sweep (29 Aug 2026) — SPEC §11 gives four phrases for a missing value — Not recorded, Not applicable, Unknown, Unable to extract — and names MissingValue (COMPONE…
- [design-system/sweep-fix-tap-floors-round-2.md](design-system/sweep-fix-tap-floors-round-2.md) — Sweep fix — tap floors, round 2 (2026-08-29) — Round 1 (sweep-fix-tap-floors.md) taught interactiveTapFloorDeclarations to read responsive bands.
- [design-system/sweep-fix-tap-floors.md](design-system/sweep-fix-tap-floors.md) — Responsive tap-floor sweep: closing a check that could not fail — Date: 2026-08-29 · Scope:
- [redesign/01-audit.md](redesign/01-audit.md) — Design Audit (June 2026 redesign) — This run intentionally excludes /tools, src/app/tools/page.tsx, and src/lib/tools.ts by user request.
- [redesign/02-design-direction.md](redesign/02-design-direction.md) — Design Direction — This supersedes the earlier "single teal accent for primary actions" principle.
- [redesign/03-decision-log.md](redesign/03-decision-log.md) — Decision Log — Tier 2 changes — Entries are appended as work lands.
- [redesign/04-deferred.md](redesign/04-deferred.md) — Resolved Deferred Items — Status: closed (reconciled 2026-07-15).
- [redesign/05-changelog.md](redesign/05-changelog.md) — Changelog — Premium Redesign
- [redesign/06-verification.md](redesign/06-verification.md) — Verification Report — Scope: ultra-premium mobile-first redesign — token system, component layer, dashboard + document-viewer mobile surfaces, plus reconciliation…
- [redesign/07-token-adoption-audit.md](redesign/07-token-adoption-audit.md) — Token Adoption Audit (July 2026) — This run audits how consistently the codebase consumes the design tokens, not the token system itself.
- [redesign/08-design-review-prompt.md](redesign/08-design-review-prompt.md) — Design Review Prompt (July 2026) — Two reusable prompts for reviewing design work on this product, tuned to its context:
- [redesign/09-page-polish-plan.md](redesign/09-page-polish-plan.md) — Production-Page Polish & Perfection Plan (July 2026) — Status: closed as superseded (reconciled 2026-07-15).
- [redesign/09-ui-primitives-recipes.md](redesign/09-ui-primitives-recipes.md) — UI Primitives — Recipe Reference & State Contract (July 2026) — Resolves L8 from 07-token-adoption-audit.md:
- [redesign/clinical-white-aegean-master-implementation-plan.md](redesign/clinical-white-aegean-master-implementation-plan.md) — Clinical White / Aegean Graphite Master Implementation Plan — The permanent direction should be Clinical White / Aegean Graphite.
- [redesign/crisp-white-colour-system-plan.md](redesign/crisp-white-colour-system-plan.md) — Crisp white colour system plan — Replace the warm cream/porcelain light-mode direction with a cleaner, whiter, more polished clinical interface.
- [redesign/dictionary-reference-spine.md](redesign/dictionary-reference-spine.md) — Dictionary Reference Spine — Dictionary is a source-governed psychiatric terminology reference.
- [redesign/m2-atomic-reindex-migration-note.md](redesign/m2-atomic-reindex-migration-note.md) — M2 Atomic Reindex Migration Note — Make reindex completion atomic so search, evaluation, telemetry, and document views never observe a partially replaced index generation.
- [redesign/permanent-colour-direction.md](redesign/permanent-colour-direction.md) — Permanent colour direction — Adopt Clinical White / Sky Graphite as the permanent colour direction.
- [redesign/premium-colour-system-plan.md](redesign/premium-colour-system-plan.md) — Premium colour system plan — Create a light mode that feels modern, premium, calm, and clinically trustworthy without becoming sterile, washed out, or over-teal.
- [adr/0001-use-a-shared-local-first-clinical-ask-orchestrator.md](adr/0001-use-a-shared-local-first-clinical-ask-orchestrator.md) — Use a shared local-first orchestrator for Mode-aware Clinical Ask — Mode-aware Clinical Ask will extend the repository's one shared composer and governed answer surfaces through one local-first orchestration…
- [decisions/ccz4hb-review-coverage.md](decisions/ccz4hb-review-coverage.md) — Decision: restoring automated review coverage (#CCZ4HB) — the row closed — but see the 2026-09-02 correction below, which removes the premise that decision rested on.
- [product/clinical-trust-direction.md](product/clinical-trust-direction.md) — Clinical trust product direction — Decision date: 2026-08-23 Decision:

## Operations runbooks

- [launch-operator-runbook.md](launch-operator-runbook.md) — launch/operational duties and SLO probes
- [reindex-runbook.md](reindex-runbook.md) — safe reindex and ingestion recovery
- [retrieval-quality-runbook.md](retrieval-quality-runbook.md) — RAG/retrieval eval gates and tuning
- [worker-deploy-runbook.md](worker-deploy-runbook.md) — worker build contract, run recipe, secrets, docling shadow extraction (B4)
- [disaster-recovery-runbook.md](disaster-recovery-runbook.md) — backup/restore and recovery drills
- [auth-connection-cap-runbook.md](auth-connection-cap-runbook.md) — Supabase auth connection cap (operator)
- [staging-setup.md](staging-setup.md) — staging environment bootstrap
- [database-drift-detection.md](database-drift-detection.md) — schema drift detection (`npm run check:drift`)
- [supabase-migration-reconciliation.md](supabase-migration-reconciliation.md) — migration drift and repair policy
- [db-maintenance.md](db-maintenance.md) — Supabase advisor snapshots and the standing disposition per finding class
- [observability-slos.md](observability-slos.md) — health probes, SLO counters, degraded modes
- [openai-rag-operations.md](openai-rag-operations.md) — OpenAI/RAG provider operations and modes
- [outstanding-issues.md](outstanding-issues.md) — single universal task ledger and repository memory
- [operator-backlog.md](operator-backlog.md) — provider/operator runbook detail (status is canonical in the universal ledger)
- [deploy-corrector-public-titles.md](deploy-corrector-public-titles.md) — public-title corrector deploy notes
- [operator-apply-performance-latency-remediation.md](operator-apply-performance-latency-remediation.md) — operator apply steps for the performance/latency migration batch
- [reconciliation-playbook.md](reconciliation-playbook.md) — broad chat/worktree reconciliation and archive-safe cleanup (not for ordinary feature work)
- [staging-tenancy-release-evidence.md](staging-tenancy-release-evidence.md) — cross-tenant staging harness as executable owner-boundary proof
- [docker-optimization-guide.md](docker-optimization-guide.md) — Docker optimization and health check implementation: multi-arch, layer caching, and slim runtime targets

### Also catalogued (2026-09-02)

Every remaining tracked document in this category (operations, plus the `rag-behaviour/` and `rag-improvement/` folders), one line each; the description is the document's own title, with its opening sentence where that adds something.

- [database-remediation-plan.md](database-remediation-plan.md) — Database remediation & future-proofing plan — 2026-08 — Owner: operator (Josh) + specialist session.
- [database-remediation-playbook.md](database-remediation-playbook.md) — Database remediation playbook — multi-session execution guide — Companion to database-remediation-plan.md (the plan of record — read it first in every session).
- [database-remediation-coordination.md](database-remediation-coordination.md) — Database remediation — coordination handover
- [operations-runbook.md](operations-runbook.md) — Operations Runbook: Database Index Diagnostics & Pre/Post EXPLAIN Measurement Protocol — This runbook defines the operational verification and execution protocol for measuring query planner performance and diagnosing documents ta…
- [operator-supabase-branching-cap.md](operator-supabase-branching-cap.md) — Operator guidance: Supabase preview-branch compute cap (#9X40BT) — This document records the operator configuration and cost-containment policy for Supabase preview branches on project sjrfecxgysukkwxsowpy (…
- [performance.md](performance.md) — Performance and Web Vitals Baselines — This document outlines performance benchmarks, layout stability strategies, and Core Web Vitals baselines for the PsychSift application.
- [rag-evaluation.md](rag-evaluation.md) — RAG Evaluation and Retrieval Contracts — This document specifies the RAG evaluation framework, runtime retrieval row contracts, and defensive schema invariants that protect clinical…
- [rag-behaviour/README.md](rag-behaviour/README.md) — RAG behaviour memory — Durable, evidence-backed knowledge about how this repo's retrieval/ranking stack actually behaves — created 2026-07-20 after a full measure…
- [rag-behaviour/behaviour-map.md](rag-behaviour/behaviour-map.md) — RAG behaviour map (verified 2026-07-20) — Everything below was verified against live canary evidence (runs #49–#56) and direct source inspection during the ADDENDUM-4 cycle.
- [rag-behaviour/refuted-approaches.md](rag-behaviour/refuted-approaches.md) — Refuted ranking-improvement approaches (2026-07-20) — Two approaches to the fast-path rank-depth headroom were implemented, live-tested, and refuted in one evening.
- [rag-behaviour/safeguards.md](rag-behaviour/safeguards.md) — RAG ranking safeguards — The protection stack that keeps retrieval/ranking behaviour from being changed casually — by any task, session, or agent.
- [rag-improvement/gate-b-decision-record-2026-08-18.md](rag-improvement/gate-b-decision-record-2026-08-18.md) — Gate B decision record — Docling extraction benchmark (owner run, 2026-08-18) — Status: PASS. This is the owner's filled copy of docs/rag-improvement/gate-b-decision-record.md for packet S6b (the Gate B run the S6 harnes…
- [rag-improvement/gate-b-decision-record.md](rag-improvement/gate-b-decision-record.md) — Gate B decision record — Docling extraction benchmark (template) — Status: template — no verdict.

### Also catalogued (2026-09-26)

- [pr-batch-runner.md](pr-batch-runner.md) — Sequential PR batch runner — prepares and merges a fixed snapshot of pull requests one at a time
- [production-readiness.md](production-readiness.md) — Production readiness and operational release requirements (points to the canonical checklist)
- [site-content-sync-runbook.md](site-content-sync-runbook.md) — Site-content publication and synchronization runbook
- [site-content-publication-handover.md](site-content-publication-handover.md) — Handover of the remaining site-content database work, written 2026-09-18
- [supabase-remediation-closeout-notes.md](supabase-remediation-closeout-notes.md) — Supabase remediation closeout notes — short deferred list, no DDL

## Governance, safety, privacy

- [clinical-governance.md](clinical-governance.md) — deployment and source governance checklist
- [clinical-sign-off-how-to.md](clinical-sign-off-how-to.md) — plain-English guide for the clinical owner: signing off forms and Act-section summaries one at a time with `npm run clinical:review`, and sending the sign-offs
- [source-acquisition-protocol.md](source-acquisition-protocol.md) — how a clinical source is found, captured, scored and indexed: the WA-first locality ladder, the capture register, the metadata floor, and clinical sign-off
- [error-tracking.md](error-tracking.md) — privacy-safe, opt-in production exception tracking envelope
- [governance-incident-runbooks.md](governance-incident-runbooks.md) — operator response checklists for clinical, source, privacy, provider, and answer-pipeline rollback incidents
- [clinical-hazard-analysis.md](clinical-hazard-analysis.md) — clinical hazard register
- [care-plan/crisis-lines-verification.md](care-plan/crisis-lines-verification.md) — **DRAFT, unsigned** verification record for every crisis number printed by the Care Plan prototype: source, verification date, and the six-monthly re-verification cadence
- [rag-injection-threat-model.md](rag-injection-threat-model.md) — prompt-injection threat model
- [privacy-impact-assessment.md](privacy-impact-assessment.md) — PIA findings and launch blockers
- [openai-cross-border-basis.md](openai-cross-border-basis.md) — cross-border data-processing basis
- [governance/privacy-readiness.v1.json](governance/privacy-readiness.v1.json) — authoritative machine-checkable privacy readiness status
- [governance/privacy-closeout-2026-09-01.md](governance/privacy-closeout-2026-09-01.md) — current provider, retention, legal, notice, and clinical closeout evidence
- [governance/privacy-role-attestation-pack-2026-09-01.md](governance/privacy-role-attestation-pack-2026-09-01.md) — evidence and role decisions for eight requirements; two owner approvals are complete and six remain
- [production-readiness-checklist.md](production-readiness-checklist.md) — release readiness criteria
- [samd-classification-medication-considerations.md](samd-classification-medication-considerations.md) — SaMD classification and medication considerations

### Also catalogued (2026-09-02)

Every remaining tracked document in this category, one line each; the description is the document's own title, with its opening sentence where that adds something.

- [medication-interaction-lexicon-review.md](medication-interaction-lexicon-review.md) — Medication interaction lexicon — clinical review sheet — Status: reviewed 2026-09-06 — see the sign-off at the bottom.
- [medication-lexicon-review-worklist.md](medication-lexicon-review-worklist.md) — Medication lexicon — clinician reading worklist (#318) — This is a reading aid, not a review.
- [services-mode-governance.md](services-mode-governance.md) — Services Mode Governance — A Services record is not “current” merely because its prose is plausible or its confidence is high.

### Also catalogued (2026-09-26)

- [governance/privacy-completion-drafts-2026-09-13.md](governance/privacy-completion-drafts-2026-09-13.md) — Privacy completion drafts, 2026-09-13 — prepared, unsigned, not approved for release
- [governance/rag-adaptive-continuation-2026-09-13.md](governance/rag-adaptive-continuation-2026-09-13.md) — RAG adaptive activation: setup and continuation handoff

## Process and review

- [process-hardening.md](process-hardening.md) — verification gates, CI expectations, known debts
- [continuous-integration.md](continuous-integration.md) — workflow concurrency keys, push exemption, and Guard 2 in-flight CI push guard
- [testing.md](testing.md) — test execution, focused/live commands, Playwright ownership, flake policy
- [development-speed-playbook.md](development-speed-playbook.md) — going faster without weakening any gate: receipts, narrow selection, worktree reuse
- [phone-chrome-physical-acceptance.md](phone-chrome-physical-acceptance.md) — labelled Safari and cold-launch PWA acceptance matrix
- [productivity-workflows.md](productivity-workflows.md) — repo workflow planners (flightplan, triage, rag-lab, …)
- [codex-review-protocol.md](codex-review-protocol.md) — shared review protocol for all review skills
- [codex-prompt-playbook.md](codex-prompt-playbook.md) — copy/paste prompts for common repo work
- [codex-cloud.md](codex-cloud.md) — reproducible provider-free Codex Cloud environment and acceptance check
- [claude-cloud.md](claude-cloud.md) — Claude Code on the web container parity: tiered provisioner and checked-in user profile
- [branch-cleanup-guide.md](branch-cleanup-guide.md) — branch hygiene workflow
- [branch-review-ledger.md](branch-review-ledger.md) — reviewed branch/SHA ledger; read with `npm run ledger:lookup` (historical tables + immutable records), write with `npm run ledger:append`, and convert a pre-system active-branch row with `npm run ledger:migrate-legacy`
- [branch-review-archival-policy.md](branch-review-archival-policy.md) — what may and may not be done to the immutable records under `docs/branch-review-records/`; which operations are blocked by code, which are forbidden by policy but caught by nothing, and why foldering or deleting a record is silent history loss
- [branch-review-index.md](branch-review-index.md) — **Generated** browsable index of every immutable review record; regenerate with `npm run ledger:index`, refresh with `npm run docs:update`, check currency with `npm run ledger:index:check`. It may lag the corpus, so `npm run ledger:lookup` stays authoritative
- [task-receipts.md](task-receipts.md) — task lifecycle and sanitized receipt handoff protocol between agents and ledger

### Also catalogued (2026-09-02)

Every remaining tracked document in this category (process, plus the `agents/` rule files `AGENTS.md` delegates to, `prompts/`, `codex/` and `plans/`), one line each; the description is the document's own title, with its opening sentence where that adds something.

- [ci-operations.md](ci-operations.md) — CI Operations and Runner Usage Assessment — See also continuous-integration.md for pre-push safety controls and Guard 2 in-flight CI push guard details.
- [agents/bug-hunter-shortcut.md](agents/bug-hunter-shortcut.md) — Bug-Hunter Shortcut — When the user types exactly bug-hunter as the entire task message, after trimming surrounding whitespace, treat it as a shortcut for targete…
- [agents/claude-hook-scripts.md](agents/claude-hook-scripts.md) — Claude Code Hook Scripts — .claude/hooks/*.sh runs on Linux web containers as well as on the Windows workstation, and the workstation cannot see the thing that breaks…
- [agents/codex-cloud-environment.md](agents/codex-cloud-environment.md) — Codex Cloud Environment — Codex Cloud uses an isolated Linux container and does not inherit desktop files, credentials, OAuth sessions, MCP authentication, local serv…
- [agents/codex-dependency-shortcut.md](agents/codex-dependency-shortcut.md) — Codex Dependency Shortcut — When the user types exactly dependency as the entire task message, after trimming surrounding whitespace, treat it as a shortcut for safe de…
- [agents/codex-desktop-worktree-setup.md](agents/codex-desktop-worktree-setup.md) — Codex Desktop Worktree Setup — It must work before node_modules exists, validate Node 24/npm 11, reuse only a complete byte-identical local installation, and otherwise run…
- [agents/codex-productivity-defaults.md](agents/codex-productivity-defaults.md) — Codex Productivity Defaults
- [agents/codex-reasoning-effort.md](agents/codex-reasoning-effort.md) — Codex Reasoning Effort Calibration
- [agents/codex-review-throttling.md](agents/codex-review-throttling.md) — Codex Review Throttling & Thread Resolution — Do not review branches opportunistically.
- [agents/cursor-cloud.md](agents/cursor-cloud.md) — Cursor Cloud Specific Instructions — Durable notes for Cloud Agents.
- [agents/dead-code-deletion.md](agents/dead-code-deletion.md) — Deleting Code You Believe Is Dead — "Nothing imports it" is necessary and nowhere near sufficient.
- [agents/external-skill-precedence.md](agents/external-skill-precedence.md) — External Skill Precedence and Evidence — User-global skills and output-style plugins are installed outside this repo and know nothing about its contracts.
- [agents/pull-request-workflow.md](agents/pull-request-workflow.md) — Pull Request Workflow — The one canonical pull-request rulebook for every AI tool: open, follow CI, review threads, records, merge authority, landed, branch sync, Run PR, Clear PRs, bundling.
- [agents/repository-skills-and-issues.md](agents/repository-skills-and-issues.md) — Repository Skills and Outstanding-Work Memory — Select repo-local skills under `.agents/skills/` when their descriptions match the actual task and their use materially helps; read an explicitly named skill before acting.
- [agents/test-deletion-guard.md](agents/test-deletion-guard.md) — Deleting tests, or letting a tool delete them for you — On 2026-08-31 a commit on PR #2481 titled "test(ui):
- [agents/smart-agent-allocation.md](agents/smart-agent-allocation.md) — Default model/effort selection, independent ownership and review, evidence reuse, and portable Codex Cloud delivery.
- [agents/task-efficiency.md](agents/task-efficiency.md) - On-demand task brief, one continuation record and private measurement using existing workflows.
- [agents/upload-shortcut.md](agents/upload-shortcut.md) — Upload Shortcut — When the user types exactly:
- [agents/verification-gates.md](agents/verification-gates.md) — Verification Gates — the verification pyramid, gate receipts, and the browser-gate planner
- [agents/wiring-and-bundle-budget.md](agents/wiring-and-bundle-budget.md) — Page Wiring and Bundle Budget — Interactive controls and routes follow conventions the codebase already holds to.
- [agents/native-startup/commit-as-you-go.md](agents/native-startup/commit-as-you-go.md) — Commit as you go: committing coherent units before switching context
- [agents/native-startup/contextual-working-defaults.md](agents/native-startup/contextual-working-defaults.md) — Context-aware working defaults for workflows and boundaries
- [agents/native-startup/external-skill-precedence.md](agents/native-startup/external-skill-precedence.md) — External skill precedence and evidence calibration rules
- [agents/native-startup/process-hardening.md](agents/native-startup/process-hardening.md) — Process hardening phases and verification gates
- [agents/native-startup/publication-workflows.md](agents/native-startup/publication-workflows.md) — Safe Git publication workflows, PR shortcuts, and anti-churn sync
- [agents/native-startup/search-chrome-behaviour.md](agents/native-startup/search-chrome-behaviour.md) — Search chrome behaviour, composer ownership, and phone edge-to-edge contracts
- [prompts/codex-architecture-maintainability-ultra-review.md](prompts/codex-architecture-maintainability-ultra-review.md) — Codex Local Ultra — Architecture & Maintainability Review Orchestrator — Perform a rigorous, evidence-based Architecture and Maintainability review of this repository using multi-agent coordination.
- [prompts/codex-cloud-design-status-semantics.md](prompts/codex-cloud-design-status-semantics.md) — Codex Cloud prompt — design-system clinical status semantics — Copy the complete prompt below into a new Codex Cloud task for the Database repository KB repository.
- [prompts/codex-cloud-detailed-task.md](prompts/codex-cloud-detailed-task.md) — Codex Cloud detailed-task prompt — Use this prompt when assigning a substantial implementation, refactor, defect fix, or other detailed task to Codex Cloud in this repository.
- [prompts/codex-cloud-review/1-codex-full-stack-master-review-prompt.md](prompts/codex-cloud-review/1-codex-full-stack-master-review-prompt.md) — Codex Comprehensive Full-Stack Product, Design, Architecture, Engineering, Security, Quality and Refactoring Master Prompt — Keep this master specification as a normal Markdown file, for example:
- [prompts/codex-cloud-review/2-codex-full-stack-master-prompt-review-and-stress-test.md](prompts/codex-cloud-review/2-codex-full-stack-master-prompt-review-and-stress-test.md) — Review and Adversarial Stress Test of the Codex Full-Stack Master Prompt — The original Cursor prompt had unusually strong domain coverage and quality controls.
- [prompts/codex-cloud-review/3-codex-agents-md-companion.md](prompts/codex-cloud-review/3-codex-agents-md-companion.md) — Codex Repository Working Agreement
- [prompts/codex-data-database-safety-ultra-review.md](prompts/codex-data-database-safety-ultra-review.md) — Codex Local Ultra — Data & Database Safety Review Orchestrator — Perform a rigorous, evidence-based Data & Database Safety review of this repository using multi-agent coordination.
- [prompts/codex-documentation-ownership-ultra-review.md](prompts/codex-documentation-ownership-ultra-review.md) — Codex Local Ultra — Documentation & Ownership Review Orchestrator — Perform a rigorous, evidence-based Documentation & Ownership review of this repository using multi-agent coordination.
- [prompts/codex-functional-correctness-ultra-review.md](prompts/codex-functional-correctness-ultra-review.md) — Codex Local Ultra — Functional Correctness Review Orchestrator — Perform a rigorous, evidence-based Functional Correctness review of this repository using multi-agent coordination.
- [prompts/codex-performance-reliability-ultra-review.md](prompts/codex-performance-reliability-ultra-review.md) — Codex Local Ultra — Performance & Reliability Review Orchestrator — Perform a rigorous, evidence-based Performance and Reliability review of this repository using multi-agent coordination.
- [prompts/codex-tests-quality-gates-ultra-review.md](prompts/codex-tests-quality-gates-ultra-review.md) — Codex Local Ultra — Tests & Quality Gates Review Orchestrator — Perform a rigorous, evidence-based Tests & Quality Gates review of this repository using multi-agent coordination.
- [prompts/mode-aware-clinical-ask-codex-cloud-handover.md](prompts/mode-aware-clinical-ask-codex-cloud-handover.md) — Codex Cloud handover: implement Mode-aware Clinical Ask — Paste the prompt below into a fresh Codex Cloud task whose checkout contains this entire planning pack.
- [prompts/rag-coverage-gate-extraction.md](prompts/rag-coverage-gate-extraction.md) — X3 / #086 rag.ts coverage-gate extraction — Use this prompt in a fresh Codex Cloud task with CODEX_CLOUD_ACCESS_PROFILE=offline.
- [codex/architecture-maintainability/README.md](codex/architecture-maintainability/README.md) — Architecture and maintainability review packets — Durable artifacts requested from the architecture and maintainability review prompt belong here.
- [codex/data-database-safety/README.md](codex/data-database-safety/README.md) — Data and database safety review packets — Durable artifacts requested from the data and database safety review prompt belong here.
- [codex/documentation-ownership/README.md](codex/documentation-ownership/README.md) — Documentation and ownership review packets — Durable artifacts requested from the documentation and ownership review prompt belong here.
- [codex/functional-correctness/README.md](codex/functional-correctness/README.md) — Functional correctness review packets — Durable artifacts requested from the functional correctness review prompt belong here.
- [codex/performance-reliability/README.md](codex/performance-reliability/README.md) — Performance and reliability review packets — Durable artifacts requested from the performance and reliability review prompt belong here.
- [codex/tests-quality-gates/README.md](codex/tests-quality-gates/README.md) — Tests and quality-gates review packets — Durable artifacts requested from the tests and quality-gates review prompt belong here.
- [plans/design-system-live-convergence-plan.md](plans/design-system-live-convergence-plan.md) — Design-system live convergence programme — Status: execution-ready plan…
- [plans/document-viewer-phase2-unified-chrome.md](plans/document-viewer-phase2-unified-chrome.md) — Phase 2 — Unified viewing chrome (PDF + photo) — Status: plan only (no product behaviour change in this doc PR) Programme:
- [plans/document-viewer-phase3-handover.md](plans/document-viewer-phase3-handover.md) — Document viewer — Phase 3 handover — Execution brief for Phase 3 of docs/plans/document-viewer-redesign-plan.md.
- [plans/document-viewer-redesign-plan.md](plans/document-viewer-redesign-plan.md) — Document viewer redesign — PDF + photo surfaces — Status: programme plan (Phases 0–3 landed;
- [plans/edge-ingestion-overhaul-3pr-plan.md](plans/edge-ingestion-overhaul-3pr-plan.md) — Edge Ingestion Overhaul — 3-PR Execution Plan — Status: Planning only.
- [plans/tooling-activation-implementation-plan.md](plans/tooling-activation-implementation-plan.md) — Tooling activation — implementation plan — Status: local workstreams (WS-B, WS-C) implemented 2026-08-01;

## Plans and workstreams (living)

- [mode-aware-clinical-ask-local-handover.md](mode-aware-clinical-ask-local-handover.md) — three-phase local integration, approval-gated staging/governance, and PR publication handover for Mode-aware Clinical Ask
- [answer-page-redesign-handover.md](answer-page-redesign-handover.md) — build-and-merge handover for the chosen answer-page design: what claim-level citation data already exists, the three-PR order it forces, the design contract, and the gates and PR-body requirements that block the merge
- [maturity-backlog-workorders.md](maturity-backlog-workorders.md) — actionable work orders tracking the repository-maturity audit backlog
- [no-unchecked-indexed-access-migration-plan.md](no-unchecked-indexed-access-migration-plan.md) — staged multi-PR rollout for the `noUncheckedIndexedAccess` TypeScript flag (ledger `#211`)
- [ledger-id-scheme-proposal.md](ledger-id-scheme-proposal.md) — design for collision-free outstanding-issue ids so concurrent sessions stop contending on `issues:next-id` (ledger `#168`)
- [pr-handoff-stop-cross-agent-gap.md](pr-handoff-stop-cross-agent-gap.md) — why the PR-babysit budget is hook-enforced for Claude Code but prose-only for Codex and Cursor, and what parity would require (ledger `#258`)
- [framework-dependency-modernization-checklist.md](framework-dependency-modernization-checklist.md) — ordered Next.js 16, runtime, dependency, Turbopack, and verification migration program
- [search-rag-master-plan.md](search-rag-master-plan.md) / [search-rag-master-context.md](search-rag-master-context.md) — search/RAG roadmap and shared context
- [rag-improvement/README.md](rag-improvement/README.md) — reviewed/updated RAG improvement programme: answer-quality track (intent-aware related information, length) + corrected eval/safety infra track
- [rag-improvement/HANDOVER.md](rag-improvement/HANDOVER.md) — multi-session handover: per-session work packets, status table, checklists, and paste-ready prompts for executing the programme
- [rag-improvement/COORDINATION.md](rag-improvement/COORDINATION.md) — coordinator handover: programme history, wave/session decisions, babysit playbook, approvals map, and the coordination-chat bootstrap prompt
- [rag-improvement/231-diagnosis-2026-08-22.md](rag-improvement/231-diagnosis-2026-08-22.md) — `#231` evidence record: the row's timeout premise measured against the 60 Gate E answers, the three populations behind `source_only`, and the grounded-extractive gate gap
- [rag-improvement/baseline-record.md](rag-improvement/baseline-record.md) — programme evaluation baseline: the six-field report key, gate results, and which gates stay pending an owner-approved provider run
- [rag-improvement/data-flow-register.md](rag-improvement/data-flow-register.md) — Gate A register: every RAG input, process, sink, retention window, provider egress, and the known gaps
- [rag-hybrid-findings-and-todo.md](rag-hybrid-findings-and-todo.md) — hybrid retrieval findings backlog
- [reindex-shadow-harness-design.md](reindex-shadow-harness-design.md) — designed-only shadow reindex harness (driver not built)
- [ingestion-concurrency-fix-workorder.md](ingestion-concurrency-fix-workorder.md) — ingestion concurrency workorder
- [redesign/](redesign/) — premium redesign plans, decision log, token adoption
- [superpowers/](superpowers/) — agent-authored plans and specs
- **Care Plan (prototype, developer-gated under `/mockups/care-plan`)** — [superpowers/specs/2026-08-20-care-plan-design.md](superpowers/specs/2026-08-20-care-plan-design.md) is the binding design spec, [care-plan-context.md](care-plan-context.md) the binding glossary, [superpowers/plans/2026-08-20-care-plan-implementation.md](superpowers/plans/2026-08-20-care-plan-implementation.md) the implementation plan, [care-plan/sdd-ledger.md](care-plan/sdd-ledger.md) the build ledger and [care-plan/complete-work-ledger.md](care-plan/complete-work-ledger.md) the record of what landed; the dated handoffs, transcripts and reports under [care-plan/](care-plan/) are point-in-time records

### Also catalogued (2026-09-02)

Every remaining tracked document in this category, one line each; the description is the document's own title, with its opening sentence where that adds something.

- [corpus-health-panel-handover.md](corpus-health-panel-handover.md) — Corpus health panel — handover — Status: both changes are merged to main.

### Also catalogued (2026-09-26)

- [cme/design/cme-design-decisions.md](cme/design/cme-design-decisions.md) — CPD mode (mode id `cme`) — design decisions
- [on-call/design/2026-09-19-review-and-proposals.md](on-call/design/2026-09-19-review-and-proposals.md) — On Call — review of the shipped hub and what to build next, 2026-09-19
- [on-call/design/mockup-conformance.md](on-call/design/mockup-conformance.md) — On Call hub — mockup conformance ledger
- [on-call/design/on-call-hub-build-prompt.md](on-call/design/on-call-hub-build-prompt.md) — On Call hub redesign build prompt
- [product/2026-09-19-doctor-compliance-and-feature-brainstorm.md](product/2026-09-19-doctor-compliance-and-feature-brainstorm.md) — Personal compliance tracker and feature brainstorm, 2026-09-19 — nothing decided
- [product/2026-09-19-second-recommendations.md](product/2026-09-19-second-recommendations.md) — Seven more recommendations from reading the code, 2026-09-19 — nothing decided
- [prompts/sources-mode-extraction.md](prompts/sources-mode-extraction.md) — Sources mode extraction prompt
- [superpowers/plans/2026-09-04-on-call-mode.md](superpowers/plans/2026-09-04-on-call-mode.md) — On Call mode implementation plan
- [superpowers/plans/2026-09-27-on-call-completion.md](superpowers/plans/2026-09-27-on-call-completion.md) — On Call plan to complete the health-service rebuild (after #3110)
- [superpowers/plans/2026-09-20-cme-mode-phase-1.md](superpowers/plans/2026-09-20-cme-mode-phase-1.md) — CPD mode (mode id `cme`) phase 1 implementation plan
- [superpowers/plans/2026-09-25-wa-psychiatry-build.md](superpowers/plans/2026-09-25-wa-psychiatry-build.md) — WA Psychiatry build: fast-lane implementation plan (v2)
- [superpowers/plans/2026-09-27-roster-mode-overview.md](superpowers/plans/2026-09-27-roster-mode-overview.md) — Roster mode build overview: steps, default decisions, Josh-only actions
- [superpowers/plans/2026-09-27-roster-mode-plan-a-database.md](superpowers/plans/2026-09-27-roster-mode-plan-a-database.md) — Roster mode plan A: the combined database change (PR #3117)
- [superpowers/plans/2026-09-27-roster-mode-plan-b-release-1.md](superpowers/plans/2026-09-27-roster-mode-plan-b-release-1.md) — Roster mode plan B: Release 1, one doctor (PR #3118)
- [superpowers/plans/2026-09-27-roster-mode-plan-c-release-2.md](superpowers/plans/2026-09-27-roster-mode-plan-c-release-2.md) — Roster mode plan C: Release 2, Roster for a health service (the plan to complete it)
- [superpowers/plans/2026-09-27-roster-mode-status.md](superpowers/plans/2026-09-27-roster-mode-status.md) — Roster mode: where the build stands and the plan to complete it
- [superpowers/plans/2026-09-27-roster-mode-db-agreement.md](superpowers/plans/2026-09-27-roster-mode-db-agreement.md) — Roster mode: the Roster, On Call, Admin and Teaching agreement on the combined database change
- [superpowers/plans/2026-09-27-roster-mode-build-brief.md](superpowers/plans/2026-09-27-roster-mode-build-brief.md) — Roster mode: the brief the build threads work from
- [superpowers/specs/2026-09-30-roster-team-calendar-and-swaps-design.md](superpowers/specs/2026-09-30-roster-team-calendar-and-swaps-design.md) — Roster: team calendar (month, week board, day) and calendar-first swaps design spec
- [superpowers/plans/2026-09-30-roster-team-calendar-and-swaps.md](superpowers/plans/2026-09-30-roster-team-calendar-and-swaps.md) — Roster: team calendar and calendar-first swaps implementation plan
- [superpowers/specs/2026-09-04-on-call-mode-design.md](superpowers/specs/2026-09-04-on-call-mode-design.md) — On Call mode design spec

## Subdirectory map

| Directory                                        | What lives there                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [decisions/](decisions/)                         | The owner's recorded decisions, one short file each, indexed by [decisions/README.md](decisions/README.md). Checked by `npm run check:decisions`                                                         |
| [organisation/](organisation/)                   | The organisation map: one file per area (`systems/`), shared, not-yet-placed and ignored lists, last-read pins. Checked by `npm run check:organisation`                                                  |
| [agents/](agents/)                               | Agent-rule reference files `AGENTS.md` delegates to by name — the full text of rules its always-loaded core only points at                                                                               |
| [rag-behaviour/](rag-behaviour/)                 | Protected retrieval/ranking surface: behaviour map, refuted approaches, safeguards. **Read before touching ranking.**                                                                                    |
| [prompts/](prompts/)                             | Copy/paste review prompts, including the verbatim `codex-cloud-review/` inputs                                                                                                                           |
| [codex/](codex/)                                 | Per-lens Codex ultra-review output folders, one per review dimension                                                                                                                                     |
| [evidence/](evidence/)                           | Captured evidence artifacts backing ledger items (reliability reports, review manifests)                                                                                                                 |
| [audit/](audit/)                                 | Dated repo, design, accessibility, and latency audits (point-in-time)                                                                                                                                    |
| [redesign/](redesign/)                           | Premium redesign plans, decision log, token adoption                                                                                                                                                     |
| [superpowers/](superpowers/)                     | Agent-authored plans and specs                                                                                                                                                                           |
| [branch-review-records/](branch-review-records/) | Immutable one-row review records — one file per review — named for the SHA-256 of the row. **Append-only: never edit, delete, or move into subdirectories** ([policy](branch-review-archival-policy.md)) |
| [archive/](archive/)                             | Completed phase plans, superseded designs, old progress logs — never current guidance                                                                                                                    |

## Point-in-time records (historical — do not update)

Dated status reports, reviews, and operator decisions. They describe the repo
as it was on that date; supersede with a new dated document rather than editing.

- [dsm5tr-handover-reconciliation-2026-09-16.md](dsm5tr-handover-reconciliation-2026-09-16.md) — DSM-5-TR and Sources handover reconciled against HEAD 66105e1: the criteria-provenance fix that shipped, the disposition of all 30 claims, the four items held for owner approval, and why 0 of the 24 supplied sources pass the native acquisition gate
- [dsm5tr-approvals-queue.md](dsm5tr-approvals-queue.md) — what the DSM-5-TR handover leaves waiting on a person: 16 claims and 9 information concepts needing clinical sign-off, the seven rights questions per source across all 24, and the metadata 17 sources do not print
- [audit/](audit/) — repo and UX/accessibility audits
- [audit/full-repository-audit-2026-09-02.md](audit/full-repository-audit-2026-09-02.md) — full repository audit (25 lanes, independently verified findings, closed-off sub-projects, machine evidence, Stage-5 adversarial review; audit only, nothing acted on except one-line documentation corrections)
- [audit/2026-07-20-repository-maturity.md](audit/2026-07-20-repository-maturity.md) — full repository maturity, mapping, and organisation audit
- [audit/latency-audit-2026-07-28.md](audit/latency-audit-2026-07-28.md) — latency audit: server, client, and database findings by tier, with the already-cleared list
- [audit/audit-handover-2026-07-14.md](audit/audit-handover-2026-07-14.md) — multi-skill repository audit findings inventory
- [audit/audit-remediation-plan-2026-07-14.md](audit/audit-remediation-plan-2026-07-14.md) — sequenced remediation plan for the 2026-07-14 audit, with the 2026-07-17 reconciliation
- [audit/design-audit-2026-07-17.md](audit/design-audit-2026-07-17.md) — repository-wide design, accessibility, and interaction audit
- [audit/cloud-connection-acceptance-2026-08-05.md](audit/cloud-connection-acceptance-2026-08-05.md) — hosted versus local MCP boundary acceptance, Personal Pro split control plane, and remaining Cloud launcher blockers
- [audit/claude-code-cloud-connection-acceptance-2026-08-17.md](audit/claude-code-cloud-connection-acceptance-2026-08-17.md) — Claude Code desktop-vs-cloud connector parity check (Railway/Figma/Sentry/Supabase/GitHub live-verified), dependency-currency hook, open Supabase-scope and GitHub-portability items
- [audit/2026-09-17-external-audit-refutations.md](audit/2026-09-17-external-audit-refutations.md) — what the 2026-09-17 external audit got wrong and why: it read a commit 31 behind `main`, eight findings refuted with evidence (four re-verified 2026-09-18), which findings were real but already decided, and the two questions still worth a person
- [audit/2026-09-16-catalogue-read-latency.md](audit/2026-09-16-catalogue-read-latency.md) — every public catalogue read re-hashed the whole 9.5 MB frozen corpus (live mean 8,656 ms, max 17,263 ms); mitigated in the application, root cause still needs a migration and an approved window
- [audit/2026-09-16-registry-search-outage.md](audit/2026-09-16-registry-search-outage.md) — why registry search returned nothing for seven days; same read path as the catalogue-latency record, different defect
- [audit/psychsift-differentials-handover-reconciliation-2026-09-16.md](audit/psychsift-differentials-handover-reconciliation-2026-09-16.md) — the Differentials handover reconciled against repository records: why the evidence adapter is blocked, and the claim-to-record mapping the package cannot supply
- [audit/codex-cloud-reliability-20260907.md](audit/codex-cloud-reliability-20260907.md) — Codex Cloud reliability record, 2026-09-07
- [current-clinical-work-brief.md](current-clinical-work-brief.md) — ledger #063 product/privacy/persistence brief (decision only, no implementation)
- [factsheets-reading-model-brief.md](factsheets-reading-model-brief.md) — ledger #041 reading-model decision (no second Factsheets mode)
- [tooling-follow-through-decisions-2026-08-12.md](tooling-follow-through-decisions-2026-08-12.md) — ledger #150 CodeRabbit cap policy and #151 GitHub Actions observation fallback
- [staging-shutdown-and-repo-review-handover-2026-09-06.md](staging-shutdown-and-repo-review-handover-2026-09-06.md) — why shutting staging down does not block drift detection or repair (and what it does block), plus three off-ledger findings: the open SaMD classification on a live patient-specific feature, the spend threshold that alerts without enforcing, and unreachable password sign-in
- [evidence/forms-operational-guidance-review.md](evidence/forms-operational-guidance-review.md) — generated sign-off sheet: what the Forms mode displays for each of the 54 forms, the sections and approved form it was drafted from, and how a reviewer records sign-off one form at a time (`npm run forms:review-sheet`)
- [evidence/forms-pdf-publisher-comparison-2026-09-16.md](evidence/forms-pdf-publisher-comparison-2026-09-16.md) — byte comparison of all 51 approved-form PDFs against the Office of the Chief Psychiatrist's own URLs (51 of 51 identical), the same-day register reconciliation of all 54 codes and availability states, and the Form 10G register typo this repository does not copy
- [wa-mha-forms-handover-reconciliation-2026-09-16.md](wa-mha-forms-handover-reconciliation-2026-09-16.md) — reconciliation receipt for the portable WA MHA Forms/Sources handover: what the Forms catalogue actually carried (40 of 54 forms on PDF-indexing scaffolding or the generic fallback), what landed, the zero-insert source preview and its single Act URL conflict, and the open clinical sign-off, Act-currency and asset gates
- [source-governance-refresh-worklist-2026-07-22.md](source-governance-refresh-worklist-2026-07-22.md) — ledger #022 worklist and BMJ attestation policy status
- [specifier-definition-worklist-2026-09-18.md](specifier-definition-worklist-2026-09-18.md) — issue #693 clinical worklist for the 585-item specifier catalogue: why "71 defined" is really 14, that nothing carries clinician sign-off, the A/B/C triage split, the 63 management-changing items in full, and a worked example of what a completed entry must contain
- [specifier-entry-worksheet-with-catatonia.md](specifier-entry-worksheet-with-catatonia.md) — the first specifier entry laid out for completion: one shared definition, nine per-disorder rows, the exact field changes, and the sign-off block, with every clinical statement blank
- `release-source-metadata-debt-2026-06-30.json` — captured source-metadata debt policy, consumed by `npm run audit:source-governance:release` and `npm run eval:quality:release`
- [forward-codify-retrieval-rpcs-workorder.md](forward-codify-retrieval-rpcs-workorder.md) — completed retrieval RPC codification workorder
- [project-alignment-cleanup.md](archive/project-alignment-cleanup.md) — completed June 2026 repo-alignment record
- [capacity-review.md](audit/capacity-review.md), [scale-readiness-review.md](audit/scale-readiness-review.md), [tenancy-defense-in-depth-review.md](audit/tenancy-defense-in-depth-review.md)
- `*-2026-*` findings and status docs, e.g. [chunking-ocr-reindex-lever-finding-2026-07-08.md](chunking-ocr-reindex-lever-finding-2026-07-08.md), [source-governance-status-2026-07-08.md](archive/source-governance-status-2026-07-08.md), [source-governance-priorities-2026-07-02.md](archive/source-governance-priorities-2026-07-02.md), [source-review-priority-2026-07-02.md](source-review-priority-2026-07-02.md), [operator-apply-july8-batch.md](archive/operator-apply-july8-batch.md)

### Also catalogued (2026-09-02)

Every remaining tracked document in this category (dated records and the `evidence/`, `archive/`, `audit/`, `care-plan/` and `superpowers/` folders — historical; do not update), one line each; the description is the document's own title, with its opening sentence where that adds something.

- [review-findings-2026-08-02.md](review-findings-2026-08-02.md) — Mega-review report — TypeScript, code, quality, explicit-any, unchecked indexed access — Date: 2026-08-02 Scope:
- [evidence/bundle-budget-production-rebaseline-2026-08-18.md](evidence/bundle-budget-production-rebaseline-2026-08-18.md) — Production bundle-budget re-baseline — 2026-08-18 — check:bundle-budget compares the client JavaScript a non-mockup route can reach against a baseline captured from a known-good build.
- [evidence/mha-2014-section-summaries-review.md](evidence/mha-2014-section-summaries-review.md) — Mental Health Act 2014 (WA) — section summary review sheet — Act version 02-b0-01, as at 2025-09-25.
- [evidence/mobile-root-timing-control-2026-08-26.md](evidence/mobile-root-timing-control-2026-08-26.md) — Mobile-root timing control — 2026-08-26 — The mobile-root timing signal recorded during PR #2313 was not reproduced on pinned Linux CI.
- [evidence/performance-remediation-2026-08-23.md](evidence/performance-remediation-2026-08-23.md) — Current-main performance remediation evidence — 2026-08-23 — This change fixes the two deterministically attributed layout mechanisms on the shared search shell, removes an unsolicited Applications-rou…
- [evidence/rag-irrelevant-at-10-disposition.md](evidence/rag-irrelevant-at-10-disposition.md) — RAG irrelevant-at-10 labeling disposition & browser matrix evidence — 2026-08-27 — This document records the human review disposition and scheduled browser matrix verification for ledger issue #023 (P2), completing the eval…
- [evidence/rag-reliability-evidence-2026-07-27.md](evidence/rag-reliability-evidence-2026-07-27.md) — RAG reliability evidence — 2026-07-27 — This record captures the final local/live evidence for the 2026-07-27 RAG reliability work.
- [archive/BRANCH_ARCHIVE_20260709.md](archive/BRANCH_ARCHIVE_20260709.md) — Obsolete Branch Archive — This branch preserves the histories of obsolete remote branches before deleting their scattered refs.
- [archive/COLOR_REDESIGN_PLAN.md](archive/COLOR_REDESIGN_PLAN.md) — Luxury Black-First Color Redesign Plan (Global UI Polish) — Apply a refined, premium dark-first visual system across the app with minimal risk:
- [archive/TOOLS_CONTEXT_FOR_NEW_CHAT.md](archive/TOOLS_CONTEXT_FOR_NEW_CHAT.md) — Context handoff: Tools / Applications UX task — I’m creating this file so a new chat can continue the exact task with full context, including screenshots referenced so far.
- [archive/branch-cleanup-2026-06-28.md](archive/branch-cleanup-2026-06-28.md) — Branch Cleanup Snapshot — 2026-06-28 — Archived from docs/branch-cleanup-guide.md on 2026-07-04.
- [archive/branch-progress-2026-07-05.md](archive/branch-progress-2026-07-05.md) — Branch Progress Snapshot — 2026-07-05 — Archived from the working tree on 2026-07-05.
- [archive/branch-review-ledger-2026-q3.md](archive/branch-review-ledger-2026-q3.md) — Branch Review Ledger Archive — 2026-q3 — Historical review records rotated out of docs/branch-review-ledger.md so the live table stays navigable.
- [archive/clinical-chat-ui-implementation-plan.md](archive/clinical-chat-ui-implementation-plan.md) — Clinical Chat UI Implementation Plan — Date: 2026-06-23…
- [archive/clinical-chat-ui-phase-checklist.md](archive/clinical-chat-ui-phase-checklist.md) — Clinical Chat UI Phase Checklist — Date: 2026-06-23…
- [archive/cloud-chat-reconciliation-2026-07-22.md](archive/cloud-chat-reconciliation-2026-07-22.md) — Cloud-chat reconciliation record — 2026-07-22 — This record closes the Database cloud-chat reconciliation against protected origin/main.
- [archive/cloud-chat-reconciliation-postmortem-2026-07-23.md](archive/cloud-chat-reconciliation-postmortem-2026-07-23.md) — Cloud-chat reconciliation postmortem — 2026-07-23 — This is the durable final account of the Database cloud-chat reconciliation.
- [archive/design-qa-2026-07-15.md](archive/design-qa-2026-07-15.md) — Design QA — 2026-07-15 — Final result: blocked.
- [archive/design-qa.md](archive/design-qa.md) — design-qa
- [archive/operator-decisions-2026-07-04.md](archive/operator-decisions-2026-07-04.md) — Operator decisions — 2026-07-04 — Historical snapshot of manual follow-ups deferred during documentation and verification gate recovery work.
- [archive/operator-decisions-2026-07-06.md](archive/operator-decisions-2026-07-06.md) — Operator decisions — 2026-07-06 — Approvals granted during the repository-review follow-up session.
- [archive/phase-3-design-decision-log.md](archive/phase-3-design-decision-log.md) — Phase 3 Design Decision Log — Changed: The dashboard command header is being reworked around a full-width mobile question input, larger mode controls, and sheet-like scop…
- [archive/phase-6-reaudit-2026-06-29.md](archive/phase-6-reaudit-2026-06-29.md) — Phase 6 Re-Audit - June 29, 2026 — This pass re-checked the remediation work after the M2 merge and live Supabase migration.
- [archive/rag-scalability-wip-remediation-2026-07-17.md](archive/rag-scalability-wip-remediation-2026-07-17.md) — RAG-scalability WIP review — remediation report (2026-07-17) — Status: F11 shipped and merged;
- [archive/rag-scalability-wip-review-handover-2026-07-15.md](archive/rag-scalability-wip-review-handover-2026-07-15.md) — Handover — RAG scalability WIP review findings (2026-07-15) — Status: findings + remediation plan recorded;
- [archive/search-rag-phase-0-baseline.md](archive/search-rag-phase-0-baseline.md) — Search/RAG Phase 0 Baseline — Date: 2026-06-29 Workspace:
- [archive/search-rag-phase-1-api-validation.md](archive/search-rag-phase-1-api-validation.md) — Search/RAG Phase 1: API Validation Contract — Date: 2026-06-29 Workspace:
- [archive/search-rag-phase-2-answer-plan.md](archive/search-rag-phase-2-answer-plan.md) — Search/RAG Phase 2: Answer Plan Contract — Date: 2026-06-29 Workspace:
- [archive/search-rag-phase-3-synthesis-output.md](archive/search-rag-phase-3-synthesis-output.md) — Phase 3: Synthesis Prompt And Structured Output Hardening — Make the model the final clinical composer while keeping generated output grounded, evidence-ID constrained, and machine-validated before it…
- [archive/search-rag-phase-4-canonical-render-policy.md](archive/search-rag-phase-4-canonical-render-policy.md) — Phase 4: Canonical Render Policy — Prevent noisy answer panels by rendering from a normalized display policy instead of raw RagAnswer field presence.
- [archive/search-rag-phase-5-source-review-ux.md](archive/search-rag-phase-5-source-review-ux.md) — Phase 5: Source Review UX — Make evidence review fast, consistent, clickable, and accessible across desktop and mobile.
- [archive/search-rag-phase-5.5-retrieval-quality-source-selection.md](archive/search-rag-phase-5.5-retrieval-quality-source-selection.md) — Phase 5.5: Retrieval Quality And Source Selection Contract — Fix the remaining retrieval/source-selection failures before final security hardening.
- [archive/search-rag-phase-5.5b-retrieval-follow-up.md](archive/search-rag-phase-5.5b-retrieval-follow-up.md) — Phase 5.5b: Visual Retrieval And Supported-Answer Recovery — Phase 5.5 fixed the first set of targeted retrieval misses, but the follow-up eval still showed two retrieval defects and a separate RAG-eva…
- [archive/search-rag-pre-phase-2-diff-classification.md](archive/search-rag-pre-phase-2-diff-classification.md) — Pre-Phase 2 Dirty Diff Classification — Date: 2026-06-29 Workspace:
- [audit/gate-consolidation-audit-2026-09-02.md](audit/gate-consolidation-audit-2026-09-02.md) — Gate consolidation audit — 2026-09-02 — Status: proposal only.
- [audit/live-design-interaction-audit-2026-08-06.md](audit/live-design-interaction-audit-2026-08-06.md) — Live design & interaction audit — master report — Date: 2026-08-06 App:
- [audit/live-drift-forensics-2026-08.md](audit/live-drift-forensics-2026-08.md) — Live-drift forensics — 2026-08 — Evidence record for the phased database remediation plan and playbook.
- [audit/performance-image-cwv-audit-2026-08-02.md](audit/performance-image-cwv-audit-2026-08-02.md) — Performance, Image & Core Web Vitals Audit — PsychSift Production — Date: 2026-08-02 Scope:
- [audit/primary-checkout-reconciliation-2026-07-24.md](audit/primary-checkout-reconciliation-2026-07-24.md) — Primary checkout reconciliation — 2026-07-24 — This record covers the dirty primary checkout and the final cloud-chat salvage wave.
- [audit/repo-audit-2026-07-01.md](audit/repo-audit-2026-07-01.md) — Repository Audit — PsychSift Production — Date: 2026-07-01 Branch:
- [audit/repo-wide-review-remediation-plan-2026-07-23.md](audit/repo-wide-review-remediation-plan-2026-07-23.md) — Repository-wide review remediation completion plan — 2026-07-24 — Complete every outstanding finding from the 2026-07-19 repository-wide review sweep with the smallest safe patches, clear ownership boundari…
- [audit/repo-wide-review-sweep-2026-07-19.md](audit/repo-wide-review-sweep-2026-07-19.md) — Repository-wide review sweep — 2026-07-19 — This was a broad static repository sweep of /workspace/Database on branch work, combining the repo workflow guidance, local static commands,…
- [audit/ux-accessibility-review-2026-07-07.md](audit/ux-accessibility-review-2026-07-07.md) — UX & Accessibility Review — Date: 2026-07-07 Reviewer role:
- [audit/worktree-reconciliation-2026-08-23.md](audit/worktree-reconciliation-2026-08-23.md) — Worktree and branch reconciliation — 2026-08-23 — Disposition: preservation-first;
- [care-plan/CLAUDE-START-HERE.md](care-plan/CLAUDE-START-HERE.md) — Care Plan — Claude start here — Last updated: 22 August 2026 (Australia/Perth) Implementation status:
- [care-plan/HANDOFF-2026-08-24-SUPERSEDED.md](care-plan/HANDOFF-2026-08-24-SUPERSEDED.md) — Care Plan — complete handoff package — Assembled 24 August 2026, when the previous session hit its weekly account limit.
- [care-plan/HANDOFF-START-HERE.md](care-plan/HANDOFF-START-HERE.md) — Care Plan — start here — Rewritten 1 September 2026.
- [care-plan/accessibility-acceptance.md](care-plan/accessibility-acceptance.md) — Care Plan — accessibility and responsive acceptance — What was checked, how, at what size, in what mode — and, just as importantly, what was not checked and therefore remains an open acceptance…
- [care-plan/claude-build-handover-2026-08-21.md](care-plan/claude-build-handover-2026-08-21.md) — ED Care Plans — detailed Claude build handover — ED Care Plans is fully brainstormed, clinically bounded, visually selected, specified, and decomposed into a nine-task implementation plan.
- [care-plan/clinical-language-trace.md](care-plan/clinical-language-trace.md) — Care Plan — clinical language trace — Every consequential label the prototype shows a reader, traced to the glossary term or specification sentence it comes from, and the banned…
- [care-plan/cloud-session.md](care-plan/cloud-session.md) — Care Plan — cloud session brief and progress log — If you are an AI session working on Care Plan in the cloud, this is the first file you read and the last file you write.
- [care-plan/conversation-transcript-2026-08-21.md](care-plan/conversation-transcript-2026-08-21.md) — ED Care Plans — Codex conversation transcript — This is a portable transcript of the conversational text.
- [care-plan/implementation-handoff.md](care-plan/implementation-handoff.md) — Care Plan — implementation handoff — What was built, where it lives, what it deliberately does not do, and what would have to be true before any of it went near a patient.
- [care-plan/interaction-matrix.md](care-plan/interaction-matrix.md) — Care Plan — interaction matrix — Every control in the prototype:
- [care-plan/patient-facing-sheets/README.md](care-plan/patient-facing-sheets/README.md) — The three printed sheets, as text — Committed 2 September 2026 so that a session without access to this machine — a cloud session above all — can read what Care Plan actually p…
- [care-plan/reports/final-fix-report.md](care-plan/reports/final-fix-report.md) — Care Plan — final fix wave — Branch: claude/care-plan-stage-b-9-11 Worktree:
- [care-plan/reports/task-10-report.md](care-plan/reports/task-10-report.md) — Task 10 — Reviews, Team, Governance, History, and System states — Branch claude/care-plan-stage-b-9-11, worktree D:\Worktrees\Database\care-plan-impl.
- [care-plan/reports/task-11-report.md](care-plan/reports/task-11-report.md) — Task 11 — Browser journeys, responsive and accessibility proof, documentation, handoff — Branch claude/care-plan-stage-b-9-11, worktree D:\Worktrees\Database\care-plan-impl.
- [care-plan/reports/task-3-brief.md](care-plan/reports/task-3-brief.md) — task-3-brief
- [care-plan/reports/task-3-report.md](care-plan/reports/task-3-report.md) — Task 3 report — gated route family, literal navigation, responsive clinical shell — Branch claude/ed-care-plans-impl-7f44cd, worktree D:\Worktrees\Database\care-plan-impl, base d421bc2dc.
- [care-plan/reports/task-4-brief.md](care-plan/reports/task-4-brief.md) — task-4-brief
- [care-plan/reports/task-4-report.md](care-plan/reports/task-4-report.md) — Task 4 report — Clinical Snapshot, patient search, Current Plan hierarchy, CMHT actions — Branch claude/ed-care-plans-impl-7f44cd, worktree D:\Worktrees\Database\care-plan-impl.
- [care-plan/reports/task-5-brief.md](care-plan/reports/task-5-brief.md) — task-5-brief
- [care-plan/reports/task-5-report.md](care-plan/reports/task-5-report.md) — Task 5 report — Management Plan reading, pinned safety boundary, and clinician print — Branch claude/ed-care-plans-impl-7f44cd, worktree D:\Worktrees\Database\care-plan-impl.
- [care-plan/reports/task-6-brief.md](care-plan/reports/task-6-brief.md) — task-6-brief
- [care-plan/reports/task-6-report.md](care-plan/reports/task-6-report.md) — Task 6 report — governed Management Plan authoring — Stage B opens with the first authoring surface in the product:
- [care-plan/reports/task-7-brief.md](care-plan/reports/task-7-brief.md) — task-7-brief
- [care-plan/reports/task-7-report.md](care-plan/reports/task-7-report.md) — Task 7 report — ED Presentation timeline, concise recording, plan-use feedback, and visible amendments — Branch claude/ed-care-plans-impl-7f44cd, worktree D:\Worktrees\Database\care-plan-impl.
- [care-plan/reports/task-8-brief.md](care-plan/reports/task-8-brief.md) — task-8-brief
- [care-plan/reports/task-8-report.md](care-plan/reports/task-8-report.md) — Task 8 report — the patient's own Personal Safety Plan, its versioning, and its printed copy — Worktree D:\Worktrees\Database\care-plan-impl, branch claude/ed-care-plans-impl-7f44cd.
- [care-plan/reports/task-9-brief.md](care-plan/reports/task-9-brief.md) — task-9-brief
- [care-plan/reports/task-9-report.md](care-plan/reports/task-9-report.md) — Task 9 report — Patient Plan — Commit: f4de82034 — feat(care-plan):
- [care-plan/reports/task-d1-report.md](care-plan/reports/task-d1-report.md) — Task D1 — the moment the person's part was recorded — Status: COMPLETE. Fast checks only, by user instruction (D2).
- [care-plan/session-handoff-2026-08-21.md](care-plan/session-handoff-2026-08-21.md) — Care Plan — session handoff, 21 August 2026 — Written at the end of the controlling Claude session that designed Care Plan and built Tasks 1 and 2.
- [care-plan/session-handoff-2026-08-23.md](care-plan/session-handoff-2026-08-23.md) — Care Plan — session handoff, 23 August 2026 — Written at the moment the session was closed, mid-task.
- [care-plan/verification-log-2026-08-21.md](care-plan/verification-log-2026-08-21.md) — ED Care Plans — handover verification log — This log records evidence for the design/planning/handover package only.
- [care-plan/verification-report.md](care-plan/verification-report.md) — Care Plan — verification report (Task 11) — Exact commands, exit codes, result lines, failures, and — just as important — the checks that were not run and why.
- [superpowers/plans/2026-07-04-public-anonymous-access-rate-limits.md](superpowers/plans/2026-07-04-public-anonymous-access-rate-limits.md) — Public Anonymous Access and Rate Limiting Implementation Plan — Goal: Remove the forced sign-in/authorization barrier so anonymous users can run live searches, generate answers, browse/view source documen…
- [superpowers/plans/2026-07-24-webkit-rsc-prefetch-disposition.md](superpowers/plans/2026-07-24-webkit-rsc-prefetch-disposition.md) — WebKit RSC Prefetch Disposition Implementation Plan — Goal: Disposition issue #024 by proving whether the WebKit _rsc access-control page error is caused by the route-coverage harness, applying…
- [superpowers/plans/2026-08-05-editable-pin-menu-mockups.md](superpowers/plans/2026-08-05-editable-pin-menu-mockups.md) — Search + Editable Pins Menu — Implementation Record — Perfect /mockups/search-lens-menu around editable app-destination pins while preserving the original visual direction.
- [superpowers/plans/2026-08-20-rag-adaptive-answer.md](superpowers/plans/2026-08-20-rag-adaptive-answer.md) — Adaptive RAG answer and display — Implementation Plan — Goal: Extend the landed v19 moderate-length/related-information contract into evidence-gated adaptive answers, and remove the independent si…
- [superpowers/plans/2026-08-20-rag-australian-source-governance.md](superpowers/plans/2026-08-20-rag-australian-source-governance.md) — Australian source governance for RAG — Implementation Plan — Goal: Establish a typed, enforceable Australian source catalogue that augments uploaded indexed guidelines, excludes Healthdirect, treats eT…
- [superpowers/plans/2026-08-20-rag-evaluation-rollout.md](superpowers/plans/2026-08-20-rag-evaluation-rollout.md) — RAG programme evaluation, rollout, and operations — Implementation Plan — Goal: Make every source, retrieval, answer, fallback, re-index, and incremental-delivery improvement measurable, privacy-minimised, reversib…
- [superpowers/plans/2026-08-20-rag-ingestion-reindex.md](superpowers/plans/2026-08-20-rag-ingestion-reindex.md) — Governed ingestion audit and reversible targeted re-index — Implementation Plan — Goal: Determine which documents genuinely need repair, acquire only allowlisted public Australian versions into a governed shadow state, cor…
- [superpowers/plans/2026-08-20-rag-retrieval-composition.md](superpowers/plans/2026-08-20-rag-retrieval-composition.md) — RAG query planning, combined retrieval, and fallback — Implementation Plan — Goal: Stop false “not enough information” answers by decomposing only genuinely broad questions, searching shared uploaded guidance, current…
- [superpowers/plans/2026-08-20-rag-verified-incremental-delivery.md](superpowers/plans/2026-08-20-rag-verified-incremental-delivery.md) — Verified incremental RAG delivery — Implementation Plan — Goal: Make the chat begin showing useful answer text sooner, while preserving the rule that no raw token, provisional dose, incomplete JSON,…
- [superpowers/plans/2026-08-21-developer-hub-phase-1-COMPLETION.md](superpowers/plans/2026-08-21-developer-hub-phase-1-COMPLETION.md) — Developer hub Phase 1 — completion record — Companion to -HANDOFF.md (how to resume) and -WORKLOG.md (the full history through Task 2).
- [superpowers/plans/2026-08-21-developer-hub-phase-1-HANDOFF.md](superpowers/plans/2026-08-21-developer-hub-phase-1-HANDOFF.md) — Developer hub Phase 1 — handoff — Read this before touching the plan.
- [superpowers/plans/2026-08-21-developer-hub-phase-1-WORKLOG.md](superpowers/plans/2026-08-21-developer-hub-phase-1-WORKLOG.md) — Developer hub Phase 1 — complete worklog — Everything done on this work, in order, including what failed.
- [superpowers/plans/2026-08-21-developer-hub-phase-1.md](superpowers/plans/2026-08-21-developer-hub-phase-1.md) — Developer hub — Phase 1 implementation plan — Goal: Turn /mockups/development into a login-gated developer hub whose first live panel is a task ledger rendered from docs/outstanding-issu…
- [superpowers/plans/2026-08-21-rag-repository-content-sync.md](superpowers/plans/2026-08-21-rag-repository-content-sync.md) — Repository-wide first-party content retrieval and freshness — Implementation Plan — Goal: Let Answer mode retrieve the relevant approved the product content for questions about specifiers, differentials, medications, service…
- [superpowers/plans/2026-08-21-trusted-admin-document-ingestion.md](superpowers/plans/2026-08-21-trusted-admin-document-ingestion.md) — Trusted Admin/Backend Document Ingestion — Implementation Plan — Goal: Make a trusted administrator/backend upload the clinical-admission event, then automatically activate the document for shared clinical…
- [superpowers/plans/2026-08-22-developer-hub-phase-2-HANDOFF.md](superpowers/plans/2026-08-22-developer-hub-phase-2-HANDOFF.md) — Developer hub Phase 2 — handoff — Companion to the plan (2026-08-22-developer-hub-phase-2.md) and the approved spec (docs/superpowers/specs/2026-08-22-developer-hub-phase-2-d…
- [superpowers/plans/2026-08-22-developer-hub-phase-2.md](superpowers/plans/2026-08-22-developer-hub-phase-2.md) — Developer hub Phase 2 (repo awareness) Implementation Plan — Goal: Fill the developer hub's four phase:
- [superpowers/plans/2026-08-22-mode-aware-clinical-ask-implementation.md](superpowers/plans/2026-08-22-mode-aware-clinical-ask-implementation.md) — Mode-aware Clinical Ask Implementation Plan — Goal: Add an explicit typed-or-dictated Clinical Ask action to Services, Forms, Differentials, Formulation, DSM-5 Diagnosis, Specifiers, and…
- [superpowers/plans/2026-08-23-clinical-trust-cockpit.md](superpowers/plans/2026-08-23-clinical-trust-cockpit.md) — Clinical trust cockpit — implementation plan — Goal: Give authorised reviewers one place to see content maturity, source-change impact, and quality feedback with explicit ownership and ev…
- [superpowers/plans/2026-08-23-favourites-and-reconciliation.md](superpowers/plans/2026-08-23-favourites-and-reconciliation.md) — Favourites and repository reconciliation — implementation plan — Goal: Complete stable-reference favourites and leave the branch/worktree fleet safer without sacrificing recoverable work.
- [superpowers/plans/2026-08-23-lighthouse-local-build-reliability.md](superpowers/plans/2026-08-23-lighthouse-local-build-reliability.md) — Lighthouse Local Build Reliability Implementation Plan — Goal: Let the repository-owned Lighthouse workflow complete its isolated production build on the supported Windows workstation without weake…
- [superpowers/plans/2026-08-23-outstanding-p2-p3-remediation.md](superpowers/plans/2026-08-23-outstanding-p2-p3-remediation.md) — Outstanding P2/P3 Remediation Implementation Plan — Goal: Resolve all 55 supplied P2/P3 ledger rows through permanent repository fixes, evidence-backed closures, or accurate external-gate upda…
- [superpowers/plans/2026-08-23-performance-remediation-current-main.md](superpowers/plans/2026-08-23-performance-remediation-current-main.md) — Current-main Performance Remediation Implementation Plan — Goal: Resolve the performance defects that remain evidenced on current main, strengthen the measurement and budget guardrails that failed to…
- [superpowers/plans/2026-08-23-platform-contracts-readiness.md](superpowers/plans/2026-08-23-platform-contracts-readiness.md) — Platform contracts and readiness — implementation plan — Goal: Make API/model payloads, privacy readiness, alerts, and clinical-hazard evidence machine-checkable without overstating external accept…
- [superpowers/plans/2026-08-25-developer-hub-ingestion-panel.md](superpowers/plans/2026-08-25-developer-hub-ingestion-panel.md) — Developer hub — ingestion panel — Date: 2026-08-25 Status:
- [superpowers/plans/2026-09-01-calculators-clinical-safety.md](superpowers/plans/2026-09-01-calculators-clinical-safety.md) — Calculators clinical safety and governance implementation plan
- [superpowers/plans/2026-09-01-native-smart-catalogue-search.md](superpowers/plans/2026-09-01-native-smart-catalogue-search.md) — Native Smart Catalogue Search Implementation Plan — Goal: Add safe, provider-free natural-language catalogue search to Medication, Tools, Calculators, Factsheets, and Dictionary while preservi…
- [superpowers/plans/2026-09-01-services-safety-provenance.md](superpowers/plans/2026-09-01-services-safety-provenance.md) — Services Safety and Provenance Foundation — Implementation Plan — 2. Add canonical source modules and validation.
- [superpowers/plans/2026-09-01-sources-mode.md](superpowers/plans/2026-09-01-sources-mode.md) — Sources Mode Implementation Plan — Goal: Build a read-only /sources application mode that automatically catalogues, organises, rates, ranks and traces every structured academi…
- [superpowers/rag-upgrade/CLOUD-EXECUTION-PROMPT.md](superpowers/rag-upgrade/CLOUD-EXECUTION-PROMPT.md) — Cloud execution prompt template — Use the final handover message's filled prompt, not this unfilled template.
- [superpowers/rag-upgrade/LOCAL-CONNECTED-EXECUTION-PROMPT.md](superpowers/rag-upgrade/LOCAL-CONNECTED-EXECUTION-PROMPT.md) — New-session local connected execution prompt — Use this only after Cloud P17 and accepted PROGRAMME.json are published.
- [superpowers/rag-upgrade/canonical/START-HERE.cloud.md](superpowers/rag-upgrade/canonical/START-HERE.cloud.md) — Cloud execution package — start here — This package executes P00–P17 only.
- [superpowers/rag-upgrade/canonical/START-HERE.local.md](superpowers/rag-upgrade/canonical/START-HERE.local.md) — Local operational package — start here — This is the new-session Windows/local handover for L00–L10 after accepted Cloud P00–P17 work.
- [superpowers/rag-upgrade/canonical/approval-matrix.md](superpowers/rag-upgrade/canonical/approval-matrix.md) — Authority and approval matrix — Authority is action- and target-specific.
- [superpowers/rag-upgrade/canonical/connected-execution.md](superpowers/rag-upgrade/canonical/connected-execution.md) — Local connected execution contract — This contract begins only after P17 and the immutable offline PROGRAMME.json are accepted and published.
- [superpowers/rag-upgrade/canonical/execution-order.md](superpowers/rag-upgrade/canonical/execution-order.md) — RAG upgrade execution order — The manifest is the scheduling authority.
- [superpowers/rag-upgrade/canonical/sdd-execution.md](superpowers/rag-upgrade/canonical/sdd-execution.md) — Subagent-driven execution contract — The tracked .agents/skills/rag-cloud-sdd/SKILL.md is the self-contained Cloud controller.
- [superpowers/rag-upgrade/cloud/START-HERE.md](superpowers/rag-upgrade/cloud/START-HERE.md) — Cloud execution package — start here — This package executes P00–P17 only.
- [superpowers/rag-upgrade/cloud/approval-matrix.md](superpowers/rag-upgrade/cloud/approval-matrix.md) — Authority and approval matrix — Authority is action- and target-specific.
- [superpowers/rag-upgrade/cloud/connected-execution.md](superpowers/rag-upgrade/cloud/connected-execution.md) — Local connected execution contract — This contract begins only after P17 and the immutable offline PROGRAMME.json are accepted and published.
- [superpowers/rag-upgrade/cloud/execution-order.md](superpowers/rag-upgrade/cloud/execution-order.md) — RAG upgrade execution order — The manifest is the scheduling authority.
- [superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-adaptive-answer.md](superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-adaptive-answer.md) — Adaptive RAG answer and display — Implementation Plan — Goal: Extend the landed v19 moderate-length/related-information contract into evidence-gated adaptive answers, and remove the independent si…
- [superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-australian-source-governance.md](superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-australian-source-governance.md) — Australian source governance for RAG — Implementation Plan — Goal: Establish a typed, enforceable Australian source catalogue that augments uploaded indexed guidelines, excludes Healthdirect, treats eT…
- [superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-evaluation-rollout.md](superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-evaluation-rollout.md) — RAG programme evaluation, rollout, and operations — Implementation Plan — Goal: Make every source, retrieval, answer, fallback, re-index, and incremental-delivery improvement measurable, privacy-minimised, reversib…
- [superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-ingestion-reindex.md](superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-ingestion-reindex.md) — Governed ingestion audit and reversible targeted re-index — Implementation Plan — Goal: Determine which documents genuinely need repair, acquire only allowlisted public Australian versions into a governed shadow state, cor…
- [superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-retrieval-composition.md](superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-retrieval-composition.md) — RAG query planning, combined retrieval, and fallback — Implementation Plan — Goal: Stop false “not enough information” answers by decomposing only genuinely broad questions, searching shared uploaded guidance, current…
- [superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-verified-incremental-delivery.md](superpowers/rag-upgrade/cloud/plans/2026-08-20-rag-verified-incremental-delivery.md) — Verified incremental RAG delivery — Implementation Plan — Goal: Make the chat begin showing useful answer text sooner, while preserving the rule that no raw token, provisional dose, incomplete JSON,…
- [superpowers/rag-upgrade/cloud/plans/2026-08-21-rag-repository-content-sync.md](superpowers/rag-upgrade/cloud/plans/2026-08-21-rag-repository-content-sync.md) — Repository-wide first-party content retrieval and freshness — Implementation Plan — Goal: Let Answer mode retrieve the relevant approved the product content for questions about specifiers, differentials, medications, service…
- [superpowers/rag-upgrade/cloud/plans/2026-08-21-trusted-admin-document-ingestion.md](superpowers/rag-upgrade/cloud/plans/2026-08-21-trusted-admin-document-ingestion.md) — Trusted Admin/Backend Document Ingestion — Implementation Plan — Goal: Make a trusted administrator/backend upload the clinical-admission event, then automatically activate the document for shared clinical…
- [superpowers/rag-upgrade/cloud/sdd-execution.md](superpowers/rag-upgrade/cloud/sdd-execution.md) — Subagent-driven execution contract — The tracked .agents/skills/rag-cloud-sdd/SKILL.md is the self-contained Cloud controller.
- [superpowers/rag-upgrade/cloud/specs/2026-08-20-rag-answer-and-australian-sources-design.md](superpowers/rag-upgrade/cloud/specs/2026-08-20-rag-answer-and-australian-sources-design.md) — RAG answer quality, repository content, and Australian source augmentation — design — Status: Approved programme design, reconciled against origin/main aa0c04bce12995894a9287cb1a084f89f2ed6ef8 on 2026-08-22.
- [superpowers/rag-upgrade/cloud/specs/2026-08-21-trusted-admin-document-ingestion-design.md](superpowers/rag-upgrade/cloud/specs/2026-08-21-trusted-admin-document-ingestion-design.md) — Trusted Admin/Backend Document Ingestion and RAG Activation Design — Date: 2026-08-21 Status:
- [superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/README.md](superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/README.md) — RAG upgrade execution artifacts — Accepted phase receipts reference immutable artifacts below this directory.
- [superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/README.md](superpowers/rag-upgrade/execution-receipts/rag-answer-quality-and-repository-coverage-v1/README.md) — RAG upgrade execution receipts — This tracked directory is the durable cross-session ledger for programme rag-answer-quality-and-repository-coverage-v1.
- [superpowers/rag-upgrade/local/START-HERE.md](superpowers/rag-upgrade/local/START-HERE.md) — Local operational package — start here — This is the new-session Windows/local handover for L00–L10 after accepted Cloud P00–P17 work.
- [superpowers/rag-upgrade/local/approval-matrix.md](superpowers/rag-upgrade/local/approval-matrix.md) — Authority and approval matrix — Authority is action- and target-specific.
- [superpowers/rag-upgrade/local/connected-execution.md](superpowers/rag-upgrade/local/connected-execution.md) — Local connected execution contract — This contract begins only after P17 and the immutable offline PROGRAMME.json are accepted and published.
- [superpowers/rag-upgrade/local/execution-order.md](superpowers/rag-upgrade/local/execution-order.md) — RAG upgrade execution order — The manifest is the scheduling authority.
- [superpowers/rag-upgrade/local/plans/2026-08-20-rag-adaptive-answer.md](superpowers/rag-upgrade/local/plans/2026-08-20-rag-adaptive-answer.md) — Adaptive RAG answer and display — Implementation Plan — Goal: Extend the landed v19 moderate-length/related-information contract into evidence-gated adaptive answers, and remove the independent si…
- [superpowers/rag-upgrade/local/plans/2026-08-20-rag-australian-source-governance.md](superpowers/rag-upgrade/local/plans/2026-08-20-rag-australian-source-governance.md) — Australian source governance for RAG — Implementation Plan — Goal: Establish a typed, enforceable Australian source catalogue that augments uploaded indexed guidelines, excludes Healthdirect, treats eT…
- [superpowers/rag-upgrade/local/plans/2026-08-20-rag-evaluation-rollout.md](superpowers/rag-upgrade/local/plans/2026-08-20-rag-evaluation-rollout.md) — RAG programme evaluation, rollout, and operations — Implementation Plan — Goal: Make every source, retrieval, answer, fallback, re-index, and incremental-delivery improvement measurable, privacy-minimised, reversib…
- [superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md](superpowers/rag-upgrade/local/plans/2026-08-20-rag-ingestion-reindex.md) — Governed ingestion audit and reversible targeted re-index — Implementation Plan — Goal: Determine which documents genuinely need repair, acquire only allowlisted public Australian versions into a governed shadow state, cor…
- [superpowers/rag-upgrade/local/plans/2026-08-20-rag-retrieval-composition.md](superpowers/rag-upgrade/local/plans/2026-08-20-rag-retrieval-composition.md) — RAG query planning, combined retrieval, and fallback — Implementation Plan — Goal: Stop false “not enough information” answers by decomposing only genuinely broad questions, searching shared uploaded guidance, current…
- [superpowers/rag-upgrade/local/plans/2026-08-20-rag-verified-incremental-delivery.md](superpowers/rag-upgrade/local/plans/2026-08-20-rag-verified-incremental-delivery.md) — Verified incremental RAG delivery — Implementation Plan — Goal: Make the chat begin showing useful answer text sooner, while preserving the rule that no raw token, provisional dose, incomplete JSON,…
- [superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md](superpowers/rag-upgrade/local/plans/2026-08-21-rag-repository-content-sync.md) — Repository-wide first-party content retrieval and freshness — Implementation Plan — Goal: Let Answer mode retrieve the relevant approved the product content for questions about specifiers, differentials, medications, service…
- [superpowers/rag-upgrade/local/plans/2026-08-21-trusted-admin-document-ingestion.md](superpowers/rag-upgrade/local/plans/2026-08-21-trusted-admin-document-ingestion.md) — Trusted Admin/Backend Document Ingestion — Implementation Plan — Goal: Make a trusted administrator/backend upload the clinical-admission event, then automatically activate the document for shared clinical…
- [superpowers/rag-upgrade/local/sdd-execution.md](superpowers/rag-upgrade/local/sdd-execution.md) — Subagent-driven execution contract — The tracked .agents/skills/rag-cloud-sdd/SKILL.md is the self-contained Cloud controller.
- [superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md](superpowers/rag-upgrade/local/specs/2026-08-20-rag-answer-and-australian-sources-design.md) — RAG answer quality, repository content, and Australian source augmentation — design — Status: Approved programme design, reconciled against origin/main aa0c04bce12995894a9287cb1a084f89f2ed6ef8 on 2026-08-22.
- [superpowers/rag-upgrade/local/specs/2026-08-21-trusted-admin-document-ingestion-design.md](superpowers/rag-upgrade/local/specs/2026-08-21-trusted-admin-document-ingestion-design.md) — Trusted Admin/Backend Document Ingestion and RAG Activation Design — Date: 2026-08-21 Status:
- [superpowers/specs/2026-07-02-triage-security-reliability-design.md](superpowers/specs/2026-07-02-triage-security-reliability-design.md) — Triage Security & Reliability Fixes Design — Date: 2026-07-02 Scope:
- [superpowers/specs/2026-08-05-editable-pin-menu-mockups-design.md](superpowers/specs/2026-08-05-editable-pin-menu-mockups-design.md) — Search + Editable Pins Menu — Final Mockup Direction — Route: /mockups/search-lens-menu…
- [superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md](superpowers/specs/2026-08-20-rag-answer-and-australian-sources-design.md) — RAG answer quality, repository content, and Australian source augmentation — design — Status: Approved programme design, reconciled against origin/main aa0c04bce12995894a9287cb1a084f89f2ed6ef8 on 2026-08-22.
- [superpowers/specs/2026-08-21-developer-hub-phase-1-design.md](superpowers/specs/2026-08-21-developer-hub-phase-1-design.md) — Developer hub — Phase 1 design (hub shell, environment strip, task ledger) — Date: 2026-08-21 Status:
- [superpowers/specs/2026-08-21-mode-aware-clinical-ask-design.md](superpowers/specs/2026-08-21-mode-aware-clinical-ask-design.md) — Mode-aware Clinical Ask — binding design specification — Status: approved 21 August 2026;
- [superpowers/specs/2026-08-21-trusted-admin-document-ingestion-design.md](superpowers/specs/2026-08-21-trusted-admin-document-ingestion-design.md) — Trusted Admin/Backend Document Ingestion and RAG Activation Design — Date: 2026-08-21 Status:
- [superpowers/specs/2026-08-22-developer-hub-phase-2-design.md](superpowers/specs/2026-08-22-developer-hub-phase-2-design.md) — Developer hub — Phase 2 design (repo awareness) — Date: 2026-08-22 Status:
- [superpowers/specs/2026-08-23-clinical-operations-programme-design.md](superpowers/specs/2026-08-23-clinical-operations-programme-design.md) — Clinical operations programme — design — Status: autonomous implementation direction Date:
- [superpowers/specs/2026-08-23-outstanding-p2-p3-remediation-design.md](superpowers/specs/2026-08-23-outstanding-p2-p3-remediation-design.md) — Outstanding P2/P3 Remediation Programme Design — Date: 2026-08-23…
- [superpowers/specs/2026-09-01-calculators-clinical-safety.md](superpowers/specs/2026-09-01-calculators-clinical-safety.md) — Calculators clinical safety and evidence-governance specification — Date: 1 September 2026 Repository:
- [superpowers/specs/2026-09-01-native-smart-catalogue-search-design.md](superpowers/specs/2026-09-01-native-smart-catalogue-search-design.md) — Native Smart Catalogue Search Design — Date: 2026-09-01…
- [superpowers/specs/2026-09-01-services-safety-provenance-design.md](superpowers/specs/2026-09-01-services-safety-provenance-design.md) — Services Safety and Provenance Foundation — Design — Date: 2026-09-01 Repository base:
- [superpowers/specs/2026-09-01-sources-mode-design.md](superpowers/specs/2026-09-01-sources-mode-design.md) — Sources Mode and Clinical Source Catalogue Design — Status: Approved design, written 2026-09-01 against 058693b97.

### Also catalogued (2026-09-26)

- [audit/2026-09-20-visual-ux-audit.md](audit/2026-09-20-visual-ux-audit.md) — Visual, UX and defect audit — master report, 2026-09-20
- [design-system/drift-measurement-2026-09-02.md](design-system/drift-measurement-2026-09-02.md) — Design-token drift measurement, 2026-09-02
- [design-system/sweep-fix-visible-live-regions.md](design-system/sweep-fix-visible-live-regions.md) — Sweep fix — visible live regions (closes finding 4 of the 2026-08-29 sweep)

## Archive

- [archive/](archive/) — completed phase plans, superseded designs, and old
  progress logs kept for provenance. Never treat archive content as current
  guidance.

## Maintenance rules

- Generated files (`site-map.md`) are updated only via their generator scripts.
- When adding a doc, add it to the matching section here; date the filename if
  it is a point-in-time record.
- When a maintained doc is superseded, move it to `archive/` and update inbound
  links (`npm run docs:check-links` finds broken ones).
