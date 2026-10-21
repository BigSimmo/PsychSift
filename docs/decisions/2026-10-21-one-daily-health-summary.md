# Decision: One daily health summary at 7 am Perth replaces the separate phone alerts

- **Status:** decided 2026-10-21
- **Source:** `docs/observability-slos.md`, find "replaced the separate phone alerts with one daily health summary"
- **Retires:** `alert-mention-every-workflow`

On 21 Oct 2026 the owner asked to "Replace the many alerts with one daily health summary", then
approved the recommendations of the trimming plan ("Go ahead with all recommendations here").
The summary goes out every day at 7 am Perth time as one GitHub issue comment that @mentions the
owner, so the phone gets one push a day. Only two alerts still push straight away: the live domain
monitor opening a new failure issue (the site is down), and the ops digest reaching page level.
Every other monitor keeps its labelled issue for detail and no longer mentions or assigns anyone.
This replaces the weekly Monday summary chosen on 15 Oct and the every-workflow @mention rule of
20 and 21 Oct; the phone stays the channel chosen on 19 Oct.

If this summary and the source ever differ, the source wins.
