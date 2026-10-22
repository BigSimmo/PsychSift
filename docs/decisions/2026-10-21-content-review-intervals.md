# Decision: Reference content is reviewed every 12 or 24 months, and at once when a guideline changes

- **Status:** decided 2026-10-21
- **Source:** `src/lib/content-review-schedule.ts`, find "Owner decision (21 Oct 2026): medications and interactions are reviewed every 12"

The owner set review dates for reference content: medication records and medication interactions
every 12 months, therapy records and Mental Health Act forms every 24 months, and any of them
immediately when a guideline they cite changes ("Add review dates: 12 months for medications and
interactions, 24 months for therapy and forms, and immediately when a guideline changes"). A record
past its date stays readable and says its review is due; nothing is hidden. A guideline change only
counts once the owner confirms it in `src/data/source-change-events.json`, which the weekly source
watch (`.github/workflows/source-watch.yml`) prompts but never writes.

If this summary and the source ever differ, the source wins.
