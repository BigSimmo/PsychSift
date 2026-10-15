# Decision: No database change without the owner's explicit permission

- **Status:** decided 2026-10-15
- **Source:** `AGENTS.md`, find "No database change without the owner's explicit permission"

The owner asked that no database settings be changed without the owner's explicit permission, and that resealing migration files need the same permission. No AI tool, script or automation may change the live database, its Supabase settings, its passwords or keys, or reseal an already-shipped migration unless the owner has said yes in words to that specific change.

If this summary and the source ever differ, the source wins.
