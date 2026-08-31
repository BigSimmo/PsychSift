-- Retire the duplicate Edge processor. Core ingestion remains worker/main.ts;
-- indexing-v3-agent remains the bounded enrichment processor.
revoke execute on function public.invoke_ingestion_worker(integer) from public, anon, authenticated, service_role;
drop function if exists public.invoke_ingestion_worker(integer);

-- Completion must observe only the document's exact active generation, or
-- positively identified legacy rows when no generation metadata exists.
create or replace view public.document_strict_gate_status
with (security_invoker = true)
as
with artifact_counts as (
  select
    d.id as document_id,
    d.owner_id,
    d.status as document_status,
    d.updated_at as document_updated_at,
    coalesce(d.metadata->>'enrichment_status', 'pending') as enrichment_status,
    coalesce(d.metadata->>'indexing_v3_agent_status', 'pending') as indexing_v3_agent_status,
    coalesce(q.extraction_quality, 'unknown') as quality_extraction_quality,
    coalesce(q.quality_score, 0)::real as quality_score,
    (
      select count(*)::integer
      from public.document_sections s
      where s.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and s.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and s.index_generation_id is null
          )
        )
    ) as sections,
    (
      select count(*)::integer
      from public.document_memory_cards m
      where m.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and m.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and m.index_generation_id is null
          )
        )
    ) as memory_cards,
    (
      select count(*)::integer
      from public.document_labels l
      where l.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and l.metadata->>'index_generation_id' = d.index_generation_id::text
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and l.metadata->>'index_generation_id' is null
          )
        )
        and (
          lower(l.source) = 'generated'
          or l.metadata->>'source' = 'generated'
          or l.metadata->>'generated_by' = 'indexing-v3-agent'
          or lower(coalesce(l.metadata->>'generation_source', '')) = 'indexing_v3_agent_parsed_artifacts'
        )
    ) as generated_labels,
    (
      select count(*)::integer
      from public.document_index_units u
      where u.document_id = d.id
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and u.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and u.index_generation_id is null
          )
        )
    ) as index_units,
    exists (
      select 1
      from public.document_embedding_fields f
      where f.document_id = d.id
        and f.field_type = 'document_title'
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and f.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and f.index_generation_id is null
          )
        )
      limit 1
    ) as title_embedding,
    exists (
      select 1
      from public.document_embedding_fields f
      where f.document_id = d.id
        and f.field_type = 'document_summary'
        and (
          (
            d.index_generation_id is not null
            and d.metadata->>'index_generation_id' = d.index_generation_id::text
            and f.index_generation_id = d.index_generation_id
          )
          or (
            d.index_generation_id is null
            and not (coalesce(d.metadata, '{}'::jsonb) ? 'index_generation_id')
            and f.index_generation_id is null
          )
        )
      limit 1
    ) as summary_embedding
  from public.documents d
  left join public.document_index_quality q on q.document_id = d.id
),
gate as (
  select
    artifact_counts.*,
    array_remove(array[
      case when sections > 0 then null else 'sections' end,
      case when memory_cards > 0 then null else 'memory_cards' end,
      case when generated_labels > 0 then null else 'generated_labels' end,
      case when index_units > 0 then null else 'index_units' end,
      case when title_embedding then null else 'title_embedding' end,
      case when summary_embedding then null else 'summary_embedding' end
    ], null)::text[] as missing
  from artifact_counts
)
select
  document_id,
  owner_id,
  document_status,
  document_updated_at,
  enrichment_status,
  indexing_v3_agent_status,
  quality_extraction_quality,
  quality_score,
  sections,
  memory_cards,
  generated_labels,
  index_units,
  title_embedding,
  summary_embedding,
  missing,
  cardinality(missing) = 0 as gate_passed,
  jsonb_build_object(
    'sections', sections,
    'memory_cards', memory_cards,
    'generated_labels', generated_labels,
    'index_units', index_units
  ) as counts,
  jsonb_build_object(
    'title_embedding', title_embedding,
    'summary_embedding', summary_embedding
  ) as presence
from gate;

revoke all on table public.document_strict_gate_status from public, anon, authenticated;
grant select on table public.document_strict_gate_status to service_role;
