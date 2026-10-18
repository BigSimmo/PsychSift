-- Run only after setup.sql and the draft outbox migration in a disposable database.
-- Roles deliberately prove invoker privileges/RLS. UUIDs are synthetic fixture constants.
insert into auth.users values
 ('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003'),('00000000-0000-4000-8000-000000000004');
insert into on_call_services values ('00000000-0000-4000-8000-000000000001');
insert into roster_open_shifts values ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001',now()+interval '1 day','open');
insert into web_push_subscriptions values ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000003'),('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000003');
insert into on_call_service_members values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',null);
begin;
insert into roster_open_post_keys values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002');
rollback;
do $$ begin
 if exists(select 1 from roster_offer_alert_outbox) then raise exception 'enqueue escaped rollback'; end if;
end $$;
set role service_role;
insert into roster_open_post_keys values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000002');
do $$ declare e jsonb; t uuid; s uuid := '00000000-0000-4000-8000-000000000005'; begin
 e:=roster_offer_alert_work('claim',s); t:=(e->>'lease_token')::uuid;
 if t is null then raise exception 'no claim'; end if;
 if roster_offer_alert_work('claim',s) is not null then raise exception 'duplicate claim'; end if;
 perform roster_offer_alert_work('prepare',s,t,array['00000000-0000-4000-8000-000000000003'::uuid,'00000000-0000-4000-8000-000000000004'::uuid]);
 if jsonb_array_length(roster_offer_alert_work('devices',s,t))<>2 then raise exception 'recipient isolation'; end if;
 perform roster_offer_alert_work('ack',s,t,null,'00000000-0000-4000-8000-000000000006','sent');
 perform roster_offer_alert_work('ack',s,t,null,'00000000-0000-4000-8000-000000000007','retry');
 perform roster_offer_alert_work('release',s,t);
 if roster_offer_alert_work('claim',s) is not null then raise exception 'retry not delayed'; end if;
end $$;
reset role;
update roster_offer_alert_devices set available_at=now()-interval '1 second' where outcome='pending';
update roster_offer_alert_outbox set available_at=now()-interval '1 second';
set role service_role;
do $$ declare e jsonb; t uuid; old_t uuid; s uuid := '00000000-0000-4000-8000-000000000005'; begin
 e:=roster_offer_alert_work('claim',s); t:=(e->>'lease_token')::uuid;
 if jsonb_array_length(roster_offer_alert_work('devices',s,t))<>1 then raise exception 'successful device retried'; end if;
 if roster_offer_alert_work('ack',s,gen_random_uuid(),null,'00000000-0000-4000-8000-000000000007','sent') is not null then raise exception 'stale ack accepted'; end if;
 perform roster_offer_alert_work('release',s,t);
end $$;
reset role;
set role authenticated;
do $$ begin
 begin perform roster_offer_alert_work('claim'); raise exception 'function exposed'; exception when insufficient_privilege then null; end;
 begin perform 1 from roster_offer_alert_devices; raise exception 'table exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: enqueue rollback, partial device retry, stale ack fence, service-role privileges, authenticated denial' as result;
-- Leave one retry due for the separate two-session SKIP LOCKED/lease-expiry test.
