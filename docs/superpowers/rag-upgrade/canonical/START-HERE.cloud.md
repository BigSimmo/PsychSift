# Cloud execution package — start here

This package executes P00–P17 only. One fresh Cloud session completes exactly one declared `TARGET_PHASE`, publishes its accepted tip to the same programme branch and stops. L00–L10 are local-only.

## Launch inputs before inspection

The user prompt must declare `TARGET_PHASE`, `PACKAGE_SOURCE_REF`, `PACKAGE_HEAD_SHA`, `PACKAGE_BASE_SHA`, `PROGRAMME_BRANCH` and selected Cloud effort. Do not inspect receipts to choose a phase after launch. Confirm the declared target is exactly next using the receipt checker.

- Use high for P00, P04, P10 and P11.
- Use xhigh for every other P01–P17 phase. The user must select xhigh in the Cloud control before launch and confirm that selection; ordinary-language confirmation is sufficient. No literal prompt token or resubmission is required.

If target or UI effort is wrong, stop before substantive inspection. Cloud cannot raise its own effort. If confirmation is missing, request it once; continue after the user confirms.

After the applicable host readiness checks below, run `node scripts/rag-phase-launch-check.mjs --target TARGET_PHASE --effort SELECTED_EFFORT` as the first programme-local validation. Add `--xhigh-confirmed` only when the user has confirmed xhigh selection, including in ordinary language. This flag records user attestation, not observed runtime effort; authoritative route evidence remains required. A failure stops phase execution.

## Current host readiness and optional legacy setup

Follow `docs/agents/codex-cloud-environment.md` for the current host's readiness,
capabilities and credential boundaries. Linux/Cloud execution, `CODEX_CLOUD=1` or
an earlier probe does not select the repository's legacy offline/connected setup.
Keep this programme provider-free on every host. Cloud has no Windows task-start
script: perform the equivalent read-only repository identity, branch, HEAD, status
and worktree checks. Require a clean disposable checkout on a task-specific
non-protected branch.

Only when the owner or selected environment configuration explicitly adopts the
legacy setup, follow `docs/codex-cloud.md#scope-and-selection`. Before a login shell,
profile, setup script or OpenAI-capable binary in that selected setup, run:

```bash
set +e
bash scripts/check-codex-cloud-raw-env.sh
raw_status=$?
set -e
```

For that legacy setup, exit 0 continues. Exit 1 blocks programme execution and
requires the documented recovery and fresh task; the runbook's bounded local
policy-repair exception remains separate from acceptance. Exit 2 continues only
for the documented `OPENAI_BASE_URL`-alone restricted path: never run OpenAI clients
from the raw parent or bypass the generated profile and `node`/`npm`/`npx` shims.
No other inherited name may use that path. After its accepted raw boundary, run:

```bash
bash scripts/setup-codex-cloud.sh
bash scripts/install-codex-cloud-command-shims.sh
npm run check:codex-cloud
CODEX_CLOUD_EXPECTED_BASE_SHA="$PACKAGE_BASE_SHA" npm run check:codex-cloud -- --runtime
```

For other host-managed environments, use the current host's supported readiness
checks; do not run legacy setup or install its shims to satisfy this package.
Then, on every host, run the programme's repository acceptance checks:

```bash
npm run check:runtime
npm run check:installed-lock-parity
npm run plans:rag:check
```

Use the verified intended base SHA, not arbitrary HEAD, for `PACKAGE_BASE_SHA`. Before P00 also run `npm run plans:rag:publish-check`. Once P00 is accepted, preserve the immutable recorded package/base identity; unrelated later main movement does not rewrite accepted history.

## Branch and package identity

For P00, fetch the published package ref and verify its exact immutable `PACKAGE_HEAD_SHA`, then create the declared programme branch from that commit. For P01–P17, fetch and check out the exact remote programme tip without rebase. Do not absorb current main or the quarantined local RAG worktree.

Compute the committed generated Cloud package hash with the receipt checker. Record package base/head, programme implementation base, branch and hashes in the receipt. A mismatch is a hard stop.

## Mandatory SDD capability probe

Read `.agents/skills/rag-cloud-sdd/SKILL.md`, `sdd-execution.md`, the manifest skill profiles and the selected repo-local skill files completely. Hash them, `scripts/rag-phase-launch-check.mjs` and `scripts/rag-task-brief.mjs`. Assign the fresh read-only probe a useful bounded inspection of target-phase dependencies, accepted receipts and relevant source conflicts. Retain its findings, agent ID and authoritative dispatch metadata; do not dispatch a dummy task solely to demonstrate tool availability. No actual fresh subagent runtime means `BLOCKED_MISSING_SUBAGENT_RUNTIME`; no controller/helper/required skill means `BLOCKED_MISSING_CAPABILITY`.

Prove controller and every dispatched agent route from sanitized host metadata using `route-evidence.schema.json`. Store the host-emitted record directly; do not synthesize it from model prose. The checker parses and binds its routing fields, but cannot turn an unsigned self-authored file into host proof. Cloud requires Codex, exact model and exact effort with no mapping or fallback. Stop with `BLOCKED_MODEL_ROUTE_UNVERIFIED` if the host cannot directly provide the evidence.

## Execute and stop

Validate the declared target with `npm run plans:rag:receipts:check -- --before TARGET_PHASE`. Execute exactly that phase through the tracked SDD contract. Task commits and the one atomic phase-receipt commit are authorized by the launch prompt; no connected action is.

P17 is additionally authorized to create one separate add-only atomic `PROGRAMME.json` metadata commit after its fresh full-programme review passes. It pushes that accepted tip and stops. Report the exact local handover prompt path, but do not begin L00 or any hosted/provider/reindex/deployment action in Cloud.
