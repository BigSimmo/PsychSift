-- Keyword-only retrieval took 30-48 s on the live corpus because the text match was only a
-- select-list column, so every eligible public chunk was fully built before filtering.
-- Same function body as 20260901130000 with indexed text candidate probes; output is unchanged
-- because a call without an embedding can only rank text-matched rows (vector_ranked is empty).

begin;

create or replace function public.match_governed_candidate_chunks_v3(
  query_embedding extensions.vector(1536),
  query_text text,
  match_count integer,
  min_similarity double precision,
  document_filters uuid[],
  owner_filter uuid,
  include_public boolean,
  corpus_scopes text[],
  expected_site_release_id uuid,
  expected_site_release_digest text,
  expected_site_change_epoch bigint,
  site_content_domains text[]
)
returns table (
  id uuid,
  document_id uuid,
  title text,
  file_name text,
  page_number integer,
  chunk_index integer,
  section_heading text,
  content text,
  retrieval_synopsis text,
  image_ids uuid[],
  source_metadata jsonb,
  document_labels jsonb,
  document_summary text,
  similarity double precision,
  text_rank double precision,
  hybrid_score double precision,
  rrf_score double precision,
  lexical_score double precision,
  images jsonb,
  corpus_scope text,
  site_content_domain text,
  site_release_id uuid,
  site_change_epoch bigint,
  pending_exclusion_exact boolean
)
language sql
stable
security definer
set search_path = ''
set work_mem = '64MB'
as $$
  with
  admitted as (
    select
      least(greatest(coalesce(match_count, 12), 1), 96) as bounded_count,
      case
        when query_text is null or pg_catalog.btrim(query_text) = '' then null
        else pg_catalog.websearch_to_tsquery('english', query_text)
      end as tsq
    where include_public is true
      and owner_filter = '00000000-0000-0000-0000-000000000000'::uuid
      and corpus_scopes is not null
      and pg_catalog.cardinality(corpus_scopes) between 1 and 4
      and corpus_scopes <@ array[
        'uploaded_local',
        'clinical_kb_site',
        'australian_public',
        'international_supplementary'
      ]::text[]
  ),
  site_authority as (
    select
      state.active_release_id as release_id,
      state.change_epoch,
      state.served_change_epoch,
      release.release_digest
    from public.site_content_sync_state state
    join public.site_content_releases release
      on release.id = state.active_release_id
     and release.state = 'active'
     and release.target_change_epoch = state.served_change_epoch
     and release.release_digest = state.active_release_digest
    cross join admitted
    where expected_site_release_id is not null
      and expected_site_release_digest ~ '^[0-9a-f]{64}$'
      and expected_site_change_epoch is not null
      and state.initialized
      and state.active_release_id = expected_site_release_id
      and state.active_release_digest = expected_site_release_digest
      and state.change_epoch = expected_site_change_epoch
      and state.served_change_epoch <= state.change_epoch
  ),
  pending_site_set as (
    select not exists (
      select 1
      from public.site_content_public_records record
      left join public.site_content_sync_events event
        on event.event_sequence = record.pending_event_sequence
      where record.pending_event_sequence is not null
        and (
          event.event_sequence is null
          or event.logical_id is distinct from record.logical_id
          or event.target_publication_id is distinct from record.current_publication_id
          or event.target_change_epoch is distinct from record.head_change_epoch
          or event.target_change_epoch > site_authority.change_epoch
        )
    ) and not exists (
      select 1
      from public.site_content_public_records record
      where record.head_change_epoch > site_authority.served_change_epoch
        and (
          record.pending_event_sequence is null
          or record.head_change_epoch > site_authority.change_epoch
        )
    ) as exact
    from site_authority
  ),
  pending_site_logical_ids as (
    select record.logical_id
    from public.site_content_public_records record
    cross join site_authority
    where record.pending_event_sequence is not null
  ),
  text_match_ids as (
    -- Keep the two GIN probes separate so either index can select candidates.
    select chunk.id
    from public.document_chunks chunk
    cross join admitted
    where query_embedding is null
      and admitted.tsq is not null
      and chunk.search_tsv @@ admitted.tsq
    union
    select chunk.id
    from public.documents document
    join public.document_chunks chunk on chunk.document_id = document.id
    cross join admitted
    where query_embedding is null
      and admitted.tsq is not null
      and document.title_search_tsv @@ admitted.tsq
  ),
  document_candidates as (
    select
      chunk.id,
      document.id as document_id,
      document.title,
      document.file_name,
      chunk.page_number,
      chunk.chunk_index,
      chunk.section_heading,
      chunk.content,
      chunk.retrieval_synopsis,
      chunk.image_ids,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'source_kind', 'document',
        'source_title', document.metadata->>'source_title',
        'publisher', document.metadata->>'publisher',
        'publisher_code', document.metadata->>'publisher_code',
        'jurisdiction', document.metadata->>'jurisdiction',
        'version', document.metadata->>'version',
        'publication_date', document.metadata->>'publication_date',
        'review_date', document.metadata->>'review_date',
        'uploaded_at', document.metadata->>'uploaded_at',
        'indexed_at', document.metadata->>'indexed_at',
        'corpus_scope', document.metadata->>'corpus_scope',
        'source_role', document.metadata->>'source_role',
        'content_mode', document.metadata->>'content_mode',
        'source_catalogue_key', document.metadata->>'source_catalogue_key',
        'source_policy_version', document.metadata->>'source_policy_version',
        'canonical_url', document.metadata->>'canonical_url',
        'effective_date', document.metadata->>'effective_date',
        'expiry_date', document.metadata->>'expiry_date',
        'supersedes_document_id', document.metadata->>'supersedes_document_id',
        'superseded_by_document_id', document.metadata->>'superseded_by_document_id',
        'retrieved_at', document.metadata->>'retrieved_at',
        'content_hash', document.metadata->>'content_hash',
        'change_state', document.metadata->>'change_state',
        'licence_policy', document.metadata->>'licence_policy',
        'document_status', document.metadata->>'document_status',
        'clinical_validation_status', document.metadata->>'clinical_validation_status',
        'extraction_quality', document.metadata->>'extraction_quality'
      )) as source_metadata,
      coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('id', label.id, 'label', label.label, 'label_type', label.label_type)
            order by label.label_type, label.label, label.id
          )
          from public.document_labels label
          where label.document_id = document.id
        ),
        '[]'::jsonb
      ) as document_labels,
      (
        select summary.summary
        from public.document_summaries summary
        where summary.document_id = document.id
        order by summary.created_at desc, summary.id
        limit 1
      ) as document_summary,
      case
        when query_embedding is null then 0::double precision
        else (1 - (chunk.embedding OPERATOR(extensions.<=>) query_embedding))::double precision
      end as similarity,
      case
        when admitted.tsq is null then 0::double precision
        else pg_catalog.ts_rank_cd(chunk.search_tsv, admitted.tsq)::double precision
      end as text_rank,
      coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', image.id,
              'page_number', image.page_number,
              'storage_path', image.storage_path,
              'caption', image.caption
            )
            order by image.id
          )
          from public.document_images image
          where image.id = any(chunk.image_ids)
        ),
        '[]'::jsonb
      ) as images,
      document.metadata->>'corpus_scope' as corpus_scope,
      (
        admitted.tsq is not null
        and (chunk.search_tsv @@ admitted.tsq or document.title_search_tsv @@ admitted.tsq)
      ) as text_matched
    from public.document_chunks chunk
    join public.documents document on document.id = chunk.document_id
    cross join admitted
    left join text_match_ids matched on matched.id = chunk.id
    where document.owner_id is null
      -- Text-only calls (match_document_chunks_text_v3) can only return text-matched rows, so
      -- filter here, before the per-row labels, summary, images and jsonb work, instead of
      -- building every eligible public chunk first. Hybrid calls with an embedding are unchanged.
      and (query_embedding is not null or matched.id is not null)
      and document.status = 'indexed'
      and public.is_committed_document_generation(chunk.index_generation_id, document.index_generation_id)
      and (document_filters is null or document.id = any(document_filters))
      and document.metadata->>'corpus_scope' = any(corpus_scopes)
      and document.metadata->>'corpus_scope' = 'australian_public'
      and document.metadata->>'source_kind' = 'document'
      and document.metadata->'public_corpus' = 'true'::jsonb
      and document.metadata->>'content_mode' = 'indexed_content'
      and document.metadata->>'document_status' = 'current'
      and coalesce(document.metadata->>'change_state', '') in ('changed', 'unchanged')
      and document.metadata->>'licence_policy' = 'public_index_permitted'
      and nullif(document.metadata->>'source_catalogue_key', '') is not null
      and nullif(document.metadata->>'source_policy_version', '') is not null
      and nullif(document.metadata->>'publication_approval_id', '') is not null
      and nullif(document.metadata->>'publication_manifest_digest', '') is not null
  ),
  site_candidates as (
    select
      record.logical_chunk_id as id,
      record.logical_document_id as document_id,
      record.record->>'title' as title,
      record.record->>'route' as file_name,
      null::integer as page_number,
      0::integer as chunk_index,
      record.record->>'domain' as section_heading,
      record.normalized_text as content,
      null::text as retrieval_synopsis,
      '{}'::uuid[] as image_ids,
      pg_catalog.jsonb_build_object(
        'corpus_scope', 'clinical_kb_site',
        'source_kind', 'registry_record',
        'source_role', record.record->>'sourceRole',
        'content_mode', 'indexed_content',
        'source_title', record.record->>'title',
        'version', record.record->>'publicationVersion',
        'document_status', record.record->>'sourceStatus',
        'clinical_validation_status', record.record->>'validationStatus',
        'extraction_quality', 'good',
        'content_hash', record.record->>'contentHash',
        'site_content_lineage', record.record->'sourceLineage'
      ) as source_metadata,
      '[]'::jsonb as document_labels,
      null::text as document_summary,
      case
        when query_embedding is null or record.embedding is null then 0::double precision
        else (1 - (record.embedding OPERATOR(extensions.<=>) query_embedding))::double precision
      end as similarity,
      case
        when admitted.tsq is null then 0::double precision
        else pg_catalog.ts_rank_cd(
          pg_catalog.to_tsvector(
            'english',
            coalesce(record.record->>'title', '') || ' ' || record.normalized_text
          ),
          admitted.tsq
        )::double precision
      end as text_rank,
      '[]'::jsonb as images,
      'clinical_kb_site'::text as corpus_scope,
      (
        admitted.tsq is not null
        and pg_catalog.to_tsvector(
          'english',
          coalesce(record.record->>'title', '') || ' ' || record.normalized_text
        ) @@ admitted.tsq
      ) as text_matched,
      record.record->>'domain' as site_content_domain,
      site_authority.release_id as site_release_id,
      site_authority.change_epoch as site_change_epoch
    from public.site_content_release_records record
    cross join admitted
    cross join site_authority
    cross join pending_site_set
    where 'clinical_kb_site' = any(corpus_scopes)
      and record.release_id = site_authority.release_id
      and pending_site_set.exact
      and (document_filters is null or record.logical_document_id = any(document_filters))
      and record.public_visible
      and not record.tombstone
      and pg_catalog.jsonb_typeof(record.record) = 'object'
      and record.record->>'version' = 'site-content-record-v1'
      and record.record->>'access' = 'public'
      and record.record->>'logicalId' = record.logical_id
      and record.record->>'validationStatus' in ('locally_reviewed', 'approved')
      and record.record->>'sourceStatus' in ('current', 'review_due')
      and record.record->>'domain' in (
        'services', 'forms', 'medications', 'differentials', 'specifiers', 'dsm',
        'formulation', 'therapies', 'dictionary', 'factsheets', 'calculators', 'tools'
      )
      and (
        site_content_domains is null
        or (
          pg_catalog.cardinality(site_content_domains) between 1 and 12
          and site_content_domains <@ array[
            'services', 'forms', 'medications', 'differentials', 'specifiers', 'dsm',
            'formulation', 'therapies', 'dictionary', 'factsheets', 'calculators', 'tools'
          ]::text[]
          and record.record->>'domain' = any(site_content_domains)
        )
      )
      and not exists (
        select 1
        from pending_site_logical_ids pending
        where pending.logical_id = record.logical_id
      )
  ),
  combined as (
    select
      document.*,
      null::text as site_content_domain,
      null::uuid as site_release_id,
      null::bigint as site_change_epoch
    from document_candidates document
    union all
    select * from site_candidates
  ),
  vector_ranked as (
    select
      combined.id,
      combined.corpus_scope,
      row_number() over (order by combined.similarity desc, combined.id) as vector_rank,
      null::bigint as text_match_rank
    from combined
    where query_embedding is not null
      and combined.similarity >= greatest(coalesce(min_similarity, 0.12), 0)
    order by combined.similarity desc, combined.id
    limit (select greatest(bounded_count * 6, 48) from admitted)
  ),
  text_ranked as (
    select
      combined.id,
      combined.corpus_scope,
      null::bigint as vector_rank,
      row_number() over (order by combined.text_rank desc, combined.id) as text_match_rank
    from combined
    where combined.text_matched
    order by combined.text_rank desc, combined.id
    limit (select greatest(bounded_count * 6, 48) from admitted)
  ),
  rank_positions as (
    select
      positions.id,
      positions.corpus_scope,
      min(positions.vector_rank) as vector_rank,
      min(positions.text_match_rank) as text_match_rank
    from (
      select * from vector_ranked
      union all
      select * from text_ranked
    ) positions
    group by positions.id, positions.corpus_scope
  ),
  ranked as (
    select
      combined.*,
      ((combined.similarity * 0.65) + (least(combined.text_rank, 1) * 0.35))::double precision as hybrid_score,
      (
        coalesce(1.0 / (60 + rank_positions.vector_rank), 0)
        + coalesce(1.0 / (60 + rank_positions.text_match_rank), 0)
      )::double precision as rrf_score
    from combined
    join rank_positions using (id, corpus_scope)
  )
  select
    ranked.id,
    ranked.document_id,
    ranked.title,
    ranked.file_name,
    ranked.page_number,
    ranked.chunk_index,
    ranked.section_heading,
    ranked.content,
    ranked.retrieval_synopsis,
    ranked.image_ids,
    ranked.source_metadata,
    ranked.document_labels,
    ranked.document_summary,
    ranked.similarity,
    ranked.text_rank,
    ranked.hybrid_score,
    ranked.rrf_score,
    least(ranked.text_rank, 1)::double precision as lexical_score,
    ranked.images,
    ranked.corpus_scope,
    ranked.site_content_domain,
    ranked.site_release_id,
    ranked.site_change_epoch,
    true as pending_exclusion_exact
  from ranked
  order by ranked.hybrid_score desc, ranked.rrf_score desc, ranked.id
  limit (select bounded_count from admitted);
$$;

revoke all on function public.match_governed_candidate_chunks_v3(
  extensions.vector, text, integer, double precision, uuid[], uuid, boolean, text[], uuid, text, bigint, text[]
) from public, anon, authenticated, service_role;

alter function public.match_governed_candidate_chunks_v3(
  extensions.vector, text, integer, double precision, uuid[], uuid, boolean, text[], uuid, text, bigint, text[]
) owner to postgres;

commit;
