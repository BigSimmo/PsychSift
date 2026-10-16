-- ============================================================================
-- Operator EXPLAIN diagnostic: documents_title_trgm_idx vs bare-column ILIKE
-- Issue #102 · Latency audit findings L2-3 and L2-5
-- ============================================================================
--
-- PURPOSE:
-- Measure query execution plans on public.documents before and after applying
-- candidate bare-column GIN trigram indexes and composite status/id index.
--
-- EXECUTION:
-- Execute in an approved, read-only operator window against the target database
-- (e.g. Supabase SQL Editor or psql session).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Inventory existing indexes and scan statistics on public.documents
-- ----------------------------------------------------------------------------
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'documents'
ORDER BY indexname;

SELECT
  relname,
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND relname = 'documents'
ORDER BY indexrelname;

-- ----------------------------------------------------------------------------
-- Step 2: EXPLAIN baseline queries
-- ----------------------------------------------------------------------------

-- Query A: Concatenated expression query (matches documents_title_trgm_idx)
-- Expected: Bitmap Index Scan on documents_title_trgm_idx
EXPLAIN (ANALYZE, BUFFERS, COSTS, TIMING, VERBOSE)
SELECT id, title, file_name, status
FROM public.documents
WHERE lower(coalesce(title, '') || ' ' || coalesce(file_name, '')) ILIKE '%clozapine%'
LIMIT 12;

-- Query B: Bare-column ILIKE query (src/app/api/documents/route.ts & rag-candidate-sources.ts)
-- Current behavior: Sequential Scan on documents (expression index cannot serve bare columns)
-- With bare-column GIN indexes: BitmapOr over documents_title_bare_trgm_idx and documents_file_name_bare_trgm_idx
EXPLAIN (ANALYZE, BUFFERS, COSTS, TIMING, VERBOSE)
SELECT id, title, file_name, status
FROM public.documents
WHERE (title ILIKE '%clozapine%' OR file_name ILIKE '%clozapine%')
  AND status = 'indexed'
LIMIT 12;

-- Query C: Status filter ordered by ID (src/lib/search-scope.ts paging)
-- Current behavior: Index Scan using documents_status_idx with Sort, or Seq Scan
-- With composite index: Index Scan using documents_status_id_idx (no sort step required)
EXPLAIN (ANALYZE, BUFFERS, COSTS, TIMING, VERBOSE)
SELECT id, status, title
FROM public.documents
WHERE status = 'indexed'
ORDER BY id
LIMIT 5000;

-- ----------------------------------------------------------------------------
-- Step 3: Candidate index creation statements (for execution in operator window)
-- ----------------------------------------------------------------------------
-- Note: Must be executed concurrently outside a transaction block.
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_title_bare_trgm_idx
--   ON public.documents USING gin (title gin_trgm_ops);
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_file_name_bare_trgm_idx
--   ON public.documents USING gin (file_name gin_trgm_ops);
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS documents_status_id_idx
--   ON public.documents (status, id);
--
-- Post-creation validation:
-- SELECT indexrelname, indisvalid, indisready
-- FROM pg_index i
-- JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
-- WHERE s.relname = 'documents';

-- ----------------------------------------------------------------------------
-- Step 4: DB Advisor foreign-key index diagnostics (read-only)
-- Candidates:
--   * public.storage_cleanup_jobs(document_id)
--   * public.rag_visual_eval_cases(document_id)
--   * public.rag_visual_eval_runs(document_id)
-- ----------------------------------------------------------------------------

-- 4a: Inspect existing indexes on foreign-key advisor candidate tables
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('storage_cleanup_jobs', 'rag_visual_eval_cases', 'rag_visual_eval_runs')
ORDER BY tablename, indexname;

-- 4b: Check index scan statistics and unused/low-scan indexes via pg_stat_user_indexes
SELECT
  s.schemaname,
  s.relname AS table_name,
  s.indexrelname AS index_name,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public'
  AND s.relname IN (
    'documents',
    'storage_cleanup_jobs',
    'rag_visual_eval_cases',
    'rag_visual_eval_runs'
  )
ORDER BY s.relname, s.idx_scan ASC, s.indexrelname;

-- 4c: Verify whether foreign-key columns referencing public.documents(id) are covered by a leading index column
SELECT
  c.conrelid::regclass AS referencing_table,
  c.conname AS constraint_name,
  a.attname AS fk_column,
  EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND i.indisvalid
      AND i.indkey[0] = a.attnum
  ) AS has_leading_column_index
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid
 AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND c.confrelid = 'public.documents'::regclass
  AND c.conrelid IN (
    'public.storage_cleanup_jobs'::regclass,
    'public.rag_visual_eval_cases'::regclass,
    'public.rag_visual_eval_runs'::regclass
  )
ORDER BY referencing_table::text, fk_column;

