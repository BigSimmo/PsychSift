# Decision: Keep the full database migration history instead of folding it into one snapshot

- **Status:** decided 2026-10-16
- **Source:** the owner, in chat

The owner chose not to fold the older database migration history into one starting snapshot, because
rewriting the protected applied migration hashes, migration history and drift checks carries more risk
than benefit. The other three held scorecard items (removing unused search function versions, keeping
one PDF library, and splitting the answer pipeline into stages) wait until PR #3546 has landed, and
each still needs the owner's named yes before it reaches the database or the protected search files.

If this summary and the source ever differ, the source wins.
