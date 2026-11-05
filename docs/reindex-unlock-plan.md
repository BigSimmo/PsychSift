# Ingestion unlock and controlled rollout

## 5 November 2026 continuation — local source/summary paths verified; corpus held

The same isolated task and branch continue from local checkpoint
`839c1e3c2ac8c1b3c978135679e357996fa59651`. The original imported head and bundle
verification below remain valid. Existing main-checkout changes are preserved.

**Saved local state and remaining packaging gate.** The implementation is committed as
`77600e01ee952882b7ac810d50e4cd91e4198b42`; normal merge
`f84f7be04f91f57c94235738249b70dc7bed5a27` preserves main through
`a64d237eaed20c046d49a75cae000355c8a5dd8e`, including its document-handoff and
dependency-policy changes. The sole conflict was the generated repository-awareness date;
regeneration resolved it. The final full typecheck, scoped test lint, owned-path formatting,
documentation pipeline and enabled commit hooks pass. The pipeline reports existing decision
warnings; it does not supply owner approvals.

The normal offline Next build was attempted with the repository's provider-scrubbed
environment and all default build guards. It reached webpack, then an external task-owned
monitor stopped its process tree after free committed memory fell below 1.25 GiB (observed
1,279,396 KiB). No compiler failure was reported before termination. This app build is
**incomplete**, not passing; the worker bundle is separately passing. No pagefile, shared
process, runtime guard or CI setting was changed. Hosted app packaging remains required.

At 03:15 UTC on 5 November, exact-service Railway metadata still shows `c92e78113a` as
the latest successful app and worker deployment. More recent `a64d237eae` attempts were
`SKIPPED`; those do not prove deployment. The worker's `WORKER_PAUSED=true` was freshly
confirmed read-only. PR #3890 remains the unchanged draft transfer, not this implementation.
No implementation push, hosted CI result, production migration, deployment or model activation
is claimed. Preparing an implementation PR must account for automatic Supabase preview
compute and any GitHub Actions charges separately from the approved OpenAI comparison.

**Hosted verification and corrective evidence.** The owner subsequently approved at most
US$5 for the prepared implementation PR's hosted CI and one temporary Supabase preview,
including exact-preview cleanup before handback. Implementation
[PR #3900](https://github.com/BigSimmo/PsychSift/pull/3900) was published at `d3574f14ab`
with auto-merge off. Its first [CI run](https://github.com/BigSimmo/PsychSift/actions/runs/41961770471)
passes the app build, browser-test build and authoritative migration replay. Required CI is
not green: ingestion SAST found the inherited Tesseract executable override, the static guard
required new migration seals, and one unit partition found the ordinary enrichment query's
missing owner-only filter.

The corrections remove the OCR executable override from both producer and child environment,
restore the owner-only query for ordinary reindex while preserving explicit administrator
readmission, and append only the six new migration hashes. All previous sealed values pass
the immutability comparison against main. The existing privacy/readmission suites pass
191 tests; rendered boundary/review/terminal suites pass 32; the renderer Python suite passes
20 including the observed red/green executable-selection regression. Local Semgrep 1.172.0
reports zero findings over the same 126 target files (796 current registry rules); its engine
differs from the immutable CI image, whose rerun remains necessary. Scoped lint passes.
The broad focused-test selector refused this multi-test diff; direct focused regressions
support only the named corrections, with complete unit coverage still required in CI.

The changed inspector hash required fresh private inspections: all three originals/eight
pages still complete as `held_for_review`, with unchanged page and byte counts. The private
review pack was regenerated; no approved owner record was created. The separate advisory
Claude job reports a revoked OAuth credential, zero model usage and US$0; its green job
wrapper does not constitute a completed review. Reuse the recorded independent Sol review,
and do not rotate credentials or request another paid comparison for this correction.

**Implemented and checked locally.** Source-anchored summaries now have an immutable
candidate request, exact guarded SDK-body authorization, observed provider identity,
generation-specific retained projection, and atomic pointer/summary/generated-label/job
completion. An explicit server policy enables the additional purpose; existing settings
remain off. The standalone active-summary writer still refuses managed candidates.
Review caught and corrected dropped source-policy metadata and false identifier refusals
for server-generated UUID anchors; source text retains full identifier checks.

The new draft `20261104000000_managed_full_pdf_summary_projection.sql` preserves native
packet-v1 behavior and adds summary packet-v2. Actual local replay exposed a parser error
and an ambiguous label reference; both were corrected before successful verification.
Two independent native schema-mirror replays on the pinned Postgres image match. A fresh
complete 354-file migration-chain replay using CLI 2.108.0 passes, followed by all nineteen
SQL files and strict chain/mirror parity. The sole divergence remains the existing emulator
`pg_net` exception. The roster fixture now moves only its swap scenario beyond seven days
and restores the original dates; the previously failing behavior test passes.

A synthetic summary lifecycle verifies first completion, replacement, predecessor summary
and generated-label snapshots, manual-label preservation, immutable-stage and active-alias
tamper refusals, and rollback after an injected final job-completion failure. No production
RPC was used. Migration-role and 153 public SECURITY DEFINER grant checks pass. No applied
migration, sealed history, drift allowlist, credentials or production setting was changed.

**Rendered evidence remains held.** The new explicit renderer-only producer composites
whole pages into a raster-only intermediate and excludes original native text, native table
strings and original image streams. Its bounded wrapper checks source/runtime/pixel/OCR
identities and artifact ownership. The false active-content refusal for indirect standard
`StructElem` list attributes was reproduced and corrected narrowly; action dictionaries
remain refused. The final three original samples complete rendered inspection over eight
pages, retaining the OCR, table, diagram and whole-source semantic holds. Originals, renders
and extracted material remain in the private task directory outside Git.

Windows cleanup now requires observed producer exit, bounds the taskkill helper, and
preserves artifacts when termination is unverified. Native tests prove producer termination
kills its child and grandchild. Windows process and aggregate Job memory limits are set to
2 GiB before source opening; lower-cap allocation probes refuse excessive commitments.
An unexplained historical Windows peak counter exceeded the lower test cap after a refused
allocation, so these checks do not certify a historical peak-memory ceiling.

A distinct source-bound render-review record and opaque validated result are implemented;
they grant no ingestion, provider, publication or clinical authority. Complete reviewed page,
OCR-region, table-cell and diagram relationships are required. The rendered adapter, trusted
runtime selection/egress, private evidence retention and distinct terminal SQL are implemented.
The final 355-migration clean replay, all twenty SQL files and strict chain/mirror parity pass.
Two independent native mirror generations match. A real local one-page synthetic render/review
fixture verifies first completion and replacement with summaries, predecessor snapshots,
manual-label preservation, stale/altered input refusals, active-alias tamper detection and
injected completion rollback. Full TypeScript and the worker bundle pass. Fourteen focused
suites cover 157 cases; after the planned manifest refresh, the 57 drift cases passed again,
reusing the other 100 passing cases on unchanged relevant inputs. An early stale-manifest
failure was corrected by actual regeneration, never by changing the guard.

Independent review's initialization label, native-summary executor, image metadata, process
termination and memory-limit findings were corrected and verified with focused regressions.
Final bounded correction review found no unresolved P1/P2 in those deltas; this is not a new
whole-repository audit. No real owner render-review record has been created or inferred. The
private eight-page side-by-side pixel/OCR review pack is prepared and owner review is pending.

**Approved spending, separate remaining gates.** The owner directly approved the prepared
12-case synthetic comparison on 5 November: 24 free token counts plus 24 generations across
GPT-5.6 Terra/Sol and GPT-6.1 Sol, no retries, fourteen minutes, at most US$15. The owner
confirmed the remaining November balance. The private approval evidence
records those exact bounds; it authorizes no production change or ingestion. Current model
metadata access was verified and the official price/count-fee sources were read. The frozen
request bodies are at most 17,875 serialized bytes; the conservative aggregate token-rate
ceiling was US$12.68 before the exact counts. The approved run completed 24 counts and 24
generations with zero retries. All requested/provider model identities match and all 24
request IDs and usage records are present. Exact counts total 81,012 input tokens; provider
usage reports 4,543 output tokens. The usage-based price estimate is US$0.3151065, with
zero count fees, compared with US$5.245906 reserved. This is an estimate from usage/rates,
not a provider invoice or a refreshed account balance.

Original deterministic results are control 8/12 and Sol 9/12. Three table failures are literal
`isolate` term checks despite `isolation`/`isolating` wording. Both models explicitly describe
missing information on the two unsupported questions, but fail the strict grounded/confidence
contract. The report retained answers/check outcomes, not raw response confidence fields, so
the exact raw-versus-parser flag cause cannot be reconstructed. Do not weaken or retroactively
change those scores. Sol's observed median/p90 latency is 3.615/8.805 seconds, versus control
2.842/3.876 seconds. The single synthetic component run is complete and remains `accepted:false`;
owner quality/cost review and separate model activation are pending. No paid rerun was made.

The account cost API returns 403 and local browser use is disabled, so the monthly balance
is owner-reported rather than provider-observed. Production merge/application, deployment,
model activation, the later shadow driver and actual source-wide
acceptance remain separate uncompleted gates. Continue implementation and verification;
never invoke live readmission as a test, because it queues work. A fresh read-only check of
the exact PsychSift production worker service on 5 November confirms `WORKER_PAUSED=true`;
no variable was changed.

## 4 November 2026 local continuation — authoritative replay verified; corpus held

Source intake owns this continuation of `fix/rag-preindex-readiness`. The isolated local
branch is `local/rag-preindex-7fd0e1db2`; its verified imported starting head is
`7fd0e1db22d45b0efc31865652f8806ac5afb4ad`, containing ten commits after
`c92e78113abd936c53f88e7e069b2c7331c735a2`. Transfer PR #3890 at
`dc607428728991df106d2b7b41126178111435b5` remains a separate draft. Its binary bundle
matched SHA-256 `d0b20e68560536f00ad6f107f1ae7f88c1957fe8273d56c35b414d174d286313`;
Git verified the prerequisite and imported head. Existing main-checkout edits were not touched.

**Fresh local database evidence.** Node 24.19.0/npm 11.17.0 and installed lock parity pass.
Docker Desktop's Linux engine was stopped, then started successfully with `overlayfs`;
the cloud image-access/storage restrictions were not reproduced. The exact workflow-pinned
Supabase Postgres 17.6.1.127 digest downloaded successfully. Two independent native
`npm run drift:manifest` generations succeeded; the freshness command, with explicit
`--committed` first-generation and `--generated` second-generation paths, reported a match.
The committed schema mirror and four draft migrations were not edited; only the stale
`supabase/drift-manifest.json` was regenerated.

The pinned CI Supabase CLI 2.108.0 bootstrapped a task-owned disposable emulator using its
native Postgres 17.6.1.139 image, an initially empty migrations directory, repository roles
and the CI statement timeout. Studio's registry request returned HTTP 429, so the successful
retry excluded that database UI only; database/auth/storage and the other emulator services
ran normally, without an ignore-health-check override. `supabase migration up --local`
applied the complete chain, including all four November migrations. A captured
`schema_drift_snapshot()` passed `check:chain-mirror-parity --strict` against the regenerated
manifest: no unallowlisted divergence, with only the existing emulator `pg_net` exception.
Migration-role and all 153 SECURITY DEFINER function-grant checks pass; no drift allowlist,
applied migration or sealed history was changed.

The replayed database behaviour selector initially exposed a missing test registration for
the new authenticated administrator readmission function. Its exact signature is now covered
alongside actual ordinary-user and forged-administrator-claim refusals, absent anonymous and
service-role execution grants, and a no-queued-jobs assertion. That corrected privacy test
passes on the disposable emulator. Across the eighteen SQL files, seventeen pass; the
unchanged `roster-behaviour.sql` fails its expected automatic swap approval because its fixed
November dates are now within seven days (`needsManagerBecause: within_7_days`). That
unrelated clock-dependent fixture was diagnosed, preserved and is not reported green.

**Actual corpus evidence and remaining fidelity blocker.** A fresh read-only inventory
confirms 2,066 PDFs, including 2,065 shared ownerless PDFs, 14,313 images and 34,856 table
facts. All PDFs have recorded content hashes. Three bounded shared-reference originals,
selected using existing table/image/OCR metadata, downloaded through the existing normal
server configuration and matched their recorded SHA-256 and byte counts. Originals and
extracted material remain outside Git and external logs. These selections are metadata-based
samples, not proof of representative feature coverage or full-library acceptance.

All three originals were refused by the actual rich inspector. Local diagnosis found
whitespace-only spans and whole-span union rectangles producing false hidden-text/occlusion
alarms. The inspector now checks meaningful glyph geometry, binds documented ligature
continuations, and uses per-glyph contrast for white/complex display. Independent review
found an initial white-text gap-paint regression; its failing reproduction and the malformed
ligature reproductions were corrected before the final pass. Nineteen focused Python cases
and five selected TypeScript suites / 66 tests pass. Correction review found no further
high-confidence defect in those corrections. The final real-source rerun still refuses all
three with `hidden_text_occluded`; no fidelity gate was weakened to obtain acceptance.

The next source change requires a separate renderer-authoritative evidence profile, not
automatic fallback after an arbitrary refusal. It must retain source/render identities and
exclude unverified native text, native table strings and uncomposited embedded images from
searchable evidence. Simply forcing current OCR is unsafe because the extractor merges OCR
with native text. Its versioned inspection, source-expectation and terminal contracts must
describe rendered/OCR evidence honestly, with explicit unresolved table/diagram relationship
holds. Positive numbers, qualifications, relationships and late material must be validated
against originals before claiming corpus acceptance.

**Required functionality remains incomplete.** Reconciliation with the original programme
at `38552bafe0a82a5df2a4467afd5ba211aee5b966` confirms source-anchored, generation-addressed
summaries are required. Reuse the existing summary producer/normalizer, but integrate trusted
exact request-body authorization, generation-specific retention and terminal/replay binding
into the rich path; do not call its current `model_summary` deferral complete. Vision calls
are a conditional technique; preserved visual meaning and relationships are the requirement.
The eval-gated shadow driver remains required after the approved pilot and before wider
batches, as described below. No new batch authority or removal of the PDF bulk 409 hold
was introduced.

**Hosted/model/approval boundary.** Supported local runtime configuration has the expected
Supabase target and normal OpenAI/server bindings; no credential values were printed or
copied. Supabase metadata access works. Railway's connector needs reauthentication, but its
existing local CLI works and confirms the expected project/production environment, with both
app and worker still at `c92e78113abd936c53f88e7e069b2c7331c735a2`. The imported implementation
and local corrections are not deployed. Current `WORKER_PAUSED=true` was not independently
verified; a filtered log read returned no matching pause evidence. No setting was changed.

No paid inference/token-count comparison, provider model-access verification, model activation,
production SQL, merge, deployment, production readmission, worker claim or live ingestion ran.
Fresh model pricing/count fees/account access/monthly allowance, bounded spending approval,
the specific owner production approvals and release evidence remain required. The local
checkpoint is not a completion or release verdict; canonical task-ledger reconciliation is
pending. Continue with the source-fidelity profile and required summary integration, retaining
the exact local database evidence above. Stop before every live readmission/re-index operation.

## 3 November 2026 continuation

### Full-library continuation — local build verified; hosted gates pending

Objective: resolve the annotated table/image/OCR, authoritative replay, deployment and Sol 6.1
items, stopping before actual re-ingestion/re-indexing. Current source is
`fix/rag-preindex-readiness`, based on `af33a2517`; the continuation below is owned by this task.
The branch is local and has not been merged or deployed.

Read-only production inventory on 3 November found 2,066 PDFs: 2,065 ownerless PDFs with actual
boolean `metadata.public_corpus=true`, and one owned PDF. Existing artifacts include 14,313 images,
34,856 table facts and 172 documents with OCR. The shared PDFs lack the newer corpus/content-mode
markers. A private-owner-only/native-text profile cannot process this existing library. Current
Railway app deployment is `c92e78113abd936c53f88e7e069b2c7331c735a2` (2 November), not this branch.

The continuation adds a separate independently inspected rich-PDF profile, real locked OCR,
source-bound table/image retention, measured replacement-quality checks, dynamic local index and
memory producers, atomic completion, and authenticated active-generation image delivery. A new
authenticated administrator readmission preserves existing ownership/visibility and records a
current steward; it never reconstructs a historical upload or grants publication. The new draft
readmission/full-PDF migrations remain subject to the owner's specific production-change rule.
Native-text and reviewed-pilot profiles remain separate. Model-generated summaries, vision
interpretation and clinical semantic sign-off are explicitly deferred in the rich profile;
embeddings are its only enabled provider purpose.

Fresh local evidence: native tables, vector/raster captures and real Tesseract OCR pass under
locked PyMuPDF 1.28.2/Pillow/pytesseract dependencies; 14 Python cases pass. TypeScript compilation,
the worker bundle, source-scoped lint, access/API tests and the model smoke guards pass. The
integrated selector passes all 46 suites / 1,037 tests; final scheduling/model tests also pass
28 cases after the compiler/lint corrections. No provider request is made by
these tests or the offline comparison.

The isolated PostgreSQL 17 test activated a synthetic three-page generation with three chunks,
four searchable images, two table facts, seven memory cards and 14 index units. Strict completion
replay, retained image reads, direct-stage-delete refusal and parent-deletion cleanup passed.
A second real admission/claim proved refusal of old-admission reuse by another job, incomplete
images and stale leases; its outer rollback preserved the prior active shared generation, null
owner and existing public marker. Full local schema loading also passes with auth/storage/cron/
vault scaffolding. This is not authoritative Supabase image or migration-chain replay.

The SQL tests exposed and corrected nullable-generation comparison and column ambiguities. A
later row-parity failure exposed the existing embedding-field trigger's MD5 contract; the new
producer now matches that contract while retaining strict readback. Independent source review
also corrected owner/public cache invalidation and temporary-file ownership before post-load
cancellation. All four draft SQL files occur exactly once in `supabase/schema.sql`; the migration
role and 153-function grant guards pass. The committed drift manifest deliberately remains
unchanged and stale until authoritative regeneration is possible.

A feasible Sol smoke runner retains all 12 cases for 24 exact token-count requests followed by
24 generation requests, no retries/warmups, at most 384,000 output tokens, a 14-minute bound and
the existing US$15/run and US$30/month ceilings. Its offline run completes with zero provider
requests; live pricing, count fees, account access and monthly remaining-budget evidence are
still required before requesting a bounded paid run. Sol is not activated.

The authoritative replay remains blocked by denied `index.docker.io` image acquisition; official
OpenAI documentation/pricing hosts are also denied. An environment-domain enablement question
is pending. No network denial was bypassed, manifest fabricated, paid model run started, live
schema applied, worker claims resumed, source ingested or library re-indexed. Next actions:
regenerate the authoritative manifest when access is available,
then obtain the required concrete production/spending approvals and verify actual rollout.

The owner authorized implementing the functional build and deferred legal review as an
internal-build prerequisite ([decision](decisions/2026-11-03-defer-legal-review-for-internal-build.md)).
For an explicitly scoped owner-bound internal draft, use the recorded `review_deferred`
policy rather than fabricating a permitted licence. Explicit prohibitions, source eligibility,
administrator identity, privacy and source-fidelity checks still apply. Historical counsel
prerequisites below apply to public/operational clearance, not to this internal engineering work.

Existing work was recovered from `codex/rag-sol61-20261027` and
`rag-ingestion-safety-20261101` and integrated into `fix/rag-preindex-readiness` rather than
reimplemented. The missing programme ledger was found at
`codex/rag-local-build-20260822`, commit `38552bafe0a82a5df2a4467afd5ba211aee5b966`,
path `.superpowers/sdd/progress.md`. Its latest entry records U04 local implementation
acceptance with later units unstarted; it is an older branch, not proof of today's main-line
operational status. Preserve those accepted artifacts; do not restart U04 or merge the entire
old branch over current code. This continuation reconciles and extends current implementation.

The new general-PDF profile is explicitly native-text-only. It must retain incidental extractor
renders privately without publishing them or claiming image/OCR fidelity. Original sources with
required visual/OCR obligations remain outside that profile. The fixed reviewed pilot retains
its original terminal. A draft generic completion migration is not deployed evidence.

### Local implementation checkpoint — 3 November

Implemented: dynamic WA/native-text PDF inspection and completion; real isolated source
inspection; actual administrator/admission/private-storage supplier; finite internal policy with
fresh permission reads and scoped claims; explicitly deferred legal review; preserved unscanned
exception semantics; byte-bounded exact Unicode chunks; and additive jurisdiction/completion SQL.
The recovered Sol candidate now retains provider-returned model/request evidence and rejects an
infeasible paid comparison before consuming approval or spending.

Observed evidence: 833 tests across the 30-suite domain selector; 43 final runtime/supplier tests
after the claim-scope guard; 17 real-reader/producer tests and 11 Python cases against locked
PyMuPDF 1.28.2; worker bundle compilation; focused lint and migration-role/instruction/decision
guards. The compiler initially found fixture type errors; those were corrected. The pinned-parser
run also found deprecated-import stdout pollution; new code now uses the supported import.

Local PostgreSQL 17/pgvector proof exercised real retained-artifact and vector writes, completion,
strict replay, partial/stale attempts, malformed/null inspection timestamps, public-scope and
revoked-administrator refusal, and preservation of an existing generation. This scratch database
uses auth/storage/cron/vault scaffolding; it is not Supabase hosted parity. The first SQL run
exposed a column ambiguity, which was corrected before the passing runs.

Remaining release gates are explicit. The standard digest-pinned Supabase image could not fit
the managed Docker VFS storage. The supported rootless path was investigated, but its image
acquisition was denied at `index.docker.io` by host network policy. No denial was bypassed.
Consequently the authoritative drift-manifest regeneration is still pending; the committed
manifest has not been hand-edited to disguise that missing replay. Both draft migrations match
their appended schema definitions, but neither is approved/applied to production here.

This is a functioning **scoped native-text internal build**, not full-library, table/image/OCR,
clinical, model-quality or operational acceptance. The exact existing library IDs/admissions and
source features still require an authorized metadata/source inspection. Source-only answer
residuals and missing corpus coverage remain unclosed pending their actual evidence. Sol is
prepared, not activated: model access/prices and the currently infeasible paid comparison scope
must be resolved under the existing bounded-spending gate. No paid inference, real-source
ingestion, re-index, public publication, production setting, merge or deployment ran.

Source review: 1 November 2026, `BigSimmo/PsychSift`, base `08fbeda5148d170f3106c80dc43c45e5f650c4b1`
(PR #3881). Source intake owns this plan. [The runbook](reindex-runbook.md) governs execution.
The owner authorized preparation; no ingestion, re-index, paid evaluation, provider operation,
database change or deployment was performed in this review.

## Findings that change the October audit

Much of ingestion exists, but rollout safety and production validation remain incomplete.
The October inventory and database observations have not been refreshed against production.
Do not infer current document counts, admission records, backup health or PITR configuration
from this source review.

| Question                             | Source evidence                                                                                                                            | Implication                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| General PDFs and WA supported?       | `worker/admin-text-inspection.ts`, `current`: exact PDF digest, byte length and four-page review; catalogue jurisdiction must be Australia | Widen format inspection and jurisdiction binding separately; neither establishes rights                                                                                            |
| No scanner exists?                   | `worker/malware-inspection.ts`, `worker/clamav-inspection.ts`, `worker/admin-source-runtime.ts`                                            | Scanner implementations exist; commissioned trusted runtime configuration is missing. The [deferral](decisions/2026-10-27-defer-worker-malware-scanner.md) leaves refusal in place |
| Only fully finished indexes visible? | `worker/main.ts`, `committedCoreMetadata` and `commitDocumentIndexGeneration`                                                              | Legacy core becomes visible before enrichment. A filter requiring enrichment would hide the document after pointer movement, not retain its old index                              |
| Staged artifacts hidden?             | `src/lib/reindex-pipeline.ts`, `isCommittedGenerationMetadata`; SQL generation predicates                                                  | Stamped staged rows are hidden before commit. Unqualified legacy rows remain accepted; this is not proof of complete generation isolation                                          |
| Managed completion atomic?           | `worker/managed-generation-job.ts`; migration `20261013200007_managed_native_pdf_terminal_append.sql`                                      | TXT and exact reviewed PDF terminal scopes commit atomically; this is not general all-feature PDF support                                                                          |
| Rollback complete?                   | `src/lib/reindex-rollback.ts`; migration `20261025170000_rollback_legacy_pages_summary_and_guards.sql`                                     | Pointer, pages, metadata and quality are guarded. Summary and generated-label restoration depends on available snapshots; inspect returned restoration flags                       |
| Automatic quality approval?          | `src/lib/reindex-eval-gate.ts`; no worker caller                                                                                           | Gate core exists; no shadow driver uses it to prevent promotion. This change makes offline summary comparison available and rejects empty/invalid evaluations                      |

## Admission changes to implement before activation

Rights work and engineering can proceed in parallel. Rights approval gates only the affected
documents and uses; no WA-wide permission may be inferred from a publisher, URL or public access.

1. **Rights and current permission for public/operational clearance.** Internal build work uses
   the 3 November deferral above and does not wait for counsel. For later clearance, reuse
   source-acquisition rights fields (`publicDisplay`,
   `aiUse`, evidence, checked date, recorder), trusted admission identity and independently
   reloaded operative grants. Resolve #HGEC4B with the owner and counsel. Bind each permitted
   operation to document/source digest, publisher, jurisdiction, purpose and current policy.
   Missing or revoked evidence must refuse before any provider request. Do not populate real
   permission records, change public visibility or alter signed fingerprints in this work.
2. **PDF inspection.** Replace the exact national PDF exception with a versioned server-owned
   inspection contract: original digest and byte count, complete page inventory and text hashes,
   active-content/encryption checks, identifier checks and hidden-text consistency evidence.
   Prove the submitted embedding batch derives from those inspected source units. Preserve
   timeouts, cancellation, byte/page limits and process isolation; document unsupported OCR or
   table/image paths explicitly. A new PDF review contract also requires replacing the SQL
   terminal's four-page/four-chunk assumptions, not just removing the TypeScript digest check.
3. **Jurisdiction.** Scope the operative grant to its exact catalogue entry and jurisdiction.
   Resolve the admission contract's country-only `Australia` field without pretending it is
   evidence of WA authority. Test national/WA mismatches and protected/link-only publishers.
   Source eligibility, permission for provider processing and permission for public display
   remain distinct decisions.
4. **Scanning.** The owner selected a source-scoped administrator-only unscanned exception on
   1 November; see [the decision](decisions/2026-11-01-administrator-source-unscanned-exception.md).
   The local implementation is described below. Default refusal, real-scanner paths and all
   non-malware checks remain. This selection does not activate a runtime module or grant any
   document rights, ingestion, provider-call or rollout approval.

Implement these changes on a feature branch with synthetic fixtures. Review stale/revoked grants,
cross-owner sources, malformed or active PDFs, hidden text, oversized files, cancellation,
scanner failure and exact provider payload binding. Draft any migration unmerged; production
application requires the owner's permission for that specific database change.

## Administrator unscanned exception contract

Local implementation: `supabase/functions/_shared/admin-unscanned-exception.ts`,
`worker/admin-text-inspection.ts` and the existing ingress safety authority. The trusted mounted
module can explicitly return `backend: admin_unscanned_exception` from `loadScannerConfiguration`.
It must independently reload both the current exception grant and the administrator admission
provenance on every call. The callback receives the job, source binding, exact checked-byte hash,
purpose and source/payload phase so it can look up that exact scope. It must not synthesize a grant
or an admission from document metadata, a role label or a caller-supplied boolean.

The strict evidence contract contains:

- An active exception ID and version, responsible administrator and owner IDs, current complete
  source/attempt/lease/authority binding, admission digest, catalogue key, MIME type, byte count,
  `embedding` purpose, hashed approval reference, issue time and expiry. Validity is at most
  24 hours. Missing, revoked, future, expired or malformed evidence refuses.
- Separate current admission provenance: `admin_api` channel, administrator actor and current
  administrator status, matching administrator/owner/document/admission IDs, admission digest
  and original source hash. Current authority facts alone do not expose actor/channel. A backend
  import, ordinary upload or country-level authority declaration cannot establish this scope.

The module is a trusted server boundary: these contracts do not cryptographically authenticate
the supplier or implement a database admission reader. Before separately authorized activation,
review its actual data access and prove that provenance comes from admission events/current role
state and that grants/revocations come from the operative server-owned exception store. No such
module, real grant or exception store is provisioned by this change. Existing deployed modules
that only return scanner configurations remain compatible.

After the existing complete-source, rights, licence, catalogue, identifier, active-content and
source-derived-payload checks pass, the adapter validates the grant against the freshly loaded
facts and mints separate opaque in-process receipts for original bytes and exact payload bytes.
The gate rejects raw records, cloned/serialized receipts, different bindings/purposes and expired
receipts. Source and payload evidence are pinned together; changed grants cannot renew a permit.
An unavailable scanner never falls back to this mode. Revocation is detected by fresh supplier
reads before each provider assertion, not by a background revocation subscription.

Successful safety evidence explicitly says `scanner:unscanned` with the policy and evidence digest,
never `scanner:clean`. Permits cannot outlive the exception, including issuance from an earlier
evaluation result. Receipt validity is process-local; restart requires fresh evidence and new
receipts. No unscanned-upload authority crosses a network through serialized JSON.

This exception does not extend the current supported formats: national plain text and the exact
reviewed native PDF remain the only supported inspection paths. General PDFs, WA jurisdiction
support, rights decisions and shadow promotion remain separate implementation/acceptance work.

## Visibility and rollback acceptance

Define required artifacts for each supported feature set before promotion. Optional enrichment
may be deferred only when that scope is explicit in the report. Keep the old pointer while all
required work and quality checks run. Do not add a blanket enrichment filter or silently send
unsupported PDFs down the legacy auto-commit path.

Use a disposable local PostgreSQL instance and synthetic files to demonstrate failure before
commit, failure after legacy core commit, managed atomic completion, retries with stale leases,
and rollback to both typed and historical unstamped pages. Assess all serving artifact families,
including summaries, labels and legacy unqualified rows. Existing helper/static tests do not
prove deployed database behaviour.

For each pilot candidate, capture the exact current generation and digest and verify that the
next commit will preserve the intended rollback target. Repeat rollback preflight after the
candidate commits, before go/no-go. Record `summary_restored` and `labels_restored`; `ok: true`
alone does not establish whole-document restoration. Never re-queue a pilot candidate before
acceptance, because only one previous generation is retained.

Database backup evidence must include coverage, freshness and a restore demonstration; verify
Storage recovery separately. PITR status is unverified in this session. The historical pilot
accepted a particular recovery limitation; that does not authorize wider batches without PITR.

## Three-document pilot preparation

Select three current, rights-approved documents through a separately authorized metadata read:
one ordinary text document, one difficult native PDF, and one table/OCR case within the actually
implemented scope. If that scope is unavailable, hold the case rather than claim coverage.
Historical filenames are leads, not selected identities. No candidate IDs or approved run are
claimed here.

Before running, pin case IDs and expected document/passage references, corpus/index versions,
models, prompts, feature scope and quality thresholds. Include the reported fallback-only,
garbled text, table and missing-top-five cases where the selected documents support them.
Check correctness and citations independently; re-indexing is a hypothesis for those defects.

Acceptance requires no per-case reciprocal-rank regression, the existing pinned live-canary
recall bars, no citation/numeric/safety regression, and explicit review of extraction defects
and rollback eligibility. Summary averages alone are insufficient. Any unresolved missing case,
unsupported feature, incomplete evidence or regression is a hold. Revert/no-go action itself
needs the applicable live authority.

Present the exact documents, calls/token/runtime bounds, provider/model, pricing basis, TOTAL
estimate and enforceable hard spend cap including downstream/retries before requesting approval.
The historical roughly US$7 estimate is not a fresh quote or approval; retain the recorded
US$30 monthly OpenAI budget and refresh month-to-date usage before a proposal. No paid pilot or
acceptance run is authorized by this engineering request.

## Shadow re-index

Build the production driver after a successful approved pilot, before wider batches. The
[older GUC sketch](reindex-shadow-harness-design.md) needs revision:

- Use service-only, transaction-scoped evaluation wrappers with a document-to-candidate
  generation mapping. Normal retrieval must continue to use committed generations. Unchanged
  documents stay in the evaluation corpus, including their legacy rows; never filter the
  entire corpus to one candidate generation.
- Resolve generation overrides and run retrieval in the same database transaction. Separate
  PostgREST requests do not guarantee a shared session. Never expose overrides through ordinary
  authenticated/anonymous retrieval, use session-persistent GUCs on pooled connections, or allow
  an override to bypass document access controls.
- Split staging from promotion in every supported worker path. Preserve admission, lease fencing,
  current permission and retained source evidence. Leave the old pointer serving throughout.
- Bind evaluations to exact document/generation/digest and case populations. Reuse
  `decideReindexGate` plus existing per-case canary comparison; neither summary `GO` nor a chat
  approval can substitute for the other gates. A no-go leaves the old generation active.
- Promote each document atomically with expected-pointer fencing. Report partial batch outcomes;
  per-document atomicity is not batch-wide atomicity. Retain prior artifacts through the canary
  window, guard cleanup, and abort on drift or stale evidence.
- Require scratch-database ACL, rollback, generation-isolation and query-plan proof, followed by
  separately approved production migration, drift checks and live canary/profile evidence.

Only then propose bounded wider batches and the missing ADHD/valproate acquisitions. No automatic
fetch, ingestion, cleanup, promotion or library-wide run is part of this plan's execution.

## Offline commands and their limits

```sh
npm run audit:ingestion:offline -- --input <sanitized-inventory.json> --expected data/rag-expected-source-coverage.v1.json --output <local-report.json>
npm run reindex:gate:offline -- --input <local-summary-bundle.json>
```

The first wraps the existing local inventory audit; it has no live-read adapter. Synthetic
fixture results are not current-library observations. The second accepts four summary objects:
`baselineRetrieval`, `candidateRetrieval`, `baselineQuality`, `candidateQuality`, and optional
`chunkingExperiment`. Fields match `src/lib/reindex-eval-gate.ts`; when using retrieval eval JSON,
derive `failed_case_count` from `summary.failed_cases.length`. Supply governance quality metrics
explicitly; absent measurements are not zero. Both input summaries must describe nonempty,
comparable populations. Keep private artifacts outside tracked files.

The gate report is advisory and always emits `activationAuthorized: false`. It does not verify
artifact provenance, recompute summary metrics, establish per-case non-regression, stage a
generation or authorize an operation. Its `GO` means only that supplied summary metrics pass.
Use the existing `eval:retrieval:compare -- ... --fail-on-regression` for the separate per-case
canary check, and retain source/clinical acceptance.

## Worker security follow-up

#CK9GBW was rechecked on **1 November 2026** against the existing completed daily image scan,
[run 41334653850](https://github.com/BigSimmo/PsychSift/actions/runs/41334653850), at main `08fbeda`.
The [sanitized report](audit/worker-image-recheck-2026-11-01.json) pins the image digest and
artifact identity. It records **69 unsuppressed rows: 60 HIGH and 9 CRITICAL**. All original
24 issue #3741 rows remain, with no fixed version listed for those exact entries. These are
scanner observations, not independent exploitability or source-backport determinations.

A separate NLTK advisory lists `3.10.4`. Compare that release with the repository's pinned
upstream security commit before proposing an upgrade; the authentic `3.10.3` version alone
does not establish which source repairs are present. The report also retains the fixed-version
leads for Pillow and the two new SQLite rows since the 31 October scan. The green image job
uses the existing advisory policy and is not security acceptance or permission to ingest.

Next weekly review: **by 8 November 2026**, with remediation decisions before **2 December 2026**.
No scan was dispatched, package changed, image built, suppression added or deployed image
verified for this recheck. The existing workflow remains unchanged; this date is not an external reminder.
Preserve the owner's restriction on hand backports until after the pilot. No suppression or
advisory-window extension may be inferred from this plan.

## Checkpoint

Objective: carry out the audit recommendations without ingestion or re-index execution.
Original base: `08fbeda`; preparation commit: `daadb4f62`; branch: `rag-ingestion-safety-20261101`.
Continuation: implement the owner-selected source-scoped administrator-only unscanned exception
locally, with synthetic tests and independent review. Owned work: offline gate validation and
report, audit command alias, this plan, runbook/design corrections and owner decision.
Independent read-only source review confirmed the visibility/rollback findings; deployed state
is unverified. Fresh checks: 47 gate/report tests and 46 existing rollback/page/snapshot tests
passed; typecheck, owned-file lint, decisions, instructions, organisation, documentation script
references/inventory and diff checks passed. The audit command ran on six synthetic documents
and 21 expected source records only. Offline production-readiness structural checks passed with
pending legal/privacy and hosted-evidence blockers; this is not production readiness. Independent
diff review found no executable must-fix issues; its two documentation corrections are incorporated.
No PostgreSQL executable is installed here, and no database runtime proof was attempted.
Legal rights, implementation and integration of the general PDF/jurisdiction admission extension,
trusted runtime exception commissioning, scratch-DB runtime proof, candidate selection and bounded paid-run
approval remain outstanding. Next action after this exception implementation: extend the PDF and
jurisdiction contracts locally, then obtain their independent security review before proposing
activation. No publication, deployment or task-ledger reconciliation is implied by this checkpoint;
report those separately at handoff. Ingestion, re-index, paid evaluation, merge and deployment
require separate approval under the owner's latest instruction.

Exception continuation verification (1 November): 249 focused tests across ingress safety,
exception receipts, inspection/runtime composition and Node/Edge provider boundaries passed.
Typecheck, owned-file lint, formatting, worker bundle compilation, repository links, organisation,
instructions, decisions and diff checks passed. The type check initially caught test-fixture digest
types; these were corrected before the passing check. Independent source/security review found
no must-fix issues. Tests used synthetic inputs and scanner/provider stubs only; bundle compilation
did not execute the worker. No ingestion, re-index, paid evaluation, provider operation, database
change, merge or deployment occurred. The source changes remain local until separately authorized
publication; no canonical task-ledger reconciliation is claimed.

Publication continuation (1 November): the owner subsequently approved the recommended PR,
deployment and small-pilot steps. General operational permission is recorded; existing rights,
clinical/privacy, exact database-change and bounded-spending controls still apply. No priced,
source-pinned pilot has been approved in this continuation, and no operational grant is inferred
from document metadata.

The reviewed feature branch was published at `1e312aba98fb435d96452c8d7c6d7824f32ab2b3`.
The initial PR-local run stopped on a stale generated documentation snapshot; it was corrected,
and all remaining selected static checks passed. The full unit run had 34,339 passes, three
failures and two skips. All three failures were unchanged cloud-bootstrap tests requiring
npm 11.17.0 rather than this host's 11.9.0. All 23 tests in that suite then passed through the
documented staged-real-npm selector; no global runtime or tests changed, and no full-suite rerun
is claimed. The explicit demo/offline application build passed, including compilation,
TypeScript, static generation and the client-bundle secret check; its normal prebuild/postbuild
issue-cache cycle finished with the tracked cache restored. This proves local compilation, not
production readiness or activation.

PR creation is held because another draft PR (#3866) created a paid Supabase preview despite
reported disablement. Current metadata confirms that preview is inactive and production is
healthy, but available tools do not expose the integration's automatic-preview setting. The
owner has been asked to verify the current setting. Publishing this feature branch created no
new Supabase preview. No PR, merge, deployment, new scan, ingestion, re-index or paid evaluation
has been initiated by this continuation. The exact PR text is prepared locally; no canonical
task-ledger reconciliation is claimed.
