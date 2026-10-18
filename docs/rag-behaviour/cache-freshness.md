# Document governance and cached evidence

The F13 remediation replaces the latest-indexed-document stamp with the authoritative
`rag_cache_scope_revision_v1` database read. The complete document population in the
request's owner/public and optional document scope determines the revision. Every row's
id, owner, status, updated time, metadata and index generation participate. Each row is
hashed before aggregation; the response contains only a versioned 51-character digest.
The SQL and service-role-only grant are maintained in the database schema/migration.

Local answer/search hits require a fresh revision. A revision retained at request start
cannot skip that read. Shared answer/search hits also re-read the revision after fetching
the cache payload, so a review committed during the shared read causes a miss. A late
write with the old retrieval revision remains unreachable after a source change, even if
the shared cache deletion failed. Write promotion compares the current revision with
the retrieval-start revision; process-local owner/global epochs additionally prevent
promotion or reads across same-process invalidation. No wall-clock memo establishes
governance freshness. A read linearizes at its authoritative database revision snapshot;
it does not lock out a later review or retract an answer already delivered.

In-flight answer coalescing also includes the fresh revision and local owner/global
invalidation epochs in its process-only key. After waiting for an existing promise, the
waiter rechecks that identity before delivery. A changed or unavailable revision/epoch
causes one independent current-state origination; it never repeatedly rejoins the stale
promise or replaces another caller's current origination. Ordinary identical requests
still coalesce. Missing revision availability disables coalescing as well as cache hits.

Source-review RPCs atomically update the document metadata. The existing route clears
owner-local caches, or all scopes for a public source, after a successful review.
Deletion remains an optimization: returned errors and exceptions are reported without
provider payloads, and successful deletion is never proof of freshness. Cache-replacement
deletion errors stop the insert. These controls do not change the review's success
response when the review itself committed successfully.

An unavailable, failed or malformed revision RPC permits no cache read/write. It never
falls back to the old latest-row stamp. The `rag-cache-v26` dependency namespace also
prevents upgraded processes from reading v25 and earlier rows. Empty scopes return a
deterministic digest distinct from a failed read. Scope hashing includes all document
statuses, so decommissioning, loss of access and membership changes cannot disappear
behind an unrelated latest indexed document. Full metadata inclusion conservatively
invalidates caches after unrelated document updates.

The candidate snapshot namespaces and public-write proofs remain required. Anonymous
answer caching, `skipCache`, original-section loaders, active pilot budgets, trusted
reviewed-policy loaders/states and conflicts retain their existing exclusions. The
revision is a freshness mechanism, with no governance ranking penalty or boost.

## Application and database compatibility

The draft SQL can precede the application safely. Application code deployed before the
RPC remains cold until the compatible SQL exists. In a mixed deployment old application
replicas still use the old unsafe stamp. An approved rollout must disable the legacy
answer/search cache TTLs and drain old replicas and their in-flight work before claiming
the revocation fence is active; replace every old replica before re-enabling caches.
Rolling back to old code also requires disabled caches. Neither the local fix nor the
draft migration grants deployment or live database authority.

Each revision has O(number of scoped documents) database read/hash work and a bounded
response. Local hits add an authoritative read; shared hits add before/after reads.
Coalescing adds a read before joining and a check after waiting. No
production query-cost, latency, corpus-size or hosted behavior measurement is claimed.
An approved production rollout should measure those costs before cache re-enablement.
The ordinary eligible local-answer hit currently performs three scope-revision RPCs
(in-flight identity, request-start revision, local-hit fence); a joined waiter performs
two (before joining and after waiting). These are deliberate fresh reads, with no claim
that a scope hash is constant-time database work.

## Maintained evidence and limits

`tests/rag-cache-governance-revocation.test.ts` uses synthetic, filter-matching storage
with actual cache modules and review-route composition. It covers governance transitions,
retained cross-replica local/shared answer/search entries, returned delete errors, stale
request revisions, in-flight reads/writes, ordinary hits, the fresh-metadata refusal
control and fail-cold compatibility. The maintained cache, snapshot, owner, reviewed
policy and ranking-contract suites provide adjacent regression coverage. Actual SQL
scope/hash/grant behavior requires the isolated database probe and migration replay;
the JavaScript mock is not evidence of those database properties.

RAG impact: no retrieval/ranking/ordering behaviour change — cached artifact identity
and freshness change; retrieval inputs, scoring, comparators, source selection and
generation prompts remain unchanged. A revoked cached artifact now misses. Offline
tests do not establish hosted cache behavior, provider quality or clinical acceptance.
No provider canary, live review, migration application or deployment is implied.
