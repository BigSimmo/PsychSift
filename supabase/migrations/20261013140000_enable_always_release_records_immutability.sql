-- #4W704K: Ensure the immutability trigger on site_content_release_records
-- cannot be bypassed even when session_replication_role = 'replica'.
alter table public.site_content_release_records
  enable always trigger site_content_release_records_immutable;
