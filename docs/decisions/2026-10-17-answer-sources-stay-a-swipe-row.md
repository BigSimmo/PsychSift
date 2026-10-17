# Decision: Answer sources stay a swipe row of small cards on phones

- **Status:** decided 2026-10-17
- **Source:** `src/components/clinical-dashboard/answer-source-rail.tsx`, find "The owner reversed that on 17 Oct 2026"

The owner asked for the cited documents under an answer to go back to a small sideways-scrolling row on phones, reversing the vertical phone list from the 13 Oct 2026 design audit (D07). He rejected large cards and long single-line chips, and chose small two-line cards (title, then page and review status). Each card is a fixed width so the row settles on whole cards with the next one peeking in, and a lone source widens to the column with a title that may wrap to two lines.

If this summary and the source ever differ, the source wins.
