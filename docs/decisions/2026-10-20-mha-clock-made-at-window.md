# Decision: The MHA clock refuses a made-at time more than 7 days ago or in the future

- **Status:** decided 2026-10-20
- **Source:** `src/lib/psychiatry-hub/mha-clocks.ts`, find "How far from now a form's"

The owner ruled (relayed via Grok Bot, 07:33 AWST on 20 October 2026) that the MHA clock refuses a
"When was it made?" time more than 7 days in the past, and refuses one in the future apart from a
few minutes' allowance for clock skew. Seven days covers Form 3A's 144-hour limit, the longest in
the timeframe data apart from recurring reviews. A later owner ruling the same day (20 October 2026,
via Grok Bot) exempts recurring-review forms such as 12C from the 7-day cap, because their review
repeats every 24 hours while the order is in force. The future-time refusal still applies to every
form.

If this summary and the source ever differ, the source wins.
