-- Minimal local-only GoTrue helper used by public SECURITY DEFINER functions
-- during bare-image schema replay. Hosted Supabase owns the real auth.jwt().
create or replace function auth.jwt()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
