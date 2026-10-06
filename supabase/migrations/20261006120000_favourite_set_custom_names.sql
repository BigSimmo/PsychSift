-- Favourite sets can carry a name the clinician types instead of one of six
-- fixed names. Set names must still never become a patient-note field, so this
-- CHECK repeats the identifier rules in src/lib/favourite-set-name.ts as a
-- backstop: at most 40 characters with no surrounding spaces, no run of five
-- or more digits (UMRNs, phone numbers), no date-like digit pairs, no more than
-- four digits in total, no `@`, and not a name the app uses for its own buckets.
-- Every existing row holds one of the six original names, all of which pass.

alter table public.user_favourite_sets
  drop constraint if exists user_favourite_sets_name_check;
alter table public.user_favourite_sets
  add constraint user_favourite_sets_name_check
  check (
    char_length(name) between 1 and 40
    and name = btrim(name)
    and name !~ '[0-9]{5}'
    and name !~ '[0-9][/.-][0-9]'
    and char_length(regexp_replace(name, '[^0-9]', '', 'g')) <= 4
    and position('@' in name) = 0
    and lower(name) not in ('unsorted', 'all')
  );

-- Typed names make "ward round" and "Ward round" possible. The page groups and
-- filters by name, so two sets differing only in case would merge on screen.
create unique index if not exists user_favourite_sets_user_lower_name_key
  on public.user_favourite_sets (user_id, lower(name));
