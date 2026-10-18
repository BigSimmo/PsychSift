alter table public.documents
  add column if not exists mutation_id uuid;

update public.documents
set mutation_id = gen_random_uuid()
where mutation_id is null;

alter table public.documents
  alter column mutation_id set default gen_random_uuid(),
  alter column mutation_id set not null;

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
