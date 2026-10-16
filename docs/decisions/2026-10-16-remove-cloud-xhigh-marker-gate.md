# Decision: Retire the general Cloud xhigh prompt marker gate and allow local policy repair when raw-env checks fail

- **Status:** decided 2026-10-16
- **Source:** `docs/agents/codex-reasoning-effort.md`, find "prompt-resubmission gate were retired on 2026-10-16"
- **Retires:** `cloud-xhigh-confirmed-gate`

The owner retired the general `[xhigh-confirmed]` prompt marker and prompt-resubmission requirement in Codex Cloud so plain-language confirmation suffices when `xhigh` is recommended, while keeping the specialist RAG upgrade programme CLI launch check intact. The owner also clarified in `docs/agents/codex-cloud-environment.md` and `docs/codex-cloud.md` that a failed raw-environment credential check still blocks application execution and live provider access, but allows explicitly requested local policy/documentation inspection and repair alongside scrubbed offline checks.

If this summary and the source ever differ, the source wins.
