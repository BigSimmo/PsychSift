-- Teaching feedback totals are released to a presenter only once at least 5 people have answered
-- (was 3), as the owner agreed in the Teaching v5 review on 2026-10-05 (follow-up to PR #3304).
-- Only the release threshold changes; the function is
-- otherwise byte-identical to 20260927135500_teaching_permission_null_guards.sql, and the grants
-- are restated unchanged.

create or replace function public.teaching_depth_command(p_actor_id uuid, p_service_id uuid, p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = public, pg_catalog, pg_temp as $$
declare
  v_service public.on_call_services;
  v_role text;
  v_occ public.teaching_occurrences;
  v_pairing public.teaching_supervision_pairings;
  v_entry public.teaching_supervision_entries;
  v_note public.teaching_supervision_notes;
  v_readiness public.teaching_readiness;
  v_id uuid;
  v_registrar uuid;
  v_supervisor uuid;
  v_ids uuid[];
  v_topics text[];
  v_starts date;
  v_ends date;
  v_date date;
  v_target numeric;
  v_text text;
  v_minutes integer;
  v_useful integer;
  v_count integer;
  v_result jsonb;
  v_row jsonb;
  v_leaver boolean := false;
begin
  if p_actor_id is null then raise exception 'teaching_auth_required'; end if;
  if p_action is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_service_id is null
    or p_action not in ('pairing.save','pairing.reassign','supervision.log','supervision.confirm','supervision.note',
      'supervision.note.confirm','supervision.read','supervision.target.set','readiness.set','readiness.deid.confirm',
      'feedback.submit','feedback.totals','import.commit') then
    raise exception 'teaching_invalid_request';
  end if;
  select * into v_service from public.on_call_services where id = p_service_id for share;
  if not found then raise exception 'teaching_access_denied'; end if;
  v_role := public.teaching_member_role(p_service_id, p_actor_id);
  if v_role is null then
    -- A leaver keeps read-only access to their own supervision entries (as registrar) for 90 days
    -- from the shared revoke, as logbook.read keeps their attendance (spec §9). Nothing else.
    v_leaver := p_action = 'supervision.read' and exists (select 1 from public.on_call_service_members m
      where m.service_id = p_service_id and m.user_id = p_actor_id
        and m.revoked_at is not null and m.revoked_at > now() - interval '90 days');
    if not v_leaver then raise exception 'teaching_access_denied'; end if;
  end if;
  if p_action not in ('supervision.read','feedback.totals') and not (v_service.verified_at is not null or v_service.is_demo) then
    raise exception 'teaching_team_unverified';
  end if;
  if p_action in ('pairing.save','pairing.reassign','import.commit') then
    perform pg_advisory_xact_lock(hashtextextended(p_service_id::text, 74818));
  end if;

  if p_action = 'pairing.save' then
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    v_registrar := public.teaching_uuid_arg(p_payload, 'registrarId');
    v_supervisor := public.teaching_uuid_arg(p_payload, 'supervisorId');
    v_starts := public.teaching_date_arg(p_payload, 'startsOn');
    v_ends := public.teaching_date_arg(p_payload, 'endsOn');
    -- The hours target is the registrar's own (supervision.target.set); an organiser never sets it.
    if p_payload ? 'targetHours' then raise exception 'teaching_invalid_request'; end if;
    -- Organisers pair other people. A pairing that includes the actor needs a Teaching admin.
    if not (v_role = 'admin' or (v_role = 'organiser' and p_actor_id <> v_registrar and p_actor_id <> v_supervisor)) then
      raise exception 'teaching_role_denied';
    end if;
    if v_registrar is null or v_supervisor is null or v_registrar = v_supervisor
      or v_starts is null or v_ends is null or v_ends < v_starts or v_ends > v_starts + 731
      or not public.service_member_active(p_service_id, v_registrar)
      or not public.service_member_active(p_service_id, v_supervisor) then
      raise exception 'teaching_invalid_request';
    end if;
    if v_id is null then
      if (select count(*) from public.teaching_supervision_pairings where service_id = p_service_id) >= 5000 then
        raise exception 'teaching_limit';
      end if;
      insert into public.teaching_supervision_pairings(service_id, registrar_id, supervisor_id, starts_on, ends_on, created_by)
      values (p_service_id, v_registrar, v_supervisor, v_starts, v_ends, p_actor_id)
      returning * into v_pairing;
    else
      select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
      if not found then raise exception 'teaching_not_found'; end if;
      -- Once a pairing has entries, only its end date and target can change; the supervisor
      -- changes through pairing.reassign.
      if exists (select 1 from public.teaching_supervision_entries e where e.pairing_id = v_pairing.id)
        and (v_pairing.registrar_id is distinct from v_registrar or v_pairing.supervisor_id is distinct from v_supervisor
          or v_pairing.starts_on <> v_starts) then
        raise exception 'teaching_invalid_request';
      end if;
      update public.teaching_supervision_pairings set registrar_id = v_registrar, supervisor_id = v_supervisor,
        starts_on = v_starts, ends_on = v_ends, updated_at = now()
      where id = v_pairing.id returning * into v_pairing;
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'pairing.save', v_pairing.id);
    return jsonb_build_object('pairingId', v_pairing.id);

  elsif p_action = 'pairing.reassign' then
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    v_supervisor := public.teaching_uuid_arg(p_payload, 'supervisorId');
    select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
    if not found then raise exception 'teaching_not_found'; end if;
    if not (v_role = 'admin' or (v_role = 'organiser' and p_actor_id is distinct from v_pairing.registrar_id and p_actor_id <> v_supervisor)) then
      raise exception 'teaching_role_denied';
    end if;
    if v_supervisor is null or v_supervisor is not distinct from v_pairing.registrar_id
      or not public.service_member_active(p_service_id, v_supervisor) then
      raise exception 'teaching_invalid_request';
    end if;
    -- Confirmed entries keep who confirmed them; pending entries and notes now wait for the new
    -- supervisor, because confirmation always checks the pairing's current supervisor.
    update public.teaching_supervision_pairings set supervisor_id = v_supervisor, updated_at = now() where id = v_pairing.id;
    select count(*) into v_count from public.teaching_supervision_entries where pairing_id = v_pairing.id and status = 'pending';
    perform public.teaching_audit(p_service_id, p_actor_id, 'pairing.reassign', v_pairing.id);
    return jsonb_build_object('pairingId', v_pairing.id, 'pendingMoved', v_count);

  elsif p_action = 'supervision.target.set' then
    -- The registrar's own hours target for this pairing: nullable, no default, and progress is shown
    -- only once it is set. Only the pairing's registrar sets or clears it (targetHours null).
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id for update;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_pairing.registrar_id is distinct from p_actor_id then raise exception 'teaching_role_denied'; end if;
    if not (p_payload ? 'targetHours') then raise exception 'teaching_invalid_request'; end if;
    if p_payload->'targetHours' <> 'null'::jsonb then
      if jsonb_typeof(p_payload->'targetHours') <> 'number' or (p_payload->>'targetHours') !~ '^[0-9]{1,3}(\.[0-9])?$' then
        raise exception 'teaching_invalid_request';
      end if;
      v_target := (p_payload->>'targetHours')::numeric;
      if v_target not between 1 and 500 then raise exception 'teaching_invalid_request'; end if;
    end if;
    update public.teaching_supervision_pairings set target_hours = v_target, updated_at = now() where id = v_pairing.id;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.target.set', v_pairing.id);
    return jsonb_build_object('pairingId', v_pairing.id, 'targetHours', v_target);

  elsif p_action = 'supervision.log' then
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    select * into v_pairing from public.teaching_supervision_pairings where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_pairing.registrar_id is distinct from p_actor_id then raise exception 'teaching_role_denied'; end if;
    v_date := public.teaching_date_arg(p_payload, 'date');
    v_minutes := public.teaching_int_arg(p_payload, 'minutes');
    v_text := public.teaching_text_arg(p_payload, 'type');
    v_topics := public.teaching_text_array_arg(p_payload, 'topics', 5);
    if v_date is null or v_date < v_pairing.starts_on or v_date > v_pairing.ends_on
      or v_date > (now() at time zone 'Australia/Perth')::date
      or v_minutes is null or v_minutes not between 15 and 240 or v_minutes % 15 <> 0
      or v_text is null or v_text not in ('individual','group')
      -- Topics are optional: none to five.
      or cardinality(v_topics) not between 0 and 5
      or not (v_topics <@ array['case_review','risk','psychotherapy','formulation','medication','mha_legal','teaching_skills','career','exam_prep','wellbeing','other']::text[]) then
      raise exception 'teaching_invalid_request';
    end if;
    if (select count(*) from public.teaching_supervision_entries where pairing_id = v_pairing.id) >= 1000 then
      raise exception 'teaching_limit';
    end if;
    insert into public.teaching_supervision_entries(pairing_id, service_id, session_date, minutes, type, topics, logged_by)
    values (v_pairing.id, p_service_id, v_date, v_minutes, v_text, v_topics, p_actor_id)
    returning * into v_entry;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.log', v_entry.id);
    return jsonb_build_object('entryId', v_entry.id);

  elsif p_action = 'supervision.confirm' then
    v_ids := public.teaching_uuid_array_arg(p_payload, 'entryIds', 20);
    if cardinality(v_ids) = 0 then raise exception 'teaching_invalid_request'; end if;
    -- All or nothing: every entry must be pending and belong to a pairing the actor now supervises.
    if (select count(*) from public.teaching_supervision_entries e
        join public.teaching_supervision_pairings p on p.id = e.pairing_id
        where e.id = any(v_ids) and e.service_id = p_service_id and e.status = 'pending' and p.supervisor_id = p_actor_id)
      <> cardinality(v_ids) then
      raise exception 'teaching_not_found';
    end if;
    update public.teaching_supervision_entries set status = 'confirmed', confirmed_by = p_actor_id, confirmed_at = now(), locked = true
    where id = any(v_ids);
    insert into public.teaching_audit_events(service_id, actor_id, action, subject_id)
    select p_service_id, p_actor_id, 'supervision.confirm', u from unnest(v_ids) as u;
    return jsonb_build_object('confirmed', cardinality(v_ids));

  elsif p_action = 'supervision.note' then
    v_id := public.teaching_uuid_arg(p_payload, 'entryId');
    select e.* into v_entry from public.teaching_supervision_entries e
    join public.teaching_supervision_pairings p on p.id = e.pairing_id
    where e.id = v_id and e.service_id = p_service_id and p.registrar_id = p_actor_id;
    if not found then raise exception 'teaching_not_found'; end if;
    v_text := public.teaching_text_arg(p_payload, 'reason');
    if v_text is null or not public.teaching_valid_correction(v_text, p_payload->'correctedValue') then
      raise exception 'teaching_invalid_request';
    end if;
    if v_text = 'wrong_date' then
      perform public.teaching_date_arg(p_payload->'correctedValue', 'date');
    end if;
    if (select count(*) from public.teaching_supervision_notes where entry_id = v_entry.id and confirmed_at is null) >= 5 then
      raise exception 'teaching_limit';
    end if;
    insert into public.teaching_supervision_notes(entry_id, service_id, reason, corrected_value, created_by)
    values (v_entry.id, p_service_id, v_text, p_payload->'correctedValue', p_actor_id)
    returning * into v_note;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.note', v_note.id);
    return jsonb_build_object('noteId', v_note.id);

  elsif p_action = 'supervision.note.confirm' then
    v_id := public.teaching_uuid_arg(p_payload, 'noteId');
    select n.* into v_note from public.teaching_supervision_notes n
    join public.teaching_supervision_entries e on e.id = n.entry_id
    join public.teaching_supervision_pairings p on p.id = e.pairing_id
    where n.id = v_id and n.service_id = p_service_id and p.supervisor_id = p_actor_id and n.confirmed_at is null
    for update of n;
    if not found then raise exception 'teaching_not_found'; end if;
    update public.teaching_supervision_notes set confirmed_by = p_actor_id, confirmed_at = now() where id = v_note.id;
    perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.note.confirm', v_note.id);
    return jsonb_build_object('noteId', v_note.id);

  elsif p_action = 'supervision.read' then
    -- The registrar and supervisor of a pairing see its entries; an organiser sees totals and
    -- status only (never topics). Reading anyone else's pairing is audited. A leaver (v_leaver)
    -- sees only the pairings where they are the registrar, and reads their own record unaudited.
    v_id := public.teaching_uuid_arg(p_payload, 'pairingId');
    if v_id is not null and not exists (
      select 1 from public.teaching_supervision_pairings p where p.id = v_id and p.service_id = p_service_id
        and (p.registrar_id = p_actor_id or (not v_leaver and (p.supervisor_id = p_actor_id or v_role = 'organiser')))) then
      raise exception 'teaching_not_found';
    end if;
    if v_id is null and v_role = 'organiser' then
      -- An organiser's whole-team read (Logbook, Today): one service-level row per call.
      perform public.teaching_audit(p_service_id, p_actor_id, 'supervision.read', null);
    elsif not v_leaver then
      insert into public.teaching_audit_events(service_id, actor_id, action, subject_id)
      select p_service_id, p_actor_id, 'supervision.read', p.id
      from public.teaching_supervision_pairings p
      where p.service_id = p_service_id and (v_id is null or p.id = v_id)
        and p.registrar_id is distinct from p_actor_id
        and (p.supervisor_id = p_actor_id or v_role = 'organiser');
    end if;
    select jsonb_build_object('pairings', coalesce(jsonb_agg(jsonb_build_object(
        'pairingId', p.id,
        'access', case when p.registrar_id = p_actor_id then 'registrar' when p.supervisor_id = p_actor_id then 'supervisor' else 'organiser' end,
        'registrarName', case when p.registrar_id is null then 'Former member' else coalesce((select coalesce(m.display_name, 'Member')
          from public.on_call_service_members m where m.service_id = p.service_id and m.user_id = p.registrar_id), 'Former member') end,
        'supervisorName', case when p.supervisor_id is null then 'Former member' else coalesce((select coalesce(m.display_name, 'Member')
          from public.on_call_service_members m where m.service_id = p.service_id and m.user_id = p.supervisor_id), 'Former member') end,
        'startsOn', p.starts_on, 'endsOn', p.ends_on,
        'targetHours', case when p.registrar_id = p_actor_id or p.supervisor_id = p_actor_id then p.target_hours else null end,
        'confirmedMinutes', (select coalesce(sum(e.minutes), 0) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'confirmed'),
        'pendingMinutes', (select coalesce(sum(e.minutes), 0) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'pending'),
        'pendingCount', (select count(*) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'pending'),
        'oldestPendingAt', (select min(e.created_at) from public.teaching_supervision_entries e where e.pairing_id = p.id and e.status = 'pending'),
        'entries', case when p.registrar_id = p_actor_id or p.supervisor_id = p_actor_id then coalesce((select jsonb_agg(jsonb_build_object(
            'entryId', e.id, 'date', e.session_date, 'minutes', e.minutes, 'type', e.type, 'topics', to_jsonb(e.topics),
            'status', e.status, 'confirmedAt', e.confirmed_at,
            'confirmedByName', case when e.confirmed_at is null then null when e.confirmed_by is null then 'Former member' else coalesce(
              (select coalesce(m.display_name, 'Member') from public.on_call_service_members m where m.service_id = e.service_id and m.user_id = e.confirmed_by),
              'Former member') end,
            'notes', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.id, 'reason', n.reason, 'correctedValue', n.corrected_value,
                'createdAt', n.created_at, 'confirmedAt', n.confirmed_at) order by n.created_at)
              from public.teaching_supervision_notes n where n.entry_id = e.id), '[]'::jsonb)
          ) order by e.session_date desc, e.created_at desc) from public.teaching_supervision_entries e where e.pairing_id = p.id), '[]'::jsonb)
          else null end
      ) order by p.starts_on desc, p.id), '[]'::jsonb))
    into v_result
    from public.teaching_supervision_pairings p
    where p.service_id = p_service_id and (v_id is null or p.id = v_id)
      and (p.registrar_id = p_actor_id or (not v_leaver and (p.supervisor_id = p_actor_id or v_role = 'organiser')));
    return v_result;

  elsif p_action in ('readiness.set','readiness.deid.confirm') then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if v_occ.presenter_id is distinct from p_actor_id then raise exception 'teaching_role_denied'; end if;
    insert into public.teaching_readiness(occurrence_id, service_id) values (v_occ.id, p_service_id)
    on conflict (occurrence_id) do nothing;
    if p_action = 'readiness.set' then
      v_text := public.teaching_text_arg(p_payload, 'item');
      if v_text is null or v_text not in ('reading_list','aims','slides_link','room')
        or jsonb_typeof(p_payload->'done') is distinct from 'boolean' then
        raise exception 'teaching_invalid_request';
      end if;
      update public.teaching_readiness set
        items = case when (p_payload->>'done')::boolean
          then array(select distinct i from unnest(array_append(items, v_text)) as i order by i)
          else array_remove(items, v_text) end,
        updated_at = now()
      where occurrence_id = v_occ.id returning * into v_readiness;
    else
      update public.teaching_readiness set deid_confirmed_at = now(), deid_confirmed_by = p_actor_id, updated_at = now()
      where occurrence_id = v_occ.id returning * into v_readiness;
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, p_action, v_occ.id);
    return jsonb_build_object('items', to_jsonb(v_readiness.items), 'deidConfirmedAt', v_readiness.deid_confirmed_at);

  elsif p_action = 'feedback.submit' then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if not exists (select 1 from public.teaching_attendance a where a.occurrence_id = v_occ.id and a.user_id = p_actor_id) then
      raise exception 'teaching_not_attended';
    end if;
    if v_occ.status = 'cancelled' or now() < v_occ.ends_at or now() > v_occ.ends_at + interval '7 days' then
      raise exception 'teaching_window_closed';
    end if;
    v_useful := public.teaching_int_arg(p_payload, 'useful');
    v_text := public.teaching_text_arg(p_payload, 'pace');
    if v_useful is null or v_useful not between 1 and 5 or v_text is null or v_text not in ('slow','right','fast') then
      raise exception 'teaching_invalid_request';
    end if;
    -- One-way "already answered" marker. No responder id is stored with feedback anywhere.
    insert into public.teaching_feedback_replied(occurrence_id, reply_marker)
    values (v_occ.id, encode(extensions.digest(convert_to('teaching-feedback:' || v_occ.id::text || ':' || p_actor_id::text, 'UTF8'), 'sha256'), 'hex'))
    on conflict (occurrence_id, reply_marker) do nothing;
    if not found then raise exception 'teaching_limit'; end if;
    insert into public.teaching_feedback_answers(occurrence_id, service_id, useful, pace)
    values (v_occ.id, p_service_id, v_useful, v_text);
    -- No actor on this audit row: nothing may tie a person to the moment an answer was written.
    perform public.teaching_audit(p_service_id, null, 'feedback.submit', v_occ.id);
    return '{}'::jsonb;

  elsif p_action = 'import.commit' then
    -- A term from a spreadsheet, all or nothing: every row is a new series through the same save as
    -- series.save, inside this one transaction, so one refused row rolls back every row before it.
    -- Spec §4 gives import to organisers and admins.
    if v_role not in ('organiser','admin') then raise exception 'teaching_role_denied'; end if;
    if jsonb_typeof(p_payload->'rows') is distinct from 'array'
      or jsonb_array_length(p_payload->'rows') not between 1 and 200 then
      raise exception 'teaching_invalid_request';
    end if;
    v_count := 0;
    for v_row in select r.value from jsonb_array_elements(p_payload->'rows') as r(value) loop
      if jsonb_typeof(v_row) is distinct from 'object' or v_row ? 'seriesId' then
        raise exception 'teaching_invalid_request';
      end if;
      v_result := public.teaching_series_save(p_actor_id, p_service_id, v_row);
      perform public.teaching_audit(p_service_id, p_actor_id, 'series.save', public.teaching_uuid_arg(v_result, 'seriesId'));
      v_count := v_count + public.teaching_int_arg(v_result, 'occurrences');
    end loop;
    perform public.teaching_audit(p_service_id, p_actor_id, 'import.commit', null);
    return jsonb_build_object('series', jsonb_array_length(p_payload->'rows'), 'occurrences', v_count);

  elsif p_action = 'feedback.totals' then
    v_id := public.teaching_uuid_arg(p_payload, 'occurrenceId');
    select * into v_occ from public.teaching_occurrences where id = v_id and service_id = p_service_id;
    if not found then raise exception 'teaching_not_found'; end if;
    if (v_occ.presenter_id = p_actor_id or v_role = 'organiser') is not true then raise exception 'teaching_role_denied'; end if;
    select count(*) into v_count from public.teaching_feedback_answers where occurrence_id = v_occ.id;
    if now() < v_occ.ends_at + interval '7 days' or v_count < 5 then
      return jsonb_build_object('released', false);
    end if;
    perform public.teaching_audit(p_service_id, p_actor_id, 'feedback.totals', v_occ.id);
    return jsonb_build_object(
      'released', true,
      'replies', v_count,
      'useful', (select jsonb_build_object('1', count(*) filter (where useful = 1), '2', count(*) filter (where useful = 2),
          '3', count(*) filter (where useful = 3), '4', count(*) filter (where useful = 4), '5', count(*) filter (where useful = 5))
        from public.teaching_feedback_answers where occurrence_id = v_occ.id),
      'pace', (select jsonb_build_object('slow', count(*) filter (where pace = 'slow'), 'right', count(*) filter (where pace = 'right'),
          'fast', count(*) filter (where pace = 'fast'))
        from public.teaching_feedback_answers where occurrence_id = v_occ.id)
    );
  end if;

  raise exception 'teaching_invalid_request';
end $$;
revoke all on function public.teaching_depth_command(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.teaching_depth_command(uuid, uuid, text, jsonb) to service_role;
