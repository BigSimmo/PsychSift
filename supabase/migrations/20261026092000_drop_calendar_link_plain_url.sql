-- Privacy audit DB-04, step 2 of 2: the plain-text calendar address goes.
--
-- Step 1 (20261026081000) sealed every address in Supabase Vault and moved the app to the sealed
-- copy, keeping the plain `url` column only so the app version running during that deploy kept
-- working. This step empties and drops it. It must merge only once the step 1 app is live, which
-- never reads or writes `url`.
--
-- After this, roster_calendar_link_add seals the address itself and is the only way a link is
-- added. A link's secret and host cannot change after insert, and no two links share a secret.

-- Every link already has its sealed copy (url_secret_id is not null since step 1). Fail rather
-- than drop an address that was never sealed.
do $$
begin
  if exists (
    select 1 from public.roster_calendar_links l
    where l.url is not null
      and not exists (select 1 from vault.decrypted_secrets s
                      where s.id = l.url_secret_id and s.decrypted_secret = l.url)
  ) then
    raise exception 'roster_calendar_links: a plain-text address has no matching sealed copy';
  end if;
end $$;

drop trigger roster_calendar_links_seal_url on public.roster_calendar_links;
drop function public.roster_calendar_links_seal_url();

-- Empty first so the old values leave the live rows, then drop the column.
update public.roster_calendar_links set url = null where url is not null;
alter table public.roster_calendar_links drop column url;

alter table public.roster_calendar_links
  add constraint roster_calendar_links_url_secret_unique unique (url_secret_id);

-- The secret and host are set once, by roster_calendar_link_add, and never change.
create function public.roster_calendar_links_pin_secret() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.url_secret_id := old.url_secret_id;
  new.url_host := old.url_host;
  return new;
end $$;
alter function public.roster_calendar_links_pin_secret() owner to postgres;
revoke all on function public.roster_calendar_links_pin_secret() from public, anon, authenticated, service_role;

create trigger roster_calendar_links_pin_secret before update on public.roster_calendar_links
  for each row execute function public.roster_calendar_links_pin_secret();

-- The only way the app adds a link. The address goes straight into Vault; the table keeps only
-- the secret's id and the host name. The https and length rules of the old column check still
-- apply (check_violation, as before), and the 3-link cap (roster_limit) and the
-- one-link-per-workplace rule (23505) raise as before. A refused insert rolls the secret back
-- with it.
create or replace function public.roster_calendar_link_add(p_owner_id uuid, p_url text, p_workplace text)
returns table (id uuid, url_host text, workplace text, last_fetched_at timestamptz, last_error text,
  created_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  if p_owner_id is null then raise exception 'roster_auth_required'; end if;
  if p_url is null or p_url !~ '^https://' or char_length(p_url) > 2000 then
    raise exception 'roster_calendar_links: the address must be https and at most 2000 characters'
      using errcode = 'check_violation';
  end if;
  insert into public.roster_calendar_links(owner_id, workplace, url_secret_id, url_host)
  values (p_owner_id, p_workplace, vault.create_secret(p_url, null, 'roster calendar link'),
    lower(substring(p_url from '^https://(\[[0-9A-Fa-f:.]+\]|[^/?#:@\[]+)')))
  returning public.roster_calendar_links.id into v_id;
  return query
    select l.id, l.url_host, l.workplace, l.last_fetched_at, l.last_error, l.created_at
    from public.roster_calendar_links l where l.id = v_id;
end $$;
