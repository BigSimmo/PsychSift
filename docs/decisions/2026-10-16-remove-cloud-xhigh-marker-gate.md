# Decision: Retire the general Cloud xhigh prompt marker gate and allow local policy repair when raw-env checks fail

- **Status:** decided 2026-10-16
- **Source:** `docs/agents/codex-reasoning-effort.md`, find "former Cloud prompt-marker and prompt-resubmission gate was retired on 2026-10-16"
- **Retires:** `cloud-xhigh-marker-gate`

The owner retired the Cloud `xhigh` prompt-marker and prompt-resubmission requirement across repository policies and Cloud phase launch checks so plain-language confirmation suffices when `xhigh` is recommended. The owner also clarified in `docs/agents/codex-cloud-environment.md` and `docs/codex-cloud.md` that an inherited `GH_TOKEN` or `OPENAI_BASE_URL` in the raw parent process uses the scrubbed profile-and-shim path and never blocks explicitly requested local policy/documentation inspection and repair or scrubbed offline checks.

If this summary and the source ever differ, the source wins.
