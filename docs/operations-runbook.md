# Operations Runbook: Database Index Diagnostics & Pre/Post EXPLAIN Measurement Protocol

This runbook defines the operational verification and execution protocol for measuring query planner performance and diagnosing `documents` table indexing behavior before and after applying additive trigram and composite status indexes (`#102`).

---

## 1. Background & Query Planner Analysis

### The Problem (`documents_title_trgm_idx` Expression Mismatch)

The existing index `documents_title_trgm_idx` (`supabase/schema.sql`) indexes the concatenated expression:

```sql
CREATE INDEX documents_title_trgm_idx ON public.documents
  USING gin (lower(((COALESCE(title, ''::text) || ' '::text) || COALESCE(file_name, ''::text))) gin_trgm_ops);
```

Two critical production call sites filter on bare columns rather than the concatenated expression:

1. **Document Management API** (`src/app/api/documents/route.ts:193`):
   ```typescript
   query = query.or(`title.ilike.${pattern},file_name.ilike.${pattern}`);
   ```
2. **RAG Candidate Assembly** (`src/lib/rag/rag-candidate-sources.ts:975` - `fetchDocumentTitleAliasRows`):
   ```typescript
   const filters = terms.flatMap((term) => [`title.ilike.%${term}%`, `file_name.ilike.%${term}%`]).join(",");
   query = query.or(filters).eq("status", "indexed").limit(12);
   ```

Because PostgreSQL GIN expression indexes can only be matched by predicates whose AST strictly matches the indexed expression, PostgreSQL's query planner is unable to use `documents_title_trgm_idx` for `title ILIKE '%term%' OR file_name ILIKE '%term%'`. The planner therefore degrades to a sequential scan (`Seq Scan on public.documents`) across all table rows.

### The Pagination Query Pattern

Separately, `src/lib/search-scope.ts:311-320` executes paged queries (page size `documentScopeQueryPageSize` = 1000):

```typescript
documentQuery = documentQuery
  .eq("status", "indexed")
  .order("id", { ascending: true })
  .range(offset, Math.min(offset + documentScopeQueryPageSize - 1, maxResolvedDocuments - 1));
```

Without a composite index on `(status, id)`, PostgreSQL uses the single-column `documents_status_idx` and executes an in-memory or on-disk sort for `ORDER BY id`.

---

## 2. Canary-Gated Retraction & Invariant Notice

> [!WARNING]
> **Canary-Gated RAG Boundary**:
> `fetchDocumentTitleAliasRows` (`src/lib/rag/rag-candidate-sources.ts:975`) executes an unordered `.limit(12)`.
> In PostgreSQL, an unordered `LIMIT` has no deterministic selection guarantee. Introducing an index alters query planner access paths, which can select a different set of 12 candidate documents to pass downstream into retrieval and synthesis.
> Consequently, applying additive indexes to production is **canary-gated** and requires full RAG golden evaluation (`eval:retrieval:quality`) before promotion.

---

## 3. Pre-Index EXPLAIN Protocol (Baseline Measurement)

Before applying additive indexes, the operator must execute the following diagnostic queries to record baseline execution plans, buffer reads, and timing.

### Diagnostic Query 1: Bare-Column ILIKE Filter (RAG & API Path)

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, title, file_name, status, updated_at
FROM public.documents
WHERE (title ILIKE '%clozapine%' OR file_name ILIKE '%clozapine%')
  AND status = 'indexed'
LIMIT 12;
```

**Expected Pre-Index Plan:**

- **Node**: `Seq Scan on public.documents`
- **Filter**: `((status = 'indexed'::text) AND ((title ~~* '%clozapine%'::text) OR (file_name ~~* '%clozapine%'::text)))`
- **Buffers**: High `shared hit` + `shared read` proportional to table block count.
- **Cost / Time**: High relative execution duration as all blocks must be scanned.

### Diagnostic Query 2: Paged Status & ID Query

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, title, file_name, metadata
FROM public.documents
WHERE status = 'indexed'
ORDER BY id
LIMIT 1000;
```

**Expected Pre-Index Plan:**

- **Node**: `Bitmap Heap Scan` / `Index Scan` using `documents_status_idx` followed by an explicit `Sort` node (`Sort Method: top-N heapsort` or `quicksort`).

---

## 4. Additive Index Construction Procedure

On a live/busy PostgreSQL instance, indexes must be created concurrently outside transaction blocks to prevent exclusive table locks:

```sql
-- Step 1: Pre-create bare column trigram indexes concurrently
CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_title_bare_trgm_idx
  ON public.documents USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_file_name_bare_trgm_idx
  ON public.documents USING gin (file_name gin_trgm_ops);

-- Step 2: Pre-create composite status + id index concurrently
CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_status_id_idx
  ON public.documents (status, id);
```

### Verification of Index Readiness:

```sql
SELECT
  c.relname AS index_name,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  pg_size_pretty(pg_relation_size(c.oid)) AS index_size
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN (
  'documents_title_bare_trgm_idx',
  'documents_file_name_bare_trgm_idx',
  'documents_status_id_idx'
);
```

Ensure `is_valid = true` and `is_ready = true` for all three indexes.

### Statistics Update:

```sql
ANALYZE public.documents;
```

---

## 5. Post-Index EXPLAIN Protocol (Verification Measurement)

Re-run the exact diagnostic queries to verify that the query planner selects the additive indexes.

### Post-Index Query 1 Measurement

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, title, file_name, status, updated_at
FROM public.documents
WHERE (title ILIKE '%clozapine%' OR file_name ILIKE '%clozapine%')
  AND status = 'indexed'
LIMIT 12;
```

**Expected Post-Index Plan:**

- **Node**: `Bitmap Heap Scan on public.documents`
- **Recheck Cond**: `((title ~~* '%clozapine%'::text) OR (file_name ~~* '%clozapine%'::text))`
- **Filter**: `(status = 'indexed'::text)`
- **Inner Nodes**: `BitmapOr` combining:
  - `Bitmap Index Scan on documents_title_bare_trgm_idx`
  - `Bitmap Index Scan on documents_file_name_bare_trgm_idx`
- **Metric Verification**: Substantially lower buffer hits/reads, sub-millisecond planning and execution latency.

### Post-Index Query 2 Measurement

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT id, title, file_name, metadata
FROM public.documents
WHERE status = 'indexed'
ORDER BY id
LIMIT 1000;
```

**Expected Post-Index Plan:**

- **Node**: `Index Scan using documents_status_id_idx on public.documents`
- **Metric Verification**: Zero separate `Sort` node; scan streams rows directly in pre-sorted key order.

---

## 6. Rollback Sequence

If canary evaluations detect plan regressions:

1. **Phase A (Retract Monitoring)**: Update `search_schema_health()` to remove the indexes from `required_indexes`.
2. **Phase B (Drop Concurrently)**:
   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS public.documents_title_bare_trgm_idx;
   DROP INDEX CONCURRENTLY IF EXISTS public.documents_file_name_bare_trgm_idx;
   DROP INDEX CONCURRENTLY IF EXISTS public.documents_status_id_idx;
   ```
3. **Phase C (Reconcile Repo & Drift)**: Remove schema definitions from `supabase/schema.sql` and regenerate `supabase/drift-manifest.json`.
