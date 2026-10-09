-- Never edit an applied migration. Merging this applies it to the live database.
-- More leave kinds in Roster (owner request 8 Oct 2026, "top 20 next steps" item 13, owner yes
-- 9 Oct 2026): exam leave and personal leave join annual and professional development leave.
-- Conference leave stays the pd_leave kind, as the agreement draws it from the same leave
-- (cl 18(3), cl 30). Personal leave keeps no reason, only the kind, and roster managers see it by
-- name in team_leave like every other kind. Widening the check only: every existing row passes it.
-- App side: src/lib/roster/leave-kinds.ts lists exactly these kinds.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.roster_leave drop constraint roster_leave_kind_check;
alter table public.roster_leave add constraint roster_leave_kind_check
  check (kind in ('annual', 'pd_leave', 'exam', 'personal'));
