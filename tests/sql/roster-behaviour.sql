-- Behaviour checks for the combined Roster DB PR, run against a disposable replay of files 1-5.
-- Every block raises on a wrong answer, so a clean run prints only the final line.
-- Run: psql -v ON_ERROR_STOP=1 -1 -f tests/sql/roster-behaviour.sql   (never against a live database)
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to service_role;

do $setup$
declare s uuid; site uuid;
begin
  insert into ids values
    ('mgr', gen_random_uuid()), ('lee', gen_random_uuid()), ('mei', gen_random_uuid()),
    ('alex', gen_random_uuid()), ('ivy', gen_random_uuid()), ('out', gen_random_uuid()), ('adm', gen_random_uuid());
  insert into auth.users (id, email) select v, k || '@example.org' from ids;
  insert into public.on_call_services (name, created_by) values ('General Medicine', (select v from ids where k = 'adm')) returning id into s;
  insert into public.on_call_service_sites (service_id, name) values (s, 'Example Hospital') returning id into site;
  insert into ids values ('svc', s), ('site', site);
  insert into public.on_call_service_members (service_id, user_id, role)
  select s, v, case when k = 'adm' then 'admin' else 'member' end from ids where k in ('mgr', 'lee', 'mei', 'alex', 'ivy', 'adm');
end
$setup$;

create function pg_temp.id(p text) returns uuid language sql as $$ select v from ids where k = p $$;
create function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected % but the call succeeded: %', p_code, p_sql;
exception when others then
  if sqlerrm <> p_code then raise exception 'expected %, got %: %', p_code, sqlerrm, p_sql; end if;
end $$;
create function pg_temp.cmd(p_actor text, p_action text, p_payload jsonb) returns jsonb language sql as $$
  select public.roster_command(pg_temp.id(p_actor), pg_temp.id('svc'), p_action, p_payload)
$$;
-- The Supabase image revokes execute from public by default, so grant the helpers explicitly.
grant execute on function pg_temp.id(text), pg_temp.expect_error(text, text), pg_temp.cmd(text, text, jsonb)
  to service_role;
-- Everything below runs as the app does: as service_role, through the functions.
set local role service_role;

-- 1. Own shifts: an import never deletes a hand-added shift, and workplaces stay separate.
do $own$
declare me uuid := pg_temp.id('lee');
begin
  insert into public.on_call_shifts (owner_id, starts_at, ends_at, title, source, kind)
  values (me, '2026-10-14 06:00+00', '2026-10-14 14:30+00', 'My own', 'manual', 'day');
  perform public.roster_own_shifts_replace(me, '2026-10-12', '2026-10-18', 'xlsx', null, 'Oct.xlsx',
    '[{"startsAt":"2026-10-13T00:00:00Z","endsAt":"2026-10-13T08:30:00Z","title":"Day","location":null,"sourceUid":null,"kind":"day"}]',
    '[]', 1, 0, 0);
  perform public.roster_own_shifts_replace(me, '2026-10-12', '2026-10-18', 'ics', 'Example Clinic', null,
    '[{"startsAt":"2026-10-15T00:00:00Z","endsAt":"2026-10-15T04:00:00Z","title":"Clinic","location":null,"sourceUid":"u1","kind":"other"}]',
    '[]', 1, 0, 0);
  perform public.roster_own_shifts_replace(me, '2026-10-12', '2026-10-18', 'xlsx', null, 'Oct v2.xlsx', '[]', '[]', 0, 0, 1);
  if (select count(*) from public.on_call_shifts where owner_id = me) <> 2 then
    raise exception 'own shifts: expected the manual and the clinic shift to survive';
  end if;
  -- The original function still works for the live app until Release 1 ships.
  perform public.on_call_shifts_replace(me, '2026-10-20', '2026-10-20', 'csv',
    '[{"startsAt":"2026-10-20T00:00:00Z","endsAt":"2026-10-20T08:00:00Z","title":"Day","location":null,"sourceUid":null}]',
    '[]', 1, 0, 0);
  if (select count(*) from public.on_call_shifts where owner_id = me) <> 3 then raise exception 'old function broke'; end if;
end
$own$;

-- 2. Team features stay off until the platform verifies the team.
select pg_temp.expect_error($$select pg_temp.cmd('lee', 'seen.mark', '{}')$$, 'roster_team_not_verified');
select public.on_call_service_set_verified(pg_temp.id('svc'), pg_temp.id('adm'), true, false);
select pg_temp.expect_error($$select pg_temp.cmd('out', 'seen.mark', '{}')$$, 'roster_access_denied');

-- 3. Managers are named by the platform, never by themselves.
select pg_temp.expect_error($$select pg_temp.cmd('mgr', 'role.set', '{"userId":"00000000-0000-0000-0000-000000000000"}')$$, 'roster_role_denied');
select public.roster_set_manager(pg_temp.id('svc'), pg_temp.id('mgr'), pg_temp.id('adm'), true);
select pg_temp.cmd('mgr', 'role.set', jsonb_build_object('userId', pg_temp.id('lee'), 'grade', 'resident', 'rosterName', 'L Lee'));
select pg_temp.cmd('mgr', 'role.set', jsonb_build_object('userId', pg_temp.id('mei'), 'grade', 'resident'));
select pg_temp.cmd('mgr', 'role.set', jsonb_build_object('userId', pg_temp.id('alex'), 'grade', 'registrar'));
select pg_temp.cmd('mgr', 'role.set', jsonb_build_object('userId', pg_temp.id('ivy'), 'grade', 'intern'));
select pg_temp.cmd('mgr', 'role.set', jsonb_build_object('userId', pg_temp.id('mgr'), 'grade', 'consultant'));
do $$ begin
  if not public.roster_can_invite(pg_temp.id('svc'), pg_temp.id('mgr')) then raise exception 'manager should invite'; end if;
  if public.roster_can_invite(pg_temp.id('svc'), pg_temp.id('lee')) then raise exception 'member must not invite'; end if;
end $$;

-- 4. Publish: members cannot, managers can; all or nothing.
select pg_temp.expect_error($$select pg_temp.cmd('lee', 'publish', '{"periodStart":"2026-11-02","periodEnd":"2026-11-15","assignments":[]}')$$, 'roster_role_denied');
select pg_temp.expect_error($$select pg_temp.cmd('mgr', 'publish', jsonb_build_object('periodStart','2026-11-02','periodEnd','2026-11-15',
  'assignments', jsonb_build_array(jsonb_build_object('userId', pg_temp.id('out'), 'startsAt','2026-11-03T00:00:00Z','endsAt','2026-11-03T08:30:00Z','shiftCode','D','kind','day'))))$$,
  'roster_invalid_request');

create temp table plan_rows on commit drop as
select * from (values
  ('lee',  '2026-11-07T00:00:00Z', '2026-11-08T00:00:00Z', 'C', 'on_call'),
  ('mei',  '2026-11-14T00:00:00Z', '2026-11-15T00:00:00Z', 'C', 'on_call'),
  ('lee',  '2026-11-10T13:30:00Z', '2026-11-11T00:00:00Z', 'N', 'night'),
  ('alex', '2026-11-10T00:00:00Z', '2026-11-10T08:30:00Z', 'D', 'day'),
  ('ivy',  '2026-11-12T00:00:00Z', '2026-11-12T08:30:00Z', 'D', 'day')
) as t (who, starts_at, ends_at, code, kind);
grant all on plan_rows to service_role;

do $publish$
declare r jsonb;
begin
  r := pg_temp.cmd('mgr', 'publish', jsonb_build_object('periodStart', '2026-11-02', 'periodEnd', '2026-11-15', 'sourceName', 'Nov.xlsx',
    'assignments', (select jsonb_agg(jsonb_build_object('userId', pg_temp.id(who), 'startsAt', starts_at, 'endsAt', ends_at,
                    'shiftCode', code, 'kind', kind, 'siteId', pg_temp.id('site'))) from plan_rows)
    || jsonb_build_array(jsonb_build_object('rosterName', 'Locum 1', 'startsAt', '2026-11-11T00:00:00Z', 'endsAt', '2026-11-11T08:30:00Z', 'shiftCode', 'D', 'kind', 'day'))));
  if (r ->> 'version')::int <> 1 then raise exception 'publish: expected version 1, got %', r; end if;
  if jsonb_array_length(public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'assignments',
       '{"from":"2026-11-02","to":"2026-11-15"}') -> 'assignments') <> 6 then
    raise exception 'publish: expected 6 live rows';
  end if;
end
$publish$;

-- 5. A clean same-grade swap more than 7 days away approves itself, and can be undone for 10 minutes.
do $swap$
declare give uuid; take uuid; r jsonb; sid uuid;
begin
  select id into give from public.roster_assignments where user_id = pg_temp.id('lee') and shift_code = 'C';
  select id into take from public.roster_assignments where user_id = pg_temp.id('mei') and shift_code = 'C';
  r := pg_temp.cmd('lee', 'swap.create', jsonb_build_object('giveAssignmentId', give, 'takeAssignmentId', take, 'counterpartyId', pg_temp.id('mei')));
  sid := (r ->> 'swapId')::uuid;
  perform pg_temp.expect_error(format($f$select pg_temp.cmd('lee', 'swap.create', %L)$f$,
    jsonb_build_object('giveAssignmentId', give, 'counterpartyId', pg_temp.id('alex'))), 'roster_request_exists');
  r := pg_temp.cmd('mei', 'swap.accept', jsonb_build_object('swapId', sid));
  if r ->> 'status' <> 'approved' or not (r ->> 'autoApproved')::boolean then raise exception 'swap: expected auto approval, got %', r; end if;
  if (select user_id from public.roster_assignments where id = give) <> pg_temp.id('mei') then raise exception 'swap: give not moved'; end if;
  if (select user_id from public.roster_assignments where id = take) <> pg_temp.id('lee') then raise exception 'swap: take not moved'; end if;
  r := pg_temp.cmd('lee', 'swap.undo', jsonb_build_object('swapId', sid));
  if (select user_id from public.roster_assignments where id = give) <> pg_temp.id('lee') then raise exception 'undo failed'; end if;
end
$swap$;

-- 6. Grade: an intern may not take a resident's shift; a registrar may.
do $grade$
declare night uuid;
begin
  select id into night from public.roster_assignments where user_id = pg_temp.id('lee') and shift_code = 'N';
  perform pg_temp.expect_error(format($f$select pg_temp.cmd('lee', 'swap.create', %L)$f$,
    jsonb_build_object('giveAssignmentId', night, 'counterpartyId', pg_temp.id('ivy'))), 'roster_swap_not_eligible');
end
$grade$;

-- 7. A clash is refused: Alex's day shift overlaps nothing, but giving Lee's night to Alex while
--    Alex already works 00:00-08:30 on the 10th Perth time must be checked by time, not by date.
do $clash$
declare night uuid; r jsonb;
begin
  select id into night from public.roster_assignments where user_id = pg_temp.id('lee') and shift_code = 'N';
  insert into public.roster_assignments (service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind)
  select pg_temp.id('svc'), publication_id, pg_temp.id('alex'), '2026-11-10T14:00:00Z', '2026-11-10T20:00:00Z', 'E', 'evening'
  from public.roster_assignments where id = night;
  perform pg_temp.expect_error(format($f$select pg_temp.cmd('lee', 'swap.create', %L)$f$,
    jsonb_build_object('giveAssignmentId', night, 'counterpartyId', pg_temp.id('alex'))), 'roster_swap_not_eligible');
end
$clash$;

-- 8. Open shifts: the first eligible claim reserves it; a different grade needs manager approval.
do $open$
declare day uuid; r jsonb; oid uuid;
begin
  select id into day from public.roster_assignments where user_id = pg_temp.id('ivy') and shift_code = 'D';
  r := pg_temp.cmd('ivy', 'open.post', jsonb_build_object('assignmentId', day));
  oid := (r ->> 'openShiftId')::uuid;
  r := pg_temp.cmd('lee', 'open.claim', jsonb_build_object('openShiftId', oid));
  if r ->> 'status' is distinct from 'claimed' then raise exception 'open: expected different-grade claim pending approval, got %', r; end if;
  perform pg_temp.expect_error(format($f$select pg_temp.cmd('mei', 'open.claim', %L)$f$, jsonb_build_object('openShiftId', oid)),
    'roster_open_shift_taken');
  r := pg_temp.cmd('mgr', 'open.approve', jsonb_build_object('openShiftId', oid));
  if r ->> 'status' is distinct from 'approved' then raise exception 'open: manager approval failed %', r; end if;
  if (select user_id from public.roster_assignments where id = day) is distinct from pg_temp.id('lee') then
    raise exception 'open: approved assignment did not move to claimant';
  end if;
end
$open$;

-- 9. Seen receipts: members write their own; only managers read the count.
do $seen$
declare pub uuid; r jsonb;
begin
  select id into pub from public.roster_publications where service_id = pg_temp.id('svc');
  perform pg_temp.cmd('lee', 'seen.mark', jsonb_build_object('publicationId', pub));
  perform pg_temp.cmd('lee', 'seen.mark', jsonb_build_object('publicationId', pub));
  perform pg_temp.expect_error($$select public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'manage', '{}')$$, 'roster_role_denied');
  r := public.roster_read(pg_temp.id('mgr'), pg_temp.id('svc'), 'manage', '{}');
  if (r #>> '{seen,seen}')::int <> 2 or (r #>> '{seen,members}')::int <> 6 then raise exception 'seen: got %', r -> 'seen'; end if;
end
$seen$;

-- G1/G3: approved changes are visible only to managers; manager identities and swap names
-- are available to members without exposing the manager-only people list.
select pg_temp.expect_error($$select public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'changes', '{"from":"2026-11-02","to":"2026-11-15"}')$$, 'roster_role_denied');
do $g1_g3$
declare r jsonb;
begin
  r := public.roster_read(pg_temp.id('mgr'), pg_temp.id('svc'), 'changes', '{"from":"2026-11-02","to":"2026-11-15"}');
  if jsonb_array_length(r -> 'openShifts') < 1 then raise exception 'G1: approved open shift missing'; end if;
  r := public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'overview', '{}');
  if not (r -> 'managers') @> jsonb_build_array(jsonb_build_object('userId', pg_temp.id('mgr'))) then raise exception 'G3: manager missing'; end if;
  r := public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'requests', '{}');
  if exists (select 1 from jsonb_array_elements(r -> 'swaps') x where not (x ? 'requesterName' and x ? 'counterpartyName')) then raise exception 'G3: swap names missing'; end if;
end $g1_g3$;
-- 10. A new full publish replaces the period and cancels pending requests on replaced shifts.
do $republish$
declare give uuid; r jsonb;
begin
  select id into give from public.roster_assignments where user_id = pg_temp.id('alex') and shift_code = 'D' and superseded_at is null;
  perform pg_temp.cmd('alex', 'swap.create', jsonb_build_object('giveAssignmentId', give, 'counterpartyId', pg_temp.id('mgr')));
  r := pg_temp.cmd('mgr', 'publish', jsonb_build_object('periodStart', '2026-11-02', 'periodEnd', '2026-11-15',
    'assignments', jsonb_build_array(jsonb_build_object('userId', pg_temp.id('lee'), 'startsAt', '2026-11-03T00:00:00Z',
      'endsAt', '2026-11-03T08:30:00Z', 'shiftCode', 'D', 'kind', 'day'))));
  if jsonb_array_length(r -> 'swapsCancelled') <> 1 then raise exception 'republish: expected one cancelled swap, got %', r; end if;
  if (select count(*) from public.roster_assignments where service_id = pg_temp.id('svc') and superseded_at is null) <> 1 then
    raise exception 'republish: old rows still live';
  end if;
end
$republish$;

-- 11. Revoke cascade: leaving the team revokes the Roster role; rejoining restores nothing.
do $revoke$
begin
  perform public.on_call_service_command(pg_temp.id('adm'), pg_temp.id('svc'), 'member.revoke', jsonb_build_object('memberId', pg_temp.id('mei')));
  if exists (select 1 from public.roster_member_roles where user_id = pg_temp.id('mei') and revoked_at is null) then
    raise exception 'revoke: roster role still active';
  end if;
  update public.on_call_service_members set revoked_at = null, joined_at = now()
   where service_id = pg_temp.id('svc') and user_id = pg_temp.id('mei');
  if exists (select 1 from public.roster_member_roles where user_id = pg_temp.id('mei') and revoked_at is null) then
    raise exception 'rejoin: role restored';
  end if;
  -- Granted again after rejoining, the role must survive any later write that leaves revoked_at null
  -- (On Call's rejoin path is an upsert that sets revoked_at = null): the trigger's WHEN clause.
  perform pg_temp.cmd('mgr', 'role.set', jsonb_build_object('userId', pg_temp.id('mei'), 'grade', 'resident'));
  update public.on_call_service_members set revoked_at = null where service_id = pg_temp.id('svc') and user_id = pg_temp.id('mei');
  if not exists (select 1 from public.roster_member_roles where user_id = pg_temp.id('mei') and revoked_at is null) then
    raise exception 'rejoin: a later membership write revoked the new role';
  end if;
  if (select count(*) from public.on_call_service_member_events where user_id = pg_temp.id('mei') and mode = 'roster') <> 1 then
    raise exception 'revoke: expected one roster audit row';
  end if;
end
$revoke$;

-- 12. Roster maker: every draft change is saved with its undo, and undo puts it back.
do $maker$
declare d uuid; r jsonb; c bigint; row_id uuid;
begin
  r := pg_temp.cmd('mgr', 'draft.open', '{"periodStart":"2026-11-02","periodEnd":"2026-11-15"}');
  d := (r ->> 'draftId')::uuid;
  if (select count(*) from public.roster_draft_assignments where draft_id = d) <> 1 then raise exception 'draft: not copied'; end if;
  select id into row_id from public.roster_draft_assignments where draft_id = d;
  r := pg_temp.cmd('mgr', 'draft.change', jsonb_build_object('draftId', d, 'source', 'typed', 'ops', jsonb_build_array(
    jsonb_build_object('op', 'update', 'id', row_id, 'row', jsonb_build_object('shiftCode', 'E', 'kind', 'evening')),
    jsonb_build_object('op', 'add', 'row', jsonb_build_object('rosterName', 'Locum 2', 'startsAt', '2026-11-04T00:00:00Z',
      'endsAt', '2026-11-04T08:30:00Z', 'shiftCode', 'D', 'kind', 'day')))));
  c := (r ->> 'lastChangeId')::bigint;
  perform pg_temp.cmd('mgr', 'draft.undo', jsonb_build_object('changeId', c));
  perform pg_temp.cmd('mgr', 'draft.undo', jsonb_build_object('changeId', c - 1));
  if (select shift_code from public.roster_draft_assignments where id = row_id) <> 'D'
     or (select count(*) from public.roster_draft_assignments where draft_id = d) <> 1 then
    raise exception 'draft undo failed';
  end if;
end
$maker$;

-- 13. Retention runs, and a manager's member.remove fires the same cascade.
select public.roster_retention_purge();
select pg_temp.cmd('mgr', 'member.remove', jsonb_build_object('userId', pg_temp.id('ivy')));
select pg_temp.expect_error($$select pg_temp.cmd('ivy', 'seen.mark', '{}')$$, 'roster_access_denied');
select pg_temp.expect_error($$select pg_temp.cmd('mgr', 'member.remove', jsonb_build_object('userId', pg_temp.id('adm')))$$, 'roster_not_found');

-- G2/G4/G5: history stays actor-only; named leave is active-team manager-only; cutoff is bounded.
select pg_temp.expect_error($$select public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'team_leave', '{"from":"2026-11-02","to":"2026-11-15"}')$$, 'roster_role_denied');
select pg_temp.expect_error($$select public.roster_set_cutoff(pg_temp.id('lee'), pg_temp.id('svc'), current_date)$$, 'roster_role_denied');
select pg_temp.expect_error($$select public.roster_set_cutoff(pg_temp.id('mgr'), pg_temp.id('svc'), (now() at time zone 'Australia/Perth')::date + 181)$$, 'roster_invalid_request');
select pg_temp.expect_error($$select public.roster_read(pg_temp.id('mgr'), pg_temp.id('svc'), 'team_leave', '{"from":"2026-01-01","to":"2026-12-31"}')$$, 'roster_invalid_request');
do $g2_g4_g5$
declare r jsonb;
begin
  r := public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'my_changes', '{}');
  if jsonb_array_length(r -> 'before') = 0 or jsonb_array_length(r -> 'after') = 0 then raise exception 'G2: history missing'; end if;
  if exists (select 1 from jsonb_array_elements((r -> 'before') || (r -> 'after')) x where (x ->> 'userId')::uuid <> pg_temp.id('lee')) then raise exception 'G2: another doctor leaked'; end if;
  insert into public.roster_leave(owner_id, service_id, kind, starts_on, ends_on, status)
    values (pg_temp.id('lee'), pg_temp.id('svc'), 'annual', '2026-11-04', '2026-11-06', 'approved'),
           (pg_temp.id('ivy'), pg_temp.id('svc'), 'pd_leave', '2026-11-04', '2026-11-06', 'planned');
  r := public.roster_read(pg_temp.id('mgr'), pg_temp.id('svc'), 'team_leave', '{"from":"2026-11-02","to":"2026-11-15"}');
  if jsonb_array_length(r -> 'leave') <> 1 or r #>> '{leave,0,userId}' <> pg_temp.id('lee')::text then raise exception 'G4: wrong active leave scope'; end if;
  perform public.roster_set_cutoff(pg_temp.id('mgr'), pg_temp.id('svc'), (now() at time zone 'Australia/Perth')::date + 180);
  r := public.roster_read(pg_temp.id('lee'), pg_temp.id('svc'), 'overview', '{}');
  if (r ->> 'nextCutoffOn')::date <> (now() at time zone 'Australia/Perth')::date + 180 then raise exception 'G5: cutoff missing'; end if;
  perform public.roster_set_cutoff(pg_temp.id('mgr'), pg_temp.id('svc'), null);
end $g2_g4_g5$;

-- Safety: a decision made after preview invalidates it. Failed publication rolls back
-- role/codes writes, and success reports only users whose meaningful shifts changed.
do $atomic_publish$
declare
  d date := (now() at time zone 'Australia/Perth')::date + 90;
  preview jsonb; payload jsonb; result jsonb; give_id uuid; take_id uuid; swap_id uuid;
  before_name text; before_codes jsonb; fingerprint text;
begin
  perform pg_temp.cmd('mgr', 'settings.set', '{"swapApproval":"auto_same_grade","rules":{},"rulesSource":null,"payFortnightAnchor":null}');
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d + 7);
  payload := jsonb_build_object('roles', '[]'::jsonb, 'codes', '[]'::jsonb, 'publication', jsonb_build_object(
    'kind', 'full', 'periodStart', d, 'periodEnd', d + 7, 'assignments', jsonb_build_array(
      jsonb_build_object('userId', pg_temp.id('lee'), 'startsAt', d::timestamptz, 'endsAt', d::timestamptz + interval '8 hours', 'shiftCode', 'C', 'kind', 'on_call'),
      jsonb_build_object('userId', pg_temp.id('mei'), 'startsAt', (d + 7)::timestamptz, 'endsAt', (d + 7)::timestamptz + interval '8 hours', 'shiftCode', 'C', 'kind', 'on_call'))));
  result := public.roster_publish(pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload);
  if jsonb_array_length(result -> 'changedUserIds') <> 2 then raise exception 'publish: initial recipients wrong'; end if;
  -- A semantically identical upload must not alert everyone because IDs changed.
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d + 7);
  result := public.roster_publish(pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload);
  if result -> 'changedUserIds' <> '[]'::jsonb then raise exception 'publish: unchanged shifts alerted'; end if;
  select id into give_id from public.roster_assignments where publication_id = (result ->> 'publicationId')::uuid and user_id = pg_temp.id('lee');
  select id into take_id from public.roster_assignments where publication_id = (result ->> 'publicationId')::uuid and user_id = pg_temp.id('mei');
  result := pg_temp.cmd('lee', 'swap.create', jsonb_build_object('giveAssignmentId', give_id, 'takeAssignmentId', take_id, 'counterpartyId', pg_temp.id('mei')));
  swap_id := (result ->> 'swapId')::uuid;
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d + 7);
  result := pg_temp.cmd('mei', 'swap.accept', jsonb_build_object('swapId', swap_id));
  if result ->> 'status' <> 'approved' then raise exception 'publish test: swap failed to approve'; end if;
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)', pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload), 'roster_conflict');
  if (select user_id from public.roster_assignments where id = give_id) <> pg_temp.id('mei') then raise exception 'publish: stale preview undid swap'; end if;
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d + 7);
  fingerprint := preview ->> 'freshnessToken';
  select roster_name into before_name from public.roster_member_roles where service_id = pg_temp.id('svc') and user_id = pg_temp.id('lee');
  before_codes := preview -> 'codes';
  payload := jsonb_set(payload, '{roles}', jsonb_build_array(jsonb_build_object('userId', pg_temp.id('lee'), 'rosterName', 'Rollback Example')));
  payload := jsonb_set(payload, '{codes}', '[{"code":"ROLL","kind":"day","starts":"08:00","ends":"16:00","label":null}]');
  payload := jsonb_set(payload, '{publication,assignments,0,userId}', to_jsonb(pg_temp.id('out')));
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)', pg_temp.id('mgr'), pg_temp.id('svc'), fingerprint, payload), 'roster_invalid_request');
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d + 7);
  if preview ->> 'freshnessToken' <> fingerprint or preview -> 'codes' <> before_codes
    or (select roster_name from public.roster_member_roles where service_id = pg_temp.id('svc') and user_id = pg_temp.id('lee')) is distinct from before_name then
    raise exception 'publish: failed publication leaked metadata writes'; end if;
  perform pg_temp.expect_error(format('select public.roster_publish_preview(%L,%L,%L,%L)', pg_temp.id('lee'), pg_temp.id('svc'), d, d+7), 'roster_role_denied');
  payload := jsonb_set(payload, '{publication,periodEnd}', to_jsonb(d+8));
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)', pg_temp.id('mgr'), pg_temp.id('svc'), fingerprint, payload), 'roster_conflict');
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d + 186);
  if jsonb_array_length(preview -> 'assignments') < 2 then raise exception 'publish: full period snapshot truncated'; end if;
end $atomic_publish$;
-- P1 regression: keeping a swap in one full publication must not erase its protection
-- on the next stale upload. A deliberate file override retires only the named protection.
do $publication_lineage$
declare
  d date := (now() at time zone 'Australia/Perth')::date + 90;
  preview jsonb; payload jsonb; rows jsonb; result jsonb; protection jsonb; original_give text;
  partial_payload jsonb; duplicate_payload jsonb; outside_take text; fingerprint text;
begin
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d+7);
  protection := preview #> '{changes,swaps,0}';
  if protection is null then raise exception 'lineage fixture: approved swap missing'; end if;
  original_give := protection ->> 'giveAssignmentId';
  outside_take := protection ->> 'takeAssignmentId';
  select jsonb_agg(jsonb_build_object('userId', x -> 'userId', 'rosterName', null, 'siteId', x -> 'siteId',
    'startsAt', x -> 'startsAt', 'endsAt', x -> 'endsAt', 'shiftCode', x -> 'shiftCode', 'kind', x -> 'kind') order by x ->> 'startsAt')
    into rows from jsonb_array_elements(preview -> 'assignments') x;
  payload := jsonb_build_object('roles', '[]'::jsonb, 'codes', '[]'::jsonb, 'publication',
    jsonb_build_object('kind','full','periodStart',d,'periodEnd',d+7,'assignments',rows));
  -- Publish only the in-range half of a two-way swap; the outside assignment stays live.
  partial_payload := jsonb_set(payload,'{publication,periodEnd}',to_jsonb(d));
  partial_payload := jsonb_set(partial_payload,'{publication,assignments}',
    (select jsonb_agg(x) from jsonb_array_elements(rows) x
      where ((x ->> 'startsAt')::timestamptz at time zone 'Australia/Perth')::date = d));
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  perform public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',partial_payload);
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d+7);
  if preview #>> '{changes,swaps,0,takeAssignmentId}' <> outside_take
    or not exists (select 1 from public.roster_assignments where id=outside_take::uuid and superseded_at is null) then
    raise exception 'lineage: cross-period swap changed the outside assignment'; end if;
  -- Two indistinguishable replacements cannot identify one protected shift safely.
  fingerprint := preview ->> 'freshnessToken';
  duplicate_payload := jsonb_set(payload,'{publication,assignments}',rows || jsonb_build_array(rows -> 0));
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,duplicate_payload),'roster_conflict');
  if public.roster_publish_fingerprint(pg_temp.id('svc'),d,d+7) <> fingerprint then
    raise exception 'lineage: ambiguous duplicate partially wrote'; end if;
  result := public.roster_publish(pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload);
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d+7);
  if jsonb_array_length(preview #> '{changes,swaps}') <> 1
    or preview #>> '{changes,swaps,0,swapId}' <> protection ->> 'swapId'
    or preview #>> '{changes,swaps,0,giveAssignmentId}' = original_give then raise exception 'lineage: kept swap lost its replacement IDs'; end if;
  -- Upload the original pre-swap ownership with a FRESH token: lineage, not staleness, must stop it.
  payload := jsonb_set(payload, '{publication,assignments,0,userId}', to_jsonb(pg_temp.id('lee')));
  payload := jsonb_set(payload, '{publication,assignments,1,userId}', to_jsonb(pg_temp.id('mei')));
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)', pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload), 'roster_conflict');
  if public.roster_publish_fingerprint(pg_temp.id('svc'),d,d+7) <> preview ->> 'freshnessToken' then raise exception 'lineage: rejected upload partially wrote'; end if;
  payload := payload || jsonb_build_object('overrideChanges',jsonb_build_array(jsonb_build_object('kind','swap','id',protection ->> 'swapId')));
  result := public.roster_publish(pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload);
  if result -> 'overridesRecorded' <> payload -> 'overrideChanges' then raise exception 'lineage: override receipt missing'; end if;
  preview := public.roster_publish_preview(pg_temp.id('mgr'), pg_temp.id('svc'), d, d+7);
  if preview #> '{changes,swaps}' <> '[]'::jsonb then raise exception 'lineage: explicit override resurrected'; end if;
  perform public.roster_publish(pg_temp.id('mgr'), pg_temp.id('svc'), preview ->> 'freshnessToken', payload - 'overrideChanges');
end $publication_lineage$;

-- TBA rows are real vacancies, never fake named assignments. Identical repeated vacancies
-- keep their multiplicity without accumulating on every upload; late failures roll back all.
do $publication_open_rows$
declare
  d date := (now() at time zone 'Australia/Perth')::date + 120;
  preview jsonb; payload jsonb; bad jsonb; gap jsonb; result jsonb; first_ids jsonb; fingerprint text; claimed uuid;
begin
  gap := jsonb_build_object('startsAt',d::timestamptz,'endsAt',d::timestamptz + interval '8 hours',
    'shiftCode','D','kind','day','siteId',pg_temp.id('site'),'minGrade',null,'urgent',false);
  payload := jsonb_build_object('roles','[]'::jsonb,'codes','[]'::jsonb,'openShifts',jsonb_build_array(gap,gap),
    'publication',jsonb_build_object('kind','full','periodStart',d,'periodEnd',d,'assignments','[]'::jsonb));
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  result := public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',payload);
  first_ids := result -> 'openShiftIds';
  if jsonb_array_length(first_ids) <> 2 or first_ids ->> 0 = first_ids ->> 1 then raise exception 'open rows: lost vacancy multiplicity'; end if;
  if exists(select 1 from public.roster_assignments where publication_id=(result ->> 'publicationId')::uuid) then raise exception 'open rows: fake assignments created'; end if;
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  result := public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',payload);
  if jsonb_array_length(result -> 'openShiftIds') <> 2 or not (result -> 'openShiftIds') @> first_ids then raise exception 'open rows: re-upload duplicated gaps'; end if;
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  fingerprint := preview ->> 'freshnessToken';
  bad := jsonb_set(payload,'{openShifts,0,urgent}','true');
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad),'roster_conflict');
  bad := jsonb_set(payload,'{openShifts,0,minGrade}','"resident"');
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad),'roster_conflict');
  bad := jsonb_set(payload,'{openShifts,0,kind}','"leave"');
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad),'roster_invalid_request');
  bad := jsonb_set(payload,'{openShifts,0,startsAt}',to_jsonb((d-1)::timestamptz));
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad),'roster_invalid_request');
  bad := jsonb_set(payload,'{roles}',jsonb_build_array(jsonb_build_object('userId',pg_temp.id('lee'),'rosterName','Rollback vacancy')));
  bad := jsonb_set(bad,'{openShifts,0,siteId}',to_jsonb(gen_random_uuid()));
  begin
    perform public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad);
    raise exception 'open rows: nonexistent site accepted';
  exception when foreign_key_violation then null;
  end;
  if public.roster_publish_fingerprint(pg_temp.id('svc'),d,d) <> fingerprint then raise exception 'open rows: late failure leaked publication or metadata'; end if;
  claimed := (first_ids ->> 0)::uuid;
  result := pg_temp.cmd('lee','open.claim',jsonb_build_object('openShiftId',claimed));
  if result ->> 'status' <> 'claimed' then raise exception 'open rows fixture: expected pending claim'; end if;
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',payload),'roster_conflict');
  bad := jsonb_set(payload,'{openShifts,0,minGrade}','"registrar"');
  bad := jsonb_set(bad,'{openShifts,0,urgent}','true');
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',bad),'roster_conflict');
  -- Approving a gap creates an assignment through the base command's audit-only link.
  perform pg_temp.cmd('mgr','open.approve',jsonb_build_object('openShiftId',claimed));
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  if preview #>> '{changes,openShifts,0,openShiftId}' <> claimed::text then raise exception 'open rows: approved gap protection missing'; end if;
  select jsonb_agg(jsonb_build_object('userId',x -> 'userId','siteId',x -> 'siteId','startsAt',x -> 'startsAt',
    'endsAt',x -> 'endsAt','shiftCode',x -> 'shiftCode','kind',x -> 'kind')) into bad from jsonb_array_elements(preview -> 'assignments') x;
  payload := jsonb_set(payload,'{publication,assignments}',bad) || jsonb_build_object('openShifts',jsonb_build_array(gap));
  perform public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',payload);
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  if preview #>> '{changes,openShifts,0,openShiftId}' <> claimed::text then raise exception 'open rows: kept claim lost after publication'; end if;
  bad := jsonb_set(payload,'{publication,assignments}','[]');
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',bad),'roster_conflict');
end $publication_open_rows$;
-- Remembered off codes survive uploads, but cannot carry times or become assignments.
do $off_codes$
declare
  d date := (now() at time zone 'Australia/Perth')::date + 160;
  preview jsonb; payload jsonb; bad jsonb; fingerprint text;
begin
  payload := jsonb_build_object('roles','[]'::jsonb,'codes',
    '[{"code":"OFFX","kind":"off","starts":null,"ends":null,"label":"Off"}]'::jsonb,
    'publication',jsonb_build_object('kind','full','periodStart',d,'periodEnd',d,'assignments','[]'::jsonb));
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  perform public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',payload);
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  if not (preview -> 'codes') @> (payload -> 'codes') then raise exception 'off code was not remembered'; end if;
  perform public.roster_publish(pg_temp.id('mgr'),pg_temp.id('svc'),preview ->> 'freshnessToken',payload);
  preview := public.roster_publish_preview(pg_temp.id('mgr'),pg_temp.id('svc'),d,d);
  fingerprint := preview ->> 'freshnessToken';
  if not (preview -> 'codes') @> (payload -> 'codes') then raise exception 'off code lost on next upload'; end if;
  bad := jsonb_set(payload,'{codes,0,starts}','"08:00"');
  bad := jsonb_set(bad,'{codes,0,ends}','"16:00"');
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad),'roster_invalid_request');
  begin
    perform pg_temp.cmd('mgr','codes.set',jsonb_build_object('codes',bad -> 'codes'));
    raise exception 'off code with working hours accepted by base writer';
  exception when check_violation then null;
  end;
  bad := jsonb_set(payload,'{publication,assignments}',jsonb_build_array(jsonb_build_object('userId',pg_temp.id('lee'),
    'startsAt',d::timestamptz,'endsAt',d::timestamptz + interval '8 hours','shiftCode','OFFX','kind','off')));
  perform pg_temp.expect_error(format('select public.roster_publish(%L,%L,%L,%L)',pg_temp.id('mgr'),pg_temp.id('svc'),fingerprint,bad),'roster_invalid_request');
  if public.roster_publish_fingerprint(pg_temp.id('svc'),d,d) <> fingerprint then raise exception 'invalid off code partially wrote'; end if;
end $off_codes$;

-- Safe number: a save goes ahead only while the team still holds the needs the editor read,
-- so a manager who read before another manager's save is refused and that save stands.
do $needs_stale$
declare
  svc uuid := pg_temp.id('svc');
  read_before jsonb;
  read_after jsonb;
  monday jsonb := '[{"weekday":1,"date":null,"kind":"day","grade":null,"siteId":null,"needed":3}]';
  tuesday jsonb := '[{"weekday":2,"date":null,"kind":"night","grade":null,"siteId":null,"needed":2}]';
begin
  select coalesce(jsonb_agg(id), '[]') into read_before from public.roster_staffing_needs where service_id = svc;
  perform public.roster_needs_replace(pg_temp.id('mgr'), svc, read_before, monday);
  perform pg_temp.expect_error(format('select public.roster_needs_replace(%L,%L,%L,%L)',
    pg_temp.id('mgr'), svc, read_before, tuesday), 'roster_conflict');
  if (select count(*) from public.roster_staffing_needs where service_id = svc) <> 1
     or not exists (select 1 from public.roster_staffing_needs where service_id = svc and kind = 'day' and needed = 3) then
    raise exception 'needs: a stale save replaced the first save';
  end if;
  select jsonb_agg(id) into read_after from public.roster_staffing_needs where service_id = svc;
  perform pg_temp.expect_error(format('select public.roster_needs_replace(%L,%L,%L,%L)',
    pg_temp.id('mei'), svc, read_after, tuesday), 'roster_role_denied');
  perform public.roster_needs_replace(pg_temp.id('mgr'), svc, read_after, tuesday);
  if (select count(*) from public.roster_staffing_needs where service_id = svc) <> 1
     or not exists (select 1 from public.roster_staffing_needs where service_id = svc and kind = 'night' and weekday = 2) then
    raise exception 'needs: a save over a fresh read did not go ahead';
  end if;
end $needs_stale$;

-- 14. Deleting a doctor's account is never blocked by a Roster table.
reset role;
do $delete_account$
declare lee uuid := pg_temp.id('lee');
begin
  delete from auth.users where id = lee;
  if exists (select 1 from public.on_call_shifts where owner_id = lee) then raise exception 'delete: own shifts kept'; end if;
  if exists (select 1 from public.roster_publication_seen where user_id = lee) then raise exception 'delete: seen kept'; end if;
  if exists (select 1 from public.roster_assignments where user_id = lee) then raise exception 'delete: assignment still names them'; end if;
end
$delete_account$;
set local role service_role;

select 'roster behaviour: all checks passed' as result;
