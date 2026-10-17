# Decision: National youth crisis lines are not pinned for CAMHS crisis searches until the owner approves the list

- **Status:** decided 2026-10-18
- **Source:** `docs/outstanding-issues-inbox/dd1b66e0-1761-474c-b9bd-280288c5e294.json`, find "Owner ruling 18 Oct 2026 00:10 AWST: do NOT pin national youth crisis lines"

On 18 Oct 2026 at 00:10 AWST the owner ruled that national youth crisis lines (Lifeline WA, Suicide Call
Back Service, Kids Helpline, 13YARN) are not to be pinned for CAMHS crisis searches yet. Pinning waits
until the owner approves the exact list. Any future pinning must exclude services that are closed, planned,
superseded or marked temporarily unavailable, and must keep CAMHS Crisis Connect and MHERL first. There
is no code change: PR #3617 dropped its unapproved pinning attempt and cancelled its done request, and
#8CKX6F stays open with this ruling recorded through the ledger tool.

No routing was changed by this ruling. The existing `adult_metro_crisis` route (MHERL, then Lifeline WA;
Lifeline WA was boosted in PR #3157) still fires alongside `camhs_crisis` for a youth crisis query, so
`tests/service-urgent-routing.test.ts` expects CAMHS Crisis Connect, MHERL and Lifeline WA as the first
three results for "youth self harm". Whether the ruling's mention of Lifeline WA is meant to cover that
existing route is an open question for the owner on #8CKX6F. Until the owner answers, the route stays as
it is.

If this summary and the source ever differ, the source wins.
