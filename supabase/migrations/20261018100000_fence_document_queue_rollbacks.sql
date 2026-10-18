set local lock_timeout = '5s';
set local statement_timeout = '5min';

alter table public.documents
  add column if not exists mutation_id uuid not null default gen_random_uuid();

create or replace function public.set_document_mutation_id()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  new.mutation_id = gen_random_uuid();
  return new;
end;
$$;

drop trigger if exists documents_mutation_id on public.documents;
create trigger documents_mutation_id
before update on public.documents
for each row execute function public.set_document_mutation_id();
