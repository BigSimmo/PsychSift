# Decision: Sign-up is invite-only until launch, with a hard OpenAI spending limit

- **Status:** decided 2026-10-19; invite-only sign-up reversed 2026-10-21 by the owner ("keep sign in as anyone"), the OpenAI spending limit stands
- **Source:** the owner, in chat

Repository audit F-06 found no overall cap on paid answer generation for signed-in accounts. The
owner accepted the recommendation to make sign-up invite-only until launch and to set a hard
monthly limit in the OpenAI account. Both are settings the owner changes in the Supabase Auth and
OpenAI dashboards; no code enforces them.

If this summary and the source ever differ, the source wins.
