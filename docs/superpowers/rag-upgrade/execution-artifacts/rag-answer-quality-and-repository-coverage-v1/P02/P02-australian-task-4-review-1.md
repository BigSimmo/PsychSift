# P02 Australian Task 4 — Review 1

## Findings

### Important — the publication transition trigger reviews `OLD` state but releases arbitrary `NEW` state

File: `supabase/migrations/20260822123000_govern_australian_source_activation.sql:105-192`

The owner-release guard enters on `OLD.owner_id is not null and NEW.owner_id is null`, but it decides whether the Australian v2 rules apply from `OLD.metadata` at line 113. It then compares the approval's generation, catalogue, policy and public-indexability fields to `OLD` at lines 143-151 and recomputes the reviewed-state digest from `OLD` at lines 187-190. After those checks it returns the otherwise unconstrained `NEW` row.

That creates a direct database-boundary bypass. A service-role update can start from a non-Australian owned document with a valid v1 approval/digest, set `owner_id = null`, and in the same statement change `NEW.metadata.corpus_scope` to `australian_public` (including a `link_only`, unlicensed, withdrawn, inactive, differently catalogued or differently governed target), or replace the target generation. Because the old row is non-Australian, the v2 branch is skipped; because the general approval and digest checks cover the old row, they still pass. The trigger then publishes the unreviewed new state. Even when the old row is already Australian, the same old-versus-new mismatch lets a caller swap the approved generation or governance fields during owner release. After activation, an Australian row whose owner is already null can also have these governance fields changed without entering this transition branch.

This defeats the required guarantees that v1 can never activate `australian_public`, that activation is bound to the exact reviewed generation/state/policy, and that `link_only` fails closed at the database boundary.

Required correction:

- Validate the target `NEW` Australian state and the target generation against the v2 approval, not merely the staged `OLD` state. If the intended transition permits only ownership release plus fixed publication audit metadata, explicitly reject changes to every other digest/governance-bearing field in the same statement.
- Make post-activation changes to Australian corpus scope, catalogue, policy, content mode, licence, status, withdrawal state, committed generation and reviewed content require a new governed transition, or make them immutable while public.
- Add regression coverage proving rejection of (1) old non-Australian + v1 approval to new Australian in one update, (2) a same-update generation/policy/content-mode swap, and (3) governance mutation after an Australian row is already public.

### Important — SQL duplicate rejection is based on non-canonical UUID text

File: `supabase/migrations/20260822123000_govern_australian_source_activation.sql:236-260`

The RPC checks duplicate documents and generations by grouping the raw JSON strings (`entry->>'documentId'` and `entry->>'expectedIndexGenerationId'`) at lines 236-251. UUID syntax is accepted case-insensitively at lines 258-260 and the values are only cast to `uuid` later. Consequently, upper- and lower-case spellings of the same UUID are treated as distinct by the duplicate checks even though PostgreSQL canonicalizes them to the same UUID for sorting, binding and row processing.

The TypeScript parser normalizes and rejects this input, but the controller ruling requires SQL to independently enforce canonical cardinality and uniqueness. A direct service-role RPC caller can therefore provide the same generation twice with different casing; if two document rows reference that generation, the manifest-derived generation array can contain the duplicate UUID and an identical `p_expected_generation_ids` array passes. Mixed-case duplicate document IDs are also not rejected at the specified validation boundary (although later owner-state processing is likely to roll that transaction back).

Required correction:

- Validate UUID syntax first, then perform document and generation duplicate checks on `::uuid` values (or canonical `::uuid::text` values), and use the same canonical representation for ordering and binding.
- Add mixed-case duplicate document and generation regression cases, including a proof that the RPC rejects them before any activation loop work.

### Important — the focused SQL and dispatcher tests do not protect the high-risk behavior

Files: `tests/supabase-schema.test.ts:1425-1485`; `scripts/promote-public-documents-batch.ts:122-205`

The new migration tests only search the SQL source with `toContain` and compare substring positions. They do not execute the trigger/RPC or otherwise distinguish validation of `OLD` from `NEW`, and they assert only that a duplicate-generation error string exists rather than that canonical duplicates are rejected. That is why the required focused suite passes while both database defects above remain. No focused test exercises the changed script's v1/v2 dispatch, exact v2 RPC payload, canonical generation ordering, approval insert fields, or v1-to-Australian rejection.

Required correction:

- Add behavior-level SQL coverage in the repository's local/offline database harness for successful atomic activation and rollback/rejection paths, including the two defects above, row-lock/race failure paths, approval exactness, child ownership, and append-only history. If a database harness is unavailable in this task, add a structured SQL contract test that specifically proves canonical casts and `NEW`-state validation; simple error-message presence is not sufficient acceptance evidence.
- Isolate/test the script dispatcher with a fake Supabase client so tests prove one batch RPC, exact signed/reviewed v2 fields, canonical document/generation order and cardinality, preserved dry-run/apply confirmation, preserved v1 dispatch, and refusal to activate Australian content through v1.

## Spec and production-quality assessment

Outside the findings above, the range implements the intended TypeScript manifest-v2 contract well: strict top-level and document shapes, fixed policy version, required operator/reason/evidence, canonical UUID/lowercase digest handling, duplicate rejection, catalogue validation, link-only/inactive rejection, blocked eTG/AMH/NPS catalogue entries, and preserved v1 parsing. The approved-document helper sorts canonical document IDs and derives the batch state binding in that order.

The normal script path preserves dry-run/apply confirmation, inserts the v2 approval evidence fields, dispatches v1 and v2 separately, and supplies the v2 RPC with the manifest-derived state digest and canonically ordered generation array. The normal RPC path is a single transaction and independently recomputes the batch binding before locking/rechecking each document. It also covers active/current/non-withdrawn/indexed/public-licence state, exact approval/policy/generation/state matches, ingestion and child row locks, child ownership, publication metadata, append-only approval history, RLS/grants, service-role-only execution and a fixed empty `SECURITY DEFINER` search path. The generated database types match the new columns and RPC signature.

The migration is syntactically replay-oriented (`if not exists`, guarded constraints, `create or replace`) and preserves the existing state-digest and trigger names, but replay against a local database was not performed because the review brief explicitly prohibited applying the migration. No privilege regression was found by static inspection. No out-of-scope file is present in the immutable range, and `src/lib/rag/rag.ts` is unchanged at 4,362 lines.

## Immutable-range and verification evidence

- Current `HEAD`: `fe263fffa226940000d40cf0d743e507d3b06335` (exact requested head).
- `90b90ea26a09dc6e59fa18d1198dd2a6f63161d6..fe263fffa226940000d40cf0d743e507d3b06335` contains exactly one commit and changes exactly the six planned implementation/test/migration files.
- The canonical review package SHA-256 is `cae717f4a0a6b32e335a4199fe1119ff7161099f1bb6ca509ce467b1ae09164f`. An independent reconstruction using the repository's canonical full-index/no-renames/binary diff flags matched the package exactly; this review did not use a stale or correction-only diff.
- `node scripts/run-vitest.mjs run tests/publication-manifest.test.ts tests/supabase-schema.test.ts` — PASS, 2 files and 90 tests passed, duration 1.37 s, exit 0. This is fresh focused evidence, but the SQL portion has the coverage limitation reported above.
- `npm run typecheck` — PASS for the exact current 4,567-file whole-tree input hash `3f79ef5b80ac`; the completed run recorded one currently valid typecheck receipt.
- `npm run check:migration-role` — PASS, exit 0 (`Hosted migration-role guard passed: active hosted SQL/tooling uses postgres and immutable applied history is unchanged.`).
- `git diff --check 90b90ea26a09dc6e59fa18d1198dd2a6f63161d6 fe263fffa226940000d40cf0d743e507d3b06335` — PASS, no output.
- `src/lib/rag/rag.ts` immutable-range check — unchanged; current line count 4,362.
- No migration was applied, no Playwright command was run, and no hosted/provider/Supabase/network action was performed. Provider/live production-readiness evidence is intentionally unrun under this review's offline authority boundary.

SPEC_VERDICT: FAIL
QUALITY_VERDICT: FAIL
