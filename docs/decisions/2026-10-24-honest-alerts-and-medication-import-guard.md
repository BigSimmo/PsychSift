# Decision: Alerts go red only for real problems, and the medicines import cannot undo corrections

- **Status:** decided 2026-10-24
- **Source:** `scripts/lib/medication-import-guard.mjs`, find "stops `npm run medications:import` silently undoing corrections"

On 24 Oct 2026 the owner approved the catch-up review's recommendations ("Go ahead with all of these
recommendations"). Three of them are code. The live-site monitor reads Forms and Services through the
public catalogue route and checks that search still refuses a signed-out visitor, instead of failing on
the intended sign-in gate. The daily health summary shows CI on main as amber, not red, when the only
outstanding checks are cross-browser legs or the advisory visual baselines. The medicines import stops,
and names each medicine, before it changes or removes one already in the repository, unless that change
is accepted by name.

If this summary and the source ever differ, the source wins.
