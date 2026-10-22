# Decision: On Call example rows stay on the shared read

- **Status:** decided 2026-10-19
- **Source:** `src/app/api/on-call/demo-content/route.ts`, find "That is a property of the data, not of this route"

Repository audit F-25 noted that example On Call content one account loads is visible to every
signed-in reader. The owner accepted the recommendation to leave it as it is: the rows are
all-zero placeholders, the control warns before loading, and removal is one request. Filtering
example slugs out of the shared read was rejected because it could hide a real row that shares a
slug.

If this summary and the source ever differ, the source wins.
