-- Teaching: team admins may export attendance.
--
-- The Organise page is open to organisers and admins, and its attendance-gaps panel asks for
-- export.attendance, but teaching_command only let an organiser run that action, so an admin got
-- teaching_role_denied. This re-creates teaching_command unchanged except that export.attendance
-- now accepts 'organiser' or 'admin', the same check other Organise actions already use.
-- Every other role (including 'doctor') is still refused. Grants are restated as before.

create or replace function public.teaching_command(p_actor_id uuid, p_service_id uuid, p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_role text;
  v_occ public.teaching_occurrences;
  v_series public.teaching_series;
  v_claim public.teaching_checkin_claims;
  v_link public.teaching_display_links;
  v_result jsonb;
  v_id uuid;
  v_user uuid;
  v_ids uuid[];
  v_from date;
  v_to date;
  v_starts timestamptz;
  v_ends timestamptz;
  v_before timestamptz;
  v_before_id bigint;
  v_text text;
  v_stream text;
  v_code text;
  v_mac text;
  v_typed text;
  v_typed_previous text;
  v_venue text;
  v_status text;
  v_reason text;
  v_count integer;
  v_window bigint;
  v_is_presenter boolean;
  v_visitor boolean;
  v_needs_lock boolean;
begin
  if p_actor_id is null then raise exception 'teaching_auth_required'; end if;
  if p_action is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'teaching_invalid_request';
  end if;

  -- Actions across all of the actor's own teams. The service id must be null.
  if p_action in ('week.read','logbook.read','checkin.complete','cpd.unlogged','session.next','supervision.pending','supervision.left_services','teach.read','feedback.open') then
    if p_service_id is not null then raise exception 'teaching_invalid_request'; end if;

    if p_action = 'week.read' then
      v_from := public.teaching_date_arg(p_payload, 'from');
      v_to := public.teaching_date_arg(p_payload, 'to');
      if v_from is null or v_to is null or v_to < v_from or v_to - v_from >= 42 then
        raise exception 'teaching_invalid_request';
      end if;
      perform 1 from public.on_call_services s
      where exists (select 1 from public.on_call_service_members m where m.service_id = s.id and m.user_id = p_actor_id and m.revoked_at is null)
      order by s.id for share;
      with teams as (
        select s.id, s.name, s.verified_at, s.is_demo, public.teaching_member_role(s.id, p_actor_id) as role
        from public.on_call_services s
        join public.on_call_service_members m on m.service_id = s.id and m.user_id = p_actor_id and m.revoked_at is null
      )
      select jsonb_build_object(
        'teams', coalesce((select jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'role', t.role,
            'acceptsRealData', t.verified_at is not null or t.is_demo, 'isDemo', t.is_demo,
            -- The pages sheet shows Teach while the actor presents a session of this team that has not
            -- ended and starts in the next 90 days (teach.read's upcoming window), whatever week is loaded.
            'presenting', exists (select 1 from public.teaching_occurrences o
              where o.service_id = t.id and o.presenter_id = p_actor_id and o.status <> 'cancelled'
                and o.ends_at > now() and o.starts_at < now() + interval '90 days')) order by t.name, t.id)
          from teams t), '[]'::jsonb),
        'sessions', coalesce((select jsonb_agg(jsonb_build_object(
            'occurrenceId', o.id, 'serviceId', o.service_id, 'title', o.title, 'startsAt', o.starts_at, 'endsAt', o.ends_at,
            'venue', o.venue, 'hasJoinLink', o.join_url is not null, 'status', o.status,
            'isPresenter', o.presenter_id is not distinct from p_actor_id, 'source', 'teaching') order by o.starts_at, o.id)
          from public.teaching_occurrences o left join teams t on t.id = o.service_id
          where o.starts_at >= (v_from::timestamp at time zone 'Australia/Perth')
            and o.starts_at < ((v_to + 1)::timestamp at time zone 'Australia/Perth')
            -- Own teams by the listing rule; another team's session only while it is in the actor's
            -- week from What's on and still open to their health service (spec §5a).
            and case when t.id is not null then public.teaching_occurrence_listed(o.id, p_actor_id, t.role)
              else public.teaching_week_added(o.id, p_actor_id) and public.teaching_occurrence_open_to(o.id, p_actor_id) end), '[]'::jsonb),
        'notices', coalesce((select jsonb_agg(jsonb_build_object(
            'id', x.id, 'occurrenceId', x.occurrence_id, 'serviceId', x.service_id, 'kind', x.kind, 'createdAt', x.created_at) order by x.created_at desc)
          from (
            select n.id, n.occurrence_id, n.service_id, n.kind, n.created_at
            from public.teaching_notices n
            join teams t on t.id = n.service_id
            join public.teaching_occurrences o on o.id = n.occurrence_id
            where o.ends_at > now()
              and not exists (select 1 from public.teaching_notice_reads r where r.notice_id = n.id and r.user_id = p_actor_id)
              and public.teaching_occurrence_listed(o.id, p_actor_id, t.role)
            order by n.created_at desc
            limit 50
          ) as x), '[]'::jsonb),
        'attendance', coalesce((select jsonb_agg(jsonb_build_object(
            'occurrenceId', a.occurrence_id, 'method', a.method, 'recordedAt', a.recorded_at) order by a.recorded_at)
          from public.teaching_attendance a
          join public.teaching_occurrences o on o.id = a.occurrence_id
          left join teams t on t.id = a.service_id
          where a.user_id = p_actor_id and (t.id is not null or a.visitor)
            and o.starts_at >= (v_from::timestamp at time zone 'Australia/Perth')
            and o.starts_at < ((v_to + 1)::timestamp at time zone 'Australia/Perth')), '[]'::jsonb)
      ) into v_result;
      return v_result;

    elsif p_action = 'logbook.read' then
      -- Own record only. A leaver keeps read-only access for 90 days from the shared revoke.
      perform 1 from public.on_call_services s
      where exists (select 1 from public.on_call_service_members m where m.service_id = s.id and m.user_id = p_actor_id
        and (m.revoked_at is null or m.revoked_at > now() - interval '90 days'))
      order by s.id for share;
      select jsonb_build_object('attendance', coalesce(jsonb_agg(jsonb_build_object(
          'occurrenceId', a.occurrence_id, 'method', a.method, 'recordedAt', a.recorded_at,
          'title', o.title, 'startsAt', o.starts_at, 'endsAt', o.ends_at,
          'serviceId', s.id, 'serviceName', s.name,
          'readOnlyUntil', case when m.revoked_at is null then null else m.revoked_at + interval '90 days' end,
          'cpdEntryId', (select e.id from public.cme_entries e where e.owner_id = p_actor_id
            and e.source_ref = 'teaching:' || a.occurrence_id::text and e.archived_at is null)
        ) order by o.starts_at desc, a.occurrence_id), '[]'::jsonb))
      into v_result
      from public.teaching_attendance a
      join public.teaching_occurrences o on o.id = a.occurrence_id
      join public.on_call_services s on s.id = a.service_id
      left join public.on_call_service_members m on m.service_id = a.service_id and m.user_id = p_actor_id
      -- A visitor row (What's on) is the visitor's own record and needs no membership of the host.
      where a.user_id = p_actor_id
        and (a.visitor or (m.user_id is not null and (m.revoked_at is null or m.revoked_at > now() - interval '90 days')));
      return v_result;

    elsif p_action = 'cpd.unlogged' then
      -- A count only, for CPD's Today. Nothing from CPD is returned or stored here.
      perform 1 from public.on_call_services s
      where exists (select 1 from public.on_call_service_members m where m.service_id = s.id and m.user_id = p_actor_id
        and (m.revoked_at is null or m.revoked_at > now() - interval '90 days'))
      order by s.id for share;
      select count(*) into v_count
      from public.teaching_attendance a
      join public.teaching_occurrences o on o.id = a.occurrence_id
      left join public.on_call_service_members m on m.service_id = a.service_id and m.user_id = p_actor_id
      where a.user_id = p_actor_id
        and (a.visitor or (m.user_id is not null and (m.revoked_at is null or m.revoked_at > now() - interval '90 days')))
        and o.ends_at <= now()
        and not exists (select 1 from public.cme_entries e where e.owner_id = p_actor_id
          and e.source_ref = 'teaching:' || a.occurrence_id::text and e.archived_at is null);
      return jsonb_build_object('count', v_count);

    elsif p_action = 'session.next' then
      -- The quiet-day hero: the actor's next listed session in any active team, however far ahead
      -- (not limited to week.read's range), or null. A running session counts; cancelled ones do not.
      perform 1 from public.on_call_services s
      where exists (select 1 from public.on_call_service_members m where m.service_id = s.id and m.user_id = p_actor_id and m.revoked_at is null)
      order by s.id for share;
      select jsonb_build_object('session', (select jsonb_build_object(
          'occurrenceId', o.id, 'serviceId', o.service_id, 'title', o.title, 'startsAt', o.starts_at, 'endsAt', o.ends_at,
          'venue', o.venue, 'hasJoinLink', o.join_url is not null, 'status', o.status,
          'isPresenter', o.presenter_id is not distinct from p_actor_id, 'source', 'teaching')
        from public.teaching_occurrences o
        join public.on_call_service_members m on m.service_id = o.service_id and m.user_id = p_actor_id and m.revoked_at is null
        where o.ends_at > now() and o.status <> 'cancelled'
          and public.teaching_occurrence_listed(o.id, p_actor_id, public.teaching_member_role(o.service_id, p_actor_id))
        order by o.starts_at, o.id
        limit 1)) into v_result;
      return v_result;

    elsif p_action = 'supervision.pending' then
      -- Today's count of confirmations waiting for the actor as supervisor: pending entries and
      -- unconfirmed correction notes, in teams where the actor is still active. A count only.
      perform 1 from public.on_call_services s
      where exists (select 1 from public.on_call_service_members m where m.service_id = s.id and m.user_id = p_actor_id and m.revoked_at is null)
      order by s.id for share;
      select (select count(*) from public.teaching_supervision_entries e
          join public.teaching_supervision_pairings p on p.id = e.pairing_id
          where p.supervisor_id = p_actor_id and e.status = 'pending' and public.service_member_active(p.service_id, p_actor_id))
        + (select count(*) from public.teaching_supervision_notes n
          join public.teaching_supervision_entries e on e.id = n.entry_id
          join public.teaching_supervision_pairings p on p.id = e.pairing_id
          where p.supervisor_id = p_actor_id and n.confirmed_at is null and public.service_member_active(p.service_id, p_actor_id))
      into v_count;
      return jsonb_build_object('count', v_count);

    elsif p_action = 'supervision.left_services' then
      -- The teams the actor left in the last 90 days where they are the registrar on a pairing with
      -- supervision entries, so the app can offer supervision.read's leaver window there even with no
      -- attendance (logbook.read finds teams only through attendance). The actor's own record, so no
      -- audit; one read, so no lock. Team and dates only: no pairing details and no other people.
      select jsonb_build_object('services', coalesce(jsonb_agg(jsonb_build_object(
          'serviceId', s.id, 'serviceName', s.name, 'leftAt', m.revoked_at,
          'readableUntil', m.revoked_at + interval '90 days') order by m.revoked_at desc, s.id), '[]'::jsonb))
      into v_result
      from public.on_call_service_members m
      join public.on_call_services s on s.id = m.service_id
      where m.user_id = p_actor_id
        and m.revoked_at is not null and m.revoked_at > now() - interval '90 days'
        and exists (select 1 from public.teaching_supervision_pairings p
          where p.service_id = m.service_id and p.registrar_id = p_actor_id
            and exists (select 1 from public.teaching_supervision_entries e where e.pairing_id = p.id));
      return v_result;

    elsif p_action in ('teach.read','feedback.open') then
      perform 1 from public.on_call_services s
      where exists (select 1 from public.on_call_service_members m where m.service_id = s.id and m.user_id = p_actor_id and m.revoked_at is null)
      order by s.id for share;
      if p_action = 'teach.read' then
        -- The actor's own talks only (presenter_id = actor): the next 90 days with their checklist, and
        -- up to 50 ended talks from the last year.
        select jsonb_build_object(
          'upcoming', coalesce((select jsonb_agg(jsonb_build_object(
              'occurrenceId', o.id, 'serviceId', o.service_id, 'title', o.title, 'startsAt', o.starts_at,
              'endsAt', o.ends_at, 'venue', o.venue, 'status', o.status,
              'items', coalesce(to_jsonb(r.items), '[]'::jsonb), 'deidConfirmedAt', r.deid_confirmed_at)
              order by o.starts_at, o.id)
            from public.teaching_occurrences o
            left join public.teaching_readiness r on r.occurrence_id = o.id
            where o.presenter_id = p_actor_id and o.ends_at > now() and o.starts_at < now() + interval '90 days'
              and public.service_member_active(o.service_id, p_actor_id)), '[]'::jsonb),
          'taught', coalesce((select jsonb_agg(jsonb_build_object(
              'occurrenceId', t.id, 'serviceId', t.service_id, 'title', t.title, 'startsAt', t.starts_at,
              'endsAt', t.ends_at) order by t.starts_at desc, t.id)
            from (select o.id, o.service_id, o.title, o.starts_at, o.ends_at from public.teaching_occurrences o
              where o.presenter_id = p_actor_id and o.status <> 'cancelled' and o.ends_at <= now()
                and o.ends_at > now() - interval '365 days' and public.service_member_active(o.service_id, p_actor_id)
              order by o.starts_at desc, o.id limit 50) as t), '[]'::jsonb))
        into v_result;
      else
        -- Sessions the actor attended as a member, ended in the last 7 days and not yet answered. It checks
        -- the same one-way marker feedback.submit writes, so nothing new ties a person to an answer.
        select jsonb_build_object('sessions', coalesce(jsonb_agg(jsonb_build_object(
            'occurrenceId', o.id, 'serviceId', o.service_id, 'title', o.title, 'startsAt', o.starts_at,
            'endsAt', o.ends_at) order by o.ends_at desc, o.id), '[]'::jsonb))
        into v_result
        from public.teaching_attendance a
        join public.teaching_occurrences o on o.id = a.occurrence_id
        where a.user_id = p_actor_id and o.status <> 'cancelled'
          and o.ends_at <= now() and o.ends_at > now() - interval '7 days'
          and public.service_member_active(o.service_id, p_actor_id)
          and not exists (select 1 from public.teaching_feedback_replied f
            where f.occurrence_id = o.id and f.reply_marker = encode(extensions.digest(
              convert_to('teaching-feedback:' || o.id::text || ':' || p_actor_id::text, 'UTF8'), 'sha256'), 'hex'));
      end if;
      return v_result;

    elsif p_action = 'checkin.complete' then
      -- Redeem a claim recorded by teaching_checkin_open, after sign-in.
      v_code := public.teaching_text_arg(p_payload, 'claimHash');
      if v_code is null or v_code !~ '^[a-f0-9]{64}$' then raise exception 'teaching_invalid_request'; end if;
      select * into v_claim from public.teaching_checkin_claims where claim_hash = v_code for update;
      if not found then raise exception 'teaching_code_invalid'; end if;
      select * into v_occ from public.teaching_occurrences where id = v_claim.occurrence_id;
      select * into v_service from public.on_call_services where id = v_occ.service_id for share;
      if v_claim.used_at is not null then
        -- A retry by the same person returns the same mark; anyone else is refused.
        if v_claim.used_by is distinct from p_actor_id then raise exception 'teaching_code_expired'; end if;
        select jsonb_build_object('occurrenceId', a.occurrence_id, 'method', a.method, 'recordedAt', a.recorded_at)
        into v_result from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.user_id = p_actor_id;
        if v_result is null then raise exception 'teaching_code_expired'; end if;
        return v_result || jsonb_build_object('serviceId', v_occ.service_id, 'occurrenceId', v_occ.id);
      end if;
      if v_claim.expires_at <= now() then raise exception 'teaching_code_expired'; end if;
      if not public.service_member_active(v_occ.service_id, p_actor_id) then raise exception 'teaching_code_other_team'; end if;
      if not (v_service.verified_at is not null or v_service.is_demo) then raise exception 'teaching_team_unverified'; end if;
      if v_occ.status = 'cancelled' then raise exception 'teaching_window_closed'; end if;
      update public.teaching_checkin_claims set used_at = now(), used_by = p_actor_id where id = v_claim.id;
      v_result := public.teaching_record_attendance(p_actor_id, v_occ.service_id, v_occ.id,
        case v_claim.stream when 'room' then 'code_room' else 'code_teams' end);
      return v_result || jsonb_build_object('serviceId', v_occ.service_id, 'occurrenceId', v_occ.id);
    end if;
  end if;

  -- A calendar link knows only the occurrence, so session.read may come with a null team: take the
  -- occurrence's own team. The membership check below is unchanged.
  if p_action = 'session.read' and p_service_id is null then
    select o.service_id into p_service_id from public.teaching_occurrences o
    where o.id = public.teaching_uuid_arg(p_payload, 'occurrenceId');
    if p_service_id is null then raise exception 'teaching_not_found'; end if;
  end if;

  -- Everything else acts on one team.
  if p_service_id is null or p_action not in (
    'session.read','attendance.self','checkin.code','checkin.typed','display.create','display.revoke',
    'notice.read','calendar.set','series.save','occurrence.change','group.save','group.delete',
    'group.members.set','register.read','export.attendance','members.read','organise.read','invitation.create',
    'role.set','audit.read','attendance.remove'
  ) then
    raise exception 'teaching_invalid_request';
  end if;
  if p_action <> 'invitation.create' then
    -- Reads and check-ins share-lock the team row, so a revoke that commits first always wins.
    select * into v_service from public.on_call_services where id = p_service_id for share;
  else
    -- invitation.create does not: On Call's command, which it calls, locks the row itself, and
    -- upgrading a share lock held here would deadlock two concurrent invites.
    select * into v_service from public.on_call_services where id = p_service_id;
  end if;
  if not found then raise exception 'teaching_access_denied'; end if;
  v_role := public.teaching_member_role(p_service_id, p_actor_id);
  -- A What's on visitor (spec §5a) may read a session its team has opened to the visitor's health
  -- service, and nothing else: no codes, counts, register or writes. Every other action needs a member.
  if v_role is null and not (p_action = 'session.read'
      and public.teaching_occurrence_open_to(public.teaching_uuid_arg(p_payload, 'occurrenceId'), p_actor_id)) then
    raise exception 'teaching_access_denied';
  end if;
  if p_action not in ('session.read','checkin.code','register.read','export.attendance','members.read','organise.read','audit.read','role.set')
    and not (v_service.verified_at is not null or v_service.is_demo) then
    raise exception 'teaching_team_unverified';
  end if;
  -- 74818 guards Teaching's own tables only.
  v_needs_lock := p_action in ('display.create','display.revoke','series.save','occurrence.change','group.save',
    'group.delete','group.members.set','role.set','attendance.remove');
  if v_needs_lock then perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74818)); end if;

  if p_action in ('session.read','attendance.self','checkin.code','checkin.typed','display.create','register.read') then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    v_is_presenter := coalesce(v_occ.presenter_id = p_actor_id, false);
  end if;
  if p_action in ('checkin.code','checkin.typed','display.create') then
    v_stream := public.teaching_text_arg(p_payload, 'stream');
    if v_stream is null or v_stream not in ('room','teams') then raise exception 'teaching_invalid_request'; end if;
  end if;

  if p_action = 'session.read' then
    select * into v_series from public.teaching_series where id = v_occ.series_id;
    -- A health-service visitor (R5, R15) has no Teaching role here and got past the gate above only
    -- for an open series. They see time, place, join link and materials: no presenter name, and no
    -- code or counts (so no register), even if they once presented here and have since left.
    v_visitor := v_role is null;
    if v_visitor then v_is_presenter := false; end if;
    return jsonb_build_object(
      'occurrenceId', v_occ.id, 'serviceId', v_occ.service_id, 'seriesId', v_occ.series_id, 'title', v_occ.title,
      'startsAt', v_occ.starts_at, 'endsAt', v_occ.ends_at, 'venue', v_occ.venue,
      'hasJoinLink', v_occ.join_url is not null, 'status', v_occ.status,
      'previousStartsAt', case when v_occ.status = 'moved' then v_occ.previous_starts_at end,
      'isPresenter', v_is_presenter, 'source', 'teaching', 'visitor', v_visitor,
      'joinUrl', v_occ.join_url,
      'presenterName', case when v_visitor or v_occ.presenter_id is null then null else coalesce(
        (select coalesce(m.display_name, 'Member') from public.on_call_service_members m
         where m.service_id = p_service_id and m.user_id = v_occ.presenter_id and m.revoked_at is null),
        'Former member') end,
      'materials', coalesce(v_series.materials, '[]'::jsonb),
      'changeReason', v_occ.change_reason,
      -- The caller's own mark only, or null.
      'myAttendance', (select jsonb_build_object('method', a.method, 'recordedAt', a.recorded_at)
        from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.user_id = p_actor_id),
      'inCalendar', public.teaching_week_added(v_occ.id, p_actor_id),
      'canShowCode', v_is_presenter or coalesce(v_role = 'organiser', false),
      'counts', case when v_is_presenter or v_role in ('organiser','admin') then jsonb_build_object(
        -- Expected: active members of the series' groups, or every active member when it has none.
        'expected', case when cardinality(coalesce(v_series.group_ids, '{}')) > 0 then
            (select count(distinct gm.user_id) from public.teaching_group_members gm
             join public.on_call_service_members m on m.service_id = gm.service_id and m.user_id = gm.user_id and m.revoked_at is null
             where gm.service_id = p_service_id and gm.group_id = any(v_series.group_ids))
          else (select count(*) from public.on_call_service_members m where m.service_id = p_service_id and m.revoked_at is null) end,
        'code', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.method <> 'self'),
        'self', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.method = 'self' and not a.visitor),
        'visitors', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.visitor))
        else null end
    );

  elsif p_action = 'attendance.self' then
    if v_occ.status = 'cancelled' or now() < v_occ.starts_at or now() > v_occ.ends_at + interval '7 days' then
      raise exception 'teaching_window_closed';
    end if;
    return public.teaching_record_attendance(p_actor_id, p_service_id, v_occ.id, 'self');

  elsif p_action = 'checkin.code' then
    -- Spec role table: the presenter and organisers show codes; an admin does not.
    if not (v_is_presenter or v_role = 'organiser') then raise exception 'teaching_role_denied'; end if;
    if v_occ.status = 'cancelled' or now() < v_occ.starts_at - interval '15 minutes' or now() > v_occ.ends_at + interval '15 minutes' then
      raise exception 'teaching_window_closed';
    end if;
    v_window := floor(extract(epoch from now()) / 30)::bigint;
    v_mac := public.teaching_code_mac(v_occ.checkin_secret, v_occ.id, v_stream, v_window);
    v_typed := public.teaching_typed_code(v_occ.checkin_secret, v_occ.id, v_stream, v_window);
    return jsonb_build_object(
      'token', replace(v_occ.id::text, '-', '') || left(v_stream, 1) || v_window::text || v_mac,
      'typedCode', v_typed,
      'window', v_window,
      'validUntil', to_timestamp((v_window + 1) * 30)
    );

  elsif p_action = 'checkin.typed' then
    v_code := public.teaching_text_arg(p_payload, 'code');
    if v_code is null or v_code !~ '^[0-9]{6}$' then raise exception 'teaching_invalid_request'; end if;
    if v_occ.status = 'cancelled' or now() < v_occ.starts_at - interval '15 minutes' or now() > v_occ.ends_at + interval '15 minutes' then
      raise exception 'teaching_window_closed';
    end if;
    v_window := floor(extract(epoch from now()) / 30)::bigint;
    v_typed := public.teaching_typed_code(v_occ.checkin_secret, v_occ.id, v_stream, v_window);
    v_typed_previous := public.teaching_typed_code(v_occ.checkin_secret, v_occ.id, v_stream, v_window - 1);
    if not (public.teaching_const_eq(v_code, v_typed) or public.teaching_const_eq(v_code, v_typed_previous)) then
      raise exception 'teaching_code_invalid';
    end if;
    return public.teaching_record_attendance(p_actor_id, p_service_id, v_occ.id,
      case v_stream when 'room' then 'code_room' else 'code_teams' end);

  elsif p_action = 'display.create' then
    if not (v_is_presenter or v_role = 'organiser') then raise exception 'teaching_role_denied'; end if;
    v_code := public.teaching_text_arg(p_payload, 'linkHash');
    if v_code is null or v_code !~ '^[a-f0-9]{64}$' then raise exception 'teaching_invalid_request'; end if;
    if v_occ.status = 'cancelled' or now() > v_occ.ends_at + interval '15 minutes' then raise exception 'teaching_window_closed'; end if;
    if (select count(*) from public.teaching_display_links
        where occurrence_id = v_occ.id and revoked_at is null and expires_at > now()) >= 10 then
      raise exception 'teaching_limit';
    end if;
    insert into public.teaching_display_links(occurrence_id, stream, link_hash, created_by, expires_at)
    values (v_occ.id, v_stream, v_code, p_actor_id, v_occ.ends_at + interval '15 minutes')
    returning * into v_link;
    perform public.teaching_audit(p_service_id, p_actor_id, 'display.create', v_occ.id);
    return jsonb_build_object('expiresAt', v_link.expires_at);

  elsif p_action = 'display.revoke' then
    v_code := public.teaching_text_arg(p_payload, 'linkHash');
    if v_code is null or v_code !~ '^[a-f0-9]{64}$' then raise exception 'teaching_invalid_request'; end if;
    select l.* into v_link from public.teaching_display_links l
    join public.teaching_occurrences o on o.id = l.occurrence_id
    where l.link_hash = v_code and o.service_id = p_service_id
    for update of l;
    if not found then raise exception 'teaching_not_found'; end if;
    if not (v_link.created_by = p_actor_id or v_role = 'organiser') then raise exception 'teaching_role_denied'; end if;
    update public.teaching_display_links set revoked_at = coalesce(revoked_at, now()) where id = v_link.id;
    perform public.teaching_audit(p_service_id, p_actor_id, 'display.revoke', v_link.occurrence_id);
    return '{}'::jsonb;

  elsif p_action = 'notice.read' then
    v_id := public.teaching_uuid_arg(p_payload, 'noticeId');
    if v_id is null or not exists (select 1 from public.teaching_notices where id = v_id and service_id = p_service_id) then
      raise exception 'teaching_not_found';
    end if;
    insert into public.teaching_notice_reads(notice_id, user_id) values (v_id, p_actor_id)
    on conflict (notice_id, user_id) do nothing;
    perform public.teaching_audit(p_service_id, p_actor_id, 'notice.read', v_id);
    return '{}'::jsonb;

  elsif p_action = 'calendar.set' then
    if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'teaching_invalid_request'; end if;
    if (p_payload->>'enabled')::boolean then
      insert into public.teaching_calendar_optins(service_id, user_id) values (p_service_id, p_actor_id)
      on conflict (service_id, user_id) do nothing;
    else
      delete from public.teaching_calendar_optins where service_id = p_service_id and user_id = p_actor_id;
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'calendar.set', null);
    return jsonb_build_object('enabled', (p_payload->>'enabled')::boolean);

  elsif p_action = 'series.save' then
    if v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;
    v_result := public.teaching_series_save(p_actor_id, p_service_id, p_payload);
    perform public.teaching_audit(p_service_id, p_actor_id, 'series.save', public.teaching_uuid_arg(v_result, 'seriesId'));
    return v_result;

  elsif p_action = 'occurrence.change' then
    if v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    v_status := public.teaching_text_arg(p_payload, 'status');
    v_reason := public.teaching_text_arg(p_payload, 'reason');
    if v_status is null or v_status not in ('moved','cancelled')
      or v_reason is null or v_reason not in ('presenter_unavailable','room_change','clinical_pressure','public_holiday','rescheduled','other') then
      raise exception 'teaching_invalid_request';
    end if;
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id for update;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_occ.status = 'cancelled' then raise exception 'teaching_invalid_request'; end if;
    if v_occ.ends_at <= now() then raise exception 'teaching_window_closed'; end if;
    if v_status = 'moved' then
      v_starts := coalesce(public.teaching_ts_arg(p_payload, 'startsAt'), v_occ.starts_at);
      v_ends := coalesce(public.teaching_ts_arg(p_payload, 'endsAt'), v_starts + (v_occ.ends_at - v_occ.starts_at));
      v_venue := case when p_payload ? 'venue' then nullif(btrim(coalesce(public.teaching_text_arg(p_payload, 'venue'), '')), '') else v_occ.venue end;
      if v_ends <= v_starts or v_ends > v_starts + interval '8 hours' or v_ends <= now()
        or (v_venue is not null and char_length(v_venue) > 160)
        or (v_starts = v_occ.starts_at and v_ends = v_occ.ends_at and v_venue is not distinct from v_occ.venue) then
        raise exception 'teaching_invalid_request';
      end if;
      update public.teaching_occurrences set status = 'moved', starts_at = v_starts, ends_at = v_ends, venue = v_venue,
        change_reason = v_reason, changed_at = now(),
        previous_starts_at = case when v_starts <> v_occ.starts_at then v_occ.starts_at else v_occ.previous_starts_at end
      where id = v_occ.id;
      update public.teaching_display_links set expires_at = greatest(v_ends + interval '15 minutes', created_at + interval '1 second')
      where occurrence_id = v_occ.id and revoked_at is null;
    else
      update public.teaching_occurrences set status = 'cancelled', change_reason = v_reason, changed_at = now()
      where id = v_occ.id;
      update public.teaching_display_links set revoked_at = now() where occurrence_id = v_occ.id and revoked_at is null;
    end if;
    insert into public.teaching_notices(service_id, occurrence_id, kind, created_by)
    values (p_service_id, v_occ.id, v_status, p_actor_id);
    perform public.teaching_audit(p_service_id, p_actor_id, 'occurrence.change', v_occ.id);
    return '{}'::jsonb;

  elsif p_action = 'group.save' then
    -- Spec §4: groups are for organisers and admins.
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    v_id := public.teaching_uuid_arg(p_payload, 'groupId');
    v_text := btrim(coalesce(public.teaching_text_arg(p_payload, 'name'), ''));
    if char_length(v_text) not between 1 and 80 then raise exception 'teaching_invalid_request'; end if;
    if v_id is null then
      if (select count(*) from public.teaching_groups where service_id = p_service_id) >= 200 then raise exception 'teaching_limit'; end if;
      insert into public.teaching_groups(service_id, name) values (p_service_id, v_text) returning id into v_id;
    else
      update public.teaching_groups set name = v_text where id = v_id and service_id = p_service_id;
      if not found then raise exception 'teaching_not_found'; end if;
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'group.save', v_id);
    return jsonb_build_object('groupId', v_id);

  elsif p_action = 'group.delete' then
    -- Spec §4: groups are for organisers and admins.
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    v_id := public.teaching_uuid_arg(p_payload, 'groupId');
    delete from public.teaching_groups where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    -- A series left with no groups shows to the whole team again.
    update public.teaching_series set group_ids = array_remove(group_ids, v_id), updated_at = now()
    where service_id = p_service_id and v_id = any(group_ids);
    perform public.teaching_audit(p_service_id, p_actor_id, 'group.delete', v_id);
    return jsonb_build_object('groupId', v_id);

  elsif p_action = 'group.members.set' then
    -- Spec §4: groups are for organisers and admins.
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    v_id := public.teaching_uuid_arg(p_payload, 'groupId');
    if v_id is null or not exists (select 1 from public.teaching_groups where id = v_id and service_id = p_service_id) then
      raise exception 'teaching_not_found';
    end if;
    v_ids := public.teaching_uuid_array_arg(p_payload, 'userIds', 500);
    if exists (select 1 from unnest(v_ids) as u where not public.service_member_active(p_service_id, u)) then
      raise exception 'teaching_invalid_request';
    end if;
    delete from public.teaching_group_members where group_id = v_id and not (user_id = any(v_ids));
    insert into public.teaching_group_members(group_id, service_id, user_id)
    select v_id, p_service_id, u from unnest(v_ids) as u
    on conflict (group_id, user_id) do nothing;
    perform public.teaching_audit(p_service_id, p_actor_id, 'group.members.set', v_id);
    return jsonb_build_object('groupId', v_id);

  elsif p_action = 'attendance.remove' then
    -- Self-reported check-ins count straight away (no approval queue); an organiser may remove one.
    -- Code check-ins are never removed. Audited, with the removed person as the subject.
    if v_role <> 'organiser' then raise exception 'teaching_role_denied'; end if;
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    v_user := public.teaching_uuid_arg(p_payload, 'userId');
    if v_id is null or v_user is null then raise exception 'teaching_invalid_request'; end if;
    delete from public.teaching_attendance a
    where a.occurrence_id = v_id and a.service_id = p_service_id and a.user_id = v_user and a.method = 'self';
    if not found then raise exception 'teaching_not_found'; end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'attendance.remove', v_user);
    return '{}'::jsonb;

  elsif p_action = 'register.read' then
    if v_role = 'organiser' then
      perform public.teaching_audit(p_service_id, p_actor_id, 'register.read', v_occ.id);
      return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
          'userId', a.user_id, 'name', coalesce(m.display_name, 'Member'), 'method', a.method,
          'recordedAt', a.recorded_at, 'upgradedFrom', a.upgraded_from)
          order by lower(coalesce(m.display_name, 'Member')), a.recorded_at)
        from public.teaching_attendance a
        left join public.on_call_service_members m on m.service_id = a.service_id and m.user_id = a.user_id
        where a.occurrence_id = v_occ.id and not a.visitor), '[]'::jsonb),
        -- Visitors from other teams are counted, never named (spec §5a).
        'visitors', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.visitor));
    elsif v_is_presenter then
      return jsonb_build_object('counts', jsonb_build_object(
        'code', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.method <> 'self'),
        'self', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.method = 'self' and not a.visitor),
        'visitors', (select count(*) from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.visitor)));
    end if;
    raise exception 'teaching_role_denied';

  elsif p_action = 'export.attendance' then
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    v_from := public.teaching_date_arg(p_payload, 'from');
    v_to := public.teaching_date_arg(p_payload, 'to');
    if v_from is null or v_to is null or v_to < v_from or v_to - v_from > 366 then raise exception 'teaching_invalid_request'; end if;
    select count(*) into v_count
    from public.teaching_attendance a join public.teaching_occurrences o on o.id = a.occurrence_id
    where a.service_id = p_service_id and not a.visitor
      and o.starts_at >= (v_from::timestamp at time zone 'Australia/Perth')
      and o.starts_at < ((v_to + 1)::timestamp at time zone 'Australia/Perth');
    if v_count > 50000 then raise exception 'teaching_limit'; end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'export.attendance', null);
    return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
        'occurrenceId', o.id, 'title', o.title, 'startsAt', o.starts_at, 'endsAt', o.ends_at, 'status', o.status,
        'userId', a.user_id, 'name', coalesce(m.display_name, 'Member'), 'method', a.method, 'recordedAt', a.recorded_at)
        order by o.starts_at, o.id, lower(coalesce(m.display_name, 'Member')))
      from public.teaching_attendance a
      join public.teaching_occurrences o on o.id = a.occurrence_id
      left join public.on_call_service_members m on m.service_id = a.service_id and m.user_id = a.user_id
      where a.service_id = p_service_id and not a.visitor
        and o.starts_at >= (v_from::timestamp at time zone 'Australia/Perth')
        and o.starts_at < ((v_to + 1)::timestamp at time zone 'Australia/Perth')), '[]'::jsonb));

  elsif p_action = 'members.read' then
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'members.read', null);
    return jsonb_build_object('members', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', m.user_id, 'name', coalesce(m.display_name, 'Member'),
        'role', public.teaching_member_role(p_service_id, m.user_id), 'joinedAt', m.joined_at)
        order by lower(coalesce(m.display_name, 'Member')), m.user_id)
      from public.on_call_service_members m
      where m.service_id = p_service_id and m.revoked_at is null), '[]'::jsonb));

  elsif p_action = 'organise.read' then
    -- The Organise page's editors: every series of the team, the groups with their member ids, and
    -- the active members. One audited read; no attendance and nothing from the check-in secret.
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'organise.read', null);
    return jsonb_build_object(
      'series', coalesce((select jsonb_agg(jsonb_build_object(
          'seriesId', s.id, 'title', s.title, 'kind', s.kind, 'groupIds', to_jsonb(s.group_ids), 'repeat', s.repeat,
          'firstDate', s.first_date, 'startTime', to_char(s.start_time, 'HH24:MI'), 'minutes', s.minutes,
          'venue', s.venue, 'joinUrl', s.join_url, 'skipDates', to_jsonb(s.skip_dates), 'endDate', s.end_date,
          'presenterId', s.presenter_id, 'materials', s.materials, 'audience', s.audience, 'openTo', s.open_to,
          'lastConfirmedAt', s.last_confirmed_at)
          order by s.first_date desc, s.id)
        from public.teaching_series s where s.service_id = p_service_id), '[]'::jsonb),
      'groups', coalesce((select jsonb_agg(jsonb_build_object(
          'groupId', g.id, 'name', g.name,
          'userIds', coalesce((select jsonb_agg(gm.user_id order by gm.user_id)
            from public.teaching_group_members gm where gm.group_id = g.id), '[]'::jsonb))
          order by lower(g.name), g.id)
        from public.teaching_groups g where g.service_id = p_service_id), '[]'::jsonb),
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'userId', m.user_id, 'name', coalesce(m.display_name, 'Member'),
          'role', public.teaching_member_role(p_service_id, m.user_id), 'joinedAt', m.joined_at)
          order by lower(coalesce(m.display_name, 'Member')), m.user_id)
        from public.on_call_service_members m
        where m.service_id = p_service_id and m.revoked_at is null), '[]'::jsonb));

  elsif p_action = 'invitation.create' then
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    v_text := lower(btrim(coalesce(public.teaching_text_arg(p_payload, 'email'), '')));
    v_code := public.teaching_text_arg(p_payload, 'tokenHash');
    if char_length(v_text) not between 3 and 254 or v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or v_code is null or v_code !~ '^[a-f0-9]{64}$' then
      raise exception 'teaching_invalid_request';
    end if;
    -- On Call's command is the single writer of invitations (shared contract v6): it locks the
    -- service row, enforces the shared caps, checks teaching_can_invite for the actor, forces the
    -- member role and stores the email and issued_via_mode. Teaching never writes the table.
    begin
      v_result := public.on_call_service_command(p_actor_id, p_service_id, 'invitation.create', jsonb_build_object(
        'tokenHash', v_code, 'invitedEmail', v_text, 'expiresInDays', 7, 'role', 'member', 'issuedViaMode', 'teaching'));
    exception when raise_exception then
      if sqlerrm = 'service_limit' then raise exception 'teaching_limit'; end if;
      if sqlerrm = 'service_role_denied' then raise exception 'teaching_role_denied'; end if;
      if sqlerrm = 'service_invalid_request' then raise exception 'teaching_invalid_request'; end if;
      raise;
    end;
    v_id := public.teaching_uuid_arg(v_result, 'invitationId');
    v_ends := public.teaching_ts_arg(v_result, 'expiresAt');
    if v_id is null or v_ends is null then raise exception 'teaching_invalid_request'; end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'invitation.create', v_id);
    return jsonb_build_object('invitationId', v_id, 'expiresAt', v_ends);

  elsif p_action = 'role.set' then
    v_user := public.teaching_uuid_arg(p_payload, 'userId');
    v_text := public.teaching_text_arg(p_payload, 'role');
    if v_user is null or v_text is null or v_text not in ('doctor','organiser','admin') then raise exception 'teaching_invalid_request'; end if;
    -- A Teaching admin, or an On Call service admin while the team has no active Teaching admin.
    if not (v_role = 'admin' or (public.teaching_admin_count(p_service_id) = 0 and exists (
        select 1 from public.on_call_service_members m
        where m.service_id = p_service_id and m.user_id = p_actor_id and m.revoked_at is null and m.role = 'admin'))) then
      raise exception 'teaching_role_denied';
    end if;
    if not public.service_member_active(p_service_id, v_user) then raise exception 'teaching_not_found'; end if;
    if public.teaching_member_role(p_service_id, v_user) = 'admin' and v_text <> 'admin'
      and public.teaching_admin_count(p_service_id) <= 1 then
      raise exception 'teaching_last_admin';
    end if;
    if v_text = 'doctor' then
      update public.teaching_member_roles set revoked_at = now()
      where service_id = p_service_id and user_id = v_user and revoked_at is null;
    else
      insert into public.teaching_member_roles(service_id, user_id, role, granted_by)
      values (p_service_id, v_user, v_text, p_actor_id)
      on conflict (service_id, user_id) do update
        set role = excluded.role, granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;
    end if;
    insert into public.on_call_service_member_events(service_id, user_id, event, mode, actor_id)
    values (p_service_id, v_user, 'role_changed', 'teaching', p_actor_id);
    perform public.teaching_audit(p_service_id, p_actor_id, 'role.set', v_user);
    return '{}'::jsonb;

  elsif p_action = 'audit.read' then
    if v_role <> 'admin' then raise exception 'teaching_role_denied'; end if;
    -- Keyset paging by (at, id): pass the last row's at as before and its id as beforeId, so rows
    -- that share a timestamp are never skipped or repeated.
    v_before := public.teaching_ts_arg(p_payload, 'before');
    v_text := p_payload->'beforeId' #>> '{}';
    if (v_before is null) <> (v_text is null)
      or (v_text is not null and (jsonb_typeof(p_payload->'beforeId') <> 'number' or v_text !~ '^[0-9]{1,18}$')) then
      raise exception 'teaching_invalid_request';
    end if;
    v_before := coalesce(v_before, 'infinity'::timestamptz);
    v_before_id := coalesce(v_text::bigint, 9223372036854775807);
    perform public.teaching_audit(p_service_id, p_actor_id, 'audit.read', null);
    return jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'actorId', x.actor_id, 'actorName', x.actor_name, 'action', x.action, 'subjectId', x.subject_id, 'at', x.at)
        order by x.at desc, x.id desc)
      from (
        select e.id, e.actor_id, e.action, e.subject_id, e.at,
          case when e.actor_id is null then null else coalesce(
            (select coalesce(m.display_name, 'Member') from public.on_call_service_members m
             where m.service_id = e.service_id and m.user_id = e.actor_id), 'Former member') end as actor_name
        from public.teaching_audit_events e
        where e.service_id = p_service_id and (e.at, e.id) < (v_before, v_before_id)
        order by e.at desc, e.id desc
        limit 50
      ) as x), '[]'::jsonb));
  end if;

  raise exception 'teaching_invalid_request';
end $$;

revoke all on function public.teaching_command(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.teaching_command(uuid, uuid, text, jsonb) to service_role;
