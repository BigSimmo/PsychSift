-- Merge only after the owner's explicit yes to this database change, by the owner pressing Merge.
-- Follow-up to 20261025150000 (#2, approved 25 Oct 2026, docs/decisions/2026-10-25-audit-database-fixes.md).
-- That migration made document_admission_events.staging_owner_id nullable and let an administrator
-- record hold null account ids, so deleting the account can clear them. A CHECK cannot tell an
-- insert from that update, so this trigger keeps new records as strict as before: every new
-- record names its account, and an administrator record names its administrator.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.guard_document_admission_event_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- staging_owner_id is nullable only so account deletion can clear it; a new record must still
  -- name its account, and an administrator record its administrator.
  if new.staging_owner_id is null
    or (new.actor_kind = 'administrator' and new.administrator_id is null)
  then
    raise exception 'document_admission_event_identity_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter function public.guard_document_admission_event_insert() owner to postgres;
revoke all on function public.guard_document_admission_event_insert() from public, anon, authenticated, service_role;

create trigger require_document_admission_event_identity
  before insert on public.document_admission_events
  for each row execute function public.guard_document_admission_event_insert();

