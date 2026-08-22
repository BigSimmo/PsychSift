# Cloud execution package — start here

This package executes P00–P17 only. One fresh Cloud session completes exactly one declared `TARGET_PHASE`, publishes its accepted tip to the same programme branch and stops. L00–L10 are local-only.

## Launch inputs before inspection

The user prompt must declare `TARGET_PHASE`, `PACKAGE_SOURCE_REF`, `PACKAGE_HEAD_SHA`, `PACKAGE_BASE_SHA`, `PROGRAMME_BRANCH` and selected Cloud effort. Do not inspect receipts to choose a phase after launch. Confirm the declared target is exactly next using the receipt checker.

- Use high for P00, P04, P10 and P11.
- Use xhigh for every other P01–P17 phase. The prompt must begin with the exact repository xhigh confirmation marker and the user must select xhigh in the Cloud control before launch.

If target, prompt marker or UI effort is wrong, stop before substantive inspection. Cloud cannot raise its own effort.

As the first repository-local validation after the raw boundary and setup, run `node scripts/rag-phase-launch-check.mjs --target TARGET_PHASE --effort SELECTED_EFFORT`. Add `--xhigh-confirmed` only when the xhigh prompt marker is present. A failure stops the task.

## Raw environment boundary — first command

Before a login shell, profile, setup script or OpenAI-capable binary, run:

```bash
set +e
bash scripts/check-codex-cloud-raw-env.sh
raw_status=$?
set -e
```

Exit 0 continues. Exit 1 is a hard stop and requires a fresh task. Exit 2 continues only for the documented `OPENAI_BASE_URL`-alone restricted path: never run OpenAI clients from the raw parent or bypass the generated profile and `node`/`npm`/`npx` shims. No other inherited name may use that path.

Cloud has no Windows task-start script. Perform the equivalent read-only repository identity, branch, HEAD, status and worktree checks. Require a clean disposable checkout on a task-specific non-protected branch.

## Setup and acceptance order

After the raw boundary:

```bash
bash scripts/setup-codex-cloud.sh
bash scripts/install-codex-cloud-command-shims.sh
npm run check:codex-cloud
CODEX_CLOUD_EXPECTED_BASE_SHA="$PACKAGE_BASE_SHA" npm run check:codex-cloud -- --runtime
npm run check:runtime
npm run check:installed-lock-parity
npm run plans:rag:check
```

Use the verified intended base SHA, not arbitrary HEAD, for `PACKAGE_BASE_SHA`. Before P00 also run `npm run plans:rag:publish-check`. Once P00 is accepted, preserve the immutable recorded package/base identity; unrelated later main movement does not rewrite accepted history.

## Branch and package identity

For P00, fetch the published package ref and verify its exact immutable `PACKAGE_HEAD_SHA`, then create the declared programme branch from that commit. For P01–P17, fetch and check out the exact remote programme tip without rebase. Do not absorb current main or the quarantined local RAG worktree.

Compute the committed generated Cloud package hash with the receipt checker. Record package base/head, programme implementation base, branch and hashes in the receipt. A mismatch is a hard stop.

## Mandatory SDD capability probe

Read `.agents/skills/rag-cloud-sdd/SKILL.md`, `sdd-execution.md`, the manifest skill profiles and the selected repo-local skill files completely. Hash them, `scripts/rag-phase-launch-check.mjs` and `scripts/rag-task-brief.mjs`. Dispatch one fresh read-only probe agent and record its agent ID and authoritative dispatch metadata. No actual fresh subagent runtime means `BLOCKED_MISSING_SUBAGENT_RUNTIME`; no controller/helper/required skill means `BLOCKED_MISSING_CAPABILITY`.

Prove controller and every dispatched agent route from sanitized host metadata using `route-evidence.schema.json`. Store the host-emitted record directly; do not synthesize it from model prose. The checker parses and binds its routing fields, but cannot turn an unsigned self-authored file into host proof. Cloud requires Codex, exact model and exact effort with no mapping or fallback. Stop with `BLOCKED_MODEL_ROUTE_UNVERIFIED` if the host cannot directly provide the evidence.

## Execute and stop

Validate the declared target with `npm run plans:rag:receipts:check -- --before TARGET_PHASE`. Execute exactly that phase through the tracked SDD contract. Task commits and the one atomic phase-receipt commit are authorized by the launch prompt; no connected action is.

P17 is additionally authorized to create one separate add-only atomic `PROGRAMME.json` metadata commit after its fresh full-programme review passes. It pushes that accepted tip and stops. Report the exact local handover prompt path, but do not begin L00 or any hosted/provider/reindex/deployment action in Cloud.
