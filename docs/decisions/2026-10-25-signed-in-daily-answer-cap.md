# Decision: Each signed-in account may make 250 answer requests a day

- **Status:** decided 2026-10-25
- **Source:** `src/lib/api-rate-limit.ts`, find "The owner confirmed 250 a day on 25 Oct 2026"

The owner confirmed a shared daily cap of 250 generation requests (answers, Clinical Ask and
transcription) for each signed-in account, on top of the per-minute limit. Changing the number is
a spend decision for the owner.

If this summary and the source ever differ, the source wins.
