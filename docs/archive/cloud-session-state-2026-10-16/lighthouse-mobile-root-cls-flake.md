---
name: lighthouse-mobile-root-cls-flake
description: The Lighthouse budget CI gate flakes bimodally on mobile-root CLS (0.236 vs 0.013 baseline) and can block an unrelated PR — rerun the job before believing it
metadata:
  node_type: memory
  type: project
  originSessionId: 3b6b32c4-e01e-4cf3-8abe-b4c0c5ca2f14
  modified: 2026-08-17T12:09:16.982Z
---

`check:lighthouse-budget` in CI reports `mobile-root cls +0.223 vs baseline (max +0.02)` intermittently. Measured 2026-08-17 on PR #2022 (a server-only RAG diff with zero UI files): 0.236 / 0.236 / 0.013 across three samples of the same merge ref. The two failures were identical to three decimals, so the shift is quantized, not noisy — it either happens or it does not.

Controls run the same hour: PR #2028's merge ref measured 0.013, and PR #2026 (which _did_ touch `ClinicalDashboard`, `ClinicalSidebar` and `globals.css`) passed its own pre-merge Lighthouse. So `main` was clean and the block was flake.

Mechanism is almost certainly the phone overlay chrome reserve race that `/issues` `#147` claims RESOLVED — that row records mobile `/` at exactly 0.013, the same baseline value, and describes the reserve round trip that produces one large shift when it fires.

**Why:** the gate feeds the `PR required` aggregate, so a flake presents as a hard merge block on a PR that cannot have caused it, and the obvious-but-wrong response is to hunt the diff or raise the budget.

**How to apply:** when `Lighthouse budget` fails, first check whether the PR's diff can even reach the client bundle (grep the changed modules for imports from client components). If it cannot, rerun that single job — `gh run rerun --job <id>` — and compare against a same-hour control PR before treating it as real. Never raise the CLS budget to clear it. `#147` looks due for a reopen; the flake is not captured in `/issues` yet.
