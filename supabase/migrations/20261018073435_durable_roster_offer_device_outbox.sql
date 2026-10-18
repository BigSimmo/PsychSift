-- Draft only. Merge applies this to production: specific owner approval and an approved window required.
-- At-least-once: a crash after push acceptance but before acknowledgement can duplicate that device.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.roster_offer_alert_outbox (
  open_shift_id uuid primary key references public.roster_open_shifts(id) on delete cascade,
  service_id uuid not null references public.on_call_services(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  initialized boolean not null default false,
  completed_at timestamptz,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz
);
create index roster_offer_alert_due on public.roster_offer_alert_outbox(available_at,created_at)
  where completed_at is null;
create table public.roster_offer_alert_devices (
  open_shift_id uuid not null references public.roster_offer_alert_outbox(open_shift_id) on delete cascade,
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null default 'pending' check (outcome in ('pending','sent','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  primary key(open_shift_id,subscription_id)
);
alter table public.roster_offer_alert_outbox owner to postgres;
alter table public.roster_offer_alert_devices owner to postgres;
alter table public.roster_offer_alert_outbox enable row level security;
alter table public.roster_offer_alert_devices enable row level security;
revoke all on public.roster_offer_alert_outbox, public.roster_offer_alert_devices from public,anon,authenticated;
grant all on public.roster_offer_alert_outbox, public.roster_offer_alert_devices to service_role;

-- Idempotency keys are inserted in the same transaction as open.post. Never enqueue old posts/backfill staff.
create function public.enqueue_roster_offer_alert() returns trigger
language plpgsql security invoker set search_path = public,pg_temp as $$
begin
  insert into public.roster_offer_alert_outbox(open_shift_id,service_id,actor_id,expires_at)
  select o.id,o.service_id,new.posted_by,least(o.starts_at,now()+interval '6 hours')
  from public.roster_open_shifts o
  where o.id=new.open_shift_id and o.service_id=new.service_id and o.status='open'
    and o.starts_at>now() and new.posted_by is not null
  on conflict do nothing;
  return new;
end $$;
alter function public.enqueue_roster_offer_alert() owner to postgres;
revoke all on function public.enqueue_roster_offer_alert() from public,anon,authenticated;
grant execute on function public.enqueue_roster_offer_alert() to service_role;
create trigger enqueue_roster_offer_alert after insert on public.roster_open_post_keys
  for each row execute function public.enqueue_roster_offer_alert();

-- Service-only, invoker privileges. All operations after claim are fenced by an expiring random token.
create function public.roster_offer_alert_work(
  p_operation text, p_open_shift_id uuid default null, p_token uuid default null,
  p_owner_ids uuid[] default null, p_subscription_id uuid default null, p_outcome text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_event public.roster_offer_alert_outbox; v_result jsonb; v_now timestamptz := clock_timestamp();
begin
  if p_operation='claim' then
    -- Bounded TTL cleanup includes completed events and cascades device receipts.
    delete from public.roster_offer_alert_outbox where open_shift_id in (
      select open_shift_id from public.roster_offer_alert_outbox where expires_at<=v_now limit 500
    );
    select q.* into v_event from public.roster_offer_alert_outbox q
      join public.roster_open_shifts o on o.id=q.open_shift_id and o.service_id=q.service_id
      where q.completed_at is null and q.expires_at>v_now and q.available_at<=v_now
        and (q.lease_until is null or q.lease_until<=v_now) and o.status='open'
        and (p_open_shift_id is null or q.open_shift_id=p_open_shift_id)
      order by q.available_at,q.created_at for update of q skip locked limit 1;
    if not found then return null; end if;
    update public.roster_offer_alert_outbox set lease_token=gen_random_uuid(),lease_until=v_now+interval '10 minutes'
      where open_shift_id=v_event.open_shift_id returning * into v_event;
    return to_jsonb(v_event);
  end if;
  select * into v_event from public.roster_offer_alert_outbox where open_shift_id=p_open_shift_id
    and lease_token=p_token and lease_until>v_now and expires_at>v_now for update;
  if not found then return null; end if;
  if p_operation='prepare' then
    if coalesce(cardinality(p_owner_ids),0)>500 then raise exception 'roster_limit'; end if;
    if not v_event.initialized then
      insert into public.roster_offer_alert_devices(open_shift_id,subscription_id,owner_id)
        select v_event.open_shift_id,s.id,s.owner_id from public.web_push_subscriptions s
        join public.on_call_service_members m on m.user_id=s.owner_id and m.service_id=v_event.service_id
        where s.owner_id=any(coalesce(p_owner_ids,'{}'::uuid[])) and s.owner_id<>v_event.actor_id
          and m.revoked_at is null on conflict do nothing;
      update public.roster_offer_alert_outbox set initialized=true where open_shift_id=p_open_shift_id;
    end if;
    return 'true'::jsonb;
  elsif p_operation='devices' then
    select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) into v_result from (
      select subscription_id,owner_id from public.roster_offer_alert_devices
      where open_shift_id=p_open_shift_id and outcome='pending' and available_at<=v_now
      order by subscription_id limit 25
    ) d;
    return v_result;
  elsif p_operation='ack' then
    if p_outcome not in ('sent','skipped','retry') or p_outcome is null then raise exception 'roster_invalid_request'; end if;
    update public.roster_offer_alert_devices set
      outcome=case when p_outcome='retry' then 'pending' else p_outcome end,
      available_at=v_now+make_interval(secs=>least(900,60*power(2,least(attempts,4)))::integer),
      attempts=attempts+1
      where open_shift_id=p_open_shift_id and subscription_id=p_subscription_id and outcome='pending';
    return to_jsonb(found);
  elsif p_operation='release' then
    update public.roster_offer_alert_outbox set lease_token=null,lease_until=null,
      completed_at=case when initialized and not exists(select 1 from public.roster_offer_alert_devices
        where open_shift_id=p_open_shift_id and outcome='pending') then v_now else null end,
      available_at=coalesce((select min(available_at) from public.roster_offer_alert_devices
        where open_shift_id=p_open_shift_id and outcome='pending'),v_now+interval '1 minute')
      where open_shift_id=p_open_shift_id;
    return 'true'::jsonb;
  end if;
  raise exception 'roster_invalid_request';
end $$;
alter function public.roster_offer_alert_work(text,uuid,uuid,uuid[],uuid,text) owner to postgres;
revoke all on function public.roster_offer_alert_work(text,uuid,uuid,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function public.roster_offer_alert_work(text,uuid,uuid,uuid[],uuid,text) to service_role;
