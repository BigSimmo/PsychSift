-- Disposable PostgreSQL only: minimal fixtures, never a hosted/live database.
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create table public.on_call_services(id uuid primary key);
create table public.roster_open_shifts(id uuid primary key,service_id uuid,starts_at timestamptz,status text);
create table public.roster_open_post_keys(service_id uuid,post_key uuid primary key,open_shift_id uuid,posted_by uuid);
create table public.web_push_subscriptions(id uuid primary key,owner_id uuid);
create table public.on_call_service_members(service_id uuid,user_id uuid,revoked_at timestamptz);
grant select on public.roster_open_shifts,public.web_push_subscriptions,public.on_call_service_members to service_role;
grant insert on public.roster_open_post_keys to service_role;
