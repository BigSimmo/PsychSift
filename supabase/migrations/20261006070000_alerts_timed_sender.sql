-- alerts_timed_sender.sql: the timed sender behind My Day › Alerts (follow-up to PR #3296).
-- Owner decision (5 Oct 2026, Alerts plan, rule 1): the server holds only when a Remind me note
-- is due, never its words. A row here is an owner, an opaque id the phone chose, a time, and the
-- one device to buzz (the phone that holds the words; its alert subscription endpoint).
-- The morning brief needs no queue: its time comes from the owner's saved preferences, and
-- alert_brief_sent records the one Perth day it last went out so it is sent once.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.alert_reminder_times (
  owner_id uuid not null references auth.users (id) on delete cascade,
  ref text not null check (ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  due_at timestamptz not null,
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  created_at timestamptz not null default now(),
  primary key (owner_id, ref)
);
create index alert_reminder_times_due_idx on public.alert_reminder_times (due_at);

-- The phone keeps at most 20 notes (REMIND_ME_MAX); the server keeps no more than that.
create function public.alert_reminder_times_cap() returns trigger
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 74818));
  -- An upsert that moves an existing note's time fires this trigger too; it adds nothing.
  if exists (select 1 from public.alert_reminder_times where owner_id = new.owner_id and ref = new.ref) then
    return new;
  end if;
  if (select count(*) from public.alert_reminder_times where owner_id = new.owner_id) >= 20 then
    raise exception 'alerts_limit';
  end if;
  return new;
end $$;
create trigger alert_reminder_times_cap before insert on public.alert_reminder_times
  for each row execute function public.alert_reminder_times_cap();

create table public.alert_brief_sent (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  perth_date date not null,
  sent_at timestamptz not null default now()
);

alter table public.alert_reminder_times enable row level security;
alter table public.alert_brief_sent enable row level security;
revoke all on table public.alert_reminder_times from public, anon, authenticated;
revoke all on table public.alert_brief_sent from public, anon, authenticated;
grant select, insert, update, delete on table public.alert_reminder_times to service_role;
grant select, insert, update, delete on table public.alert_brief_sent to service_role;

-- Take every reminder due by p_now and delete it in the same statement, so two app servers
-- never send the same one and nothing is kept once it has gone out.
create function public.alert_claim_due_reminders(p_now timestamptz, p_limit integer)
returns table (owner_id uuid, ref text, due_at timestamptz, endpoint text)
language sql security invoker set search_path = public, pg_catalog, pg_temp as $$
  delete from public.alert_reminder_times t
  using (
    select d.owner_id, d.ref from public.alert_reminder_times d
    where d.due_at <= p_now
    order by d.due_at
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  ) due
  where t.owner_id = due.owner_id and t.ref = due.ref
  returning t.owner_id, t.ref, t.due_at, t.endpoint;
$$;

-- True exactly once per owner per Perth day: the caller that gets true sends the brief.
create function public.alert_claim_morning_brief(p_owner_id uuid, p_perth_date date)
returns boolean
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare v_claimed uuid;
begin
  insert into public.alert_brief_sent as s (owner_id, perth_date, sent_at)
  values (p_owner_id, p_perth_date, now())
  on conflict (owner_id) do update set perth_date = excluded.perth_date, sent_at = excluded.sent_at
    where s.perth_date < excluded.perth_date
  returning s.owner_id into v_claimed;
  return v_claimed is not null;
end $$;

revoke all on function public.alert_claim_due_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.alert_claim_due_reminders(timestamptz, integer) to service_role;
revoke all on function public.alert_claim_morning_brief(uuid, date) from public, anon, authenticated;
grant execute on function public.alert_claim_morning_brief(uuid, date) to service_role;
revoke all on function public.alert_reminder_times_cap() from public, anon, authenticated;
