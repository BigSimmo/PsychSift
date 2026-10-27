-- Synthetic disposable replay only (`npm run test:sql`). Proves 20261027120000_one_supervisor_list.sql:
-- People and roles is the one supervisor list for a hospital team, and Teaching follows it.
begin;
create temp table sup_test_ids (k text primary key, v uuid) on commit drop;
grant all on sup_test_ids to service_role;
do $setup$
declare h uuid; s uuid; loose uuid;
begin
  insert into sup_test_ids values ('dct', gen_random_uuid()), ('reg', gen_random_uuid()),
    ('sup1', gen_random_uuid()), ('sup2', gen_random_uuid()), ('org', gen_random_uuid());
  insert into auth.users (id, email) select v, 'sup-' || k || '@example.org' from sup_test_ids;
  insert into public.work_hospitals (name, created_by)
    values ('Example supervision hospital', (select v from sup_test_ids where k = 'dct')) returning id into h;
  insert into public.on_call_services (name, created_by, is_demo)
    values ('Example hospital team', (select v from sup_test_ids where k = 'org'), true) returning id into s;
  insert into public.on_call_services (name, created_by, is_demo)
    values ('Example loose team', (select v from sup_test_ids where k = 'org'), true) returning id into loose;
  insert into public.work_hospital_teams (service_id, hospital_id) values (s, h);
  -- sup2 is not in the hospital team yet; everyone is in the loose team.
  insert into public.on_call_service_members (service_id, user_id, role)
    select s, v, 'member' from sup_test_ids where k <> 'sup2';
  insert into public.on_call_service_members (service_id, user_id, role)
    select loose, v, 'member' from sup_test_ids;
  insert into public.teaching_member_roles (service_id, user_id, role)
    values (s, (select v from sup_test_ids where k = 'org'), 'admin'),
      (loose, (select v from sup_test_ids where k = 'org'), 'admin');
  insert into sup_test_ids values ('hospital', h), ('svc', s), ('loose', loose);
end $setup$;
set local role service_role;
do $one_list$
declare
  h uuid := (select v from sup_test_ids where k = 'hospital');
  svc uuid := (select v from sup_test_ids where k = 'svc');
  loose uuid := (select v from sup_test_ids where k = 'loose');
  dct uuid := (select v from sup_test_ids where k = 'dct');
  reg uuid := (select v from sup_test_ids where k = 'reg');
  sup1 uuid := (select v from sup_test_ids where k = 'sup1');
  sup2 uuid := (select v from sup_test_ids where k = 'sup2');
  org uuid := (select v from sup_test_ids where k = 'org');
  g1 uuid; g2 uuid; pairing uuid; second uuid; entry uuid; result jsonb;
begin
  -- Naming a trainee supervisor starts the pairing in the hospital team, and only there.
  -- Every grant here shares one transaction, so now() is the same: date the first an hour back so
  -- "the latest named supervisor" is well defined, as it is across real transactions.
  insert into public.work_role_grants (user_id, role, hospital_id, subject_user_id, granted_by, granted_at)
    values (sup1, 'supervisor', h, reg, dct, now() - interval '1 hour') returning id into g1;
  select id into pairing from public.teaching_supervision_pairings
    where service_id = svc and registrar_id = reg and supervisor_id = sup1;
  if pairing is null then raise exception 'naming a supervisor did not start a pairing'; end if;
  if exists (select 1 from public.teaching_supervision_pairings where service_id = loose) then
    raise exception 'a team outside the hospital got a pairing';
  end if;

  -- The named supervisor confirms the registrar's hours.
  result := public.teaching_depth_command(reg, svc, 'supervision.log', jsonb_build_object(
    'pairingId', pairing, 'date', (now() at time zone 'Australia/Perth')::date, 'minutes', 60,
    'type', 'individual', 'topics', '[]'::jsonb));
  entry := (result ->> 'entryId')::uuid;
  result := public.teaching_depth_command(sup1, svc, 'supervision.confirm', jsonb_build_object('entryIds', jsonb_build_array(entry)));
  if (result ->> 'confirmed')::int <> 1 then raise exception 'the named supervisor could not confirm: %', result; end if;

  -- Teaching can no longer start a pairing or change its supervisor in a hospital team.
  begin
    perform public.teaching_depth_command(org, svc, 'pairing.reassign', jsonb_build_object('pairingId', pairing, 'supervisorId', dct));
    raise exception 'Teaching reassigned a hospital team pairing';
  exception when raise_exception then
    if sqlerrm <> 'teaching_supervisor_from_people' then raise; end if;
  end;
  begin
    perform public.teaching_depth_command(org, svc, 'pairing.save', jsonb_build_object('registrarId', dct,
      'supervisorId', sup1, 'startsOn', current_date, 'endsOn', current_date + 30));
    raise exception 'Teaching started a hospital team pairing';
  exception when raise_exception then
    if sqlerrm <> 'teaching_supervisor_from_people' then raise; end if;
  end;
  result := public.teaching_depth_command(org, svc, 'supervision.read', '{}'::jsonb);
  if (result ->> 'supervisorsFromPeople')::boolean is not true then raise exception 'read did not flag the hospital team'; end if;

  -- A second supervisor named while not in the team does nothing until they join, then takes over.
  insert into public.work_role_grants (user_id, role, hospital_id, subject_user_id, granted_by)
    values (sup2, 'supervisor', h, reg, dct) returning id into g2;
  if (select supervisor_id from public.teaching_supervision_pairings where id = pairing) <> sup1 then
    raise exception 'a supervisor outside the team took the pairing';
  end if;
  insert into public.on_call_service_members (service_id, user_id, role) values (svc, sup2, 'member');
  if (select supervisor_id from public.teaching_supervision_pairings where id = pairing) <> sup2 then
    raise exception 'joining the team did not hand the pairing to the latest named supervisor';
  end if;
  if (select confirmed_by from public.teaching_supervision_entries where id = entry) <> sup1 then
    raise exception 'a confirmed session lost who confirmed it';
  end if;
  -- Every open pairing follows, not just one.
  insert into public.teaching_supervision_pairings (service_id, registrar_id, supervisor_id, starts_on, ends_on, created_by)
    values (svc, reg, org, current_date, current_date + 30, org) returning id into second;
  update public.work_role_grants set revoked_at = now(), revoked_by = dct where id = g2;
  update public.work_role_grants set revoked_at = null, revoked_by = null where id = g2;
  if exists (select 1 from public.teaching_supervision_pairings
      where service_id = svc and registrar_id = reg and supervisor_id is distinct from sup2) then
    raise exception 'an open pairing kept a supervisor nobody named';
  end if;
  delete from public.teaching_supervision_pairings where id = second;

  -- Removing the latest name falls back to the earlier one; removing both leaves nobody named.
  update public.work_role_grants set revoked_at = now(), revoked_by = dct where id = g2;
  if (select supervisor_id from public.teaching_supervision_pairings where id = pairing) <> sup1 then
    raise exception 'removing a name did not fall back to the other named supervisor';
  end if;
  update public.work_role_grants set revoked_at = now(), revoked_by = dct where id = g1;
  if (select supervisor_id from public.teaching_supervision_pairings where id = pairing) is not null then
    raise exception 'removing every name left a supervisor on the pairing';
  end if;
  result := public.teaching_depth_command(reg, svc, 'supervision.read', '{}'::jsonb);
  if result -> 'pairings' -> 0 ->> 'supervisorName' <> 'No supervisor named' then
    raise exception 'a pairing with nobody named shows %', result -> 'pairings' -> 0 ->> 'supervisorName';
  end if;
  begin
    perform public.teaching_depth_command(sup1, svc, 'supervision.confirm', jsonb_build_object('entryIds', jsonb_build_array(entry)));
    raise exception 'a removed supervisor still confirms';
  exception when raise_exception then
    if sqlerrm <> 'teaching_not_found' then raise; end if;
  end;

  -- A team outside any hospital keeps Teaching pairings as before.
  result := public.teaching_depth_command(org, loose, 'pairing.save', jsonb_build_object('registrarId', reg,
    'supervisorId', sup1, 'startsOn', current_date, 'endsOn', current_date + 30));
  if result ->> 'pairingId' is null then raise exception 'a loose team could not pair by hand'; end if;
  result := public.teaching_depth_command(org, loose, 'supervision.read', '{}'::jsonb);
  if (result ->> 'supervisorsFromPeople')::boolean is not false then raise exception 'read flagged a loose team'; end if;

  -- Linking that team to the hospital brings its pairings into the one list: nobody is named for
  -- the trainee any more, so the hand-made supervisor goes.
  insert into public.work_hospital_teams (service_id, hospital_id, linked_by) values (loose, h, dct);
  if exists (select 1 from public.teaching_supervision_pairings where service_id = loose and supervisor_id is not null) then
    raise exception 'linking a team to a hospital kept a supervisor nobody named';
  end if;
end $one_list$;
select 'One supervisor list checks passed';
rollback;
