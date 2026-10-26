-- Synthetic disposable replay only (`npm run test:sql`). Proves 20261026085000_roster_swap_accept_team_rules.sql.
begin;
create temp table rule_test_ids (k text primary key, v uuid) on commit drop;
grant all on rule_test_ids to service_role;
do $setup$
declare s uuid;
begin
  insert into rule_test_ids values ('mgr', gen_random_uuid()), ('give', gen_random_uuid()),
    ('take', gen_random_uuid()), ('out', gen_random_uuid());
  insert into auth.users (id, email) select v, 'rule-' || k || '@example.org' from rule_test_ids;
  insert into public.on_call_services (name, created_by, is_demo)
    values ('Example rules team', (select v from rule_test_ids where k = 'mgr'), true) returning id into s;
  insert into public.on_call_service_members (service_id, user_id, role)
    select s, v, 'member' from rule_test_ids where k <> 'out';
  insert into public.roster_member_roles (service_id, user_id, role, grade, granted_by)
    select s, v, case when k = 'mgr' then 'manager' else 'member' end, 'resident',
      (select v from rule_test_ids where k = 'mgr') from rule_test_ids where k <> 'out';
  insert into rule_test_ids values ('svc', s);
end $setup$;
set local role service_role;
do $rules$
declare
  svc uuid := (select v from rule_test_ids where k = 'svc');
  mgr uuid := (select v from rule_test_ids where k = 'mgr');
  giver uuid := (select v from rule_test_ids where k = 'give');
  taker uuid := (select v from rule_test_ids where k = 'take');
  outsider uuid := (select v from rule_test_ids where k = 'out');
  d timestamptz := date_trunc('day', now()) + interval '30 days';
  pub uuid; give_id uuid; prior_id uuid; swap_id uuid; result jsonb; rule text; limit_value numeric;
begin
  insert into public.roster_publications(service_id, version, kind, period_start, period_end, published_by)
    values (svc, 1, 'full', d::date, d::date + 90, mgr) returning id into pub;
  foreach rule in array array['maxHours7d', 'maxHours14d', 'maxNightsInRow', 'maxDaysInRow'] loop
    delete from public.roster_assignments where service_id = svc;
    perform public.roster_command(mgr, svc, 'settings.set', '{"rules":{}}');
    insert into public.roster_assignments(service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind, grade)
      values (svc, pub, taker, d, d + interval '8 hours', 'N', 'night', 'resident') returning id into prior_id;
    insert into public.roster_assignments(service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind, grade)
      values (svc, pub, giver, d + interval '24 hours', d + interval '32 hours', 'N', 'night', 'resident') returning id into give_id;
    result := public.roster_command(giver, svc, 'swap.create',
      jsonb_build_object('giveAssignmentId', give_id, 'counterpartyId', taker));
    swap_id := (result ->> 'swapId')::uuid;
    -- Simulate the app reading empty rules, then the manager changing them before accept.
    limit_value := case when rule like 'maxHours%' then 8 else 1 end;
    perform public.roster_command(mgr, svc, 'settings.set',
      jsonb_build_object('rules', jsonb_build_object(rule, limit_value)));
    begin
      perform public.roster_command(outsider, svc, 'swap.accept', jsonb_build_object('swapId', swap_id));
      raise exception 'outsider accepted a swap';
    exception when raise_exception then
      if sqlerrm <> 'roster_access_denied' then raise; end if;
    end;
    result := public.roster_command(taker, svc, 'swap.accept', jsonb_build_object('swapId', swap_id));
    if result ->> 'status' <> 'accepted' or result ->> 'needsManagerBecause' <> 'team_rule' then
      raise exception '% did not require the manager: %', rule, result;
    end if;
    if (select user_id from public.roster_assignments where id = give_id) <> giver
      or exists (select 1 from public.roster_changes where service_id = svc and change ->> 'swapId' = swap_id::text) then
      raise exception '% changed ownership or left an approval side effect', rule;
    end if;
  end loop;

  -- Equal to the limit still approves automatically. Superseded shifts never
  -- contribute to this team's rule (cross-team scope is also pinned statically).
  delete from public.roster_assignments where service_id = svc;
  perform public.roster_command(mgr, svc, 'settings.set', '{"rules":{"maxHours7d":8}}');
  insert into public.roster_assignments(service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind, grade)
    values (svc, pub, giver, d, d + interval '8 hours', 'D', 'day', 'resident') returning id into give_id;
  insert into public.roster_assignments(service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind, superseded_at)
    values (svc, pub, taker, d - interval '24 hours', d - interval '16 hours', 'D', 'day', now());
  result := public.roster_command(giver, svc, 'swap.create', jsonb_build_object('giveAssignmentId', give_id, 'counterpartyId', taker));
  result := public.roster_command(taker, svc, 'swap.accept', jsonb_build_object('swapId', result ->> 'swapId'));
  if result ->> 'status' <> 'approved' then raise exception 'equal limit failed: %', result; end if;

  -- Existing unrelated flags are subtracted, rather than blocking every later swap.
  delete from public.roster_assignments where service_id = svc;
  perform public.roster_command(mgr, svc, 'settings.set', '{"rules":{"maxNightsInRow":1}}');
  insert into public.roster_assignments(service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind, grade)
    values (svc, pub, taker, d, d + interval '8 hours', 'N', 'night', 'resident'),
           (svc, pub, taker, d + interval '24 hours', d + interval '32 hours', 'N', 'night', 'resident');
  insert into public.roster_assignments(service_id, publication_id, user_id, starts_at, ends_at, shift_code, kind, grade)
    values (svc, pub, giver, d + interval '72 hours', d + interval '80 hours', 'D', 'day', 'resident') returning id into give_id;
  result := public.roster_command(giver, svc, 'swap.create', jsonb_build_object('giveAssignmentId', give_id, 'counterpartyId', taker));
  result := public.roster_command(taker, svc, 'swap.accept', jsonb_build_object('swapId', result ->> 'swapId'));
  if result ->> 'status' <> 'approved' then raise exception 'old flag blocked an unrelated swap: %', result; end if;
end $rules$;
select 'Roster transactional team-rule accept checks passed';
rollback;
