-- Never edit an applied migration. Merging this applies it to the live database.
-- Deleting a doctor's account also clears their id from the open-shift post keys.
-- roster_open_shifts.posted_by already clears itself when the account goes (on delete set null);
-- the post keys added in 20261015174500 kept the same id with no link to the account, so it stayed
-- until the open shift itself was purged. This gives roster_open_post_keys.posted_by the same
-- link. Any key whose poster's account is already gone is cleared first so the link can be added.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

update public.roster_open_post_keys k
   set posted_by = null
 where k.posted_by is not null
   and not exists (select 1 from auth.users u where u.id = k.posted_by);

create index roster_open_post_keys_posted_by_idx on public.roster_open_post_keys (posted_by);

alter table public.roster_open_post_keys
  add constraint roster_open_post_keys_posted_by_fkey
  foreign key (posted_by) references auth.users (id) on delete set null;
