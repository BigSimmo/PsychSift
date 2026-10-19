# Decision: The MHA clock refuses a made-at time more than 7 days ago or in the future

- **Status:** decided 2026-10-20
- **Source:** `src/lib/psychiatry-hub/mha-clocks.ts`, find "How far from now a form's"

The owner ruled (relayed via Grok Bot, 07:33 AWST on 20 October 2026) that the MHA clock refuses a
"When was it made?" time more than 7 days in the past, and refuses one in the future apart from a
few minutes' allowance for clock skew. Seven days covers Form 3A's 144-hour limit, the longest in
the timeframe data.

If this summary and the source ever differ, the source wins.
