# Decision: The overseas AI line stays on the Answer home, centred like the line under each answer

- **Status:** decided 2026-10-17
- **Source:** `src/components/ClinicalDashboard.tsx`, find "Centred to match the line under each answer"

The owner first asked for the overseas AI line to come off the home pages, then chose to keep it on the
Answer home in the same style as the line under each answer: centred, with the same wording. The wording
itself is set once in `src/components/clinical-dashboard/answer-provider-notice.tsx`, so both places
always say the same thing. This replaces the earlier 17 Oct 2026 decision to remove the line from the home pages.

If this summary and the source ever differ, the source wins.
