# PsychSift RAG — current local-chat handover

Updated 5 November 2026. This replaces the earlier startup instructions in this file.
The old versions remain in Git history; both original and follow-up bundles are preserved.

## Paste this into the local chat

> Continue the existing PsychSift RAG/ingestion task. Read the latest LOCAL-HANDOFF.md in
> transfer PR #3890 before acting. Implementation PR #3900 at f7459705d has full hosted CI
> success. The additive bundle in #3890 contains reviewed follow-up commit 9052aee8a on that
> exact base: paid-smoke diagnostics and an offline PDF-review validator. Import and reconcile
> it with existing local work; do not restart the original 7fd bundle or repeat completed
> audits/replay/model comparison. Preserve unpublished edits and verify drift first. Complete
> independently actionable work and report the exact remaining evidence. Stop before any
> re-indexing, ingestion, readmission, worker resume or corpus processing. Source/clinical
> approval must come from the owner. New billable runs need current pricing and the required
> fresh bounded approval; do not reuse the completed comparison's approval. Production
> migrations require owner-specific permission and manual merge. Never claim Sol acceptance,
> production deployment or source fidelity from offline tests alone.

## Objective and stopping point

Finish the RAG build, supported PDF/table/image/OCR paths, authoritative database verification,
model evaluation/activation readiness and production verification efficiently. Target model:
`gpt-6.1-sol`; requested routing is distinct from observed provider execution. Stop before
re-indexing or ingestion. Do not queue work as a test.

Legal/counsel review was explicitly deferred as an internal-build blocker. Do not reinstate it.
Actual source fidelity, privacy, clinical acceptance and applicable production safeguards remain
separate. The present state is **not yet all done awaiting re-indexing**.

## Exact state and ownership

| Item                           | Verified identity and state                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                     | `https://github.com/BigSimmo/PsychSift.git`                                                                                              |
| Implementation PR              | [#3900](https://github.com/BigSimmo/PsychSift/pull/3900), open, not draft, unmerged; auto-merge off                                      |
| Implementation branch/head     | `local/rag-preindex-7fd0e1db2` / `f7459705d562f32a9f90ba35543b79d133292aef`                                                              |
| Hosted implementation evidence | [CI run 41987788641](https://github.com/BigSimmo/PsychSift/actions/runs/41987788641), completed **success** at that exact head           |
| Additive follow-up             | `9052aee8a954f3ed816ba05dabf0d51b3bcf5bff`, on f7459705d; in the transfer bundle, **not integrated into #3900**                          |
| Transfer PR                    | [#3890](https://github.com/BigSimmo/PsychSift/pull/3890), branch `handoff/rag-preindex-local-7fd0e1db2`; draft, unmerged, auto-merge off |
| Cloud follow-up checkout       | `/workspace/PsychSift-rag-followup`, branch `fix/rag-preindex-followup`, clean at 9052aee8a when handed over                             |
| Cloud transfer checkout        | `/workspace/PsychSift-transfer-pr`; contains this document and the two bundles, not the applied implementation                           |
| Original cloud implementation  | `7fd0e1db22d45b0efc31865652f8806ac5afb4ad`; historical starting point only                                                               |

The cloud cannot see unpublished desktop changes, private Windows review artifacts or local
credentials. No direct delivery/acknowledgement from the running local chat is available.
Publishing this document supplies a retrievable handover, not proof that another chat loaded it.
Check the current PR heads and relevant local changes before integrating anything.

## What is already implemented and verified

The implementation combines earlier cloud fixes and newer local work; do not redo the latter.

- Current-administrator, source-bound readmission for legacy shared PDFs; ordinary requests
  remain owner scoped. WA admission jurisdiction is retained. Bulk PDF requests remain held.
- General native PDF and full rich-PDF generation paths, provenance/retention packets,
  pages, table facts, images, embedding fields, index units and memory cards.
- Source-anchored summaries and generated labels, retained and completed atomically with
  generation pointers and final job state. Additional policies remain off by default.
- A separate reviewed-rendered path excludes original native-layer text/metadata and holds
  results until complete bound review. It does not erase the original hidden-text conflict.
- Answer-proof repairs prevent generated synopsis/index/memory narrative from acting as
  direct claim evidence or exact quotations; withdrawn recommendations are withheld while
  supported short quotations and independent later recommendations remain available.
- The old Docker/image/replay blocker was solved locally. Two independent schema-manifest
  generations match; clean 355-migration replay, all 20 SQL test files and strict mirror/chain
  parity were recorded. New draft migration seals were appended; previous seals and applied
  SQL were preserved. Hosted migration replay also passes at f7459705d.
- CI OCR prerequisites and portable test runtime selection were corrected. Hosted app,
  Playwright and container builds now pass; the earlier interrupted local app build is no
  longer an unresolved packaging blocker.

### Cloud correction published in #3900: f7459705d

Both native-rich and reviewed-rendered egress validators rejected the existing `memory_cards`
embedding family. Both now admit it with unchanged exact-payload/source-plan checks, UUID
keys, identifier scanning, byte budgets and current authority/source revalidation. New tests
first reproduced `embedding_source_plan` rejection. Existing terminal lifecycle tests now
exercise real executor units through real SDK serialization and real source validators,
using synthetic transport, vectors and RPCs. Every emitted ID, including memory cards, is covered.

The reindex route exposes its sanctioned owner scope directly to the mechanical tenancy
scanner and retains the additional owner-only filter for ordinary requests. Runtime tests
refuse foreign/shared ordinary requests before mutations or child-job reads. Both scanner
phases pass; no exemptions were added.

The component model harness gained bounded raw-versus-parsed grounding/confidence flags.
The PR's OCR approval citation was corrected to an immutable HTTPS source accepted by the
unchanged PR policy. These fixes passed 189 focused tests across 11 suites, typecheck, scoped
lint, owner-scope checks and independent correction review. Offline readiness CI mode passed
with environment/release warnings; that is not production acceptance.

The complete hosted CI run then passed builds, static checks, both unit partitions and
combined coverage, migration replay, safety/config, ingestion SAST, critical browser journeys,
all three broader browser shards, Lighthouse and container verification/security/evidence.
Release-only/advisory checks skipped by their conditions are not claimed as passing.

### Swarm follow-up in the additive bundle: 9052aee8a

Three native agents examined model, source and release readiness. Ponytail was not exposed
in callable tools or discovered skills; do not claim it ran. Verification-before-completion
was used alongside the repository's narrower verification rules.

1. **Paid-smoke diagnostic gap fixed.** The feasible paid smoke runner assembled its own
   outcomes and dropped the new diagnostics, although offline/component execution retained
   them. It now reuses the same bounded diagnostics helper through the actual paid-path
   outcome constructor. Serialized-outcome tests distinguish raw and parsed flags and
   exclude arbitrary malformed field text. Scores, latency thresholds, model defaults,
   blinded-review output, spend controls and previous results are unchanged.
2. **Offline source-review validator added.**
   `scripts/validate-rendered-pdf-review.ts` consumes a complete private review and an
   externally approved canonical digest, creates a fresh local inspection and calls the
   existing validator. It emits hashes/counts and structural scope only. It issues no
   approval, authenticates no reviewer, and calls no provider, policy writer or queue.
   Strict arguments, bounded regular-file/UTF-8 reads, digest/source refusals, exact validator
   forwarding and sanitized failures are tested. Instructions live in `docs/reindex-runbook.md`.
3. The existing programme checkpoint and source-intake ownership map are updated.

Fresh follow-up evidence: **75 tests across four focused suites**, full typecheck, scoped lint,
formatting, documentation links and independent correction review pass. Organisation mapping
covers the new files. No new paid/live model run occurred. This commit has **no hosted CI or
production acceptance claim** until integrated and checked at its resulting head.

## Retrieve and integrate without repeating work

Replace placeholders with verified literal paths. Confirm origin and local ownership first;
use unused ref/worktree names. Preserve dirty work. Never force-push, reset, overwrite or
silently drop a private local correction. These commands fetch/import only, not publish.

```text
git -C "<verified-local-checkout>" fetch origin refs/pull/3890/head:refs/heads/handoff/pr-3890-transfer
git -C "<verified-local-checkout>" worktree add "<unused-transfer-worktree>" handoff/pr-3890-transfer
git -C "<verified-local-checkout>" fetch origin refs/pull/3900/head:refs/heads/handoff/pr-3900-reviewed
```

If those refs already exist, inspect their heads and update safely rather than reusing the
examples blindly. The reviewed base f7459705d must exist locally before verifying the bundle.
If #3900 has advanced, inspect the new commits and compare/cherry-equivalence before merging.

Follow-up bundle:
`<transfer-worktree>/docs/agents/handoffs/2026-11-03-rag-preindex/psychsift-followup-9052aee8a.bundle`

- SHA-256: `8c74c5829094448a895a7394896de4fbc3c361e9ffc35b0e3acc666aaf1ca62d`
- Required commit: `f7459705d562f32a9f90ba35543b79d133292aef`
- Advertised ref: `refs/heads/fix/rag-preindex-followup`
- Advertised head: `9052aee8a954f3ed816ba05dabf0d51b3bcf5bff`

Use `Get-FileHash -Algorithm SHA256` or `sha256sum`; keep bundle bytes binary.

```text
git -C "<verified-local-checkout>" bundle verify "<absolute-followup-bundle-path>"
git -C "<verified-local-checkout>" fetch "<absolute-followup-bundle-path>" refs/heads/fix/rag-preindex-followup:refs/heads/handoff/rag-swarm-9052
git -C "<verified-local-checkout>" worktree add "<unused-implementation-worktree>" handoff/rag-swarm-9052
```

Review/reconcile the one additive commit with the current local task. Do not mistake the
transfer checkout for the implemented application or merge #3890 into main to install it.
Do not duplicate a local fix that already has equivalent behaviour. Run only affected checks
and mandatory project gates after reconciliation; reuse unchanged valid evidence.

The original `psychsift-preindex.bundle` remains available for historical recovery only:
SHA-256 `d0b20e68560536f00ad6f107f1ae7f88c1957fe8273d56c35b414d174d286313`.
Its advertised historical implementation ends at 7fd0e1db2; prefer the current #3900 base.

## Actual source review still required

Three real PDFs/eight pages were inspected locally with original byte/hash matching. All
remain held: native inspection reported hidden-text conflict; the separate rendered path
produced private review artifacts. An owner-approved complete review record and observations
are still absent from accessible evidence. The private Windows pack location is unknown here.
Do not download/rebuild it again unless its source/inspector inputs or artifacts changed.

Owner observations must cover every full page, text completeness/reading order, OCR regions,
table rows/cells and relationships, and diagram nodes/edges/directions/labels. Unresolved
issues retain holds. Native text stays excluded in the reviewed-rendered profile.

After the owner supplies the actual complete source-bound record, use the new local command:

```text
node --import tsx --import ./scripts/enable-server-only-stub.mjs scripts/validate-rendered-pdf-review.ts --source <absolute-original.pdf> --artifact-root <absolute-private-directory> --source-sha256 sha256:<64hex> --review <absolute-complete-review.json> --approved-review-sha256 sha256:<64hex>
```

Use `renderedPdfReviewDigest` for the canonical review digest; the JSON file's byte SHA is
not equivalent. The supplied approved digest must originate from the actual approval process,
not be self-authorized by the CLI/operator agent. Schema-valid reviewer IDs/reference hashes
are not authenticated owner approval. Structural success is not clinical sign-off.

## Sol status and the next bounded experiment

The earlier approved component experiment completed 24 counts and 24 generations, zero
retries. Control passed 8/12 strict checks; Sol passed 9/12; **accepted:false**. Candidate p90
was 8.805 s versus 3.876 s for control. Raw confidence flags were not retained in that old
run, so the unsupported-case provider/parser split cannot be reconstructed. Some failed
term checks involved morphology; do not retroactively relax the recorded scores.

Measured reported usage: 81,012 input and 4,543 output tokens. Calculated cost was about
US$0.3151065, not a provider invoice. The account cost API returned 403, so remaining allowance
was owner-reported. No later paid generation or Sol activation occurred in cloud.

The feasible next tool is `scripts/smoke-answer-models.ts`:

```text
node scripts/run-tsx.mjs scripts/smoke-answer-models.ts --dry-run
node scripts/run-tsx.mjs scripts/smoke-answer-models.ts --paid --price-card <private-price-card.json> --approval <private-approval.json> --output output/answer-model-comparison/<new-unused-run>
```

The second command is a future conditional command, **not current execution authority**.
First obtain verified current prices/limits for all exact models, count-endpoint fees,
remaining monthly allowance/evidence, configured local provider access and a fresh approved
bounded run. Never copy credentials into chat or Git. Source/config/price/output identities
must match the approval; this changed harness cannot reuse the consumed old approval.

The smoke scope is 24 counts plus 24 generations, no retries/warmups; maximum 384,000 output
tokens, 1,000,000 input tokens, 840,000 ms and an approved USD cap no higher than $15. These
are ceilings, not a quote or new approval. Price actual scope and include downstream charges.
Exact counts must establish that the full generation plan fits before generation starts.
Dry-run reports identities/request hashes but does not price/validate approval files.

Do not bypass the full 52-execution harness's valid refusal: its 832,000-token reservation
exceeds its 400,000-token cap. Use existing blinded review before buying more generations.
The standard workflow canary checks out default-branch code and exposes no Sol selector;
it is not a candidate/control live acceptance pair for this branch. Component smoke does
not establish end-to-end route/retrieval/cache/recovery or live clinical acceptance. Keep
control defaults until quality, latency, cost and applicable behavioural acceptance pass.

## Publication, preview cost and production

The active implementation PR was not advanced with 9052aee8a because a new push may recreate
a charged Supabase preview after the previous one was deleted. The additive code is retrievable
through the existing docs/bundle-only transfer PR. This is not hosted acceptance for that code.
Verify current integration behaviour and defensible pricing/cap before triggering a billable
run; do not carry an old approval to a new run or silently change integration/billing settings.

The exact former #3900 preview was deleted after its check passed and its absence verified:
branch `40edd8b2-4119-43ed-b7f9-4d8678635a3c`, project `wnrowzxmjvagapdcqrco`.
Production was preserved; unrelated #3866 preview was inactive and untouched. The earlier
hosted-verification approval was US$5; actual preview cost is unavailable. Do not report a
measured total or guaranteed no-overage cap without evidence.

Six draft migrations remain in #3900:

- `20261103000000_preserve_wa_admission_jurisdiction.sql`
- `20261103000100_managed_general_native_pdf_text_terminal.sql`
- `20261103000200_administrator_legacy_reindex_readmission.sql`
- `20261103000300_managed_full_pdf_generation.sql`
- `20261104000000_managed_full_pdf_summary_projection.sql`
- `20261105000000_managed_reviewed_rendered_pdf.sql`

After all applicable premerge acceptance gates, the owner must specifically authorize and
manually merge the migration PR. Merge to main applies database changes automatically;
there is no separate harmless merge window. Do not merge, arm auto-merge or deploy from
this handover alone. Before merge, verify exact-head required checks, review dispositions
and relevant drift rather than assuming the old green head certifies newly integrated code.

Last cloud production observation (dated, not a fresh deployment check): app and worker
last successful deployment used `c92e78113abd936c53f88e7e069b2c7331c735a2` on 2 November;
the six migration rows and new completion/readmission RPCs were absent. Local checkpoint
recorded `WORKER_PAUSED=true`. Recheck read-only before planning release.

Exact known targets:

- Supabase production: `sjrfecxgysukkwxsowpy`.
- Railway project: `5deaad0b-675a-4c13-978e-5ca2b5b877f9`.
- Railway production environment: `6aa16f7b-d3e8-4aa2-9854-ee9ead9fcbd4`.
- App service: `6db32f39-2ecd-493c-a688-feb2d6670ff4`.
- Worker service: `29510fca-4920-470d-941c-b1290e06d3d5`.

After an authorized owner merge/deployment, prove exact-merge `live-drift` success with both
`check:migration-history` and `check:drift`, expected RPC signatures/ACLs, actual app/worker
SHA/image identities and prerequisites/readiness. Include the general/full PDF, image read,
administrator readmission and authority RPCs in the read-only catalog check; never execute
readmission as a probe. Railway Success or migration-history rows alone are insufficient.
Keep the worker paused. Production observation is not permission to start processing.

## Remaining work, in execution order

1. Fetch the current PRs and import/reconcile the verified additive bundle without losing local work.
2. Resolve the new hosted-verification pricing/cap boundary before advancing #3900; verify the resulting exact head.
3. Obtain and validate the actual owner source-review record using private local artifacts.
4. Diagnose Sol with existing results/blinded review; price and approve the smallest necessary new run, then establish genuine acceptance before activation.
5. Complete the separately authorized owner-manual production rollout and read-only live verification.
6. Stop, reporting what is proven and what remains. Do not re-index, ingest, readmit, resume workers or change processing settings.

The wider-batch shadow driver remains later scope after an approved successful pilot, not a
reason to repeat current engineering work. Runtime answer/safety improvements can benefit
users after deployment; rebuilt extraction/chunks/embeddings require subsequent ingestion.
Do not state that every benefit waits for a complete library rebuild.

Canonical programme checkpoint: `docs/reindex-unlock-plan.md` in the implementation/follow-up.
Canonical operational detail: `docs/reindex-runbook.md`, `docs/worker-deploy-runbook.md`,
`docs/openai-rag-operations.md` and the current project instructions. Keep originals, rendered
pages, extracted clinical content, credentials and private approval records outside Git/logs.
