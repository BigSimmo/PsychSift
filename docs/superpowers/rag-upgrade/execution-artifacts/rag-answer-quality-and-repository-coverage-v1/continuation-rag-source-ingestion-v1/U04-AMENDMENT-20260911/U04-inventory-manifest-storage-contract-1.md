# U04 correction: durable family and producer declarations

Proposed correction to package2; not self-accepted. This takes precedence over evidence-record contract1's single-producer FamilyManifest and any implication that a family manifest exists only in memory. All other full-evidence, witness, requiredness and source/attempt rules remain. No new storage owner, generic mutation endpoint or operational permission is introduced.

## Durable owner and exact identity

Add one fixed column to existing proposed `document_index_generations`: `inventory_manifest jsonb NOT NULL`. Its strict version1 payload is `{version:1,documentId,candidateGenerationId,jobId,families}`. The job/document/C are server-bound and immutable. `families` has exactly the 18 fixed Family entries, in canonical family order; each is `{family,groups}`. Each fixed producer slot has `{groupKey,state,declaration}`. State is exactly `pending` or `declared`; declaration is null only while pending. All 18 entries and their exact slots are inserted at enqueue, without asserting an output population or inventing a first token. This column is added to the future-field origin/after-image contract and its coverage assertions.

Fixed producer-slot keys are: `worker_core`, `worker_native`, `deep_memory`, `enrichment`, `projection_aggregate`, `private_objects`, `control`, `cache`, `repair`. Slot membership is literal:

- pages, chunks, images, table_facts, embedding_fields, quality: `[worker_core]`.
- index_units: `[worker_core,deep_memory]`.
- native_structure: `[worker_native]`.
- sections, memory_cards, producer_aliases: `[deep_memory]`.
- summary, generated_labels: `[enrichment]`.
- document_metadata: `[projection_aggregate]` (the already defined complete aggregate, not one unit per contributing producer).
- private_objects: `[private_objects]`; attempt_control: `[control]`; cache_inputs: `[cache]`; repair_audit_inputs: `[repair]`.

This does not rename a real producer. The slot is a closed orchestration responsibility; its declaration retains the actual producer name/version and output manifest digest. Unknown additional producers or slots require a reviewed extension, never silent reassignment. Candidate family-level binding is document/C/job plus the member's immutable first token after claim, with **no family-wide D**. Each inventory unit and producer declaration carries its actual D or null. Thus core index units and deep-memory index units coexist without assigning core evidence to D or losing either producer.

## Closed per-slot declaration

Each non-null declaration is exact-key:

```ts
type ProducerDeclaration = {
  firstLeaseToken: Uuid;
  producer: { name: Text; version: Text | null; outputManifestDigest: Digest };
  artifactGenerationId: Uuid | null;
  population:
    | { tag: "known"; expectedUnits: UnitId[]; basis: EvidencePointer[];
        reason: "no_units_expected" | null }
    | { tag: "unknown"; limitation: Limitation }
    | { tag: "unavailable"; limitation: Limitation };
};
```

Use evidence-record contract1's strict primitive/ref/limitation definitions. Known expectedUnits are sorted unique identities from that producer's complete planned output before persistence. Nonempty sets have reason=null; empty sets require no_units_expected and the reviewed/pre-write basis. The complete outputManifestDigest binds that planned output or the explicit unavailable/unknown result, not a hash of surviving writes. Unknown remains allowed only for the previously permitted native/unused cache/repair cases. Unavailable is allowed only for an optional producer that produced no units and records its actual producer_unavailable/producer_failed/producer_skipped limitation; it is not known-empty and cannot satisfy an evaluation dependency. A required producer cannot use unavailable to seal.

The deep_memory slot's artifactGenerationId is the exact reserved owned D when it produces units, non-null and distinct from G0/C. D is shared by that actual producer's sections/cards/units/aliases declarations and must match its receipt. An unavailable deep-memory producer has null D only if it never reserved one; if D was reserved, preserve that exact D and all partial evidence instead of claiming no output. Other slots use null D. Per-unit binding remains ViewBinding, so full C/job/first-token/D identity is validated at persistence. Origin full-row inventories retain historical producer identities separately, without imposing these prospective slots on old rows.

Known unit sets from different slots within a family are disjoint, and their exact union is the family's declared population. The same unit cannot change producer/D, appear in two slots, or transfer from core to deep_memory. Per-unit producer/D fields match the owning declaration. Cross-family declarations by one producer bind the same output manifest where it is a single actual output batch. Multiple output stages are allowed only where the fixed slots already distinguish them; no late append to a declared slot or reinterpreted group meaning.

## Existing fixed RPC, monotonic mutation and freeze

Use only existing proposed `write_shadow_generation_inventory(p_fence jsonb,p_generation uuid,p_declarations jsonb,p_dispositions jsonb)`. Give p_declarations the closed shape `{version:1,groups:[{family,groupKey,declaration}],units:[<existing strict per-unit declaration>]}`; p_dispositions retains the existing closed per-unit finalization list. No column name, dynamic producer slot, arbitrary merge patch, SQL or callable parameter is accepted.

Under accepted U03 source/current-attempt fencing, lock the member and its exact checkpoint, validate persisted C/job/first token and exact expected control revision. In one transaction, declare selected pending slots and their complete unit declarations, verify exact membership/requiredness, update inventory_manifest and owned control after-image/revision, or roll back all effects. Every artifact writer requires its matching declaration before its first persistent artifact effect. The group may be declared after a producer has formed its planned in-memory output; it may not infer expectations from successful inserts. Independent source expectations used by P04 remain separately reviewed and cannot be replaced by this producer output population.

Pending-to-declared is one-way. Identical canonical payload replay under a still-valid Fence is idempotent; different content, extra units, changed producer/D or an unavailable result replacing a prior declaration refuses. Unit dispositions may later finalize under their existing write-once protocol. Partially produced available evidence must be declared and preserved as full units with the producer's actual output/limitation evidence; it cannot be hidden behind an unavailable zero-output declaration. Failure before all slots declare leaves an inert retained member, with no seal.

Until every slot is declared, expected_inventory_digest stays null and the complete inventory_manifest remains covered by the mutable owned checkpoint. At the transaction declaring the last slot, calculate and set expected_inventory_digest exactly once from the full canonical 18-family manifest plus all immutable per-unit declarations, using the already reviewed inventory domain. This freeze is derived from persisted rows, never a caller count. Thereafter manifest/declaration fields and digest are immutable. The original reviewed source expectations/plan/origin digest have their own unchanged identities throughout; this late candidate-output inventory digest is not substituted for them.

Final inventory_digest includes the frozen manifest/declarations plus every final disposition, full ref/digest, relationship and limitation. Member seal requires all fixed slots terminal, every required unit retained, all available partial bytes preserved, and exact producer/C/D/first-token membership. It embeds/references both the full retained manifest bytes and expected/final inventory digests in the immutable receipt and recovery bundle; whole-wave receipt binds all member digests. Known-empty families and optional unavailable declarations are durable facts, never reconstructed from zero unit rows. Candidate guarded reads bind the sealed manifest digest; before seal they cannot claim a complete candidate.

Only the fixed inventory writer may advance this field; revoke direct ordinary/service writes as for the rest of the private ledger. Existing enqueue initializes it, existing stage seals it, and no cleanup/reset/reclaim path may rewrite or release it. No new U05 retention/cleanup executor.

Control bootstrap and receipt hashing are acyclic. Enqueue/first claim/heartbeat use their accepted server checkpoint before producer inventory declarations exist; a control-family declaration is not a prerequisite to creating its own first token. The declaration-before-write rule applies to candidate artifact/projection persistence. For attempt_control, inventory retains the original controls and exact declared pre-seal checkpoint/previous producer receipts. The final stage receipt then binds that inventory digest and the actual terminal control after-image, captured in the same seal transaction. The final stage receipt is retained alongside the inventory in the member/bundle, never included in its own preimage. A later whole-wave receipt binds the completed member receipts. This clarifies evidence-record contract1's requirement to retain the terminal receipt without creating a self-referential inventory hash or requiring a future timestamp before seal.

## Focused proof

1. Persist an index_units family with one worker_core unit (D=null) and one deep_memory unit (D=owned D); preserve both declarations, producer versions/manifests and full rows through seal/readback.
2. Reject same-count wrong membership, a unit duplicated across groups, reassigned producer/D, missing/foreign first token and changing a declared slot. Failure after core declaration preserves it while deep_memory stays pending/unavailable; it does not falsify a complete family.
3. Persist all 18 known-empty or populated family declarations as appropriate, reload through the fixed ledger reader, and verify exact empty reasons/basis survive. Optional unavailable remains distinct from known-empty and blocks required evaluation paths.
4. Atomic RPC rejection leaves manifest, unit declarations and control revision unchanged. Seal refuses any pending slot; last declaration freezes exact expected digest once; complete final receipt/bundle contains the same bytes and producer membership.

These are local authored/mock/static test obligations. Hosted atomicity, ACL/role/RLS and race schedules still require separate connected acceptance. No tests or SQL were run to write this proposal.
