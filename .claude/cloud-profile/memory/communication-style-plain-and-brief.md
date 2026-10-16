---
name: communication-style-plain-and-brief
description: Josh wants short, plain-English answers that lead with what to do; no internal detail unless asked
metadata:
  type: feedback
---

Josh asked (2026-08-18) for replies to be much simpler and shorter: state plainly what he needs
to do, skip the detail and complexity. At the time this was saved in the workstation's
`C:\Users\joshs\.claude\CLAUDE.md`. That historical location does not establish what is loaded
on the current host; follow the user's current instructions.

**Why:** he is a psychiatrist, not a software engineer. Long technical answers full of file
paths, gate names and reasoning bury the one thing he actually has to decide or do.

**How to apply:** answer first, then numbered steps, under ~10 lines. One recommendation, not a
menu. No jargon without a plain-English gloss. Keep full detail only for destructive actions,
exact commands to run, clinical/privacy/patient-facing matters, decisive verification evidence,
and when he explicitly asks why or for more. Offer with "Want the
detail?" instead of dumping it. See the archived Windows test incidents (`docs/archive/cloud-session-state-2026-10-16/local-test-failures-windows.md`) for an example of the kind
of environment noise he does not need repeated back.

Resolve repository paths against the verified current checkout root, not this installed memory directory.
