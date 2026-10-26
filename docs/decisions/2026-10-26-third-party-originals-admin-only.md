# Decision: Only administrators open third-party original files until each source has a licence entry

- **Status:** decided 2026-10-26
- **Source:** `src/lib/env.ts`, find "limits the original files of documents the caller does not own"

On 26 Oct 2026 the owner answered yes to question 5 of the project plan ("Go ahead with all
recommendations"): until each third-party source has a licence entry, only administrators can open
or download the original files of shared documents (regulatory finding R-05). Every signed-in health
professional still sees the cited excerpts, and people can always open their own uploads. The switch
`THIRD_PARTY_ORIGINALS_ADMIN_ONLY` is on by default; setting it to `false` reopens the originals once
licences are recorded.

If this summary and the source ever differ, the source wins.
