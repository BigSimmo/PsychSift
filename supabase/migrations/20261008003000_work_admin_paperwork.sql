-- Never edit an applied migration. Merging this applies it to the live database.
-- Admin paperwork kept with the account (owner decision 8 Oct 2026, "Backend decisions for Josh",
-- question 3, chosen on the decision card): the doctor's own requests, documents list, sharing
-- choices, payslip checks and tax checklist, until now kept on one device only. One row per doctor
-- holding the whole record exactly as the Admin pages keep it
-- (src/lib/work-screens/admin/paperwork-model.ts). Written only by /api/work/sync with the service
-- role after the record is validated; the newest save wins. A null record means the doctor cleared it,
-- kept so their other devices clear it too.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.work_admin_paperwork (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  record jsonb,
  updated_at timestamptz not null default now(),
  constraint work_admin_paperwork_record_object check (record is null or jsonb_typeof(record) = 'object'),
  constraint work_admin_paperwork_record_size check (record is null or octet_length(record::text) <= 262144)
);

alter table public.work_admin_paperwork enable row level security;
revoke all on table public.work_admin_paperwork from public, anon, authenticated;
grant select, insert, update, delete on table public.work_admin_paperwork to service_role;
