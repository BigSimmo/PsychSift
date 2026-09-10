# U04 origin column parity and admission boundary closure 1

Design contribution at `378c9c3997f91921d89aa6d919b5c9ef05b2152a`, 10 September 2026. Repository `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`, branch `codex/rag-local-build-20260822`; tracked status clean. Only this report and the new outside `U04-origin-column-contract-2.json` were written. No product code, SQL, dependencies, tests, providers, workers, migrations, commits, or unrelated file inventories were run or changed. This is not independent acceptance or hosted schema evidence.

The accompanying JSON is the literal field/predicate contract. Its 22 tables contain **335 effective SQL columns**; the root's TypeScript-derived input contained 331. The comparison used the exact current `schema.sql` CREATE definitions plus the explicit ALTER additions below, inspected without executing SQL. A small local lexical extraction recorded declarations and compared sets; this is not a general SQL parser or database drift check. All definitions and additions relevant to these named tables were inspected. No type or schema cleanup is requested merely because this report finds source drift.

## 1. Confirmed parity differences and exact source identity

| SQL field absent from the TypeScript-derived inventory | Effective source | Disposition |
| --- | --- | --- |
| document_table_facts.index_generation_id | schema.sql:331 | Include in U04 integrity/evaluation generation predicates and literal snapshot. Narrow type ownership only if implementation needs this existing field; do not omit it to match the old Row type. |
| document_embedding_fields.index_generation_id | schema.sql:363 | Same; source_chunk_id or metadata does not replace the typed generation column. |
| document_title_words.word, document_title_words.document_id | schema.sql:5135–5141 | Include both stored values and exact row population. This table is absent from the Row inventory. No automatic request to generate unrelated database types. |

No TypeScript-only columns were found within these 22 table sets. This establishes source column-name parity after the four additions, not hosted column/type/nullability parity. The JSON preserves SQL declarations, distinguishing them from TypeScript's `number`, `unknown` and Json approximations.

Effective ALTER additions included: six lease columns each on ingestion_jobs (`schema.sql:11751–11764`) and indexing_v3_agent_jobs (`11765–11778`); job_kind/lease_token/index_generation_id on ingestion_job_stages (`12182–12183`); source_catalogue_key/source_policy_version/reviewed_index_generation_id on document_publication_approvals (`11558–11561`). Other inspected ALTERs in these named tables set reloptions, RLS, or constraints; they do not add omitted stored columns. Existing source publication triggers and constraints remain effective.

Source hashes:

- schema.sql: `34c22c97cabd6b9a0f754265c1b4da69b440c5c250f66fb3bffa551b83a31741`
- database.types.ts: `dcb21f4473fa1bc75d772583b2b5cbc239064f19084bc8a04514a852cc440480`
- Accepted U03 migration: `92924c2c2b324866a18a0436a581b37886a44f440b6fbc8cd84fda22eed9ad0f`
- JSON contract SHA-256: `8f933621bfa7d9a73e839567e5fe368dd53f23436cd05eda26c81011ef7fab90`

The JSON also binds the input inventory hash. Future U04 columns, pages' new generation column, and private ledger/projection table definitions are explicitly **not current source**. Add their exact fields to a later new contract version when the implementation brief freezes them; do not mutate this evidence to pretend they already exist.

## 2. Literal table fields

The companion JSON enumerates every name and SQL declaration, not a wildcard `SELECT *` allowance. These counts permit a quick completeness check:

| Table | Columns | Primary comparison identity |
| --- | ---: | --- |
| documents | 22 | id |
| document_pages | 7 | id |
| document_chunks | 19 | id |
| document_images | 27 | id |
| document_table_facts | 16 | id |
| document_embedding_fields | 12 | id |
| document_index_units | 23 | id |
| document_sections | 18 | id |
| document_memory_cards | 20 | id |
| document_summaries | 12 | id |
| document_labels | 10 | id |
| document_index_quality | 13 | document_id |
| ingestion_jobs | 22 | id |
| indexing_v3_agent_jobs | 20 | id |
| ingestion_job_stages | 16 | id |
| import_batches | 15 | id |
| rag_aliases | 10 | id |
| document_title_words | 2 | word, document_id |
| public_source_versions | 25 | id |
| public_source_activation_events | 10 | id |
| public_source_serving_authority | 3 | singleton |
| document_publication_approvals | 13 | id |

The document list includes description. The integrity inventory includes all generations/producers and legacy rows; generation-filtered evaluation views are a separate operation. Existing manual labels and every original live singleton field are preserved. Candidate C must never disappear from integrity accounting because a committed-reader helper filters it out.

## 3. Fixed population and predicate matrix

Define W as the sorted unique exact authorized document UUID set. Q is all original Node and Edge job IDs whose document_id is in W. B is the union of original selected Node batch_id and selected documents.import_batch_id. K is the union of catalogue keys on selected documents and their source versions. A is the referenced approval UUID set from selected versions and valid document publication metadata. Invalid source identity shapes refuse rather than being dropped. These sets are derived inside the fixed operation, not caller-supplied arbitrary filters.

| Family | Exact comparison population / refusal rule |
| --- | --- |
| documents | id IN W; returned identity set must equal W. Full source/owner/G0/metadata and all stored fields, including persisted times. |
| pages/chunks/images/facts/fields/units/sections/cards/summaries/labels/quality | document_id IN W, all rows, all generations, all producers. Compare row identity sets before fields. Preserve null generation distinctly. Referenced anchors/arrays are checked against full selected memberships; dangling or cross-document links remain evidence, never silently omitted. |
| selected Node/Edge jobs | Every row with document_id IN W, all statuses and attempts. Historical failed/completed rows are not omitted. Their full after-image is relevant foreign state. |
| stages | document_id IN W **OR** job_id IN Q. Keep inconsistent cross-document rows. Q does not automatically include all batch siblings; there is no recursive graph expansion. Schema intentionally has no job FK, so narrowing to document-only or AND would lose evidence. |
| original batches | id IN B, full fields. Missing referenced batch is a refusal/integrity defect, not an empty result. |
| Node batch siblings | Every Node row with batch_id IN B; capture full row, even outside W. Deduplicate rows already selected by document identity. No walk to siblings' other artifacts, stages, or unrelated batches. A sibling heartbeat is real foreign drift under this conservative contract. |
| producer/document aliases | Every row whose metadata.document_id text exactly identifies W; full stored row, including disabled and manual rows. No generation/producer exclusion in integrity capture. |
| permitted manual alias overlay | The same frozen, reviewed manual alias population on G0 and C; exact selector and IDs must be fixed in the evaluation contract. Existing ordinary owner/global alias selection at rag-retrieval-variants.ts:148–171 includes aliases beyond document predicates and takes a pre-merge limit. Therefore a document-only inventory cannot silently stand in for that read. Capture the complete permitted selector population before its ranking/limit, including states needed to detect enabled flips/new entrants; exact-wave evaluation must not borrow generated aliases from other documents. This selector is a finite remaining reader decision, not an unrestricted global overlay. |
| title words | document_id IN W, exact (word,document_id) set. The actual fuzzy correction helper reads a whole-table pool at schema.sql:5310; evaluation must use W before candidate selection/limit. No implicit background corpus. |
| source versions | staging_document_id IN W, full 25 fields; authority requires exact unique binding. Supersedes_version_id is retained as a referenced identity, not a reason to recursively inventory unrelated version trees. |
| source events | source_catalogue_key IN K, full matching events and exact sequence ordering. Authority independently selects the latest event. A new event, even one restoring an old decision, changes this population. A missing event/source disagreement fails authority. |
| source serving authority | singleton=true; exactly one full row. lifecycle_epoch is precision-bearing bigint and not an ignored timestamp. Including this global epoch may conservatively invalidate a wave on unrelated source activation; that cost is explicit. |
| publication approvals | document_id IN W **OR** id IN A, full rows. A mismatched referenced approval stays visible and fails authority. No FK assumption: this table declares document_id as plain uuid. |

At subsequent observations, rerun these relational selectors. The immutable server ledger identifies the only permitted new own job/stage/artifact IDs. Subtracting/normalizing those additions requires exact C/document/first-token/state identity and checkpoint equality. Existing rows never become owned by adding C metadata. New foreign rows, row removals, same-count replacements and changed fields remain drift. The comparison excludes no timestamps globally.

## 4. Generated and precision-bearing representation

Seven generated search-vector columns may be represented by exact source fields **and the frozen SQL/schema/search-configuration identity**, rather than copying a derived tsvector into every preimage:

- documents.search_tsv and title_search_tsv: title and file_name, including the exact normalization/search expression.
- document_chunks.search_tsv: section_heading, retrieval_synopsis, content.
- document_table_facts.search_tsv: table_title, row_label, clinical_parameter, threshold_value, action.
- document_embedding_fields.search_tsv: content.
- document_index_units.search_tsv: unit_type, title, content.
- document_memory_cards.search_tsv: title and content.

The generated documents.index_generation_id remains an explicit typed observed value plus the complete metadata and generation-key-presence check. The supported G0-null case cannot be inferred from the generated null value alone. A present malformed/null metadata key remains a refusal.

**document_title_words is stored trigger-maintained data, not a generated column.** Retain its exact row set even though it can normally be derived from a title. `sync_document_title_words` reacts to title/status/owner changes (`schema.sql:5161–5222`); service-role DML and its scope trigger exist. Hashing only title would miss a missing stored word or a valid subset deleted from this table. Its absence in TS is not permission to omit it.

Use the retained PostgreSQL-owned envelope bytes from the adopted digest contract. Preserve full JSON evidence objects, every field, null versus empty, string whitespace/line breaks, Unicode and meaningful array order/duplicates. Sort only row populations by declared identity. Specifically preserve heading paths, labels/tags/issues, normalized_terms, source/image/chunk ID arrays, event/approval evidence_references, vectors and coordinate arrays exactly; treating them as unordered sets would erase real changes even where a consumer currently ignores order.

All bigint fields (file_size, total_bytes, source_sequence, lifecycle_epoch), timestamptz values and vector/real scores must retain server precision. Never verify a digest by a JavaScript-parsed-and-reserialized numeric/timestamp view. The JSON's representation tags identify the top-level precision-bearing declarations; nested JSON may contain precision-bearing values too and always retains raw envelope bytes. A typed consumer must use strings or reject out-of-range numbers; hashes do not justify truncation. No converting microseconds to Date milliseconds, no lossy vector conversion, and no UTF-8 content normalization for integrity. The existing duplicate-content analysis policy is a separate metric and must not replace integrity hashing.

## 5. Broad barriers only at full-origin admission boundaries

Adopt the controller's narrower placement: the complete relation `SHARE ROW EXCLUSIVE NOWAIT` barrier belongs at **enqueue** and **terminal member/wave seal**, where a full origin/current-state verdict becomes authoritative. It is not repeated on every heartbeat, progress, stage or candidate artifact append.

This is compatible with the proposed ownership model provided all intermediate mutations:

1. Use existing U03 source/advisory/document/Node/Edge authority locks and current wall-clock lease checks.
2. Bind exact persisted shadow operation, document, C, original G0, original first token and member state. No same-C reclaim or fake G0-to-C Fence handoff.
3. Write only candidate-owned rows/private projections/inventory and the exact permitted own control after-image/checkpoint in the same transaction. They cannot modify G0, live summaries/labels/metadata/aliases, original queues or original batches.
4. Refuse sealed/terminal members except narrowly defined historical receipt reads. Candidate append/reset/deep-memory owners must all enforce this, including direct callable SQL paths.
5. Leave C inert until terminal sealing rechecks the entire original foreign population and full candidate inventory under the complete barrier. Any observed drift causes rollback/refusal of the seal; previous candidate work is retained, not adopted as valid.

A foreign manual label edit during a heartbeat is therefore allowed to proceed by its ordinary owner; U04 does not call the heartbeat a full-origin equality check. Terminal seal detects the label change and refuses. This sacrifices wasted candidate work under contention, not fidelity or live-state preservation. Source/owner/G0 changes remain checked by the U03 authority/Fence path on every mutation rather than waiting until seal. If a candidate producer needs foreign data, its input is bound to the expected origin; a changed live lookup must refuse or remain provisional until terminal comparison, never replace a reviewed expectation.

For multi-member waves, individual historical receipts do not imply whole-wave readiness. The final wave acceptance must bind all terminal member receipts and validate the original population together; a failed later member leaves the wave NO_GO. A source/foreign-state change after seal makes atomic evaluation reads refuse; sealed historical receipts are not ongoing activation authority.

### Required preservation correction: existing cleanup and direct mutation owners

There is one concrete counterexample if only seal locks/private table immutability are implemented: `cleanup_abandoned_document_index_generations(uuid,integer,boolean)` remains service-executable (`schema.sql:5686–5687`). It selects noncommitted artifact generations when no pending/processing Node job remains (`2054–2063`), rechecks that same condition, then deletes the generation-mismatched core rows (`2200–2259`). U04 intentionally completes its shadow job while keeping C uncommitted. The existing cleanup can therefore delete sealed C after the seal transaction releases its locks. The barrier merely delays this; it cannot provide durable protection.

Add this existing SQL function to U04's narrow owner allowlist solely to exclude **every reserved/retained U04 generation** and its recorded owned artifact-generation identities from discovery/count/deletion, including sealed, failed and ambiguous attempts. Do not protect only open jobs or only successful C. Each destructive predicate must enforce ledger protection at the actual write boundary, with compatible source/document/ledger synchronization; a preliminary target list alone is a TOCTOU gap. No new cleanup command or cleanup execution is introduced. Later explicitly admitted U05/U13 disposition owns release of protection and actual cleanup.

Apply the schema recommendation's same durable rule to direct base-family mutations/deletions: protected generation ledger states govern existing artifact/reset/commit paths, not only new private-table immutability. An old function must not delete C or retained D merely because they are not the active G0; another standard worker's page replacement must not clear generation-addressed candidate pages. Exact candidate resets are allowed only while the original first-token build is active and the existing uncertainty policy permits them; terminal/ambiguous evidence is retained. Accepted U03 migration bytes remain unchanged; the U04 migration/snapshot owns the narrowed function definitions/guards. This is candidate preservation required for U04, not reopening U03 acceptance or implementing the U05 retention executor.

## 6. Exact short-boundary lock/deadline proposal

The two full-admission RPCs are VOLATILE at READ COMMITTED with one PostgREST transaction. Before any factual SELECT or mutation: validate scalar/envelope shape; validate the effective transaction mode and preconfigured operational timeout profile; capture an absolute server deadline; acquire all 22 existing table barriers plus the exact new private tables in lexicographic fully-qualified order, NOWAIT. Add any further relation only when the fixed factual query/trigger closure actually requires it. document_title_words is included because document triggers and evaluation use it. No caller chooses relations/mode/order.

After complete barriers, use U03's source-key advisory/event/version/document authority order and then stable Node/Edge/artifact/control/batch row order. Prefer try-authority and NOWAIT row acquisition where the existing contracts permit it. The unchanged helper has some blocking event/version locks; set a finite lock_timeout before invoking it and refuse typed contention/deadlock without automatic mutation retry. Existing U03 transactions can hold compatible row locks before attempting a write; complete relation barriers alone are not a deadlock-free protocol. No effects are allowed before full admission.

Then recapture full facts with fresh READ COMMITTED statement snapshots after all barriers. Since all compared relations are write-barrier protected, snapshots taken during this short boundary observe a stable compared relation set; the existing source/Fence predicates still recheck exact authority. Compare original state, permitted own checkpoint and candidate inventory. Apply enqueue or terminal seal atomically, inspect actual trigger after-images, and freeze the returned receipt. Any post-effect failure must raise/roll back the RPC, not return false after leaving partial writes. Concurrent ordinary readers remain permitted; ordinary writers may wait while the barrier is held.

Provisional concrete bounds remain 2s lock timeout, 15s server request statement timeout configured **before request dispatch**, and 20s monotonic client operation deadline. Check the absolute server budget at each fixed stage/loop boundary and before effects, with an earlier refusal margin; this does not itself interrupt a long SQL expression. No provider/model/native/object work or unbounded retry occurs inside. The request profile must reject disabled/oversized effective timeouts and be verified under later connected acceptance. A SET LOCAL statement_timeout inside the already-running RPC is not accepted as proof that its top-level deadline was armed. An aborted HTTP fetch remains outcome_unknown until exact later receipt readback; never assert rollback from the client deadline alone.

Admission must also bind exact maximum wave members, complete row count and serialized byte budget for the fixed format/population contract. At a limit, return explicit evidence-too-large before mutation; never silently use LIMIT, truncate fields, ignore historical rows or reduce the required population to fit. These numerical payload limits are a finite remaining controller/brief decision; the 15s timeout is not itself a payload or performance proof. Connected tests must measure the worst approved complete fixture and ordinary writer contention before approving runtime use. Intermediate per-member writes retain their own bounded RPC/lease controls without the global relation barrier.

## 7. Focused proof and finite remaining dispatch decisions

No verification command ran. Proposed focused acceptance consists of:

- Exact SQL/typed-column matrix includes all 335 current fields and fails when a new stored column is omitted; search-vector source mapping, title_words physical set and future U04 columns are explicit.
- Source fixtures change description, fact/field typed generation, a stored title word, microsecond timestamp, bigint above JS safe range, nested JSON number, array order/duplicate, a same-count artifact, a cross-document stage linked to Q, and a batch sibling. Each relevant origin comparison must detect the change without lossy normalization.
- A foreign edit between candidate appends does not alter G0 through U04; terminal seal refuses and retains C. Heartbeat does not unnecessarily take the broad relation barrier.
- Sealed/failed/ambiguous C and retained D survive the **actual existing cleanup/direct SQL owner predicates**; only later authorized disposition can release protection. No optimistic preselection guard substitutes for write-boundary protection.
- Both lock interleavings with ordinary U03 writers, source events, manual labels, alias/stage phantoms, title-word triggers and batch siblings produce either a complete correct commit or bounded rollback/refusal. These SQL schedules are separately gated and unrun.
- Atomic evaluation read guards and their evidence queries share a single snapshot, include all ranking/projection inputs, freeze the evaluation timestamp, and preserve a sticky NO_GO on missing/changed inputs.

Only these finite design details remain for the controller's integrated brief: (1) exact new private table/column/guard allowlist; (2) frozen permitted manual-alias selector and any other evaluation-only input beyond W; (3) exact payload/member limits and timeout operational profile; (4) literal fixed source/row-lock query ordering and cleanup/write-boundary ledger guard; (5) exact measurement producers for P04's quality/structure/provenance fields. Independent xhigh schema/RAG review must assess the combined contract; this contributor does not accept its own design. Actual SQL/runtime/provider/native proof remains separately authorized later.

Route: `/root/u04_transaction_closure`, session `01a08bd5-607b-7341-b39f-fe1276f7a643`. Selected turn_context re-read from the exact own log recorded by contract 3 at `2026-09-10T15:17:30.301Z` reports `gpt-6-astra`, effort `high`. This is observed local configuration, not backend attestation or an independent verdict. U02's historical exit 1 / four failed suites / 45 failed and 586 passed remains unchanged and grants no future exception.
