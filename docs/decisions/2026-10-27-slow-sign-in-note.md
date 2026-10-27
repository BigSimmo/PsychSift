# Decision: Say why a page opened signed out when sign-in was too slow

- **Status:** decided 2026-10-27
- **Source:** `src/components/front-door/slow-sign-in-notice.tsx`, find "Checking your sign-in took too long"

On 27 Oct 2026 the owner chose "Build" on the slow sign-in note mockup. When the server's 4 second sign-in limit is reached the page opens as signed out, and a note now says "Sign-in is slow right now. Checking your sign-in took too long, so this page opened as signed out. Try again in a moment", with Try again to reload. It never shows on a normal signed-out visit. The proxy marks the page (never an API call) with a one-minute flag cookie that names no one, and the note, mounted in the root layout so every page can show it, clears it. The mockup line "You are still signed in" was dropped in review because a timed-out check cannot confirm the session is still valid.

If this summary and the source ever differ, the source wins.
