# Decision: OpenAI spending is held to US$30 a month

- **Status:** decided 2026-10-26
- **Source:** the owner, in chat

On 26 Oct 2026 the owner said "My openai montly budget is $30" and then "go ahead with all other recommendations". Every paid run (eval canaries, re-index pilots, answer checks) must fit inside US$30 a month across all OpenAI use. The daily spend alert `SPEND_ALERT_DAILY_USD` on the PsychSift Railway service is set to 3, not 20. Agents ask the owner before any paid run once the month's spend nears the budget. Per-run spending approval in `docs/agents/shared-context-and-memory.md` still applies.

If this summary and the source ever differ, the source wins.
