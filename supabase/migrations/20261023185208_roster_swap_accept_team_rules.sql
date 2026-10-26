-- DRAFT #DW0T5X: never edit an applied migration. Merging applies this to production.
-- Keep the app's conservative manager route, and close its read/accept timing gap in SQL.
-- roster_command already holds service FOR SHARE then the team's advisory transaction lock:
-- settings.set and all roster writes take the same locks, so rules and live rows stay coherent.
-- The helper compares the flags before/after, just like swapRuleFlags: existing flags alone
-- do not block, but a new owner, longer run or changed displayed hour total requires review.
-- Leave/on_call do not count as work; runs use distinct Perth START dates; hours clip to the
-- trailing 7/14 * 24 hours ending at each shift's end. Only the two people and app lookback
-- window are read. Invalid numeric rules fail closed rather than allowing an automatic swap.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.roster_swap_breaks_team_rules(p_service_id uuid, p_swap_id uuid, p_rules jsonb)
returns boolean language sql security invoker set search_path = public, pg_catalog, pg_temp as $$
  with sides as (
    select w.requester_id, w.counterparty_id, g.id give_id, t.id take_id,
           least(g.starts_at, g.ends_at, t.starts_at, t.ends_at) anchor_from,
           greatest(g.starts_at, g.ends_at, t.starts_at, t.ends_at) anchor_to
    from public.roster_swaps w
    join public.roster_assignments g on g.id = w.give_assignment_id and g.service_id = p_service_id
    left join public.roster_assignments t on t.id = w.take_assignment_id and t.service_id = p_service_id
    where w.id = p_swap_id and w.service_id = p_service_id
  ), limits as (
    select (p_rules ->> 'minBreakHours')::numeric min_break,
           (p_rules ->> 'maxNightsInRow')::numeric max_nights,
           (p_rules ->> 'maxDaysInRow')::numeric max_days,
           (p_rules ->> 'maxHours7d')::numeric max_7,
           (p_rules ->> 'maxHours14d')::numeric max_14
  ), bounds as (
    select greatest(0, ceil(min_break / 24) + 2, max_nights + 1, max_days + 1,
                    case when max_7 is not null then 8 else 0 end,
                    case when max_14 is not null then 15 else 0 end) * interval '24 hours' lookback
    from limits
  ), before_rows as (
    select a.id, a.user_id, a.starts_at, a.ends_at, a.kind
    from public.roster_assignments a cross join sides s cross join bounds b
    where a.service_id = p_service_id and a.superseded_at is null
      and a.user_id in (s.requester_id, s.counterparty_id)
      and a.starts_at between s.anchor_from - b.lookback and s.anchor_to + b.lookback
      and a.kind not in ('leave', 'on_call')
  ), states as (
    select 0 phase, a.* from before_rows a
    union all
    select 1 phase, a.id,
           case when a.id = s.give_id then s.counterparty_id
                when a.id = s.take_id then s.requester_id else a.user_id end,
           a.starts_at, a.ends_at, a.kind
    from before_rows a cross join sides s
  ), dates as (
    select distinct phase, user_id, 'maxDaysInRow' rule, (starts_at at time zone 'Australia/Perth')::date as day
    from states
    union
    select distinct phase, user_id, 'maxNightsInRow' rule, (starts_at at time zone 'Australia/Perth')::date as day
    from states where kind = 'night'
  ), islands as (
    select *, day - (row_number() over (partition by phase, user_id, rule order by day))::integer island
    from dates
  ), positions as (
    select *, row_number() over (partition by phase, user_id, rule, island order by day) position
    from islands
  ), run_flags as (
    select a.phase, a.user_id, a.id, d.rule, d.position::numeric metric
    from states a
    join positions d on d.phase = a.phase and d.user_id = a.user_id
      and d.day = (a.starts_at at time zone 'Australia/Perth')::date
    cross join limits l
    where (d.rule = 'maxDaysInRow' and d.position > l.max_days)
       or (d.rule = 'maxNightsInRow' and a.kind = 'night' and d.position > l.max_nights)
  ), rest_flags as (
    select a.phase, a.user_id, a.id, 'minBreakHours'::text rule, 1::numeric metric
    from states a cross join limits l
    where extract(epoch from (a.starts_at - (
      select max(b.ends_at) from states b
      where b.phase = a.phase and b.user_id = a.user_id and b.ends_at <= a.starts_at
    ))) / 3600 < l.min_break
  ), hour_totals as (
    select a.phase, a.user_id, a.id, h.rule, h.maximum,
           sum(greatest(0::numeric, extract(epoch from (
             least(a.ends_at, b.ends_at) - greatest(a.ends_at - h.span, b.starts_at)
           )))) / 3600 hours
    from states a
    join states b on b.phase = a.phase and b.user_id = a.user_id
    cross join limits l
    cross join lateral (values
      ('maxHours7d'::text, l.max_7, interval '168 hours'),
      ('maxHours14d'::text, l.max_14, interval '336 hours')
    ) h(rule, maximum, span)
    where h.maximum is not null
    group by a.phase, a.user_id, a.id, a.ends_at, h.rule, h.maximum
  ), flags as (
    select * from run_flags
    union all select * from rest_flags
    union all
    select phase, user_id, id, rule, round(hours, 1) metric from hour_totals where hours > maximum
  )
  select exists (
    select 1 from flags a where a.phase = 1 and not exists (
      select 1 from flags b where b.phase = 0 and b.user_id = a.user_id and b.id = a.id
        and b.rule = a.rule and b.metric = a.metric
    )
  );
$$;

revoke all on function public.roster_swap_breaks_team_rules(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.roster_swap_breaks_team_rules(uuid, uuid, jsonb) to service_role;

-- Forward replacement: original roster_command body, with one extra team_rule condition only.
-- The focused contract compares this whole body to the original after removing that addition.

create or replace function public.roster_command(p_actor_id uuid, p_service_id uuid, p_action text, p_payload jsonb default '{}')
returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_role public.roster_member_roles;
  v_is_manager boolean;
  v_settings public.roster_team_settings;
  v_min_break numeric;
  v_pub public.roster_publications;
  v_swap public.roster_swaps;
  v_open public.roster_open_shifts;
  v_give public.roster_assignments;
  v_take public.roster_assignments;
  v_draft public.roster_drafts;
  v_row jsonb;
  v_id uuid;
  v_change_id bigint;
  v_count integer;
  v_ids uuid[];
  v_problem text;
  v_reason text;
  v_giver_rank integer;
  v_taker_rank integer;
  v_result jsonb;
  v_from date;
  v_to date;
begin
  if p_actor_id is null then raise exception 'roster_auth_required'; end if;
  if p_service_id is null or p_action is null then raise exception 'roster_invalid_request'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'roster_invalid_request'; end if;

  -- Removing a member changes membership, so it takes the service row FOR UPDATE, as On Call
  -- does; every other action takes it FOR SHARE. Never upgrade a lock mid-call.
  if p_action = 'member.remove' then
    select * into v_service from public.on_call_services where id = p_service_id for update;
  else
    select * into v_service from public.on_call_services where id = p_service_id for share;
  end if;
  if not found or not public.service_member_active(p_service_id, p_actor_id) then
    raise exception 'roster_access_denied';
  end if;
  if v_service.verified_at is null and not v_service.is_demo then raise exception 'roster_team_not_verified'; end if;

  -- Seen receipts are a check-in: the share lock is enough, and they never wait on other writes.
  if p_action = 'seen.mark' then
    select * into v_pub from public.roster_publications
     where service_id = p_service_id and id = (p_payload ->> 'publicationId')::uuid;
    if not found then raise exception 'roster_not_found'; end if;
    insert into public.roster_publication_seen (publication_id, user_id) values (v_pub.id, p_actor_id)
      on conflict do nothing;
    return jsonb_build_object('ok', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74817));

  select * into v_role from public.roster_member_roles
   where service_id = p_service_id and user_id = p_actor_id and revoked_at is null;
  v_is_manager := found and v_role.role = 'manager';
  select * into v_settings from public.roster_team_settings where service_id = p_service_id;
  v_min_break := nullif(v_settings.rules ->> 'minBreakHours', '')::numeric;

  -- ---------------------------------------------------------------- people and settings
  if p_action = 'role.set' then
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    v_id := (p_payload ->> 'userId')::uuid;
    if v_id is null or not public.service_member_active(p_service_id, v_id) then raise exception 'roster_not_found'; end if;
    if p_payload ? 'grade' and p_payload ->> 'grade' is not null
       and p_payload ->> 'grade' not in ('intern', 'resident', 'registrar', 'fellow', 'consultant', 'other') then
      raise exception 'roster_invalid_request';
    end if;
    insert into public.roster_member_roles (service_id, user_id, role, grade, roster_name, rotation_ends_on, granted_by)
    values (p_service_id, v_id, 'member', p_payload ->> 'grade', nullif(btrim(p_payload ->> 'rosterName'), ''),
            (p_payload ->> 'rotationEndsOn')::date, p_actor_id)
    on conflict (service_id, user_id) do update set
      grade = case when p_payload ? 'grade' then excluded.grade else public.roster_member_roles.grade end,
      roster_name = case when p_payload ? 'rosterName' then excluded.roster_name else public.roster_member_roles.roster_name end,
      rotation_ends_on = case when p_payload ? 'rotationEndsOn' then excluded.rotation_ends_on else public.roster_member_roles.rotation_ends_on end,
      role = case when public.roster_member_roles.revoked_at is null then public.roster_member_roles.role else 'member' end,
      revoked_at = null;
    return jsonb_build_object('ok', true);

  elsif p_action = 'member.remove' then
    -- Someone who leaves the team. Only ordinary service members; editors and admins are
    -- removed in On Call by a service admin. Revoking fires every mode's cascade trigger.
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    v_id := (p_payload ->> 'userId')::uuid;
    if v_id is null or v_id = p_actor_id then raise exception 'roster_invalid_request'; end if;
    update public.on_call_service_members set revoked_at = now(), clinical_reviewer = false
     where service_id = p_service_id and user_id = v_id and revoked_at is null and role = 'member';
    if not found then raise exception 'roster_not_found'; end if;
    insert into public.on_call_service_member_events (service_id, user_id, event, mode, actor_id)
    values (p_service_id, v_id, 'revoked', null, p_actor_id);
    return jsonb_build_object('ok', true);

  elsif p_action = 'settings.set' then
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    insert into public.roster_team_settings (service_id, swap_approval, rules, rules_source, pay_fortnight_anchor, updated_by)
    values (p_service_id,
            coalesce(p_payload ->> 'swapApproval', 'auto_same_grade'),
            coalesce(p_payload -> 'rules', '{}'::jsonb),
            nullif(btrim(p_payload ->> 'rulesSource'), ''),
            (p_payload ->> 'payFortnightAnchor')::date,
            p_actor_id)
    on conflict (service_id) do update set
      swap_approval = excluded.swap_approval, rules = excluded.rules, rules_source = excluded.rules_source,
      pay_fortnight_anchor = excluded.pay_fortnight_anchor, updated_by = excluded.updated_by;
    return jsonb_build_object('ok', true);

  elsif p_action = 'unavailability.set' then
    -- payload {set: [{date, kind}], clear: [date]} for the actor only, future dates only.
    delete from public.roster_unavailability
     where service_id = p_service_id and user_id = p_actor_id
       and on_date in (select (value #>> '{}')::date from jsonb_array_elements(coalesce(p_payload -> 'clear', '[]')));
    insert into public.roster_unavailability (service_id, user_id, on_date, kind)
    select p_service_id, p_actor_id, (value ->> 'date')::date, value ->> 'kind'
    from jsonb_array_elements(coalesce(p_payload -> 'set', '[]'))
    where (value ->> 'date')::date > (now() at time zone 'Australia/Perth')::date
    on conflict (service_id, user_id, on_date) do update set kind = excluded.kind;
    if (select count(*) from public.roster_unavailability where service_id = p_service_id and user_id = p_actor_id) > 120 then
      raise exception 'roster_limit';
    end if;
    return jsonb_build_object('ok', true);

  -- ---------------------------------------------------------------- publishing
  elsif p_action = 'publish' then
    -- payload {kind, periodStart, periodEnd, sourceName?, replaceAssignmentIds?[], assignments[], draftId?}
    -- The app has already settled rows it couldn't match and approved swaps the file would undo;
    -- this step is all or nothing.
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    v_from := (p_payload ->> 'periodStart')::date;
    v_to := (p_payload ->> 'periodEnd')::date;
    if v_from is null or v_to is null or jsonb_typeof(p_payload -> 'assignments') is distinct from 'array'
       or jsonb_array_length(p_payload -> 'assignments') > 5000
       or coalesce(p_payload ->> 'kind', 'full') not in ('full', 'single_change') then
      raise exception 'roster_invalid_request';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_payload -> 'assignments') x
      where (x ->> 'userId') is not null
        and not public.service_member_active(p_service_id, (x ->> 'userId')::uuid)
    ) or exists (
      select 1 from jsonb_array_elements(p_payload -> 'assignments') x
      where (x ->> 'userId') is null and nullif(btrim(x ->> 'rosterName'), '') is null
    ) or exists (
      select 1 from jsonb_array_elements(p_payload -> 'assignments') x
      where ((x ->> 'startsAt')::timestamptz at time zone 'Australia/Perth')::date not between v_from and v_to
    ) then
      raise exception 'roster_invalid_request';
    end if;

    insert into public.roster_publications (service_id, version, kind, period_start, period_end, source_name, published_by)
    values (p_service_id,
            coalesce((select max(version) from public.roster_publications where service_id = p_service_id), 0) + 1,
            coalesce(p_payload ->> 'kind', 'full'), v_from, v_to, nullif(btrim(p_payload ->> 'sourceName'), ''), p_actor_id)
    returning * into v_pub;

    if v_pub.kind = 'full' then
      with replaced as (
        update public.roster_assignments set superseded_at = now()
         where service_id = p_service_id and superseded_at is null
           and (starts_at at time zone 'Australia/Perth')::date between v_from and v_to
        returning id
      )
      select coalesce(array_agg(id), '{}') into v_ids from replaced;
    else
      select coalesce(array_agg((value #>> '{}')::uuid), '{}') into v_ids
        from jsonb_array_elements(coalesce(p_payload -> 'replaceAssignmentIds', '[]'));
      update public.roster_assignments set superseded_at = now()
       where service_id = p_service_id and superseded_at is null and id = any (v_ids);
      get diagnostics v_count = row_count;
      if v_count <> coalesce(array_length(v_ids, 1), 0) then raise exception 'roster_conflict'; end if;
    end if;

    insert into public.roster_assignments (service_id, publication_id, user_id, roster_name, site_id, starts_at, ends_at, shift_code, kind, grade)
    select p_service_id, v_pub.id, (x ->> 'userId')::uuid, nullif(btrim(x ->> 'rosterName'), ''), (x ->> 'siteId')::uuid,
           (x ->> 'startsAt')::timestamptz, (x ->> 'endsAt')::timestamptz, btrim(x ->> 'shiftCode'), x ->> 'kind', x ->> 'grade'
    from jsonb_array_elements(p_payload -> 'assignments') x;

    -- Pending requests on replaced shifts cancel themselves and say why.
    with cancelled as (
      update public.roster_swaps set status = 'cancelled', cancel_reason = 'roster_changed', decided_at = now()
       where service_id = p_service_id and status in ('requested', 'accepted')
         and (give_assignment_id = any (v_ids) or take_assignment_id = any (v_ids))
      returning id, requester_id, counterparty_id
    )
    select jsonb_build_object('swapsCancelled', coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'requesterId', requester_id, 'counterpartyId', counterparty_id)), '[]')) into v_result from cancelled;
    update public.roster_open_shifts set status = 'cancelled', decided_at = now()
     where service_id = p_service_id and status in ('reported', 'open', 'claimed') and assignment_id = any (v_ids);

    insert into public.roster_changes (service_id, target, source, change, actor_id)
    values (p_service_id, 'live', 'publish',
            jsonb_build_object('kind', 'publish', 'publicationId', v_pub.id, 'version', v_pub.version,
                               'replaced', coalesce(array_length(v_ids, 1), 0),
                               'rows', jsonb_array_length(p_payload -> 'assignments')),
            p_actor_id);
    -- The manager has seen their own roster.
    insert into public.roster_publication_seen (publication_id, user_id) values (v_pub.id, p_actor_id);
    if p_payload ? 'draftId' then
      delete from public.roster_drafts where id = (p_payload ->> 'draftId')::uuid and service_id = p_service_id;
    end if;
    return v_result || jsonb_build_object('publicationId', v_pub.id, 'version', v_pub.version);

  -- ---------------------------------------------------------------- swaps
  elsif p_action in ('swap.create', 'swap.accept', 'swap.approve') then
    if p_action = 'swap.create' then
      select * into v_give from public.roster_assignments
       where id = (p_payload ->> 'giveAssignmentId')::uuid and service_id = p_service_id and superseded_at is null for update;
      if not found or v_give.user_id is distinct from p_actor_id or v_give.starts_at <= now() or v_give.kind = 'leave' then
        raise exception 'roster_not_found';
      end if;
      v_id := (p_payload ->> 'counterpartyId')::uuid;
      if v_id is null or v_id = p_actor_id or not public.service_member_active(p_service_id, v_id) then
        raise exception 'roster_not_found';
      end if;
      if p_payload ->> 'takeAssignmentId' is not null then
        select * into v_take from public.roster_assignments
         where id = (p_payload ->> 'takeAssignmentId')::uuid and service_id = p_service_id and superseded_at is null for update;
        if not found or v_take.user_id is distinct from v_id or v_take.starts_at <= now() or v_take.kind = 'leave' then
          raise exception 'roster_not_found';
        end if;
      end if;
      if exists (select 1 from public.roster_swaps w where w.status in ('requested', 'accepted')
                 and (w.give_assignment_id in (v_give.id, v_take.id) or w.take_assignment_id in (v_give.id, v_take.id)))
         or exists (select 1 from public.roster_open_shifts o where o.status in ('reported', 'open', 'claimed')
                 and o.assignment_id in (v_give.id, v_take.id)) then
        raise exception 'roster_request_exists';
      end if;
      insert into public.roster_swaps (service_id, requester_id, counterparty_id, give_assignment_id, take_assignment_id, expires_at)
      values (p_service_id, p_actor_id, v_id, v_give.id, v_take.id,
              least(v_give.starts_at, coalesce(v_take.starts_at, v_give.starts_at), now() + interval '7 days'))
      returning * into v_swap;
    else
      select * into v_swap from public.roster_swaps
       where id = (p_payload ->> 'swapId')::uuid and service_id = p_service_id for update;
      if not found then raise exception 'roster_not_found'; end if;
      if p_action = 'swap.accept' and (v_swap.counterparty_id <> p_actor_id or v_swap.status <> 'requested') then
        raise exception 'roster_not_found';
      end if;
      if p_action = 'swap.approve' and (not v_is_manager or v_swap.status <> 'accepted') then
        raise exception 'roster_role_denied';
      end if;
      -- A manager never approves a swap they are part of.
      if p_action = 'swap.approve' and p_actor_id in (v_swap.requester_id, v_swap.counterparty_id) then
        raise exception 'roster_role_denied';
      end if;
      if v_swap.expires_at <= now() then
        update public.roster_swaps set status = 'expired', decided_at = now() where id = v_swap.id;
        return jsonb_build_object('swapId', v_swap.id, 'status', 'expired');
      end if;
      select * into v_give from public.roster_assignments where id = v_swap.give_assignment_id for update;
      select * into v_take from public.roster_assignments where id = v_swap.take_assignment_id for update;
    end if;

    -- Recheck at every step: still live, still theirs, still eligible, still fits.
    v_reason := null;
    if v_give.superseded_at is not null or v_give.user_id is distinct from v_swap.requester_id
       or (v_swap.take_assignment_id is not null
           and (v_take.superseded_at is not null or v_take.user_id is distinct from v_swap.counterparty_id)) then
      v_reason := 'roster_changed';
    else
      v_giver_rank := public.roster_grade_rank(coalesce(v_give.grade,
        (select grade from public.roster_member_roles where service_id = p_service_id and user_id = v_swap.requester_id and revoked_at is null)));
      v_taker_rank := public.roster_grade_rank(
        (select grade from public.roster_member_roles where service_id = p_service_id and user_id = v_swap.counterparty_id and revoked_at is null));
      if v_giver_rank is null or v_taker_rank is null or v_taker_rank < v_giver_rank then
        v_reason := 'no_longer_fits';
      elsif v_swap.take_assignment_id is not null and (
          public.roster_grade_rank(coalesce(v_take.grade,
            (select grade from public.roster_member_roles where service_id = p_service_id and user_id = v_swap.counterparty_id and revoked_at is null)))
          > public.roster_grade_rank(
            (select grade from public.roster_member_roles where service_id = p_service_id and user_id = v_swap.requester_id and revoked_at is null))
          or public.roster_grade_rank(
            (select grade from public.roster_member_roles where service_id = p_service_id and user_id = v_swap.requester_id and revoked_at is null)) is null) then
        v_reason := 'no_longer_fits';
      elsif public.roster_placement_problem(p_service_id, v_swap.counterparty_id, v_give.starts_at, v_give.ends_at,
              array[v_take.id], null) = 'clash'
         or (v_swap.take_assignment_id is not null and public.roster_placement_problem(p_service_id, v_swap.requester_id,
              v_take.starts_at, v_take.ends_at, array[v_give.id], null) = 'clash') then
        v_reason := 'no_longer_fits';
      end if;
    end if;
    if v_reason is not null then
      if p_action = 'swap.create' then raise exception 'roster_swap_not_eligible'; end if;
      update public.roster_swaps set status = 'cancelled', cancel_reason = v_reason, decided_at = now() where id = v_swap.id;
      return jsonb_build_object('swapId', v_swap.id, 'status', 'cancelled', 'cancelReason', v_reason);
    end if;
    if p_action = 'swap.create' then
      return jsonb_build_object('swapId', v_swap.id, 'status', 'requested');
    end if;

    if p_action = 'swap.accept' then
      -- Does it need the manager? Team setting, then within 7 days, then grade, then team rule.
      v_reason := case
        when coalesce(v_settings.swap_approval, 'auto_same_grade') = 'manager' then 'team_setting'
        when least(v_give.starts_at, coalesce(v_take.starts_at, v_give.starts_at)) < now() + interval '7 days' then 'within_7_days'
        when v_taker_rank <> v_giver_rank then 'different_grade'
        when public.roster_placement_problem(p_service_id, v_swap.counterparty_id, v_give.starts_at, v_give.ends_at, array[v_take.id], v_min_break) is not null
          or (v_swap.take_assignment_id is not null and public.roster_placement_problem(p_service_id, v_swap.requester_id,
                v_take.starts_at, v_take.ends_at, array[v_give.id], v_min_break) is not null) then 'team_rule'
        when public.roster_swap_breaks_team_rules(p_service_id, v_swap.id, v_settings.rules) then 'team_rule'
        else null end;
      if v_reason is not null then
        update public.roster_swaps set status = 'accepted', accepted_at = now(), needs_manager_because = v_reason
         where id = v_swap.id;
        return jsonb_build_object('swapId', v_swap.id, 'status', 'accepted', 'needsManagerBecause', v_reason);
      end if;
    end if;

    -- Apply: both shifts change hands together, with the undo saved in the same step.
    update public.roster_assignments set user_id = v_swap.counterparty_id, roster_name = null where id = v_give.id;
    if v_swap.take_assignment_id is not null then
      update public.roster_assignments set user_id = v_swap.requester_id, roster_name = null where id = v_take.id;
    end if;
    update public.roster_swaps
       set status = 'approved', auto_approved = (p_action = 'swap.accept'),
           accepted_at = coalesce(accepted_at, now()), decided_at = now(),
           decided_by = case when p_action = 'swap.approve' then p_actor_id else null end
     where id = v_swap.id;
    insert into public.roster_changes (service_id, target, source, change, undo, actor_id)
    values (p_service_id, 'live', 'swap',
            jsonb_build_object('kind', 'swap', 'swapId', v_swap.id),
            jsonb_build_object('assignments', jsonb_build_array(
              jsonb_build_object('id', v_give.id, 'userId', v_give.user_id, 'rosterName', v_give.roster_name))
              || case when v_take.id is null then '[]'::jsonb else jsonb_build_array(
              jsonb_build_object('id', v_take.id, 'userId', v_take.user_id, 'rosterName', v_take.roster_name)) end),
            p_actor_id);
    -- Any other request that relied on these shifts no longer fits.
    update public.roster_swaps set status = 'cancelled', cancel_reason = 'roster_changed', decided_at = now()
     where service_id = p_service_id and id <> v_swap.id and status in ('requested', 'accepted')
       and (give_assignment_id in (v_give.id, v_take.id) or take_assignment_id in (v_give.id, v_take.id));
    return jsonb_build_object('swapId', v_swap.id, 'status', 'approved', 'autoApproved', p_action = 'swap.accept');

  elsif p_action in ('swap.decline', 'swap.cancel', 'swap.undo') then
    select * into v_swap from public.roster_swaps
     where id = (p_payload ->> 'swapId')::uuid and service_id = p_service_id for update;
    if not found then raise exception 'roster_not_found'; end if;
    if p_action = 'swap.decline' then
      if not ((v_swap.status = 'requested' and v_swap.counterparty_id = p_actor_id)
              or (v_swap.status = 'accepted' and v_is_manager and p_actor_id not in (v_swap.requester_id, v_swap.counterparty_id))) then
        raise exception 'roster_role_denied';
      end if;
      update public.roster_swaps set status = 'declined', decided_at = now(),
             decided_by = case when v_swap.status = 'accepted' then p_actor_id else null end
       where id = v_swap.id;
      return jsonb_build_object('swapId', v_swap.id, 'status', 'declined');
    elsif p_action = 'swap.cancel' then
      if v_swap.requester_id <> p_actor_id or v_swap.status not in ('requested', 'accepted') then
        raise exception 'roster_role_denied';
      end if;
      update public.roster_swaps set status = 'cancelled', cancel_reason = 'withdrawn', decided_at = now() where id = v_swap.id;
      return jsonb_build_object('swapId', v_swap.id, 'status', 'cancelled');
    else
      -- "Undo for 10 min" after a swap approved itself, by either doctor, if nothing moved since.
      if not v_swap.auto_approved or v_swap.status <> 'approved' or v_swap.decided_at < now() - interval '10 minutes'
         or p_actor_id not in (v_swap.requester_id, v_swap.counterparty_id) then
        raise exception 'roster_role_denied';
      end if;
      select * into v_give from public.roster_assignments where id = v_swap.give_assignment_id for update;
      select * into v_take from public.roster_assignments where id = v_swap.take_assignment_id for update;
      if v_give.superseded_at is not null or v_give.user_id is distinct from v_swap.counterparty_id
         or (v_take.id is not null and (v_take.superseded_at is not null or v_take.user_id is distinct from v_swap.requester_id)) then
        raise exception 'roster_conflict';
      end if;
      update public.roster_assignments set user_id = v_swap.requester_id where id = v_give.id;
      if v_take.id is not null then
        update public.roster_assignments set user_id = v_swap.counterparty_id where id = v_take.id;
      end if;
      update public.roster_swaps set status = 'undone', decided_at = now() where id = v_swap.id;
      update public.roster_changes set undone_at = now(), undone_by = p_actor_id
       where service_id = p_service_id and source = 'swap' and change ->> 'swapId' = v_swap.id::text and undone_at is null;
      return jsonb_build_object('swapId', v_swap.id, 'status', 'undone');
    end if;

  -- ---------------------------------------------------------------- open shifts
  elsif p_action in ('open.post', 'open.report') then
    -- open.post: a member gives away their own shift, or a manager posts any live shift or a gap.
    -- open.report: "I can't make my shift": waits as 'reported' for the manager to release it.
    if p_payload ->> 'assignmentId' is not null then
      select * into v_give from public.roster_assignments
       where id = (p_payload ->> 'assignmentId')::uuid and service_id = p_service_id and superseded_at is null for update;
      if not found or v_give.ends_at <= now() or v_give.kind = 'leave'
         or (not v_is_manager and v_give.user_id is distinct from p_actor_id) then
        raise exception 'roster_not_found';
      end if;
      if exists (select 1 from public.roster_swaps w where w.status in ('requested', 'accepted')
                 and (w.give_assignment_id = v_give.id or w.take_assignment_id = v_give.id)) then
        raise exception 'roster_request_exists';
      end if;
      insert into public.roster_open_shifts (service_id, assignment_id, starts_at, ends_at, shift_code, kind, site_id,
                                             min_grade, urgent, status, posted_by)
      values (p_service_id, v_give.id, v_give.starts_at, v_give.ends_at, v_give.shift_code, v_give.kind, v_give.site_id,
              coalesce(nullif(v_give.grade, 'other'),
                       nullif((select grade from public.roster_member_roles where service_id = p_service_id
                               and user_id = v_give.user_id and revoked_at is null), 'other')),
              case when p_action = 'open.report' then true else coalesce((p_payload ->> 'urgent')::boolean, false) and v_is_manager end,
              case when p_action = 'open.report' then 'reported' else 'open' end, p_actor_id)
      returning * into v_open;
    else
      if p_action = 'open.report' or not v_is_manager then raise exception 'roster_role_denied'; end if;
      insert into public.roster_open_shifts (service_id, starts_at, ends_at, shift_code, kind, site_id, min_grade, urgent, posted_by)
      values (p_service_id, (p_payload ->> 'startsAt')::timestamptz, (p_payload ->> 'endsAt')::timestamptz,
              btrim(p_payload ->> 'shiftCode'), p_payload ->> 'kind', (p_payload ->> 'siteId')::uuid,
              p_payload ->> 'minGrade', coalesce((p_payload ->> 'urgent')::boolean, false), p_actor_id)
      returning * into v_open;
      if v_open.starts_at <= now() then raise exception 'roster_invalid_request'; end if;
    end if;
    if (select count(*) from public.roster_open_shifts where service_id = p_service_id and status in ('reported', 'open', 'claimed')) > 1000 then
      raise exception 'roster_limit';
    end if;
    return jsonb_build_object('openShiftId', v_open.id, 'status', v_open.status);

  elsif p_action in ('open.claim', 'open.approve', 'open.decline', 'open.cancel', 'open.release') then
    select * into v_open from public.roster_open_shifts
     where id = (p_payload ->> 'openShiftId')::uuid and service_id = p_service_id for update;
    if not found then raise exception 'roster_not_found'; end if;

    if p_action = 'open.release' then
      if not v_is_manager or v_open.status <> 'reported' then raise exception 'roster_role_denied'; end if;
      update public.roster_open_shifts set status = 'open', urgent = coalesce((p_payload ->> 'urgent')::boolean, true)
       where id = v_open.id;
      return jsonb_build_object('openShiftId', v_open.id, 'status', 'open');
    elsif p_action = 'open.cancel' then
      if v_open.status not in ('reported', 'open', 'claimed') or not (v_is_manager or v_open.posted_by = p_actor_id) then
        raise exception 'roster_role_denied';
      end if;
      update public.roster_open_shifts set status = 'cancelled', decided_at = now(), decided_by = p_actor_id where id = v_open.id;
      return jsonb_build_object('openShiftId', v_open.id, 'status', 'cancelled');
    elsif p_action = 'open.decline' then
      if not v_is_manager or v_open.status <> 'claimed' or v_open.claimed_by = p_actor_id then raise exception 'roster_role_denied'; end if;
      update public.roster_open_shifts set status = 'open', claimed_by = null, claimed_at = null where id = v_open.id;
      return jsonb_build_object('openShiftId', v_open.id, 'status', 'open');
    end if;

    if p_action = 'open.claim' then
      if v_open.status <> 'open' then raise exception 'roster_open_shift_taken'; end if;
      if v_open.starts_at <= now() or v_open.posted_by = p_actor_id then raise exception 'roster_not_found'; end if;
      v_id := p_actor_id;
    else
      if not v_is_manager or v_open.status <> 'claimed' or v_open.claimed_by = p_actor_id then raise exception 'roster_role_denied'; end if;
      v_id := v_open.claimed_by;
    end if;
    v_taker_rank := public.roster_grade_rank(
      (select grade from public.roster_member_roles where service_id = p_service_id and user_id = v_id and revoked_at is null));
    if v_taker_rank is null or (v_open.min_grade is not null and v_taker_rank < public.roster_grade_rank(v_open.min_grade))
       or public.roster_placement_problem(p_service_id, v_id, v_open.starts_at, v_open.ends_at,
            array[v_open.assignment_id], null) is not null then
      raise exception 'roster_swap_not_eligible';
    end if;
    if p_action = 'open.claim' and (
         coalesce(v_settings.swap_approval, 'auto_same_grade') = 'manager'
         or v_open.starts_at < now() + interval '7 days'
         or v_open.min_grade is null or v_taker_rank <> public.roster_grade_rank(v_open.min_grade)
         or public.roster_placement_problem(p_service_id, v_id, v_open.starts_at, v_open.ends_at,
              array[v_open.assignment_id], v_min_break) is not null) then
      update public.roster_open_shifts set status = 'claimed', claimed_by = v_id, claimed_at = now() where id = v_open.id;
      return jsonb_build_object('openShiftId', v_open.id, 'status', 'claimed');
    end if;

    -- Apply: the shift moves to the taker (or a gap becomes their shift), with its undo.
    if v_open.assignment_id is not null then
      select * into v_give from public.roster_assignments where id = v_open.assignment_id for update;
      if v_give.superseded_at is not null then raise exception 'roster_conflict'; end if;
      update public.roster_assignments set user_id = v_id, roster_name = null where id = v_give.id;
      v_row := jsonb_build_object('id', v_give.id, 'userId', v_give.user_id, 'rosterName', v_give.roster_name);
    else
      select * into v_pub from public.roster_publications where service_id = p_service_id order by version desc limit 1;
      if not found then raise exception 'roster_conflict'; end if;
      insert into public.roster_assignments (service_id, publication_id, user_id, site_id, starts_at, ends_at, shift_code, kind, grade)
      values (p_service_id, v_pub.id, v_id, v_open.site_id, v_open.starts_at, v_open.ends_at, v_open.shift_code, v_open.kind, v_open.min_grade)
      returning * into v_give;
      v_row := jsonb_build_object('id', v_give.id, 'delete', true);
    end if;
    update public.roster_open_shifts
       set status = 'approved', claimed_by = v_id, claimed_at = coalesce(claimed_at, now()), decided_at = now(),
           decided_by = case when p_action = 'open.approve' then p_actor_id else null end
     where id = v_open.id;
    insert into public.roster_changes (service_id, target, source, change, undo, actor_id)
    values (p_service_id, 'live', 'open_shift', jsonb_build_object('kind', 'open_shift', 'openShiftId', v_open.id),
            jsonb_build_object('assignments', jsonb_build_array(v_row)), p_actor_id);
    return jsonb_build_object('openShiftId', v_open.id, 'status', 'approved', 'assignmentId', v_give.id);

  -- ---------------------------------------------------------------- roster maker (Release 3)
  elsif p_action = 'codes.set' then
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    delete from public.roster_shift_codes where service_id = p_service_id;
    insert into public.roster_shift_codes (service_id, code, kind, starts, ends, label)
    select p_service_id, btrim(x ->> 'code'), x ->> 'kind', (x ->> 'starts')::time, (x ->> 'ends')::time, nullif(btrim(x ->> 'label'), '')
    from jsonb_array_elements(coalesce(p_payload -> 'codes', '[]')) x;
    if (select count(*) from public.roster_shift_codes where service_id = p_service_id) > 100 then raise exception 'roster_limit'; end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'needs.set' then
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    delete from public.roster_staffing_needs where service_id = p_service_id;
    insert into public.roster_staffing_needs (service_id, weekday, on_date, kind, grade, site_id, needed)
    select p_service_id, (x ->> 'weekday')::smallint, (x ->> 'date')::date, x ->> 'kind', x ->> 'grade',
           (x ->> 'siteId')::uuid, (x ->> 'needed')::smallint
    from jsonb_array_elements(coalesce(p_payload -> 'needs', '[]')) x;
    if (select count(*) from public.roster_staffing_needs where service_id = p_service_id) > 2000 then raise exception 'roster_limit'; end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'draft.open' then
    -- Start (or return) the draft for a period, copied from the live roster.
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    v_from := (p_payload ->> 'periodStart')::date;
    v_to := (p_payload ->> 'periodEnd')::date;
    select * into v_draft from public.roster_drafts
     where service_id = p_service_id and period_start = v_from and period_end = v_to;
    if found then return jsonb_build_object('draftId', v_draft.id, 'created', false); end if;
    if (select count(*) from public.roster_drafts where service_id = p_service_id) >= 12 then raise exception 'roster_limit'; end if;
    insert into public.roster_drafts (service_id, period_start, period_end, based_on_publication_id, created_by)
    values (p_service_id, v_from, v_to,
            (select id from public.roster_publications where service_id = p_service_id order by version desc limit 1), p_actor_id)
    returning * into v_draft;
    insert into public.roster_draft_assignments (draft_id, user_id, roster_name, site_id, starts_at, ends_at, shift_code, kind, grade)
    select v_draft.id, a.user_id,
           case when a.user_id is null then coalesce(a.roster_name, 'Unnamed') else a.roster_name end,
           a.site_id, a.starts_at, a.ends_at, a.shift_code, a.kind, a.grade
    from public.roster_assignments a
    where a.service_id = p_service_id and a.superseded_at is null
      and (a.starts_at at time zone 'Australia/Perth')::date between v_from and v_to;
    return jsonb_build_object('draftId', v_draft.id, 'created', true);

  elsif p_action = 'draft.change' then
    -- payload {draftId, source, ops: [{op:'add', row{...}} | {op:'remove', id} | {op:'update', id, row{...}}]}
    -- One roster_changes row per op, each with its undo, in this one transaction.
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    select * into v_draft from public.roster_drafts
     where id = (p_payload ->> 'draftId')::uuid and service_id = p_service_id for update;
    if not found then raise exception 'roster_not_found'; end if;
    if coalesce(p_payload ->> 'source', '') not in ('typed', 'grid', 'upload')
       or jsonb_typeof(p_payload -> 'ops') is distinct from 'array' or jsonb_array_length(p_payload -> 'ops') > 500 then
      raise exception 'roster_invalid_request';
    end if;
    for v_row in select value from jsonb_array_elements(p_payload -> 'ops') loop
      if v_row ->> 'op' = 'add' then
        if (v_row #>> '{row,userId}') is not null
           and not public.service_member_active(p_service_id, (v_row #>> '{row,userId}')::uuid) then
          raise exception 'roster_invalid_request';
        end if;
        insert into public.roster_draft_assignments (draft_id, user_id, roster_name, site_id, starts_at, ends_at, shift_code, kind, grade)
        values (v_draft.id, (v_row #>> '{row,userId}')::uuid, nullif(btrim(v_row #>> '{row,rosterName}'), ''),
                (v_row #>> '{row,siteId}')::uuid, (v_row #>> '{row,startsAt}')::timestamptz, (v_row #>> '{row,endsAt}')::timestamptz,
                btrim(v_row #>> '{row,shiftCode}'), v_row #>> '{row,kind}', v_row #>> '{row,grade}')
        returning id into v_id;
        insert into public.roster_changes (service_id, draft_id, target, source, change, undo, actor_id)
        values (p_service_id, v_draft.id, 'draft', p_payload ->> 'source', v_row || jsonb_build_object('id', v_id),
                jsonb_build_object('op', 'remove', 'id', v_id), p_actor_id)
        returning id into v_change_id;
      elsif v_row ->> 'op' in ('remove', 'update') then
        select to_jsonb(d) - 'draft_id' into v_result from public.roster_draft_assignments d
         where d.id = (v_row ->> 'id')::uuid and d.draft_id = v_draft.id for update;
        if v_result is null then raise exception 'roster_conflict'; end if;
        if v_row ->> 'op' = 'remove' then
          delete from public.roster_draft_assignments where id = (v_row ->> 'id')::uuid;
          insert into public.roster_changes (service_id, draft_id, target, source, change, undo, actor_id)
          values (p_service_id, v_draft.id, 'draft', p_payload ->> 'source', v_row,
                  jsonb_build_object('op', 'add', 'row', v_result), p_actor_id)
          returning id into v_change_id;
        else
          if (v_row #>> '{row,userId}') is not null
             and not public.service_member_active(p_service_id, (v_row #>> '{row,userId}')::uuid) then
            raise exception 'roster_invalid_request';
          end if;
          update public.roster_draft_assignments set
            user_id = case when v_row -> 'row' ? 'userId' then (v_row #>> '{row,userId}')::uuid else user_id end,
            roster_name = case when v_row -> 'row' ? 'rosterName' then nullif(btrim(v_row #>> '{row,rosterName}'), '') else roster_name end,
            site_id = case when v_row -> 'row' ? 'siteId' then (v_row #>> '{row,siteId}')::uuid else site_id end,
            starts_at = coalesce((v_row #>> '{row,startsAt}')::timestamptz, starts_at),
            ends_at = coalesce((v_row #>> '{row,endsAt}')::timestamptz, ends_at),
            shift_code = coalesce(btrim(v_row #>> '{row,shiftCode}'), shift_code),
            kind = coalesce(v_row #>> '{row,kind}', kind),
            grade = case when v_row -> 'row' ? 'grade' then v_row #>> '{row,grade}' else grade end
          where id = (v_row ->> 'id')::uuid;
          insert into public.roster_changes (service_id, draft_id, target, source, change, undo, actor_id)
          values (p_service_id, v_draft.id, 'draft', p_payload ->> 'source', v_row,
                  jsonb_build_object('op', 'update', 'id', v_row ->> 'id', 'row', v_result - 'id'), p_actor_id)
          returning id into v_change_id;
        end if;
      else
        raise exception 'roster_invalid_request';
      end if;
    end loop;
    if (select count(*) from public.roster_draft_assignments where draft_id = v_draft.id) > 5000 then raise exception 'roster_limit'; end if;
    update public.roster_drafts set updated_at = now() where id = v_draft.id;
    return jsonb_build_object('ok', true, 'lastChangeId', v_change_id);

  elsif p_action = 'draft.undo' then
    if not v_is_manager then raise exception 'roster_role_denied'; end if;
    select to_jsonb(x) into v_row from public.roster_changes x
     where x.id = (p_payload ->> 'changeId')::bigint and x.service_id = p_service_id
       and x.target = 'draft' and x.undone_at is null for update;
    if v_row is null then raise exception 'roster_not_found'; end if;
    if v_row #>> '{undo,op}' = 'remove' then
      delete from public.roster_draft_assignments where id = (v_row #>> '{undo,id}')::uuid
        and draft_id = (v_row ->> 'draft_id')::uuid;
      if not found then raise exception 'roster_conflict'; end if;
    elsif v_row #>> '{undo,op}' = 'add' then
      insert into public.roster_draft_assignments (id, draft_id, user_id, roster_name, site_id, starts_at, ends_at, shift_code, kind, grade)
      values ((v_row #>> '{undo,row,id}')::uuid, (v_row ->> 'draft_id')::uuid, (v_row #>> '{undo,row,user_id}')::uuid,
              v_row #>> '{undo,row,roster_name}', (v_row #>> '{undo,row,site_id}')::uuid,
              (v_row #>> '{undo,row,starts_at}')::timestamptz, (v_row #>> '{undo,row,ends_at}')::timestamptz,
              v_row #>> '{undo,row,shift_code}', v_row #>> '{undo,row,kind}', v_row #>> '{undo,row,grade}');
    else
      update public.roster_draft_assignments set
        user_id = (v_row #>> '{undo,row,user_id}')::uuid, roster_name = v_row #>> '{undo,row,roster_name}',
        site_id = (v_row #>> '{undo,row,site_id}')::uuid, starts_at = (v_row #>> '{undo,row,starts_at}')::timestamptz,
        ends_at = (v_row #>> '{undo,row,ends_at}')::timestamptz, shift_code = v_row #>> '{undo,row,shift_code}',
        kind = v_row #>> '{undo,row,kind}', grade = v_row #>> '{undo,row,grade}'
      where id = (v_row #>> '{undo,id}')::uuid and draft_id = (v_row ->> 'draft_id')::uuid;
      if not found then raise exception 'roster_conflict'; end if;
    end if;
    update public.roster_changes set undone_at = now(), undone_by = p_actor_id where id = (v_row ->> 'id')::bigint;
    return jsonb_build_object('ok', true);

  elsif p_action = 'agreement.record' then
    if not exists (select 1 from public.roster_changes c where c.id = (p_payload ->> 'changeId')::bigint
                   and c.service_id = p_service_id and c.agreement_required and c.undone_at is null) then
      raise exception 'roster_not_found';
    end if;
    insert into public.roster_change_agreements (change_id, user_id) values ((p_payload ->> 'changeId')::bigint, p_actor_id)
      on conflict do nothing;
    return jsonb_build_object('ok', true);
  end if;

  raise exception 'roster_invalid_request';
end $$;

revoke all on function public.roster_command(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.roster_command(uuid, uuid, text, jsonb) to service_role;
