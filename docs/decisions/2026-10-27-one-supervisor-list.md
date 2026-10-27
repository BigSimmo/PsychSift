# Decision: People and roles is the one supervisor list for a hospital team

- **Status:** decided 2026-10-27
- **Source:** `supabase/migrations/20261027120000_one_supervisor_list.sql`, find "One supervisor list"

On 27 Oct 2026 the owner chose "One list in People and roles" when asked how the two supervisor lists should become one (`docs/access-roles.md`, known gap 1). For a team that belongs to a live hospital, the supervisor Medical Workforce, the DCT or the administrator names for a trainee in People and roles now starts and follows that trainee's Teaching pairing, so that supervisor confirms the trainee's supervision hours. Removing the name moves the pairing to the trainee's next named supervisor, or leaves it with nobody named, and pending sessions wait. The same check runs when someone joins or leaves a team and when a team joins or moves hospital, and once when the change goes live, so an existing pairing in a hospital team whose trainee has nobody named is left with nobody named. Teaching keeps the pairing as the record of sessions and can change only its dates. Confirmed sessions keep who confirmed them. A whole-team supervisor does not start pairings. Teams outside any hospital keep Teaching pairings as before. Merging the database change deploys it to the live database, so it merges only when the owner presses Merge.

If this summary and the source ever differ, the source wins.
