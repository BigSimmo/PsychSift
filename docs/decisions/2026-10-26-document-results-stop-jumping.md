# Decision: Document results no longer jump while a search loads

- **Status:** decided 2026-10-26
- **Source:** `src/components/ClinicalDashboard.tsx`, find "performance audit M2"
- **Background:** the owner chose "Build both" on 26 Oct 2026, after seeing before screenshots of a
  phone document search. Finding M2 in the project-files report
  `reviews/2026-10-26-performance-reliability-audit/report.html` measured a layout shift of 0.129
  on phone document results (above 0.1 is poor).

Two things moved the results. The "Also matches" strip arrived after the results and was drawn
above them, pushing every result down. It is now drawn under the document results, collapsed as
before. Tools, services and forms searches are unchanged. The separate "Searching…" line above the
results disappeared when they landed. Document searches no longer show it, because the results
area shows its own "Finding matching documents" placeholder. Answer searches are unchanged.

Measured with `scripts/measure-cls-attribution.mjs` on the offline build: phone 0.129 to 0.000,
computer (1350 px) 0.060 to 0.000.

If this summary and the source ever differ, the source wins.
