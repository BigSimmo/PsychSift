# Decision: Sign in and Create account are separate, and the email is remembered

- **Status:** decided 2026-10-26; superseded in part by 2026-11-05-remembered-email-clearing-and-label.md
- **Source:** the owner, in chat

On 26 Oct 2026 the owner asked to "have sign up and sign in clear", to "perfect the design" and to "ensure everything is remembered". After a before and after mockup, the owner said "Build" and then "Perfect further in real build".

- The account window opens on a two-way switch, Sign in or Create account. The heading follows it ("Welcome back" or "Create your account"). The favourites prompt opens on Create account.
- On Create account, the provider buttons read "Sign up with Apple, Google, Microsoft".
- The email-link sign-in is a text link under the Sign in button, not a third tab. "Forgot password?" shows only on Sign in.
- Show password, and "Remember my email on this device" (ticked by default, email address only, kept in this browser, removed when unticked). The privacy page says so.
- When signed out, the account control in the menu reads "Sign in or create an account" instead of a "G Guest" initial.
- On a phone the close button has its own row, so it no longer covers a provider button.
- No Supabase or session setting changed. Staying signed in, Terms acceptance and returning to the page you were on already worked.

## 2026-11-05 wording clarification

The remembered-email wording above records the original choice. The owner subsequently chose to keep sign-out clearing and clarify its label; the [dated clarification](2026-11-05-remembered-email-clearing-and-label.md) governs that wording. The other choices above remain in force.

If this summary and the source ever differ, the source wins.
