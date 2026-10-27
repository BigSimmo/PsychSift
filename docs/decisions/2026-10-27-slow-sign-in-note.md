# Decision: Say why a page opened signed out when sign-in was too slow

- **Status:** decided 2026-10-27
- **Source:** `src/components/front-door/slow-sign-in-notice.tsx`, and `SLOW_SIGN_IN_COOKIE` in `src/lib/supabase/auth-deadline.ts`

On 27 Oct 2026 the owner chose "Build" on the slow sign-in note mockup. When the server's 4 second sign-in limit is reached the page opens as signed out, and a note now says "Sign-in is slow right now. So this page opened as signed out. You are still signed in. Try again in a moment", with Try again to reload. It never shows on a normal signed-out visit. The proxy marks the page with a one-minute flag cookie that names no one, and the note clears it.

If this summary and the source ever differ, the source wins.
