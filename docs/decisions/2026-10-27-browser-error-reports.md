# Decision: Report phone and browser errors through our own server

- **Status:** decided 2026-10-27
- **Source:** `src/lib/observability/client-error-report.ts`, find "never read into it"

On 27 Oct 2026 the owner signed off phone error reporting (performance audit M4, held since the earlier "no phone-side error reporting" speed decision) by choosing "Yes, via our server". Uncaught errors in the browser are sent as a code-location-only report (error type, how it was caught, the first page-path segment and stack frames in the app's own `/_next/` files) to `/api/client-error` without cookies. The server re-checks every field and forwards it to Sentry, in the United States, through the same scrubber as server errors. The error message, query string, typed text, page content and account data are never read into the report. There is still no browser Sentry SDK and no session replay. The privacy page now says error reports from the app in your browser go to Sentry with typed text stripped.

If this summary and the source ever differ, the source wins.
