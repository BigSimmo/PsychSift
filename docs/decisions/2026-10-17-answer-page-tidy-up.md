# Decision: Answer page tidy-up and a shorter overseas notice

- **Status:** decided 2026-10-17
- **Source:** `src/components/clinical-dashboard/answer-provider-notice.tsx`, find "AnswerSummaryUnavailableNotice"

The owner approved a mockup of the Answer page and asked for it to be built. The overseas notice under an answer now reads "Sent to OpenAI overseas. Don't include patient details." and is centred. When the model could not write the answer, an amber "AI summary unavailable" line sits directly under that notice instead of a sentence above the question. Other degraded reasons, which say something about the evidence, keep their sentence above the answer. The limitations chip drops its count when it already says "Source-only" or "Review due", and the support and limitations chips share one square shape and size. "How this answer was built" moved under the answer's actions, and "Also in your library" became a plain row with its count shown at every width.

If this summary and the source ever differ, the source wins.
