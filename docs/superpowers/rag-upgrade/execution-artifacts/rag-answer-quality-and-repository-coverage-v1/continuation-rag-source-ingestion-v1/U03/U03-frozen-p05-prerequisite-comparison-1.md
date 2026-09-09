# U03 frozen P05 prerequisite comparison 1 — PREPARATION NOT ACCEPTANCE

Completed the bounded static comparison requested by the controller against the frozen pause snapshot and immutable TASK_BASE migration owners. This is an object-level preparation artifact, not an independent product review, SQL/runtime verdict, full-schema parity claim, or U03 acceptance. The active author’s moving product files were not read.

## Outcome

The nine explicitly selected P05 function definitions match their final tracked owners. The selected table column/check/FK/uniqueness definitions, named indexes, RLS declarations, approval columns/v2 constraint, serving-authority seed, and selected declared grants also match, subject to the precise ACL and column-order distinctions below. The complete direct prerequisite closure does **not** match: the frozen snapshot retains an older approval-insert guard and omits nine active-source constraint-trigger bindings plus their three function dependencies. These are named below for controller review before any addition.

No repository write, test, compiler, gate, SQL, provider/network, worker, operator, server, ledger or commit ran. Only immutable/local reads, in-memory lexical comparison and these outside evidence writes were performed.

## Input binding and method

- TASK_BASE: `8c11f138e6c683a13db3b465332e7f3cbb515c62`. All migration reads used `git show <TASK_BASE>:<path>`; final-owner discovery used scoped `git grep <TASK_BASE>`. No moving migration or schema content was used.
- Frozen schema: `C:\Users\joshs\Codex-Handoffs\Ingestion\Execution\20260907-continuation\pause-20260908-u03\product\supabase\schema.sql`, raw-file SHA-256 `66079496aad32643fb2679e90d69af5dce9d20c478ca8f5b33c732ca7cf7b82c`. The same raw hash was checked again before writing this report.
- Pause manifest raw SHA-256 retained from the first precheck: `9bdca0894db2abab44a2d1a730b0d0dfb029149aa087fae07ae5f1f597391ecd`.
- Object inventory: `C:\Users\joshs\Codex-Handoffs\Ingestion\Execution\20260907-continuation\U03-frozen-p05-prerequisite-inventory-1.json`, raw-file SHA-256 `d26029cd84b9bbf9677425b1234aa3adb4043a436c74177035a8fe7fa7332168`. It contains exact owner/snapshot paths and line ranges, complete selected function headers/bodies, object excerpt hashes, source-file hashes, trigger definitions, logical table components and direct relation declarations.
- Lexical equality ignores comments, whitespace and unquoted-token case, while preserving quoted text. Function signatures/configuration and bodies were compared separately. No `ALTER FUNCTION` override for the compared names was found in immutable migrations or frozen schema. This is lexical comparison plus focused source inspection, not a PostgreSQL parser or executable SQL proof.
- Logical table comparison composes only the explicitly selected final ALTERs onto their CREATE definition and compares unordered column/constraint components. Raw input hashes are authoritative. Per-object excerpt hashes describe the UTF-8 text recorded in the JSON; some excerpt capture normalizes CRLF to LF. They must not be substituted for raw whole-file hashes.
- Reused own route evidence, without inferring a new session: requested Astra/high; observed `gpt-6-astra`, effort `high`, provider `openai`, session `01a0824e-514c-7072-bb43-e7ad9504978d`, agent `/root/u03_frozen_sql_precheck`, parent `01a07b47-4623-7e90-825a-ec25116b8531`. Selected own session_meta/turn_context evidence was read in precheck 1 from `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T02-36-05-01a0824e-514c-7072-bb43-e7ad9504978d.jsonl`. Local route configuration is not backend attestation.

All schema ranges below refer to the frozen schema, not R/supabase/schema.sql. Migration paths are relative to R and resolve only at TASK_BASE.

## Differences and additions requiring controller disposition

### D1 — Approval-insert guard is the old body

Frozen schema `require_document_publication_approval_state_digest()` at 8245–8256 checks only non-null `reviewed_state_digest`. Its final P05 owner is `supabase/migrations/20260822123000_govern_australian_source_activation.sql:29–77`. The existing trigger binding at snapshot 8261–8263 is identical to the final owner at 82–84, but therefore invokes the wrong effective body in the snapshot.

The final body additionally locks/validates the document, requires the v2 source and generation fields for `australian_public`, matches the exact committed generation and source policy, and refuses non-indexable, non-current or superseded source metadata. For example an all-null v2 tuple on an Australian document satisfies the copied all-null/all-present CHECK and the old trigger; the final migration-chain trigger rejects it. The already copied final publication-transition guard is a separate later validation and does not make this insertion contract equal.

Exact proposed closure addition: replace this existing snapshot function with that final owner body, retaining its existing trigger and the matching execute revocation at owner line 79. No new table, activation operation or migration backfill is needed. This is a named further P05 dependency reported under U03 execution-contract line 147, not permission to add it without controller disposition.

### D2 — Active-source DML constraint-trigger closure is missing

The selected `make_public_source_version_ineligible(uuid,text)` writes documents and eight owned artifact tables. Their effective migration-chain DML includes the following constraint triggers; all nine are absent from the frozen snapshot:

| Missing binding | Final immutable owner |
| --- | --- |
| `public_source_documents_require_active_version` on `documents` | `20260824120000_consolidate_public_source_lifecycle_authority.sql:374–377` |
| `public_source_document_labels_require_active_version` on `document_labels` | `20260824123000_harden_public_source_lifecycle_authority.sql:710` |
| `public_source_document_summaries_require_active_version` on `document_summaries` | `20260824123000_harden_public_source_lifecycle_authority.sql:712` |
| `public_source_document_sections_require_active_version` on `document_sections` | `20260824123000_harden_public_source_lifecycle_authority.sql:714` |
| `public_source_document_memory_cards_require_active_version` on `document_memory_cards` | `20260824123000_harden_public_source_lifecycle_authority.sql:716` |
| `public_source_document_table_facts_require_active_version` on `document_table_facts` | `20260824123000_harden_public_source_lifecycle_authority.sql:718` |
| `public_source_document_embedding_fields_require_active_version` on `document_embedding_fields` | `20260824123000_harden_public_source_lifecycle_authority.sql:720` |
| `public_source_document_index_quality_require_active_version` on `document_index_quality` | `20260824123000_harden_public_source_lifecycle_authority.sql:722` |
| `public_source_document_index_units_require_active_version` on `document_index_units` | `20260824123000_harden_public_source_lifecycle_authority.sql:724` |

They are AFTER INSERT OR UPDATE, DEFERRABLE INITIALLY IMMEDIATE, per-row constraint triggers. Restoring only a BEFORE publication guard is not equivalent. Their missing final function closure is exactly:

- `public_source_document_is_serving_eligible(uuid)` — hardening migration 603–633.
- `require_active_public_source_version_for_publication()` — hardening migration 635–646.
- `require_active_public_source_artifact_for_publication()` — hardening migration 699–707.
- Associated PUBLIC/anon/authenticated revocations — hardening migration 736–738.

The eligibility predicate directly reads only already named documents, versions and publication approvals; it does not require a new table or full retrieval/serving API. The predicate refuses catalogue-tagged public documents/artifacts without the exact active version and approved generation/publication binding. It is reached through these DML triggers, so this particular serving-named predicate is a transitive dependency, unlike unrelated serving stamps/retrieval definitions that remain out of scope. The selected lifecycle-exit update re-owns rows before trigger evaluation; its positive re-ownership case should still work, but the snapshot currently lacks the corresponding negative publication guardrails. No actual invalid publication or runtime exploit was executed or claimed.

Exact proposed addition is the three functions, nine bindings and their ACL statements only. Do not copy hardening lines 648–697: they are historical orphan-publication backfill/trigger-disable operations. Do not import activation, fetch, staging, tombstone, outbox or serving-stamp APIs as a shortcut. This set requires controller-reviewed inclusion before editing under the accepted line-147 boundary.

### D3 — Exact ACL wording and inherited privileges need an explicit disposition

The snapshot copies the source-table RLS and explicit grants exactly (source events/versions: 11218–11224 versus control-plane owner 64–70; authority table: 11279–11281 versus consolidation 66–68). However `GRANT SELECT` is additive: it does not revoke previously granted INSERT/UPDATE/DELETE. Immutable default-privilege owner `20260719055609_repair_postgres_default_privileges.sql:126–143` grants postgres-created public tables CRUD and functions EXECUTE to service_role; the snapshot reasserts the same defaults at 9358–9375 before creating the selected P05 objects. The P05 table REVOKEs name PUBLIC, anon and authenticated, not service_role. Therefore, for the expected postgres replay role, both source representations retain those default service-role grants; neither statically establishes the contract’s literal “SELECT-only service-role” description. Similarly the helper REVOKEs that omit service_role do not by themselves make those functions inaccessible to service_role.

This is an inherited P05 contract-versus-ACL distinction, not newly introduced snapshot-only exposure and not authority to change global defaults or P05 policy. Exact migration parity and strict SELECT-only/internal-only privilege claims are different verdicts here. Controller disposition is required before either stronger claim; do not silently revoke unrelated capabilities. Actual role ownership/inheritance/privilege results remain unrun.

Two explicit trigger-function REVOKEs present at control-plane owner 716–717 (`reject_public_source_activation_event_mutation()` and `guard_public_source_version_identity()`, PUBLIC/anon/authenticated) are absent from the appended snapshot. Under the encoded postgres defaults they do not create an effective PUBLIC/anon/authenticated privilege difference, but the local contribution does not reproduce those explicit ACL declarations. Copying the two exact revocations would restore declarative parity; no direct trigger-function exploit is inferred.

## Named objects that match

| Object group | Frozen ranges | Exact final owner/composition | Result |
| --- | --- | --- | --- |
| Source activation events: all column types/defaults/nullability/CHECKs, UUID PK, sequence uniqueness | 11155–11170 | Control plane 4–17 plus consolidation 4–5,20–24 | Logical components equal |
| Source versions: all columns/CHECKs, UUID PK, 4 FKs with ON DELETE RESTRICT, version/content and staging-document uniqueness, no-self-supersession | 11175–11208 | Control plane 22–54 plus consolidation 26–33 | Logical components equal |
| Source event index and three version indexes, including active-only unique partial index | 11172–11173,11210–11216 | Control plane 19–20,56–62 | Token-identical |
| Events/versions RLS and explicit table ACL | 11218–11224 | Control plane 64–70 | Token-identical; D3 qualifies effective privileges |
| Serving-authority table, positive epoch/singleton checks, seed, RLS and explicit ACL | 11272–11281 | Consolidation 59–68 | Token-identical |
| Three publication-approval columns and v2 completeness constraint | 11521–11534 | Govern-Australian migration 5–18 | Token-identical |
| Immutable event/version trigger bindings | 11238–11240,11267–11269 | Control plane 84–86,123–125 | Token-identical |
| Document publication trigger binding | 8354–8356 | Publication-approval migration 92–94 | Token-identical, final function replacement retained |

The migration-chain physical column order appends `source_sequence` and `acquisition_identity_digest` after the original columns; the snapshot places them beside related fields. All selected functions return JSON/UUID/text/boolean/void or triggers and access these rows by field name; no selected positional composite-return consumer was found. This is recorded as physical-order non-parity, not an observed semantic defect. Do not claim byte-identical CREATE TABLE text.

## Function inventory

All paths in this table have full raw-file SHA-256 records in the JSON. Abbreviated migration filenames here remain exact names, without `.sql` omitted.

| Function / argument count | Snapshot lines | Final owner lines | Verdict |
| --- | --- | --- | --- |
| `public.bump_public_source_serving_authority / 0` | 11283–11297 | `20260824120000_consolidate_public_source_lifecycle_authority.sql:70–84` | TOKEN_IDENTICAL |
| `public.document_publication_state_digest / 2` | 8204–8240 | `20260722190000_bind_publication_approval_to_reviewed_state.sql:15–120` | TOKEN_IDENTICAL |
| `public.enforce_document_title_word_scope / 0` | 5185–5209 | `20260719055623_enforce_public_title_word_scope.sql:42–67` | TOKEN_IDENTICAL |
| `public.guard_document_publication_transition / 0` | 11537–11623 | `20260824120000_consolidate_public_source_lifecycle_authority.sql:379–465` | TOKEN_IDENTICAL |
| `public.guard_public_source_version_identity / 0` | 11242–11264 | `20260824120000_consolidate_public_source_lifecycle_authority.sql:35–57` | TOKEN_IDENTICAL |
| `public.is_committed_artifact_generation / 2` | 5696–5708 | `20260702180000_promote_index_generation_id_columns.sql:117–129` | TOKEN_IDENTICAL |
| `public.is_committed_document_generation / 2` | 2585–2596 | `20260714110000_promote_documents_index_generation_id.sql:46–57` | TOKEN_IDENTICAL |
| `public.make_public_source_version_ineligible / 1` | 11509–11511 | `20260824123000_harden_public_source_lifecycle_authority.sql:353–355` | TOKEN_IDENTICAL |
| `public.make_public_source_version_ineligible / 2` | 11421–11471 | `20260824123000_harden_public_source_lifecycle_authority.sql:301–351` | TOKEN_IDENTICAL |
| `public.notify_document_change_ingestion_webhook / 0` | 4946–5015 | `20260723150000_document_change_ingestion_webhook.sql:1–70` | TOKEN_IDENTICAL |
| `public.prevent_document_publication_approval_mutation / 0` | 8187–8195 | `20260717131000_guard_document_publication_approval.sql:28–36` | TOKEN_IDENTICAL |
| `public.public_source_acquisition_identity_digest / 1` | 11300–11348 | `20260824123000_harden_public_source_lifecycle_authority.sql:4–52` | TOKEN_IDENTICAL |
| `public.public_source_document_is_serving_eligible / 1` | absent | `20260824123000_harden_public_source_lifecycle_authority.sql:603–633` | MISSING |
| `public.record_public_source_activation_event / 1` | 11350–11419 | `20260824123000_harden_public_source_lifecycle_authority.sql:54–123` | TOKEN_IDENTICAL |
| `public.reject_public_source_activation_event_mutation / 0` | 11226–11234 | `20260820121000_create_public_source_control_plane.sql:72–80` | TOKEN_IDENTICAL |
| `public.require_active_public_source_artifact_for_publication / 0` | absent | `20260824123000_harden_public_source_lifecycle_authority.sql:699–707` | MISSING |
| `public.require_active_public_source_version_for_publication / 0` | absent | `20260824123000_harden_public_source_lifecycle_authority.sql:635–646` | MISSING |
| `public.require_document_publication_approval_state_digest / 0` | 8245–8256 | `20260822123000_govern_australian_source_activation.sql:29–77` | DIFFERENT |
| `public.set_document_embedding_field_content_hash / 0` | 783–798 | `20260622000000_reconcile_schema_health_vector_privileges.sql:104–119` | TOKEN_IDENTICAL |
| `public.set_updated_at / 0` | 910–919 | `20260528009000_deep_memory_indexing.sql:56–65` | TOKEN_IDENTICAL |
| `public.sync_document_title_words / 0` | 5161–5180 | `20260717171000_public_title_corrector.sql:25–46` | TOKEN_IDENTICAL |
| `public.transition_public_source_version / 6` | 11473–11507 | `20260824123000_harden_public_source_lifecycle_authority.sql:507–541` | TOKEN_IDENTICAL |

The selected nine are event immutability, version immutability, acquisition digest, event writer, authority bump, both ineligible overloads, six-argument lifecycle transition, and final document publication guard. The obsolete seven-argument transition is absent from the snapshot, matching the final hardening DROP at 503–505. Other rows are direct helper/trigger dependencies, not a broader all-writer audit.

## Direct referenced-object and DML closure

The JSON inventories all directly named public relations. All are present: source events/versions/authority; documents and publication approvals; pages, images, labels, summaries, sections, memory cards, chunks, table facts, embedding fields, quality and index units; Node/Edge jobs; response cache; and title words. Their required identity, owner, metadata, generation, status, sequence and target columns are represented in the existing declarations/effective selected additions. This comparison does not re-audit every unrelated constraint/index/RLS policy on these pre-existing artifact/job tables.

- Publication-transition guard → `document_publication_state_digest(uuid,uuid)` → the existing generation helpers and the named artifact tables: all three function definitions are token-identical to final owners. The approval relation’s v2 columns/constraint match; its INSERT trigger body remains D1.
- Lifecycle/event writers → updated-at triggers on documents/sections/cards/index units; embedding-field content-hash trigger; document title-word synchronization; and metadata webhook: all present function definitions and bindings examined are token-identical. The hash trigger is UPDATE OF its named content columns, which the selected owner-only update does not change.
- Document title-word synchronization → title-word table plus its public-scope constraint trigger and helper: present and token-identical. For lifecycle exit the document becomes owned, so the synchronization deletes the previous public title words.
- The metadata webhook helper is unchanged and triggers only when JSON boolean `reindex_requested` changes to true. The selected P05 exit preserves that key, so it does not activate the HTTP branch. `vault.decrypted_secrets` and `net.http_post` remain pre-existing environment dependencies, not new selected P05 additions or executed provider work.
- The missing document/artifact constraint-trigger branch is precisely D2. No further public table dependency is introduced by its three missing functions.
- `extensions.digest` is an external PostgreSQL extension dependency of the already existing publication digest, content-hash trigger and selected acquisition digest. Neither searched immutable migration declarations nor the frozen schema explicitly creates pgcrypto. This shared environment/bootstrap assumption is recorded as unproven, not a new snapshot-only missing P05 object. No extension installation or SQL bootstrap was run.

| Existing trigger group | Comparison |
| --- | --- |
| Documents updated_at, title-word synchronization, metadata webhook, publication approval | 4 bindings token-identical |
| Artifact updated_at (sections/cards/index units), embedding-field content hash | 4 bindings token-identical |
| Title-word public-scope enforcement | 1 binding token-identical |
| Approval immutable/require-state-digest | 2 bindings token-identical; require-state-digest body differs (D1) |
| Source events/version immutable | 2 bindings token-identical |
| Active-source document and eight artifact constraints | 9 bindings missing (D2) |

## Rebinding and remaining proof

The controller can reuse the matching object inventory only after binding the same prerequisite bytes/object excerpts at the final source freeze. D1/D2 and D3 disposition prevent a complete closure/parity PASS now. Do not treat this preparation as final fresh xhigh acceptance or as validation of the moving U03 migration, claims, planner, operator changes, types, or complete writer families. Prior precheck findings remain separate; this artifact does not rerun that audit.

After approved correction, the smallest static follow-up is the same named-object comparison. Separate authorised SQL proof must compare migration-chain and snapshot environments, including valid exact lifecycle exit versus missing lifecycle-exit binding, approval v2 rejection cases, document/artifact exact active-version refusal, and actual role/ACL behavior. No SQL recipe was executed or authorized by this report.

Full immutable input-file hashes and object excerpt hashes are in the JSON inventory. Primary owner file hashes:

- `supabase/migrations/20260820121000_create_public_source_control_plane.sql`: `82bd07efdc31a4ee44b5f917a35ace340d6f731b70e3611f79c0bab2210d637e`.
- `supabase/migrations/20260822123000_govern_australian_source_activation.sql`: `19018ca1a04200853352c145f46b2de01517547d3bac687521e70effed6e19ef`.
- `supabase/migrations/20260824120000_consolidate_public_source_lifecycle_authority.sql`: `e37c53f6a5a744d061ea228133e67cde72c426f807342f43e56ebfcddd9d8837`.
- `supabase/migrations/20260824123000_harden_public_source_lifecycle_authority.sql`: `39c332a5dd4f5aa7e50afa44a2456e35dd34f49f16f09769b54be315114983a2`.
