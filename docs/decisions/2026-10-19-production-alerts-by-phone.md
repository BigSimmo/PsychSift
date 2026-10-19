# Decision: Production alerts reach the owner by phone notification

- **Status:** decided 2026-10-19
- **Source:** `docs/observability-slos.md`, find "The owner chose phone notification as the production alert channel on 2026-10-19"

On 19 Oct 2026 the owner chose phone notification over email as the alert channel for production
problems, because email is easy to miss during clinic. The ops digest now assigns its rolling issue to
the repository owner before posting an attention comment, so the GitHub mobile app pushes it to the
owner's phone. Delivery is unproven until the owner has received one push.

If this summary and the source ever differ, the source wins.
