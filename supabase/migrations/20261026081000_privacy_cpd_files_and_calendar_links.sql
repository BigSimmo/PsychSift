-- Merge only after the owner's explicit yes to this database change, by the owner pressing Merge.
-- Never edit this file once it is on main: merging it applies it to the live database.
--
-- Privacy audit, 26 Oct 2026 (stream S8). Two changes, no other table or function changes:
--
--   SB-05  Deleting an account removed its CPD evidence rows but left the certificate files in
--          the private cme-private-evidence bucket, with nothing left that pointed at them. A row
--          leaving public.cme_evidence now queues its file for the existing storage cleaner, in
--          the same transaction. The cleaner removes it on its next run.
--
--   DB-04  A doctor's live roster calendar address (an .ics link, usually a secret link with a
--          token in it) was stored as plain text. It is now also kept encrypted in Supabase Vault,
--          and the app reads it back only through a service-role function that checks the owner.
--          The list screen uses a new url_host column (the host name only) and never needs the
--          address. A link added through the new roster_calendar_link_add function is stored
--          encrypted only: its plain-text column is left empty. This is step 1 of 2: the plain
--          text of links that already exist stays for now, so the app that is still running during
--          the deploy keeps working. Step 2, a separate later change, empties and then drops the
--          column once this app version is live.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- SB-05 ---------------------------------------------------------------------------------------
-- Rows only ever leave cme_evidence by cascade (service_role holds select and insert only), which
-- in practice means the account was deleted. The job names neither the owner nor the evidence id:
-- both rows are being deleted in this same statement, so a foreign key to either would refuse the
-- insert, and the cleaner needs only the bucket and path. A file already queued by
-- cme_remove_evidence keeps its existing job instead of getting a second one, and that job lets
-- go of the evidence id here rather than in the foreign key's own SET NULL, which can run after
-- the owner_id SET NULL on the same job and make that update fail its evidence-id check.
create function public.cme_evidence_queue_file_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.storage_cleanup_jobs j
    where j.cme_evidence_id = old.id
       or (j.document_bucket = 'cme-private-evidence' and j.document_paths = array[old.storage_path])
  ) then
    insert into public.storage_cleanup_jobs(owner_id, cme_evidence_id, document_bucket, document_paths,
      image_bucket, image_paths, metadata)
    values (null, null, 'cme-private-evidence', array[old.storage_path], 'cme-private-evidence', '{}',
      jsonb_build_object('operation', 'cme_evidence_deleted'));
  end if;
  update public.storage_cleanup_jobs set cme_evidence_id = null where cme_evidence_id = old.id;
  return old;
end $$;
alter function public.cme_evidence_queue_file_cleanup() owner to postgres;
revoke all on function public.cme_evidence_queue_file_cleanup() from public, anon, authenticated, service_role;

create trigger cme_evidence_queue_file_cleanup before delete on public.cme_evidence
  for each row execute function public.cme_evidence_queue_file_cleanup();

-- DB-04 ---------------------------------------------------------------------------------------
alter table public.roster_calendar_links
  add column url_secret_id uuid,
  add column url_host text check (url_host is null or char_length(url_host) <= 253);

-- Seal the links that already exist (at most 3 per doctor), before the triggers exist. The host is
-- the name only (an IPv6 literal keeps its brackets), never the path or the query string.
update public.roster_calendar_links
set url_secret_id = vault.create_secret(url, null, 'roster calendar link'),
    url_host = lower(substring(url from '^https://(\[[0-9A-Fa-f:.]+\]|[^/?#:@\[]+)'))
where url_secret_id is null;

alter table public.roster_calendar_links alter column url_secret_id set not null;
-- New links keep no plain text (roster_calendar_link_add). The existing check still applies to
-- any address that is stored.
alter table public.roster_calendar_links alter column url drop not null;

-- Keeps the encrypted copy in step with the address. The app never sets url_secret_id or
-- url_host itself; both are derived here, so a write cannot point a link at another secret.
create function public.roster_calendar_links_seal_url() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.url_secret_id := old.url_secret_id;
    new.url_host := old.url_host;
    if new.url is not distinct from old.url then return new; end if;
  end if;
  if new.url is null then return new; end if;
  if new.url_secret_id is not null and tg_op = 'UPDATE' then
    perform vault.update_secret(new.url_secret_id, new.url);
  else
    new.url_secret_id := vault.create_secret(new.url, null, 'roster calendar link');
  end if;
  new.url_host := lower(substring(new.url from '^https://(\[[0-9A-Fa-f:.]+\]|[^/?#:@\[]+)'));
  return new;
end $$;
alter function public.roster_calendar_links_seal_url() owner to postgres;
revoke all on function public.roster_calendar_links_seal_url() from public, anon, authenticated, service_role;

create trigger roster_calendar_links_seal_url before insert or update on public.roster_calendar_links
  for each row execute function public.roster_calendar_links_seal_url();

-- Removing a link, or the whole account, removes its encrypted copy too.
create function public.roster_calendar_links_drop_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.url_secret_id is not null then
    delete from vault.secrets where id = old.url_secret_id;
  end if;
  return old;
end $$;
alter function public.roster_calendar_links_drop_secret() owner to postgres;
revoke all on function public.roster_calendar_links_drop_secret() from public, anon, authenticated, service_role;

create trigger roster_calendar_links_drop_secret after delete on public.roster_calendar_links
  for each row execute function public.roster_calendar_links_drop_secret();

-- The only way the app reads an address back: the owner's own links, by id, for a server-side
-- refresh. Never returned to a browser (src/lib/roster/calendar-links.ts).
create function public.roster_calendar_link_urls(p_owner_id uuid, p_ids uuid[])
returns table (id uuid, url text)
language sql stable security definer set search_path = '' as $$
  select l.id, s.decrypted_secret
  from public.roster_calendar_links l
  join vault.decrypted_secrets s on s.id = l.url_secret_id
  where p_owner_id is not null and l.owner_id = p_owner_id and l.id = any(p_ids)
$$;
alter function public.roster_calendar_link_urls(uuid, uuid[]) owner to postgres;
revoke all on function public.roster_calendar_link_urls(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.roster_calendar_link_urls(uuid, uuid[]) to service_role;

-- The only way the app adds a link. The address is sealed by the trigger above in the same
-- statement as the insert, and the plain-text copy is emptied before the transaction commits, so
-- it is never stored. The 3-link cap (roster_limit) and the one-link-per-workplace rule (23505)
-- raise exactly as a direct insert did.
create function public.roster_calendar_link_add(p_owner_id uuid, p_url text, p_workplace text)
returns table (id uuid, url_host text, workplace text, last_fetched_at timestamptz, last_error text,
  created_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  if p_owner_id is null then raise exception 'roster_auth_required'; end if;
  insert into public.roster_calendar_links(owner_id, url, workplace)
  values (p_owner_id, p_url, p_workplace)
  returning public.roster_calendar_links.id into v_id;
  update public.roster_calendar_links l set url = null where l.id = v_id;
  return query
    select l.id, l.url_host, l.workplace, l.last_fetched_at, l.last_error, l.created_at
    from public.roster_calendar_links l where l.id = v_id;
end $$;
alter function public.roster_calendar_link_add(uuid, text, text) owner to postgres;
revoke all on function public.roster_calendar_link_add(uuid, text, text) from public, anon, authenticated;
grant execute on function public.roster_calendar_link_add(uuid, text, text) to service_role;
