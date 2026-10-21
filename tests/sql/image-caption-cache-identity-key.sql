-- Disposable database only. Proves #3726's image_caption_cache key
-- unique nulls not distinct (owner_id, image_hash, model, cache_identity): two legacy rows with
-- a null identity for the same owner/hash/model conflict, while distinct identities coexist.
-- Requires migration 20261021160000. Synthetic rows; rolled back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;

insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');

-- Distinct identities for the same owner/hash/model coexist, alongside one legacy null row.
insert into public.image_caption_cache(owner_id, image_hash, model, caption, cache_identity) values
  ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-x', 'Caption A', 'identity-a'),
  ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-x', 'Caption B', 'identity-b'),
  ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-x', 'Legacy', null);
select pg_temp.assert_true((select count(*) from public.image_caption_cache where image_hash = 'hash-1') = 3,
  'distinct identities and one legacy row must coexist');

-- A second legacy null-identity row for the same owner/hash/model conflicts.
do $$
begin
  begin
    insert into public.image_caption_cache(owner_id, image_hash, model, caption, cache_identity)
    values ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-x', 'Legacy 2', null);
    raise exception 'a second null-identity row for the same owner/hash/model must conflict';
  exception when unique_violation then null;
  end;
end $$;

-- The same identity twice also conflicts.
do $$
begin
  begin
    insert into public.image_caption_cache(owner_id, image_hash, model, caption, cache_identity)
    values ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-x', 'Dup', 'identity-a');
    raise exception 'a duplicate identity must conflict';
  exception when unique_violation then null;
  end;
end $$;

-- The worker's upsert target resolves against the new key and updates in place.
insert into public.image_caption_cache(owner_id, image_hash, model, caption, cache_identity)
values ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-x', 'Caption A2', 'identity-a')
on conflict (owner_id, image_hash, model, cache_identity) do update set caption = excluded.caption;
select pg_temp.assert_true((select caption from public.image_caption_cache where cache_identity = 'identity-a') = 'Caption A2',
  'the upsert on the new key must update the existing identity row');

-- Null legacy rows are still per owner and per model.
insert into public.image_caption_cache(owner_id, image_hash, model, caption, cache_identity) values
  ('22222222-2222-4222-8222-222222222222', 'hash-1', 'model-x', 'Other owner legacy', null),
  ('11111111-1111-4111-8111-111111111111', 'hash-1', 'model-y', 'Other model legacy', null);

-- The old three-column key is gone.
select pg_temp.assert_true(not exists (select 1 from pg_constraint
  where conrelid = 'public.image_caption_cache'::regclass and conname = 'image_caption_cache_owner_id_image_hash_model_key'),
  'the old (owner_id, image_hash, model) key must be dropped');

\echo IMAGE_CAPTION_CACHE_IDENTITY_KEY_SQL_PASS: null identities conflict, distinct identities coexist
rollback;
