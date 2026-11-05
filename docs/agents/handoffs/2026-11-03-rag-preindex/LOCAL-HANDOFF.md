# Latest continuation — 5 November swarm follow-up

Use implementation PR #3900 at `f7459705d562f32a9f90ba35543b79d133292aef` as the base.
Its complete CI run 41987788641 passed, including container and browser acceptance.
Do not restart from the older 7fd bundle below if that implementation is already present.

The additive `psychsift-followup-9052aee8a.bundle` carries one reviewed offline correction,
`9052aee8a954f3ed816ba05dabf0d51b3bcf5bff`, on that exact prerequisite. SHA-256:
`8c74c5829094448a895a7394896de4fbc3c361e9ffc35b0e3acc666aaf1ca62d`.

It fixes lost diagnostics in the feasible paid model-smoke path and adds a provider-free,
validation-only PDF-review CLI with explicit external canonical approval digest. Four
focused suites pass 75 tests; full typecheck, scoped lint and independent correction review
pass. Source review and model acceptance remain pending. There has been no new paid model
run, production merge, deployment, re-index or ingestion. Ponytail was unavailable; three
native agents performed the bounded swarm. No reviewer/clinical approval was created.

Fetch #3900 first and preserve unpublished local edits. Verify this bundle, then fetch its
`refs/heads/fix/rag-preindex-followup` into a fresh local follow-up branch. Merge or reconcile
that one commit with the existing local task; do not reset or overwrite dirty work. The
new source CLI and exact arguments are documented in `docs/reindex-runbook.md` in the bundle.
The local private three-PDF/eight-page pack's location is unavailable in cloud. Use the
actual owner-reviewed record, never fabricate it or infer approval from structural success.

The follow-up is carried here so the active implementation PR is not advanced while its
paid automatic preview cost remains unresolved. Its old temporary preview was removed;
updating #3900 may create another charged preview. Obtain a fresh defensible pricing/cap
record before such a billable verification run. Use the existing local provider access
and fresh source-bound pricing/approval for any model comparison. Keep processing paused.
After acceptance, production migration PR merge remains owner-manual, with exact-merge
live-drift/history and app/worker revision verification. Never probe readmission: it queues work.

The previous handoff below is retained as dated import history only.

# PsychSift local completion handoff

Continue locally from [draft transfer PR #3890](https://github.com/BigSimmo/PsychSift/pull/3890). Its branch is `handoff/rag-preindex-local-7fd0e1db2`, based on `main`. It contains only this prompt and the accompanying Git bundle. The implementation is inside that bundle; it is not applied to the transfer PR's checkout and has not been merged or deployed.

**Use the latest PR head for these instructions, then import the bundle before inspecting or editing the implementation.** Working directly in the transfer PR's checkout would inspect the old application code. The PR does not need to be merged to retrieve its files. Leave it draft with auto-merge off.

## Local retrieval and import

First identify the actual local checkout and verify its origin is `https://github.com/BigSimmo/PsychSift.git`. Preserve dirty work and inspect existing branches/worktrees. Replace each placeholder below with a verified literal path; choose unused branch names and worktree directories, or reuse an already-correct import. Do not reset, force-update, stash or overwrite another task's work.

Fetch the latest transfer PR and obtain both files in an isolated worktree:

```text
git -C "<local-checkout>" fetch origin refs/pull/3890/head:refs/heads/handoff/pr-3890-transfer
git -C "<local-checkout>" worktree add "<transfer-worktree>" handoff/pr-3890-transfer
```

The bundle is then at:

```text
<transfer-worktree>/docs/agents/handoffs/2026-11-03-rag-preindex/psychsift-preindex.bundle
```

Check its SHA-256 against the value below using `Get-FileHash -Algorithm SHA256` on PowerShell or `sha256sum` on Linux. Keep the bundle as binary bytes rather than extracting it through text redirection. Verify its prerequisite, then import into a separate implementation branch/worktree:

```text
git -C "<local-checkout>" bundle verify "<bundle-path>"
git -C "<local-checkout>" fetch "<bundle-path>" refs/heads/fix/rag-preindex-readiness:refs/heads/local/rag-preindex-7fd0e1db2
git -C "<local-checkout>" worktree add "<implementation-worktree>" local/rag-preindex-7fd0e1db2
git -C "<implementation-worktree>" rev-parse HEAD
```

If the prerequisite is missing, fetch the required history from the verified origin and repeat bundle verification. Do not use a newer `main` checkout as a substitute for importing the prepared commits. The final `rev-parse` must return the exact implementation head below. Perform subsequent implementation work in **that** worktree, and read its own AGENTS.md and checkpoint before proceeding. Reconcile newer main-line changes only after establishing this exact starting revision.

Bundle: `psychsift-preindex.bundle` (10 commits).

- SHA-256: `d0b20e68560536f00ad6f107f1ae7f88c1957fe8273d56c35b414d174d286313`
- Prerequisite commit: `c92e78113abd936c53f88e7e069b2c7331c735a2`
- Bundle branch: `fix/rag-preindex-readiness`
- Required imported head: `7fd0e1db22d45b0efc31865652f8806ac5afb4ad`
- Verified repository origin: `https://github.com/BigSimmo/PsychSift.git`

## Paste into the local chat

Continue the existing PsychSift RAG/ingestion completion task from https://github.com/BigSimmo/PsychSift/pull/3890. Fetch the latest PR head, read `docs/agents/handoffs/2026-11-03-rag-preindex/LOCAL-HANDOFF.md`, and follow its retrieval/import steps. Finish the remaining prerequisites efficiently, and stop before live re-indexing or re-ingestion. Resume the existing implementation; do not rebuild it or repeat its completed audit.

**First establish the actual local state.** Read the local checkout's AGENTS.md and required continuation, relevant host/raw-environment safeguards and `docs/agents/shared-context-and-memory.md`. Verify repository origin, branch, dirty files and available tools without exposing credentials. Preserve concurrent work. PR #3890 publishes the transfer files, not the implementation as an ordinary code branch. Verify the accompanying bundle's SHA-256 and prerequisite, import it as described above, then read the imported worktree's instructions. Confirm its head is exactly `7fd0e1db22d45b0efc31865652f8806ac5afb4ad` before reconciling newer main-line changes. Use literal verified checkout paths in Git commands. The transfer PR is access to source, not approval to deploy or spend.

**Read the current checkpoint and source:**

- `docs/reindex-unlock-plan.md`, especially its 3 November full-library continuation.
- `docs/reindex-runbook.md`, `docs/worker-deploy-runbook.md`.
- `docs/database-drift-detection.md`, `docs/openai-rag-operations.md`.
- `docs/decisions/2026-11-03-defer-legal-review-for-internal-build.md`.

Legal review was explicitly deferred as an internal-build prerequisite; do not reinstate counsel clearance as a coding blocker. Preserve explicit prohibitions, source fidelity, privacy, administrator identity and production controls. Do not invent historical rights, clinical approval or publication permission.

**Reuse completed work and evidence.** The imported implementation contains WA admission support, separate native-text and rich-PDF profiles, original feature inspection, actual OCR, source-bound table/image retention, current administrator readmission, local derived index/memory artifacts, atomic completion and authenticated active-generation image delivery. Recorded cloud evidence at `7fd0e1db2` was 46 suites / 1,037 passing tests, 14 Python tests, typecheck, focused lint and worker bundle compilation. Synthetic PostgreSQL 17 tests passed completion, strict replay, image retrieval, stale/incomplete/old-admission refusals, existing-generation preservation and stage deletion lifecycle. That scratch database used scaffolding and does not prove authoritative Supabase replay or real-corpus accuracy. The transfer PR's publication added no new local or hosted verification; do not treat those checks as observed or passing. Reuse unchanged code evidence; rerun only checks affected by local environment, drift or fixes.

**Complete the remaining work in this order:**

1. **Establish local execution prerequisites.** Check Node 24, lockfile parity, Docker/Linux containers, disk space and the existing authenticated Supabase/Railway/OpenAI configuration through supported setup. Do not read/export stored credentials, request keys in chat, or assume cloud secrets/sessions transfer. The cloud had denied image/documentation access and no runtime secret bindings. Identify actual local failures rather than carrying those assumptions over. Docker's cloud VFS layer duplication exhausted storage; do not change shared daemon settings as a workaround.

2. **Complete authoritative database verification.** Follow the repository's CI replay/bootstrap procedure. Prove the migration chain with `supabase migration up --local` on a disposable local instance, and verify its result against the schema mirror. Separately pull the exact digest-pinned image in the workflow and run `npm run drift:manifest` to regenerate the stale `supabase/drift-manifest.json` from `supabase/schema.sql`. The supported rootless alternative is documented for a compatible Linux host. Do not substitute the lightweight pgvector/shim replay, hand-edit the manifest, modify applied migrations, reseal history or widen allowlists. Validate the regenerated manifest against a second authoritative generation using the freshness command's explicit `--committed` and `--generated` paths; comparing the known-stale old manifest initially is expected to fail. Keep the four new migrations and schema definitions aligned.

3. **Validate the actual corpus and close required functionality gaps.** Recheck production metadata read-only: the previous inventory was 2,066 PDFs, including 2,065 ownerless existing shared-library PDFs, with substantial table/image/OCR content. Using authorized original-file access, inspect bounded representative native-table, figure/image and scanned/OCR references locally. Verify source hashes, table relationships/qualifiers, visual coverage and OCR output; keep originals/private content out of Git and external logs. Offline test bindings are not real admission/lease authority. Diagnose unsupported cases without weakening fidelity gates. The rich profile currently defers model-generated summaries and vision interpretation; non-embedding provider purposes are disabled without trusted source-bound bodies and purpose grants. Bulk PDF re-indexing currently returns a 409 hold; an explicit per-document readmission queues one document. Compare those gaps with the original programme and finish any required operator/batch or enrichment functionality before claiming full readiness. Do not silently call a deferred feature complete.

4. **Verify GPT-6.1 Sol through a bounded live comparison.** Verify the exact API model identifier/account access and current official pricing, cache/context conditions, counting-endpoint fees and remaining monthly budget. Do not assume historical prices or a free counting endpoint. Reuse `scripts/smoke-answer-models.ts`: 24 exact token-count requests, then 24 generation requests, zero retries/warmups, at most 384,000 output tokens and 1,000,000 input tokens, 14-minute bound. Its current design ceiling is US$15 per run within the existing US$30 monthly budget; neither ceiling is spending approval or proof of remaining allowance. Present the defensible total estimate, price basis, full scope and enforceable maximum, then obtain my explicit bounded-run approval before spending. Do not raise caps or use the infeasible 52-generation comparison. Retain actual provider model/request IDs, usage, failures, quality/citation/numeric checks and latency. Review blinded outputs before unblinding. A passing smoke result alone is not clinical acceptance or automatic activation.

5. **Prepare and verify production rollout under the repository's approval rules.** Targets: Supabase `sjrfecxgysukkwxsowpy`; Railway PsychSift project `5deaad0b-675a-4c13-978e-5ca2b5b877f9`, production environment `6aa16f7b-d3e8-4aa2-9854-ee9ead9fcbd4`. Verify current identities/state rather than assuming the old deployment is unchanged. The four draft migrations are `20261103000000_preserve_wa_admission_jurisdiction.sql`, `20261103000100_managed_general_native_pdf_text_terminal.sql`, `20261103000200_administrator_legacy_reindex_readmission.sql` and `20261103000300_managed_full_pdf_generation.sql`. Prepare the concrete reviewed change, then obtain the required specific owner approval before applying/merging production database changes. Respect owner-only manual merge and any CI/preview spending gate. Verify actual application with the prescribed post-merge `check:drift` and `check:migration-history`, not recorded migration history alone. Deploy and verify the intended app/worker revision with ingestion held; confirm `WORKER_PAUSED=true` without exposing other variables. After accepted model evidence and explicit activation authority, set the three answer model selectors to the verified Sol 6.1 identifier, retaining low/medium reasoning efforts and independent non-answer/embedding settings. Record rollback settings.

**Stop boundary:** Do not run a library re-index, re-ingest sources, resume claims, run `worker:once`/the reindex pipeline or invoke the production readmission RPC as a test: readmission itself queues work. Prepare the finite source/claim policy and usable later execution procedure without starting them. Do not label the system ready until the required real-corpus, schema, deployment and model evidence exists. Report exact remaining external blockers when execution cannot proceed.

Work autonomously on all independent authorized steps. Batch reads, serialize coupled writes/checks, avoid unrelated cleanup and repeated broad tests. Ask only for genuinely missing access or required bounded spending/production approvals after preparing reviewable work. Keep one checkpoint with source revision, evidence, approvals, remaining blockers and next command. Final status must distinguish implemented, locally verified, deployed, model-activated and awaiting re-indexing.

**First useful checkpoint:** report the verified imported head, the actual local Docker/authentication capabilities, and the first authoritative replay result or precise blocker. Do not spend the first session repeating the completed cloud audit. New extracted/indexed artifacts require re-indexing; an accepted answer-model switch affects new queries after activation and does not require re-embedding the corpus.
