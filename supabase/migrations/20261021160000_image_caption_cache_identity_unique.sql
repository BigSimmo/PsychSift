-- Merge only after the owner's explicit yes to this database change (given 2026-10-21) and
-- only after PR #3718's migration 20261021150000.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Follow-up to the PR #3697 review: image_caption_cache was unique on
-- (owner_id, image_hash, model), so captions of the same image bytes under different
-- cache identities (another document, admission or caption context) overwrote each other.
-- The identity moves into its own column and joins the unique key so they coexist.
--
-- cache_identity is nullable: rows written before worker/image-caption-cache.ts bound an
-- identity have none, and the worker never reads them. The key uses NULLS NOT DISTINCT so a
-- null identity still counts as one value: at most one legacy row per
-- (owner_id, image_hash, model), exactly the uniqueness the old key gave them. A coalesce
-- expression index was not used because PostgREST's on_conflict can only target plain
-- columns of a unique constraint or index.
--
-- Safe to run twice: every step checks before it changes anything.

alter table public.image_caption_cache
  add column if not exists cache_identity text;

-- Backfill from the copy the worker already keeps in metadata. Each existing row is unique on
-- (owner_id, image_hash, model), so the backfill cannot create a duplicate under the new key.
update public.image_caption_cache
   set cache_identity = metadata->>'cache_identity'
 where cache_identity is null
   and jsonb_typeof(metadata->'cache_identity') = 'string';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.image_caption_cache'::regclass
       and conname = 'image_caption_cache_owner_hash_model_identity_key'
  ) then
    alter table public.image_caption_cache
      add constraint image_caption_cache_owner_hash_model_identity_key
      unique nulls not distinct (owner_id, image_hash, model, cache_identity);
  end if;
end
$$;

-- The old key's name is Postgres's default for the inline unique in 20260528001000.
alter table public.image_caption_cache
  drop constraint if exists image_caption_cache_owner_id_image_hash_model_key;
