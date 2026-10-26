-- ============================================================================
-- Operator export: the exact current public population, for publication planning
-- Read-only · site-content initial adoption · feeds build-site-content-dynamic-input.ts
-- ============================================================================
--
-- PURPOSE
-- `scripts/sync-site-content-corpus.ts` plans a publication from three inputs. Two of them are
-- derivable offline; the third, `existingReleaseRecords`, is the exact population the public site
-- serves today, and it can only come from `public.site_content_release_records`.
--
-- WHY THIS IS A SQL FILE YOU RUN, AND NOT A SCRIPT THAT CONNECTS
-- `service_role` has no SELECT on any of the six site-content control-plane tables. Verified
-- 2026-09-18 with has_table_privilege():
--
--   site_content_release_records   service_role SELECT = false
--   site_content_releases          service_role SELECT = false
--   site_content_sync_state        service_role SELECT = false
--   site_content_publications      service_role SELECT = false
--   site_content_sync_events       service_role SELECT = false
--   clinical_registry_records      service_role SELECT = TRUE
--
-- That is deliberate: the control plane is reached through its RPCs, not by a key an application
-- holds. So the privileged read stays with an operator, in the Supabase SQL editor, and the
-- planning script consumes the file it produces. It also keeps the runbook's own rule intact --
-- "Initial adoption is deliberately ordered and must not be compressed into one privileged
-- script" (docs/site-content-sync-runbook.md).
--
-- EXECUTION
-- Read-only. Nothing here writes, locks, or creates anything. Run it in the Supabase SQL editor
-- against the target project, save the single returned JSON value to a file, and pass that file to
--
--   node scripts/run-tsx.mjs scripts/build-site-content-dynamic-input.ts \
--     --population <that-file.json> --out dynamic-input.json
--
-- The export is bounded: it emits the active release only, and it carries no embeddings (the
-- epoch-zero release stores none -- embedding_model is 'bootstrap-no-embedding' for all 843 rows),
-- so the file stays small. If a future release does carry vectors, add `'embedding', r.embedding`
-- to the object below and expect the file to grow by roughly 1536 floats per record.
--
-- WHAT IT DOES NOT DO
-- It does not decide anything. It is a faithful projection of what is published, in the exact
-- shape `ExistingSiteContentReleaseRecord` declares in src/lib/site-content/site-content-sync.ts.
-- Every field is copied; none is derived.
-- ============================================================================

select jsonb_pretty(jsonb_build_object(
  'version', 'site-content-population-export-v1',
  'exportedAt', to_jsonb(now()),
  'activeReleaseId', to_jsonb(s.active_release_id),
  'activeReleaseDigest', to_jsonb(s.active_release_digest),
  'changeEpoch', to_jsonb(s.change_epoch::text),
  'servedChangeEpoch', to_jsonb(s.served_change_epoch::text),
  'initialized', to_jsonb(s.initialized),
  'recordCount', to_jsonb(count(r.*)),
  -- Exactly ExistingSiteContentReleaseRecord. `embedding` is emitted as null rather than omitted,
  -- because the planner's reuse decision distinguishes "no vector" from "field absent".
  'existingReleaseRecords', coalesce(
    jsonb_agg(
      jsonb_build_object(
        'logicalId', r.logical_id,
        'targetPublicationId', r.target_publication_id,
        'publicationFingerprint', r.publication_fingerprint,
        'contentHash', r.content_hash,
        'governanceFingerprint', r.governance_fingerprint,
        'lineageFingerprint', r.lineage_fingerprint,
        'publicMetadataFingerprint', r.public_metadata_fingerprint,
        'normalizedText', r.normalized_text,
        'documentId', r.logical_document_id,
        'chunkId', r.logical_chunk_id,
        'embeddingModel', r.embedding_model,
        'embeddingDimensions', r.embedding_dimensions,
        'embeddingFingerprint', r.embedding_fingerprint,
        'embedding', null
      )
      order by r.logical_id
    ) filter (where r.release_id is not null),
    '[]'::jsonb
  )
)) as population_export
from public.site_content_sync_state s
left join public.site_content_release_records r
  on r.release_id = s.active_release_id
 and r.tombstone is not true
group by s.active_release_id, s.active_release_digest, s.change_epoch, s.served_change_epoch, s.initialized;

-- ----------------------------------------------------------------------------
-- Sanity, to run alongside. `recordCount` above must equal `expected_record_count`, and the digest
-- must equal what the reader reports, or the export describes a population that is already moving
-- and must not be planned against.
-- ----------------------------------------------------------------------------
select r.id                       as release_id,
       r.state,
       r.expected_record_count,
       count(rr.*)                as actual_records,
       left(r.release_digest, 16) as release_digest_16
from public.site_content_releases r
left join public.site_content_release_records rr
  on rr.release_id = r.id and rr.tombstone is not true
group by r.id, r.state, r.expected_record_count, r.release_digest
order by r.created_at desc;
